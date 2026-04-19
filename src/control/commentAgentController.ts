import type { TFile } from "obsidian";
import type { CommentManager } from "../commentManager";
import {
    cloneAgentRunStreamState,
    getAgentRunsForCommentThread,
    getLatestAgentRunForThread,
    getQueuedAgentRuns,
    type AgentRunRecord,
    type AgentRunRuntime,
    type AgentRunStreamState,
} from "../core/agents/agentRuns";
import {
    getPrimarySupportedAgentActor,
    resolveUnsupportedAgentNotice,
} from "../core/agents/agentActorRegistry";
import type { SideNote2AgentTarget } from "../core/config/agentTargets";
import { parseAgentDirectives } from "../core/text/agentDirectives";
import { AgentRunStore } from "./agentRunStore";
import { isAgentRuntimeCancelledError } from "./agentRuntimeAdapter";
import { buildAgentPromptContext } from "./agentPromptContextPlanner";

export interface SavedUserEntryEvent {
    threadId: string;
    entryId: string;
    filePath: string;
    body: string;
}

export interface AgentRuntimeResponse {
    runtime: AgentRunRuntime;
    replyText: string;
}

export interface AgentStreamUpdate {
    threadId: string;
    stream: AgentRunStreamState | null;
}

export interface CommentAgentHost {
    createCommentId(): string;
    now(): number;
    refreshCommentViews?(): Promise<void>;
    getRuntimeWorkingDirectory(filePath: string): string | null;
    getCommentManager(): CommentManager;
    getFileByPath(filePath: string): TFile | null;
    isCommentableFile(file: TFile | null): file is TFile;
    getCurrentNoteContent(file: TFile): Promise<string>;
    loadCommentsForFile(file: TFile): Promise<unknown>;
    appendThreadEntry(
        threadId: string,
        entry: {
            id: string;
            body: string;
            timestamp: number;
        },
        options?: {
            skipCommentViewRefresh?: boolean;
        },
    ): Promise<boolean>;
    editComment(commentId: string, newCommentText: string, options?: { skipCommentViewRefresh?: boolean }): Promise<boolean>;
    deleteComment(commentId: string, options?: { skipCommentViewRefresh?: boolean }): Promise<void>;
    runAgentRuntime(invocation: {
        target: SideNote2AgentTarget;
        prompt: string;
        cwd: string;
        onPartialText?: (partialText: string) => void;
        onProgressText?: (progressText: string) => void;
        abortSignal?: AbortSignal;
    }): Promise<AgentRuntimeResponse>;
    showNotice(message: string): void;
    log?(level: "info" | "warn" | "error", area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
}

const PRIMARY_SUPPORTED_AGENT = getPrimarySupportedAgentActor();
const AGENT_CONFLICT_NOTICE = "Use only one explicit supported agent target per side note.";
const AGENT_RETRY_NOTICE = `Retry requires a single explicit ${PRIMARY_SUPPORTED_AGENT.directive} target in the triggering entry.`;
const AGENT_PENDING_SESSION_NOTICE = "The previous SideNote2 agent run did not finish. Retry the thread to run it again.";
const AGENT_DESKTOP_RUNTIME_NOTICE = "Agent execution requires desktop Obsidian with a filesystem-backed vault.";
const AGENT_REGENERATE_REPLACE_FAILED_NOTICE = "Unable to replace the previous agent reply.";
const AGENT_CANCELLED_NOTICE = "Cancelled.";
const AGENT_STATUS_CANCELLED = "Cancelled";

interface ActiveRunExecution {
    runId: string;
    threadId: string;
    abortController: AbortController;
    cancelRequested: boolean;
}

function summarizeError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }

    return "Agent execution failed.";
}

type AgentStreamListener = (update: AgentStreamUpdate) => void;
const FINAL_STREAM_RETENTION_MS = 30_000;

export class CommentAgentController {
    private processingQueue = false;
    private readonly runStreams = new Map<string, AgentRunStreamState>();
    private readonly runStreamPruneTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly streamListeners = new Set<AgentStreamListener>();
    private readonly activeRunExecutions = new Map<string, ActiveRunExecution>();

    constructor(
        private readonly host: CommentAgentHost,
        private readonly store: AgentRunStore,
    ) {}

