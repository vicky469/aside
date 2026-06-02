import type { TFile } from "obsidian";
import type { CommentManager } from "../commentManager";
import {
    cloneAgentRunStreamState,
    getAgentRunsForCommentThread,
    getLatestAgentRunForTriggerEntry,
    getLatestAgentRunForThread,
    getQueuedAgentRuns,
    mergeAgentRunMetadata,
    type AgentRunMetadata,
    type AgentRunRecord,
    type AgentRunRuntime,
    type AgentRunStreamState,
} from "../core/agents/agentRuns";
import type { AgentRuntimeModePreference } from "../core/agents/agentRuntimePreferences";
import { resolveUnsupportedAgentNotice } from "../core/agents/agentActorRegistry";
import type { AsideAgentTarget } from "../core/config/agentTargets";
import { parseAgentDirectives } from "../core/text/agentDirectives";
import { AgentRunStore } from "./agentRunStore";
import {
    type AgentRuntimeSelection,
} from "./agentRuntimeSelection";
import { isAgentRuntimeCancelledError } from "./agentRuntimeAdapter";
import {
    buildAgentPromptContext,
    type AgentPromptContext,
} from "./agentPromptContextPlanner";

export interface SavedUserEntryEvent {
    threadId: string;
    entryId: string;
    filePath: string;
    body: string;
}

export interface AgentRuntimeResponse extends AgentRunMetadata {
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
    getPluginVersion(): string;
    getVaultRootPath(): string | null;
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
            insertAfterCommentId?: string;
            alwaysInsertAfterTarget?: boolean;
            skipCommentViewRefresh?: boolean;
        },
    ): Promise<boolean>;
    editComment(commentId: string, newCommentText: string, options?: { skipCommentViewRefresh?: boolean }): Promise<boolean>;
    deleteComment(commentId: string, options?: { skipCommentViewRefresh?: boolean }): Promise<void>;
    runAgentRuntime(invocation: {
        target: AsideAgentTarget;
        prompt: string;
        cwd: string;
        vaultRootPath?: string | null;
        onPartialText?: (partialText: string) => void;
        onProgressText?: (progressText: string) => void;
        onRunMetadata?: (metadata: AgentRunMetadata) => void;
        abortSignal?: AbortSignal;
    }): Promise<AgentRuntimeResponse>;
    resolveAgentRuntimeSelection(target: AsideAgentTarget): Promise<AgentRuntimeSelection>;
    showNotice(message: string): void;
    log?(level: "info" | "warn" | "error", area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
}

const AGENT_CONFLICT_NOTICE = "Use only one explicit supported agent target per side note.";
const AGENT_RETRY_NOTICE = "Retry requires a single explicit supported agent target in the triggering entry.";
const AGENT_PENDING_SESSION_NOTICE = "The previous Aside agent run did not finish. Retry the thread to run it again.";
const AGENT_DESKTOP_RUNTIME_NOTICE = "Agent execution requires desktop Obsidian with a filesystem-backed vault.";
const AGENT_REGENERATE_REPLACE_FAILED_NOTICE = "Unable to replace the previous agent reply.";
const AGENT_CANCELLED_NOTICE = "Cancelled.";
const AGENT_STATUS_CANCELLED = "Cancelled";
const LOCAL_MAX_CONCURRENT_RUNS = 3;
const BUILT_IN_ASIDE_SKILL_NAME = "aside";
const BUILT_IN_ASIDE_SKILL_MODE = "write";
const UTF8_ENCODER = new TextEncoder();

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

function getTimerWindow(): Window | null {
    return typeof window === "undefined" ? null : window;
}

type AgentStreamListener = (update: AgentStreamUpdate) => void;
const FINAL_STREAM_RETENTION_MS = 30_000;

export class CommentAgentController {
    private processingQueue = false;
    private readonly runStreams = new Map<string, AgentRunStreamState>();
    private readonly runStreamPruneTimers = new Map<string, number>();
    private readonly streamListeners = new Set<AgentStreamListener>();
    private readonly activeRunExecutions = new Map<string, ActiveRunExecution>();
    private readonly dispatchingRunIds = new Set<string>();

    constructor(
        private readonly host: CommentAgentHost,
        private readonly store: AgentRunStore,
    ) {}

