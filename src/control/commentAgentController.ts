import type { TFile } from "obsidian";
import type { CommentManager } from "../commentManager";
import {
    cloneAgentRunStreamState,
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
    runAgentRuntime(invocation: {
        target: SideNote2AgentTarget;
        prompt: string;
        cwd: string;
        onPartialText?: (partialText: string) => void;
    }): Promise<AgentRuntimeResponse>;
    showNotice(message: string): void;
    log?(level: "info" | "warn" | "error", area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
}

const PRIMARY_SUPPORTED_AGENT = getPrimarySupportedAgentActor();
const AGENT_CONFLICT_NOTICE = "Use only one explicit supported agent target per side note.";
const AGENT_RETRY_NOTICE = `Retry requires a single explicit ${PRIMARY_SUPPORTED_AGENT.directive} target in the triggering entry.`;
const AGENT_PENDING_SESSION_NOTICE = "The previous SideNote2 agent run did not finish. Retry the thread to run it again.";
const AGENT_DESKTOP_RUNTIME_NOTICE = "Agent execution requires desktop Obsidian with a filesystem-backed vault.";

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

    public async retryLatestRun(threadId: string): Promise<boolean> {
        const latestRun = getLatestAgentRunForThread(this.store.getRuns(), threadId);
        if (!latestRun) {
            this.host.showNotice("No agent run exists for that thread yet.");
            return false;
        }

        const file = this.host.getFileByPath(latestRun.filePath);
        if (!this.host.isCommentableFile(file)) {
            this.host.showNotice("Unable to reload that thread for retry.");
            return false;
        }

        await this.host.loadCommentsForFile(file);
        const latestComment = this.host.getCommentManager().getCommentById(latestRun.triggerEntryId);
        if (!latestComment) {
            this.host.showNotice("Unable to find the triggering entry for retry.");
            return false;
        }

        const resolution = parseAgentDirectives(latestComment.comment);
        const resolvedTarget = this.resolveRetryTarget(resolution);
        if (!resolvedTarget) {
            return false;
        }

        const run = this.buildQueuedRun({
            threadId,
            triggerEntryId: latestRun.triggerEntryId,
            filePath: latestRun.filePath,
            requestedAgent: resolvedTarget,
            promptText: latestComment.comment,
            retryOfRunId: latestRun.id,
        });
        await this.enqueueRun(run);
        void this.host.log?.("info", "agents", "agents.retry.created", {
            runId: run.id,
            retryOfRunId: latestRun.id,
            threadId,
            requestedAgent: run.requestedAgent,
        });
        return true;
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
        const runningRun = await this.store.updateRun(runId, (run) => ({
            ...run,
            status: "running",
            startedAt,
            error: undefined,
        }));
        if (!runningRun) {
            return;
        }
        await this.refreshStatusViews();
        this.setRunStream(this.buildRunStreamState(runningRun, {
            status: "running",
            partialText: "",
            startedAt,
            updatedAt: startedAt,
        }));

        void this.host.log?.("info", "agents", "agents.run.started", {
            runId,
            threadId: runningRun.threadId,
            requestedAgent: runningRun.requestedAgent,
            runtime: runningRun.runtime,
        });

        const workingDirectory = this.host.getRuntimeWorkingDirectory(runningRun.filePath);
        if (!workingDirectory) {
            await this.failRun(runId, runningRun, AGENT_DESKTOP_RUNTIME_NOTICE);
            return;
        }

        try {
            const runtimeResponse = await this.host.runAgentRuntime({
                target: runningRun.requestedAgent,
                prompt: runningRun.promptText,
                cwd: workingDirectory,
                onPartialText: (partialText) => this.updateRunStream(
                    runId,
                    this.buildRunStreamState(runningRun, {
                        status: "running",
                        partialText,
                        startedAt,
                        updatedAt: this.host.now(),
                    }),
                ),
            });
            const replyText = runtimeResponse.replyText.trim();
            if (!replyText) {
                throw new Error("The agent returned an empty response.");
            }

            const outputEntryId = this.host.createCommentId();
            const timestamp = this.host.now();
            const appended = await this.host.appendThreadEntry(runningRun.threadId, {
                id: outputEntryId,
                body: replyText,
                timestamp,
            }, {
                skipCommentViewRefresh: true,
            });
            if (!appended) {
                throw new Error("Unable to append the agent reply to the thread.");
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
            this.setRunStream(this.buildRunStreamState(completedRun, {
                status: "succeeded",
                partialText: replyText,
                startedAt,
                updatedAt: timestamp,
                outputEntryId,
            }));
        } catch (error) {
            await this.failRun(runId, runningRun, summarizeError(error));
        }
    }

    private async failRun(runId: string, run: AgentRunRecord, message: string): Promise<void> {
        const failedRun = await this.store.updateRun(runId, (currentRun) => ({
            ...currentRun,
            status: "failed",
            endedAt: this.host.now(),
            error: message,
        }));
        if (failedRun) {
            const existingStream = this.runStreams.get(runId);
            this.setRunStream(this.buildRunStreamState(failedRun, {
                status: "failed",
                partialText: existingStream?.partialText ?? "",
                startedAt: failedRun.startedAt ?? run.createdAt,
                updatedAt: failedRun.endedAt ?? this.host.now(),
                error: message,
            }));
        }
        void this.host.log?.("warn", "agents", "agents.run.failed", {
            runId,
            threadId: run.threadId,
            requestedAgent: run.requestedAgent,
            runtime: run.runtime,
            error: message,
        });
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
            && previous.error === nextStream.error
            && previous.outputEntryId === nextStream.outputEntryId
        ) {
            this.runStreams.set(runId, {
                ...previous,
                updatedAt: nextStream.updatedAt,
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