    public initialize(): void {
        this.store.load();
    }

    public async reconcilePendingRunsFromPreviousSession(): Promise<void> {
        const changed = await this.store.failPendingRuns(
            AGENT_PENDING_SESSION_NOTICE,
            this.host.now(),
        );
        if (changed) {
            await this.refreshStatusViews();
        }
    }

    public getAgentRuns(): AgentRunRecord[] {
        return this.store.getRuns();
    }

    public getLatestAgentRunForThread(threadId: string): AgentRunRecord | null {
        return getLatestAgentRunForThread(this.store.getRuns(), threadId);
    }

    public getActiveAgentStreamForThread(threadId: string): AgentRunStreamState | null {
        const matchingStreams = Array.from(this.runStreams.values())
            .filter((stream) => stream.threadId === threadId)
            .sort((left, right) => right.updatedAt - left.updatedAt);
        return matchingStreams[0] ? cloneAgentRunStreamState(matchingStreams[0]) : null;
    }

    public subscribeToStreamUpdates(listener: AgentStreamListener): () => void {
        this.streamListeners.add(listener);
        return () => {
            this.streamListeners.delete(listener);
        };
    }

    public dispose(): void {
        this.streamListeners.clear();
        for (const timer of this.runStreamPruneTimers.values()) {
            clearTimeout(timer);
        }
        this.runStreamPruneTimers.clear();
        for (const execution of this.activeRunExecutions.values()) {
            execution.cancelRequested = true;
            execution.abortController.abort();
        }
        this.activeRunExecutions.clear();
        this.runStreams.clear();
    }

    public async handleSavedUserEntry(event: SavedUserEntryEvent): Promise<void> {
        const resolution = parseAgentDirectives(event.body);
        const resolvedTarget = this.resolveDispatchTarget(resolution, event);
        if (!resolvedTarget) {
            return;
        }

        const run = this.buildQueuedRun({
            threadId: event.threadId,
            triggerEntryId: event.entryId,
            filePath: event.filePath,
            requestedAgent: resolvedTarget,
            promptText: event.body,
        });
        await this.enqueueRun(run);
        void this.host.log?.("info", "agents", "agents.directive.detected", {
            threadId: event.threadId,
            entryId: event.entryId,
            requestedAgent: run.requestedAgent,
        });
    }

    public async retryRun(runId: string): Promise<boolean> {
        const previousRun = this.store.getRunById(runId);
        if (!previousRun) {
            this.host.showNotice("Unable to find that agent reply.");
            return false;
        }

        const file = this.host.getFileByPath(previousRun.filePath);
        if (!this.host.isCommentableFile(file)) {
            this.host.showNotice("Unable to reload that side note reply.");
            return false;
        }

        await this.host.loadCommentsForFile(file);
        const latestComment = this.host.getCommentManager().getCommentById(previousRun.triggerEntryId);
        if (!latestComment) {
            this.host.showNotice("Unable to find the latest saved side note entry.");
            return false;
        }

        const thread = this.host.getCommentManager().getThreadById(previousRun.threadId);
        if (!thread) {
            this.host.showNotice("Unable to find that side note thread.");
            return false;
        }

        const resolution = parseAgentDirectives(latestComment.comment);
        const resolvedTarget = this.resolveRetryTarget(resolution);
        if (!resolvedTarget) {
            return false;
        }

        const run = this.buildQueuedRun({
            threadId: thread.id,
            triggerEntryId: previousRun.triggerEntryId,
            filePath: latestComment.filePath,
            requestedAgent: resolvedTarget,
            promptText: latestComment.comment,
            retryOfRunId: previousRun.id,
        });
        await this.enqueueRun(run);
        void this.host.log?.("info", "agents", "agents.retry.created", {
            runId: run.id,
            retryOfRunId: previousRun.id,
            threadId: thread.id,
            triggerEntryId: previousRun.triggerEntryId,
            requestedAgent: run.requestedAgent,
        });
        return true;
    }