    public initialize(): void {
        this.store.load();
    }

    public async reconcilePendingRunsFromPreviousSession(): Promise<void> {
        let changed = false;
        const now = this.host.now();
        for (const run of this.store.getRuns()) {
            if (run.status !== "queued" && run.status !== "running") {
                continue;
            }

            const updated = await this.store.updateRun(run.id, (currentRun) => ({
                ...currentRun,
                status: "failed",
                endedAt: now,
                error: currentRun.error ?? AGENT_PENDING_SESSION_NOTICE,
            }));
            changed = changed || !!updated;
        }

        if (changed) {
            await this.refreshStatusViews();
        }
        void this.processQueue();
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
        const timerWindow = getTimerWindow();
        for (const timer of this.runStreamPruneTimers.values()) {
            timerWindow?.clearTimeout(timer);
        }
        this.runStreamPruneTimers.clear();
        for (const execution of this.activeRunExecutions.values()) {
            execution.cancelRequested = true;
            execution.abortController.abort();
        }
        this.activeRunExecutions.clear();
        this.dispatchingRunIds.clear();
        this.runStreams.clear();
    }

    public async handleSavedUserEntry(event: SavedUserEntryEvent): Promise<void> {
        const resolution = parseAgentDirectives(event.body);
        const resolvedTarget = this.resolveDispatchTarget(resolution, event);
        if (!resolvedTarget) {
            return;
        }
        const runtimeSelection = await this.host.resolveAgentRuntimeSelection(resolvedTarget);
        if (runtimeSelection.kind === "blocked") {
            this.host.showNotice(runtimeSelection.notice);
            return;
        }

        const run = this.buildQueuedRun({
            threadId: event.threadId,
            triggerEntryId: event.entryId,
            filePath: event.filePath,
            requestedAgent: resolvedTarget,
            runtime: runtimeSelection.runtime,
            modePreference: runtimeSelection.modePreference,
            promptText: event.body,
        });
        await this.enqueueRun(run);
        this.logBuiltInAsideSkillSelected(run, event.entryId);
        void this.host.log?.("info", "agents", "agents.directive.detected", {
            threadId: event.threadId,
            entryId: event.entryId,
            requestedAgent: run.requestedAgent,
            runtime: run.runtime,
        });
    }

    public async retryRun(runId: string): Promise<boolean> {
        const previousRun = this.store.getRunById(runId);
        if (!previousRun) {
            this.host.showNotice("Unable to find that agent reply.");
            return false;
        }

        return this.retryPromptForCommentInternal({
            triggerEntryId: previousRun.triggerEntryId,
            filePath: previousRun.filePath,
            retryOfRunId: previousRun.id,
            missingFileNotice: "Unable to reload that side note reply.",
            missingCommentNotice: "Unable to find the latest saved side note entry.",
        });
    }

    public async retryPromptForComment(commentId: string, filePath: string): Promise<boolean> {
        return this.retryPromptForCommentInternal({
            triggerEntryId: commentId,
            filePath,
            missingFileNotice: "Unable to reload that side note prompt.",
            missingCommentNotice: "Unable to find that saved side note entry.",
        });
    }