    public async cancelRun(runId: string): Promise<boolean> {
        const run = this.store.getRunById(runId);
        if (!run || (run.status !== "queued" && run.status !== "running")) {
            return false;
        }

        const execution = this.activeRunExecutions.get(runId);
        if (execution) {
            execution.cancelRequested = true;
            execution.abortController.abort();
        }

        const existingStream = this.runStreams.get(runId);
        const partialText = existingStream?.partialText.trim().length
            ? existingStream.partialText
            : "";
        if (run.outputEntryId) {
            if (partialText) {
                await this.host.editComment(run.outputEntryId, partialText, { skipCommentViewRefresh: true });
            }
        }

        const cancelledRun = await this.store.updateRun(runId, (currentRun) => ({
            ...currentRun,
            status: "cancelled",
            endedAt: this.host.now(),
            error: AGENT_CANCELLED_NOTICE,
        }));
        if (cancelledRun) {
            this.setRunStream(this.buildRunStreamState(cancelledRun, {
                status: "cancelled",
                statusText: AGENT_STATUS_CANCELLED,
                partialText,
                startedAt: cancelledRun.startedAt ?? run.createdAt,
                updatedAt: cancelledRun.endedAt ?? this.host.now(),
                outputEntryId: cancelledRun.outputEntryId,
                error: AGENT_CANCELLED_NOTICE,
            }));
        } else {
            this.clearRunStream(runId, run.threadId);
        }
        await this.refreshStatusViews();
        if (cancelledRun) {
            void this.host.log?.("info", "agents", "agents.run.cancelled", {
                runId,
                threadId: cancelledRun.threadId,
                requestedAgent: cancelledRun.requestedAgent,
                runtime: cancelledRun.runtime,
            });
        }
        return true;
    }

    public async cancelRunsForComment(commentId: string): Promise<void> {
        const thread = this.host.getCommentManager().getThreadById(commentId);
        const runs = thread
            ? getAgentRunsForCommentThread(this.store.getRuns(), thread)
            : this.store.getRuns().filter((run) =>
                run.triggerEntryId === commentId
                || run.outputEntryId === commentId,
            );
        const activeRuns = runs.filter((run) => run.status === "queued" || run.status === "running");
        for (const run of activeRuns) {
            await this.cancelRun(run.id);
        }
    }

    private async processQueue(): Promise<void> {
        if (this.processingQueue) {
            return;
        }

        this.processingQueue = true;
        try {
            while (true) {
                const nextRun = getQueuedAgentRuns(this.store.getRuns())[0];
                if (!nextRun) {
                    break;
                }

                await this.executeRun(nextRun.id);
            }
        } finally {
            this.processingQueue = false;
        }
    }

    private async executeRun(runId: string): Promise<void> {
        const queuedRun = this.store.getRunById(runId);
        if (!queuedRun || queuedRun.status !== "queued") {
            return;
        }

        const startedAt = this.host.now();
        const previousRun = queuedRun.retryOfRunId
            ? this.store.getRunById(queuedRun.retryOfRunId)
            : null;
        const replaceOutputEntryId = previousRun?.outputEntryId ?? undefined;
        const outputEntryId = replaceOutputEntryId ?? this.host.createCommentId();
        const runtimePrompt = await this.buildRuntimePrompt(queuedRun);
        const latestQueuedRun = this.store.getRunById(runId);
        if (!latestQueuedRun || latestQueuedRun.status !== "queued") {
            return;
        }
        if (!replaceOutputEntryId) {
            const appended = await this.host.appendThreadEntry(queuedRun.threadId, {
                id: outputEntryId,
                body: "",
                timestamp: startedAt,
            }, {
                skipCommentViewRefresh: true,
            });
            if (!appended) {
                const failedRun = await this.store.updateRun(runId, (run) => ({
                    ...run,
                    status: "failed",
                    endedAt: this.host.now(),
                    error: "Unable to append the agent reply to the thread.",
                }));
                if (failedRun) {
                    await this.refreshStatusViews();
                }
                return;
            }
        }
        const runningRun = await this.store.updateRun(runId, (run) => ({
            ...run,
            status: "running",
            startedAt,
            error: undefined,
            outputEntryId,
        }));
        if (!runningRun) {
            return;
        }
        const execution: ActiveRunExecution = {
            runId,
            threadId: runningRun.threadId,
            abortController: new AbortController(),
            cancelRequested: false,
        };
        this.activeRunExecutions.set(runId, execution);
        await this.refreshStatusViews();
        this.setRunStream(this.buildRunStreamState(runningRun, {
            status: "running",
            partialText: "",
            startedAt,
            updatedAt: startedAt,
            outputEntryId,
        }));

        void this.host.log?.("info", "agents", "agents.run.started", {
            runId,
            threadId: runningRun.threadId,
            requestedAgent: runningRun.requestedAgent,
            runtime: runningRun.runtime,
        });

        const workingDirectory = this.host.getRuntimeWorkingDirectory(runningRun.filePath);
        if (!workingDirectory) {
            this.activeRunExecutions.delete(runId);
            await this.failRun(runId, runningRun, AGENT_DESKTOP_RUNTIME_NOTICE);
            return;
        }

        try {
            const runtimeResponse = await this.host.runAgentRuntime({
                target: runningRun.requestedAgent,
                prompt: runtimePrompt,
                cwd: workingDirectory,
                abortSignal: execution.abortController.signal,
                onProgressText: (progressText) => {
                    if (this.isRunCancellationRequested(runId)) {
                        return;
                    }

                    const normalizedProgressText = progressText.trim();
                    if (!normalizedProgressText) {
                        return;
                    }

                    this.updateRunStream(
                        runId,
                        this.buildRunStreamState(runningRun, {
                            status: "running",
                            statusHintText: normalizedProgressText,
                            partialText: this.runStreams.get(runId)?.partialText ?? "",
                            startedAt,
                            updatedAt: this.host.now(),
                            outputEntryId,
                        }),
                    );
                },
                onPartialText: (partialText) => {
                    if (this.isRunCancellationRequested(runId)) {
                        return;
                    }

                    this.updateRunStream(
                        runId,
                        this.buildRunStreamState(runningRun, {
                            status: "running",
                            partialText,
                            startedAt,
                            updatedAt: this.host.now(),
                            outputEntryId,
                        }),
                    );
                },
            });
            if (this.isRunCancellationRequested(runId)) {
                return;
            }
            const replyText = runtimeResponse.replyText.trim();
            if (!replyText) {
                throw new Error("The agent returned an empty response.");
            }

            const timestamp = this.host.now();
            this.updateRunStream(runId, this.buildRunStreamState(runningRun, {
                status: "running",
                partialText: replyText,
                startedAt,
                updatedAt: timestamp,
                outputEntryId,
            }));
            const replaced = await this.host.editComment(outputEntryId, replyText, { skipCommentViewRefresh: true });
            if (this.isRunCancellationRequested(runId)) {
                return;
            }
            if (!replaced) {
                if (replaceOutputEntryId) {
                    throw new Error(AGENT_REGENERATE_REPLACE_FAILED_NOTICE);
                }
                throw new Error("Unable to update the agent reply.");
            }

            const completedRun = await this.store.updateRun(runId, (run) => ({
                ...run,
                runtime: runtimeResponse.runtime,
                status: "succeeded",
                endedAt: timestamp,
                outputEntryId,
                error: undefined,
            }));
            if (!completedRun) {
                throw new Error("Unable to finalize the agent run.");
            }
            this.setRunStream(this.buildRunStreamState(completedRun, {
                status: "succeeded",
                partialText: replyText,
                startedAt,
                updatedAt: timestamp,
                outputEntryId,
            }));
            await this.refreshStatusViews();
            this.clearRunStream(runId, runningRun.threadId);
            void this.host.log?.("info", "agents", "agents.reply.appended", {
                runId,
                threadId: runningRun.threadId,
                outputEntryId,
            });
            void this.host.log?.("info", "agents", "agents.run.succeeded", {
                runId,
                threadId: runningRun.threadId,
                runtime: runtimeResponse.runtime,
                outputEntryId,
            });
        } catch (error) {
            if (this.isRunCancellationRequested(runId) || isAgentRuntimeCancelledError(error)) {
                return;
            }
            await this.failRun(runId, runningRun, summarizeError(error));
        } finally {
            this.activeRunExecutions.delete(runId);
        }
    }