    private async retryPromptForCommentInternal(options: {
        triggerEntryId: string;
        filePath: string;
        retryOfRunId?: string;
        missingFileNotice: string;
        missingCommentNotice: string;
    }): Promise<boolean> {
        const file = this.host.getFileByPath(options.filePath);
        if (!this.host.isCommentableFile(file)) {
            this.host.showNotice(options.missingFileNotice);
            return false;
        }

        await this.host.loadCommentsForFile(file);
        const latestComment = this.host.getCommentManager().getCommentById(options.triggerEntryId);
        if (!latestComment) {
            this.host.showNotice(options.missingCommentNotice);
            return false;
        }

        const thread = this.host.getCommentManager().getThreadById(options.triggerEntryId);
        if (!thread) {
            this.host.showNotice("Unable to find that side note thread.");
            return false;
        }

        const resolution = parseAgentDirectives(latestComment.comment);
        const resolvedTarget = this.resolveRetryTarget(resolution);
        if (!resolvedTarget) {
            return false;
        }
        const runtimeSelection = await this.host.resolveAgentRuntimeSelection(resolvedTarget);
        if (runtimeSelection.kind === "blocked") {
            this.host.showNotice(runtimeSelection.notice);
            return false;
        }

        const retryOfRunId = options.retryOfRunId
            ?? getLatestAgentRunForTriggerEntry(this.store.getRuns(), latestComment.id)?.id;
        const retryOutputEntryId = retryOfRunId
            ? this.store.getRunById(retryOfRunId)?.outputEntryId
            : undefined;
        const run = this.buildQueuedRun({
            threadId: thread.id,
            triggerEntryId: latestComment.id,
            filePath: latestComment.filePath,
            requestedAgent: resolvedTarget,
            runtime: runtimeSelection.runtime,
            modePreference: runtimeSelection.modePreference,
            promptText: latestComment.comment,
            ...(retryOfRunId ? { retryOfRunId } : {}),
            ...(retryOutputEntryId ? { outputEntryId: retryOutputEntryId } : {}),
        });
        if (retryOutputEntryId && !(await this.clearRetryOutputEntry(run, retryOutputEntryId))) {
            return false;
        }
        await this.enqueueRun(run);
        this.logBuiltInAsideSkillSelected(run, latestComment.id);
        void this.host.log?.("info", "agents", "agents.retry.created", {
            runId: run.id,
            ...(retryOfRunId ? { retryOfRunId } : {}),
            threadId: thread.id,
            triggerEntryId: latestComment.id,
            requestedAgent: run.requestedAgent,
        });
        return true;
    }

    private async clearRetryOutputEntry(run: AgentRunRecord, outputEntryId: string): Promise<boolean> {
        const cleared = await this.host.editComment(outputEntryId, "", { skipCommentViewRefresh: true });
        if (!cleared) {
            this.host.showNotice(AGENT_REGENERATE_REPLACE_FAILED_NOTICE);
            return false;
        }

        const updatedAt = this.host.now();
        this.setRunStream(this.buildRunStreamState(run, {
            status: "queued",
            partialText: "",
            startedAt: run.createdAt,
            updatedAt,
            outputEntryId,
        }));
        void this.host.log?.("info", "agents", "agents.retry.output_cleared", {
            runId: run.id,
            threadId: run.threadId,
            outputEntryId,
        });
        return true;
    }