    private async failRun(runId: string, run: AgentRunRecord, message: string): Promise<void> {
        const existingStream = this.runStreams.get(runId);
        const failureText = existingStream?.partialText.trim().length
            ? existingStream.partialText
            : message;
        if (run.outputEntryId) {
            await this.host.editComment(run.outputEntryId, failureText, { skipCommentViewRefresh: true });
        }
        const failedRun = await this.store.updateRun(runId, (currentRun) => ({
            ...currentRun,
            status: "failed",
            endedAt: this.host.now(),
            error: message,
        }));
        if (failedRun) {
            this.setRunStream(this.buildRunStreamState(failedRun, {
                status: "failed",
                partialText: failureText,
                startedAt: failedRun.startedAt ?? run.createdAt,
                updatedAt: failedRun.endedAt ?? this.host.now(),
                outputEntryId: failedRun.outputEntryId,
                error: message,
            }));
            await this.refreshStatusViews();
            this.clearRunStream(runId, run.threadId);
        }
        void this.host.log?.("warn", "agents", "agents.run.failed", {
            runId,
            threadId: run.threadId,
            requestedAgent: run.requestedAgent,
            runtime: run.runtime,
            error: message,
        });
    }

    private isRunCancellationRequested(runId: string): boolean {
        return this.activeRunExecutions.get(runId)?.cancelRequested ?? false;
    }

    private async buildRuntimePrompt(
        run: Pick<AgentRunRecord, "id" | "threadId" | "triggerEntryId" | "filePath" | "promptText">,
    ): Promise<string> {
        const thread = this.host.getCommentManager().getThreadById(run.threadId);
        if (!thread) {
            return run.promptText;
        }

        const file = this.host.getFileByPath(run.filePath);
        let noteContent: string | null = null;
        if (file && /\.md$/i.test(file.path)) {
            try {
                noteContent = await this.host.getCurrentNoteContent(file);
            } catch (error) {
                void this.host.log?.("warn", "agents", "agents.context.note-read.warn", {
                    runId: run.id,
                    filePath: run.filePath,
                    error,
                });
            }
        }

        const context = buildAgentPromptContext({
            filePath: run.filePath,
            noteContent,
            thread,
            triggerEntryId: run.triggerEntryId,
            fallbackPromptText: run.promptText,
            threadAgentRuns: getAgentRunsForCommentThread(this.store.getRuns(), thread),
        });
        void this.host.log?.("info", "agents", "agents.context.built", {
            runId: run.id,
            threadId: run.threadId,
            scope: context.scope,
            hasNoteContext: !!noteContent,
        });
        return context.promptText;
    }

    private resolveDispatchTarget(
        resolution: ReturnType<typeof parseAgentDirectives>,
        event: SavedUserEntryEvent,
    ): SideNote2AgentTarget | null {
        if (resolution.unsupportedTargets.length > 0) {
            void this.host.log?.("warn", "agents", "agents.directive.unsupported", {
                threadId: event.threadId,
                entryId: event.entryId,
                unsupportedTargets: resolution.unsupportedTargets,
            });
            this.host.showNotice(resolveUnsupportedAgentNotice(resolution.unsupportedTargets));
            return null;
        }

        if (resolution.hasConflict) {
            void this.host.log?.("warn", "agents", "agents.directive.conflict", {
                threadId: event.threadId,
                entryId: event.entryId,
                matchedTargets: resolution.matchedTargets,
            });
            this.host.showNotice(AGENT_CONFLICT_NOTICE);
            return null;
        }

        return resolution.target;
    }

    private resolveRetryTarget(
        resolution: ReturnType<typeof parseAgentDirectives>,
    ): SideNote2AgentTarget | null {
        if (resolution.unsupportedTargets.length > 0) {
            this.host.showNotice(resolveUnsupportedAgentNotice(resolution.unsupportedTargets));
            return null;
        }

        if (resolution.hasConflict || !resolution.target) {
            this.host.showNotice(AGENT_RETRY_NOTICE);
            return null;
        }

        return resolution.target;
    }

    private buildQueuedRun(options: {
        threadId: string;
        triggerEntryId: string;
        filePath: string;
        requestedAgent: SideNote2AgentTarget;
        promptText: string;
        retryOfRunId?: string;
    }): AgentRunRecord {
        return {
            id: this.host.createCommentId(),
            threadId: options.threadId,
            triggerEntryId: options.triggerEntryId,
            filePath: options.filePath,
            requestedAgent: options.requestedAgent,
            runtime: "direct-cli",
            status: "queued",
            promptText: options.promptText,
            createdAt: this.host.now(),
            retryOfRunId: options.retryOfRunId,
        };
    }

    private buildRunStreamState(
        run: Pick<AgentRunRecord, "id" | "threadId" | "requestedAgent">,
        options: {
            status: AgentRunRecord["status"];
            statusText?: string;
            statusHintText?: string;
            partialText: string;
            startedAt: number;
            updatedAt: number;
            outputEntryId?: string;
            error?: string;
        },
    ): AgentRunStreamState {
        return {
            runId: run.id,
            threadId: run.threadId,
            requestedAgent: run.requestedAgent,
            status: options.status,
            statusText: options.statusText,
            statusHintText: options.statusHintText,
            partialText: options.partialText,
            startedAt: options.startedAt,
            updatedAt: options.updatedAt,
            outputEntryId: options.outputEntryId,
            error: options.error,
        };
    }

    private async enqueueRun(run: AgentRunRecord): Promise<void> {
        await this.store.addRun(run);
        await this.refreshStatusViews();
        void this.host.log?.("info", "agents", "agents.run.queued", {
            runId: run.id,
            threadId: run.threadId,
            requestedAgent: run.requestedAgent,
            runtime: run.runtime,
        });
        void this.processQueue();
    }

    private async refreshStatusViews(): Promise<void> {
        try {
            await this.host.refreshCommentViews?.();
        } catch (error) {
            void this.host.log?.("warn", "agents", "agents.refresh.warn", {
                error,
            });
        }
    }

    private updateRunStream(runId: string, nextStream: AgentRunStreamState): void {
        const previous = this.runStreams.get(runId);
        if (
            previous
            && previous.partialText === nextStream.partialText
            && previous.status === nextStream.status
            && previous.statusText === nextStream.statusText
            && previous.statusHintText === nextStream.statusHintText
            && previous.error === nextStream.error
            && previous.outputEntryId === nextStream.outputEntryId
        ) {
            this.runStreams.set(runId, {
                ...previous,
                updatedAt: nextStream.updatedAt,
                statusText: nextStream.statusText,
                statusHintText: nextStream.statusHintText,
            });
            return;
        }

        this.setRunStream(nextStream);
    }

    private setRunStream(stream: AgentRunStreamState): void {
        this.clearRunStreamPruneTimer(stream.runId);
        this.runStreams.set(stream.runId, cloneAgentRunStreamState(stream));
        if (stream.status === "succeeded" || stream.status === "failed" || stream.status === "cancelled") {
            this.scheduleSilentRunStreamPrune(stream.runId);
        }
        this.emitStreamUpdate(stream.threadId, stream);
    }

    private clearRunStream(runId: string, threadId: string): void {
        if (!this.runStreams.has(runId)) {
            return;
        }

        this.clearRunStreamPruneTimer(runId);
        this.runStreams.delete(runId);
        this.emitStreamUpdate(threadId, null);
    }

    private scheduleSilentRunStreamPrune(runId: string): void {
        this.clearRunStreamPruneTimer(runId);
        const timer = setTimeout(() => {
            this.runStreamPruneTimers.delete(runId);
            this.runStreams.delete(runId);
        }, FINAL_STREAM_RETENTION_MS);
        this.runStreamPruneTimers.set(runId, timer);
    }

    private clearRunStreamPruneTimer(runId: string): void {
        const timer = this.runStreamPruneTimers.get(runId);
        if (!timer) {
            return;
        }

        clearTimeout(timer);
        this.runStreamPruneTimers.delete(runId);
    }

    private emitStreamUpdate(threadId: string, stream: AgentRunStreamState | null): void {
        const payload: AgentStreamUpdate = {
            threadId,
            stream: stream ? cloneAgentRunStreamState(stream) : null,
        };
        for (const listener of this.streamListeners) {
            try {
                listener(payload);
            } catch (error) {
                void this.host.log?.("warn", "agents", "agents.stream-listener.warn", {
                    threadId,
                    error,
                });
            }
        }
    }
}