    public async cancelRun(runId: string, options?: { message?: string }): Promise<boolean> {
        const run = this.store.getRunById(runId);
        if (!run || (run.status !== "queued" && run.status !== "running")) {
            return false;
        }
        const cancellationMessage = options?.message?.trim() || AGENT_CANCELLED_NOTICE;

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
            error: cancellationMessage,
        }));
        if (cancelledRun) {
            this.setRunStream(this.buildRunStreamState(cancelledRun, {
                status: "cancelled",
                statusText: AGENT_STATUS_CANCELLED,
                partialText,
                startedAt: cancelledRun.startedAt ?? run.createdAt,
                updatedAt: cancelledRun.endedAt ?? this.host.now(),
                outputEntryId: cancelledRun.outputEntryId,
                error: cancellationMessage,
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
                error: cancellationMessage,
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

    private processQueue(): void {
        if (this.processingQueue) {
            return;
        }

        this.processingQueue = true;
        try {
            while (true) {
                const nextRun = this.getNextStartableQueuedRun();
                if (!nextRun) {
                    break;
                }

                this.dispatchingRunIds.add(nextRun.id);
                void this.executeRun(nextRun.id).finally(() => {
                    this.dispatchingRunIds.delete(nextRun.id);
                    void this.processQueue();
                });
            }
        } finally {
            this.processingQueue = false;
        }
    }

    private getRuntimeConcurrencyLimit(runtime: AgentRunRuntime): number {
        return LOCAL_MAX_CONCURRENT_RUNS;
    }

    private getInFlightRuns(): AgentRunRecord[] {
        const inFlightRunIds = new Set<string>([
            ...this.dispatchingRunIds,
            ...this.activeRunExecutions.keys(),
        ]);

        return Array.from(inFlightRunIds)
            .map((runId) => this.store.getRunById(runId))
            .filter((run): run is AgentRunRecord => !!run);
    }

    private getNextStartableQueuedRun(): AgentRunRecord | null {
        const queuedRuns = getQueuedAgentRuns(this.store.getRuns());
        const inFlightRuns = this.getInFlightRuns();

        for (const run of queuedRuns) {
            if (this.dispatchingRunIds.has(run.id)) {
                continue;
            }

            const matchingRuntimeCount = inFlightRuns
                .filter((activeRun) => activeRun.runtime === run.runtime)
                .length;
            if (matchingRuntimeCount >= this.getRuntimeConcurrencyLimit(run.runtime)) {
                continue;
            }

            return run;
        }

        return null;
    }

    private async executeRun(runId: string): Promise<void> {
        const queuedRun = this.store.getRunById(runId);
        if (!queuedRun || queuedRun.status !== "queued") {
            return;
        }

        const startedAt = queuedRun.startedAt ?? this.host.now();
        const previousRun = queuedRun.retryOfRunId
            ? this.store.getRunById(queuedRun.retryOfRunId)
            : null;
        const replaceOutputEntryId = previousRun?.outputEntryId ?? undefined;
        const outputEntryId = queuedRun.outputEntryId ?? replaceOutputEntryId ?? this.host.createCommentId();
        const runtimeContext = await this.buildRuntimePromptContext(queuedRun);
        const latestQueuedRun = this.store.getRunById(runId);
        if (!latestQueuedRun || latestQueuedRun.status !== "queued") {
            return;
        }
        const shouldAppendOutputEntry = !queuedRun.outputEntryId && !replaceOutputEntryId;
        if (shouldAppendOutputEntry) {
            const appended = await this.host.appendThreadEntry(queuedRun.threadId, {
                id: outputEntryId,
                body: "",
                timestamp: startedAt,
            }, {
                insertAfterCommentId: queuedRun.triggerEntryId,
                alwaysInsertAfterTarget: true,
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
            startedAt: run.startedAt ?? startedAt,
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
            startedAt: runningRun.startedAt ?? startedAt,
            updatedAt: runningRun.startedAt ?? startedAt,
            outputEntryId,
        }));

        void this.host.log?.("info", "agents", "agents.run.started", {
            runId,
            threadId: runningRun.threadId,
            requestedAgent: runningRun.requestedAgent,
            runtime: runningRun.runtime,
            contextScope: runtimeContext.scope,
            contextBytes: runtimeContext.byteLength,
        });

        try {
            await this.executeLocalRun({
                run: runningRun,
                outputEntryId,
                replaceOutputEntryId,
                startedAt: runningRun.startedAt ?? startedAt,
                runtimePrompt: runtimeContext.promptText,
                execution,
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
        const failureMetadata = mergeAgentRunMetadata(run, existingStream ?? {});
        if (run.outputEntryId) {
            await this.host.editComment(run.outputEntryId, failureText, { skipCommentViewRefresh: true });
        }
        const failedRun = await this.store.updateRun(runId, (currentRun) => ({
            ...currentRun,
            ...failureMetadata,
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

    private async executeLocalRun(options: {
        run: AgentRunRecord;
        outputEntryId: string;
        replaceOutputEntryId?: string;
        startedAt: number;
        runtimePrompt: string;
        execution: ActiveRunExecution;
    }): Promise<void> {
        const workingDirectory = this.host.getRuntimeWorkingDirectory(options.run.filePath);
        if (!workingDirectory) {
            await this.failRun(options.run.id, options.run, AGENT_DESKTOP_RUNTIME_NOTICE);
            return;
        }

        const runtimeResponse = await this.host.runAgentRuntime({
            target: options.run.requestedAgent,
            prompt: options.runtimePrompt,
            cwd: workingDirectory,
            vaultRootPath: this.host.getVaultRootPath(),
            abortSignal: options.execution.abortController.signal,
            onProgressText: (progressText) => {
                if (this.isRunCancellationRequested(options.run.id)) {
                    return;
                }

                const normalizedProgressText = progressText.trim();
                if (!normalizedProgressText) {
                    return;
                }

                this.updateRunStream(
                    options.run.id,
                    this.buildRunStreamState({
                        ...options.run,
                        ...mergeAgentRunMetadata(options.run, this.runStreams.get(options.run.id) ?? {}),
                    }, {
                        status: "running",
                        statusHintText: normalizedProgressText,
                        partialText: this.runStreams.get(options.run.id)?.partialText ?? "",
                        startedAt: options.startedAt,
                        updatedAt: this.host.now(),
                        outputEntryId: options.outputEntryId,
                    }),
                );
            },
            onPartialText: (partialText) => {
                if (this.isRunCancellationRequested(options.run.id)) {
                    return;
                }

                this.updateRunStream(
                    options.run.id,
                    this.buildRunStreamState({
                        ...options.run,
                        ...mergeAgentRunMetadata(options.run, this.runStreams.get(options.run.id) ?? {}),
                    }, {
                        status: "running",
                        partialText,
                        startedAt: options.startedAt,
                        updatedAt: this.host.now(),
                        outputEntryId: options.outputEntryId,
                    }),
                );
            },
            onRunMetadata: (metadata) => {
                if (this.isRunCancellationRequested(options.run.id)) {
                    return;
                }

                const currentStream = this.runStreams.get(options.run.id);
                const mergedMetadata = mergeAgentRunMetadata(currentStream ?? options.run, metadata);
                this.updateRunStream(
                    options.run.id,
                    this.buildRunStreamState({
                        ...options.run,
                        ...mergedMetadata,
                    }, {
                        status: "running",
                        statusHintText: currentStream?.statusHintText,
                        partialText: currentStream?.partialText ?? "",
                        startedAt: options.startedAt,
                        updatedAt: this.host.now(),
                        outputEntryId: options.outputEntryId,
                        ...mergedMetadata,
                    }),
                );
            },
        });
        if (this.isRunCancellationRequested(options.run.id)) {
            return;
        }

        await this.completeRunWithReply({
            run: options.run,
            runtime: runtimeResponse.runtime,
            replyText: runtimeResponse.replyText,
            replyMetadata: runtimeResponse,
            outputEntryId: options.outputEntryId,
            replaceOutputEntryId: options.replaceOutputEntryId,
            startedAt: options.startedAt,
        });
    }

    private async completeRunWithReply(options: {
        run: AgentRunRecord;
        runtime: AgentRunRuntime;
        replyText: string;
        replyMetadata?: AgentRunMetadata;
        outputEntryId: string;
        replaceOutputEntryId?: string;
        startedAt: number;
    }): Promise<void> {
        if (this.isRunCancellationRequested(options.run.id)) {
            return;
        }

        const replyText = options.replyText.trim();
        if (!replyText) {
            throw new Error("The agent returned an empty response.");
        }

        const timestamp = this.host.now();
        this.updateRunStream(options.run.id, this.buildRunStreamState({
            ...options.run,
            ...mergeAgentRunMetadata(options.run, this.runStreams.get(options.run.id) ?? {}),
        }, {
            status: "running",
            partialText: replyText,
            startedAt: options.startedAt,
            updatedAt: timestamp,
            outputEntryId: options.outputEntryId,
        }));
        const replaced = await this.host.editComment(options.outputEntryId, replyText, { skipCommentViewRefresh: true });
        if (this.isRunCancellationRequested(options.run.id)) {
            return;
        }
        if (!replaced) {
            if (options.replaceOutputEntryId) {
                throw new Error(AGENT_REGENERATE_REPLACE_FAILED_NOTICE);
            }
            throw new Error("Unable to update the agent reply.");
        }

        const completedRun = await this.store.updateRun(options.run.id, (run) => ({
            ...run,
            ...mergeAgentRunMetadata(run, options.replyMetadata ?? {}),
            runtime: options.runtime,
            status: "succeeded",
            endedAt: timestamp,
            outputEntryId: options.outputEntryId,
            error: undefined,
        }));
        if (!completedRun) {
            throw new Error("Unable to finalize the agent run.");
        }
        this.setRunStream(this.buildRunStreamState(completedRun, {
            status: "succeeded",
            partialText: replyText,
            startedAt: options.startedAt,
            updatedAt: timestamp,
            outputEntryId: options.outputEntryId,
        }));
        await this.refreshStatusViews();
        this.clearRunStream(options.run.id, options.run.threadId);
        void this.host.log?.("info", "agents", "agents.reply.appended", {
            runId: options.run.id,
            threadId: options.run.threadId,
            outputEntryId: options.outputEntryId,
        });
        void this.host.log?.("info", "agents", "agents.run.succeeded", {
            runId: options.run.id,
            threadId: options.run.threadId,
            runtime: options.runtime,
            outputEntryId: options.outputEntryId,
        });
    }

    private async buildRuntimePromptContext(
        run: Pick<AgentRunRecord, "id" | "threadId" | "triggerEntryId" | "filePath" | "promptText">,
    ): Promise<AgentPromptContext> {
        const thread = this.host.getCommentManager().getThreadById(run.threadId);
        if (!thread) {
            const promptText = run.promptText;
            return {
                scope: "page",
                promptText,
                byteLength: UTF8_ENCODER.encode(promptText).length,
            };
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
            contextBytes: context.byteLength,
            hasNoteContext: !!noteContent,
        });
        return context;
    }

    private logBuiltInAsideSkillSelected(
        run: Pick<AgentRunRecord, "id" | "threadId" | "requestedAgent">,
        entryId: string,
    ): void {
        void this.host.log?.("info", "agents", "agents.skill.selected", {
            runId: run.id,
            threadId: run.threadId,
            entryId,
            requestedAgent: run.requestedAgent,
            skill: BUILT_IN_ASIDE_SKILL_NAME,
            mode: BUILT_IN_ASIDE_SKILL_MODE,
            source: "built-in",
        });
    }

    private resolveDispatchTarget(
        resolution: ReturnType<typeof parseAgentDirectives>,
        event: SavedUserEntryEvent,
    ): AsideAgentTarget | null {
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
    ): AsideAgentTarget | null {
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
        requestedAgent: AsideAgentTarget;
        runtime: AgentRunRuntime;
        modePreference: AgentRuntimeModePreference;
        promptText: string;
        retryOfRunId?: string;
        outputEntryId?: string;
    }): AgentRunRecord {
        return {
            id: this.host.createCommentId(),
            threadId: options.threadId,
            triggerEntryId: options.triggerEntryId,
            filePath: options.filePath,
            requestedAgent: options.requestedAgent,
            runtime: options.runtime,
            status: "queued",
            promptText: options.promptText,
            createdAt: this.host.now(),
            modePreference: options.modePreference,
            retryOfRunId: options.retryOfRunId,
            outputEntryId: options.outputEntryId,
            usedSkills: [{
                name: BUILT_IN_ASIDE_SKILL_NAME,
                mode: BUILT_IN_ASIDE_SKILL_MODE,
                source: "built-in",
            }],
        };
    }

    private buildRunStreamState(
        run: Pick<AgentRunRecord, "id" | "threadId" | "requestedAgent" | "runtime"> & AgentRunMetadata,
        options: {
            status: AgentRunRecord["status"];
            statusText?: string;
            statusHintText?: string;
            partialText: string;
            startedAt: number;
            updatedAt: number;
            outputEntryId?: string;
            error?: string;
        } & AgentRunMetadata,
    ): AgentRunStreamState {
        const metadata = mergeAgentRunMetadata(run, options);
        return {
            runId: run.id,
            threadId: run.threadId,
            requestedAgent: run.requestedAgent,
            runtime: run.runtime,
            status: options.status,
            statusText: options.statusText,
            statusHintText: options.statusHintText,
            partialText: options.partialText,
            startedAt: options.startedAt,
            updatedAt: options.updatedAt,
            outputEntryId: options.outputEntryId,
            error: options.error,
            ...metadata,
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
            && previous.runtime === nextStream.runtime
            && previous.status === nextStream.status
            && previous.statusText === nextStream.statusText
            && previous.statusHintText === nextStream.statusHintText
            && previous.error === nextStream.error
            && previous.outputEntryId === nextStream.outputEntryId
            && JSON.stringify(previous.usedSkills ?? []) === JSON.stringify(nextStream.usedSkills ?? [])
            && JSON.stringify(previous.usedTools ?? []) === JSON.stringify(nextStream.usedTools ?? [])
            && JSON.stringify(previous.usedUrls ?? []) === JSON.stringify(nextStream.usedUrls ?? [])
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
        const timerWindow = getTimerWindow();
        if (!timerWindow) {
            return;
        }

        const timer = timerWindow.setTimeout(() => {
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

        getTimerWindow()?.clearTimeout(timer);
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
