import type { TFile } from "obsidian";
import type { VaultScriptRegistration } from "../../shared/vaultScriptPolicy.js";
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
    type AgentRunRequestKind,
    type AgentRunRuntime,
    type AgentRunStreamState,
} from "../core/agents/agentRuns";
import type { AgentRuntimeModePreference } from "../core/agents/agentRuntimePreferences";
import {
    getAgentActorLabel,
    resolveUnsupportedAgentNotice,
} from "../core/agents/agentActorRegistry";
import { resolveRequestedAgentRunSkills } from "../core/agents/agentSkillRouting";
import type { AsideAgentTarget } from "../core/config/agentTargets";
import type { SavedUserEntryEvent } from "../core/comments/savedUserEntry";
import { parseAgentDirectives } from "../core/text/agentDirectives";
import {
    CREATE_SCRIPT_NO_AGENT,
    CREATE_SCRIPT_USAGE,
    parseCreateScriptDirective,
} from "../core/text/createScriptDirective";
import {
    PDF_TO_MARKDOWN_DIRECTIVE,
    PDF_TO_MARKDOWN_NO_AGENT,
    PDF_TO_MARKDOWN_SOURCE_REQUIRED,
    PDF_TO_MARKDOWN_USAGE,
    derivePdfToMarkdownDestinationPath,
    formatPdfToMarkdownDestinationConflict,
    formatPdfToMarkdownInProgress,
    parsePdfToMarkdownDirective,
} from "../core/text/pdfToMarkdownDirective";
import {
    UPDATE_SCRIPT_NO_AGENT,
    UPDATE_SCRIPT_USAGE,
    parseUpdateScriptDirective,
} from "../core/text/updateScriptDirective";
import { AgentRunStore } from "./agentRunStore";
import {
    extractAgentAnnotationProposals,
    resolveAgentAnnotationProposal,
} from "./agentAnnotationProposals";
import {
    type AgentRuntimeSelection,
    type DefaultAgentRuntimeSelection,
} from "./agentRuntimeSelection";
import {
    formatAgentPreflightFailureReply,
    formatKnownAgentFailureReply,
    formatStandaloneAgentProviderFailureReply,
    sanitizeAgentDiagnosticForDisplay,
} from "./agentFailurePolicy";
import { isAgentRuntimeCancelledError } from "./agentRuntimeAdapter";
import {
    buildAgentPromptContext,
    type AgentPromptContext,
} from "./agentPromptContextPlanner";

export type { SavedUserEntryEvent } from "../core/comments/savedUserEntry";

export interface AgentRuntimeResponse extends AgentRunMetadata {
    runtime: AgentRunRuntime;
    replyText: string;
}

export interface AgentStreamUpdate {
    threadId: string;
    runId: string;
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
    getFilePaths(): string[];
    isCommentableFile(file: TFile | null): file is TFile;
    isPageNoteCapableFile(file: TFile | null): file is TFile;
    getCurrentNoteContent(file: TFile): Promise<string>;
    loadCommentsForFile(file: TFile): Promise<unknown>;
    hashText(text: string): Promise<string>;
    persistCommentsForFile(file: TFile, options?: {
        immediateAggregateRefresh?: boolean;
        skipCommentViewRefresh?: boolean;
        refreshEditorDecorations?: boolean;
        refreshMarkdownPreviews?: boolean;
    }): Promise<void>;
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
    commitThreadEntry(
        filePath: string,
        threadId: string,
        entry: {
            id: string;
            body: string;
            timestamp: number;
        },
        options?: {
            insertAfterCommentId?: string;
            immediateAggregateRefresh?: boolean;
            skipCommentViewRefresh?: boolean;
            refreshEditorDecorations?: boolean;
            refreshMarkdownPreviews?: boolean;
        },
    ): Promise<boolean>;
    editComment(commentId: string, newCommentText: string, options?: { skipCommentViewRefresh?: boolean }): Promise<boolean>;
    deleteComment(commentId: string, options?: { skipCommentViewRefresh?: boolean }): Promise<void>;
    runAgentRuntime(invocation: {
        target: AsideAgentTarget;
        prompt: string;
        cwd: string;
        vaultRootPath?: string | null;
        requestKind?: AgentRunRequestKind;
        targetScriptPath?: string;
        onPartialText?: (partialText: string) => void;
        onProgressText?: (progressText: string) => void;
        onRunMetadata?: (metadata: AgentRunMetadata) => void;
        abortSignal?: AbortSignal;
    }): Promise<AgentRuntimeResponse>;
    resolveAgentRuntimeSelection(target: AsideAgentTarget): Promise<AgentRuntimeSelection>;
    resolveDefaultAgentRuntimeSelection(): Promise<DefaultAgentRuntimeSelection>;
    resolveVaultScriptMention(mention: string): VaultScriptRegistration | null;
    showNotice(message: string): void;
    log?(level: "info" | "warn" | "error", area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
}

const AGENT_CONFLICT_NOTICE = "Use only one explicit supported agent target per side note.";
const AGENT_RETRY_NOTICE = "Retry requires a single explicit supported agent target in the triggering entry.";
const AGENT_REPLY_SAVE_PENDING_NOTICE = "That agent reply is still being saved.";
const AGENT_PENDING_SESSION_NOTICE = "The previous Aside agent run did not finish. Retry the thread to run it again.";
const AGENT_DESKTOP_RUNTIME_NOTICE = "Agent execution requires desktop Obsidian with a filesystem-backed vault.";
const AGENT_REPLY_SAVE_FAILED_HINT = "Couldn’t save reply";
const AGENT_CANCELLED_NOTICE = "Cancelled.";
const AGENT_STATUS_CANCELLED = "Cancelled";
const LOCAL_MAX_CONCURRENT_RUNS = 3;
const REPLY_HANDOFF_RETRY_MS = 250;
const MAX_REPLY_HANDOFF_RETRIES = 5;
const BUILT_IN_ASIDE_SKILL_NAME = "aside";
const BUILT_IN_ASIDE_SKILL_MODE = "write";
const MAX_AGENT_PROCESS_LOG_LINES = 80;
const UTF8_ENCODER = new TextEncoder();

function formatAgentStartingHint(target: AsideAgentTarget): string {
    return `Starting ${getAgentActorLabel(target)}…`;
}

function normalizeAgentReplyDuplicateText(text: string): string {
    return text.replace(/\r\n?/g, "\n").trim();
}

interface ActiveRunExecution {
    runId: string;
    threadId: string;
    abortController: AbortController;
    cancelRequested: boolean;
}

interface RetryPromptOptions {
    triggerEntryId: string;
    filePath: string;
    retryOfRunId?: string;
    missingFileNotice: string;
    missingCommentNotice: string;
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

function normalizeAgentProcessLogLine(value: string): string | null {
    const normalized = value.replace(/\s+/gu, " ").trim();
    return normalized || null;
}

function appendAgentProcessLogLine(
    existingLines: readonly string[] | undefined,
    value: string,
): string[] {
    const normalized = normalizeAgentProcessLogLine(value);
    if (!normalized) {
        return existingLines ? [...existingLines] : [];
    }

    const lines = existingLines ? [...existingLines] : [];
    if (lines.at(-1) !== normalized) {
        lines.push(normalized);
    }
    return lines.slice(-MAX_AGENT_PROCESS_LOG_LINES);
}

type AgentStreamListener = (update: AgentStreamUpdate) => void;
const FINAL_STREAM_RETENTION_MS = 30_000;

export class CommentAgentController {
    private disposed = false;
    private processingQueue = false;
    private readonly runStreams = new Map<string, AgentRunStreamState>();
    private readonly runStreamPruneTimers = new Map<string, number>();
    private readonly replyHandoffRetryTimers = new Map<string, number>();
    private readonly replyHandoffRetryAttempts = new Map<string, number>();
    private readonly pendingReplyHandoffs = new Map<string, string>();
    private readonly streamListeners = new Set<AgentStreamListener>();
    private readonly activeRunExecutions = new Map<string, ActiveRunExecution>();
    private readonly persistingReplyRunIds = new Set<string>();
    private readonly retainedRunStreamIds = new Set<string>();
    private readonly dispatchingRunIds = new Set<string>();
    private readonly dispatchingPdfDestinationPaths = new Set<string>();
    private readonly preparingRetryTriggerEntryIds = new Set<string>();

    constructor(
        private readonly host: CommentAgentHost,
        private readonly store: AgentRunStore,
    ) {}

    public initialize(): void {
        this.disposed = false;
        this.store.load();
    }

    public async reconcilePendingRunsFromPreviousSession(): Promise<void> {
        if (this.disposed) {
            return;
        }
        let changed = false;
        const now = this.host.now();
        for (const run of this.store.getRuns()) {
            if (this.disposed) {
                break;
            }
            if (run.status !== "queued" && run.status !== "running") {
                continue;
            }

            const recoveredOutputEntryId = await this.ensureInterruptedRunReply(run, now);
            const updated = await this.store.updateRun(run.id, (currentRun) => ({
                ...currentRun,
                status: "failed",
                endedAt: now,
                error: currentRun.error ?? AGENT_PENDING_SESSION_NOTICE,
                ...(recoveredOutputEntryId ? { outputEntryId: recoveredOutputEntryId } : {}),
            }));
            changed = changed || !!updated;
        }

        if (changed) {
            await this.refreshStatusViews();
        }
        void this.processQueue();
    }

    private async ensureInterruptedRunReply(
        run: AgentRunRecord,
        timestamp: number,
    ): Promise<string | undefined> {
        const outputEntryId = run.outputEntryId ?? this.host.createCommentId();
        const file = this.host.getFileByPath(run.filePath);
        if (!this.host.isPageNoteCapableFile(file)) {
            return run.outputEntryId;
        }

        try {
            await this.host.loadCommentsForFile(file);
            const existingOutput = this.host.getCommentManager().getCommentById(outputEntryId);
            if (existingOutput?.deletedAt !== undefined) {
                return run.outputEntryId;
            }
            if (existingOutput?.comment.trim()) {
                return outputEntryId;
            }
            const committed = await this.commitRunReply(
                run,
                outputEntryId,
                AGENT_PENDING_SESSION_NOTICE,
                timestamp,
            );
            if (committed) {
                return outputEntryId;
            }
            void this.host.log?.("warn", "agents", "agents.reply.interrupted_commit_failed", {
                runId: run.id,
                threadId: run.threadId,
                outputEntryId,
                error: "Unable to save the interrupted agent reply.",
            });
        } catch (error) {
            void this.host.log?.("warn", "agents", "agents.reply.interrupted_commit_failed", {
                runId: run.id,
                threadId: run.threadId,
                outputEntryId,
                error,
            });
        }

        return run.outputEntryId;
    }

    public getAgentRuns(): AgentRunRecord[] {
        return this.store.getRuns();
    }

    public getLocallyOwnedRunIds(): string[] {
        return Array.from(new Set([
            ...this.store.getActiveRunIds(),
            ...this.runStreams.keys(),
            ...this.dispatchingRunIds,
            ...this.activeRunExecutions.keys(),
            ...this.persistingReplyRunIds,
            ...this.retainedRunStreamIds,
        ]));
    }

    public getLatestAgentRunForThread(threadId: string): AgentRunRecord | null {
        return getLatestAgentRunForThread(this.store.getRuns(), threadId);
    }

    public getActiveAgentStreamForThread(threadId: string): AgentRunStreamState | null {
        return this.getAgentStreamsForThread(threadId)[0] ?? null;
    }

    public getAgentStreamsForThread(threadId: string): AgentRunStreamState[] {
        return Array.from(this.runStreams.values())
            .filter((stream) => stream.threadId === threadId)
            .sort((left, right) => (
                right.updatedAt !== left.updatedAt
                    ? right.updatedAt - left.updatedAt
                    : right.runId.localeCompare(left.runId)
            ))
            .map((stream) => cloneAgentRunStreamState(stream));
    }

    public subscribeToStreamUpdates(listener: AgentStreamListener): () => void {
        this.streamListeners.add(listener);
        return () => {
            this.streamListeners.delete(listener);
        };
    }

    public dispose(): void {
        this.disposed = true;
        this.streamListeners.clear();
        const timerWindow = getTimerWindow();
        for (const timer of this.runStreamPruneTimers.values()) {
            timerWindow?.clearTimeout(timer);
        }
        this.runStreamPruneTimers.clear();
        for (const timer of this.replyHandoffRetryTimers.values()) {
            timerWindow?.clearTimeout(timer);
        }
        this.replyHandoffRetryTimers.clear();
        this.replyHandoffRetryAttempts.clear();
        this.pendingReplyHandoffs.clear();
        for (const execution of this.activeRunExecutions.values()) {
            execution.cancelRequested = true;
            execution.abortController.abort();
        }
        this.activeRunExecutions.clear();
        this.persistingReplyRunIds.clear();
        this.retainedRunStreamIds.clear();
        this.dispatchingRunIds.clear();
        this.dispatchingPdfDestinationPaths.clear();
        this.preparingRetryTriggerEntryIds.clear();
        this.runStreams.clear();
    }

    public async handleSavedUserEntry(event: SavedUserEntryEvent): Promise<void> {
        if (this.disposed) {
            return;
        }
        const resolution = parseAgentDirectives(event.body);
        const resolvedTarget = this.resolveDispatchTarget(resolution, event);
        if (!resolvedTarget) {
            return;
        }
        const runtimeSelection = await this.host.resolveAgentRuntimeSelection(resolvedTarget);
        if (this.disposed) {
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
        if (runtimeSelection.kind === "blocked") {
            await this.persistPreflightFailure(run, runtimeSelection.diagnostic);
        } else {
            await this.enqueueRun(run);
        }
        this.logBuiltInAsideSkillSelected(run, event.entryId);
        void this.host.log?.("info", "agents", "agents.directive.detected", {
            threadId: event.threadId,
            entryId: event.entryId,
            requestedAgent: run.requestedAgent,
            runtime: run.runtime,
        });
    }

    public async handleCreateScriptRequest(
        event: SavedUserEntryEvent,
        requestText: string,
    ): Promise<void> {
        if (this.disposed) {
            return;
        }
        if (getLatestAgentRunForTriggerEntry(this.store.getRuns(), event.entryId)) {
            return;
        }

        const selection = await this.host.resolveDefaultAgentRuntimeSelection();
        if (this.disposed) {
            return;
        }
        if (selection.kind === "none") {
            await this.appendCommandReply(event, CREATE_SCRIPT_NO_AGENT);
            return;
        }

        const run = this.buildQueuedRun({
            threadId: event.threadId,
            triggerEntryId: event.entryId,
            filePath: event.filePath,
            requestedAgent: selection.selectedAgent,
            requestKind: "create-script",
            runtime: selection.runtime,
            modePreference: selection.modePreference,
            promptText: requestText,
        });
        await this.enqueueRun(run);
        this.logBuiltInAsideSkillSelected(run, event.entryId);
    }

    public async handleUpdateScriptRequest(
        event: SavedUserEntryEvent,
        requestText: string,
        targetScript: VaultScriptRegistration,
    ): Promise<void> {
        if (this.disposed) {
            return;
        }
        if (getLatestAgentRunForTriggerEntry(this.store.getRuns(), event.entryId)) {
            return;
        }

        const selection = await this.host.resolveDefaultAgentRuntimeSelection();
        if (this.disposed) {
            return;
        }
        if (selection.kind === "none") {
            await this.appendCommandReply(event, UPDATE_SCRIPT_NO_AGENT);
            return;
        }

        const run = this.buildQueuedRun({
            threadId: event.threadId,
            triggerEntryId: event.entryId,
            filePath: event.filePath,
            requestedAgent: selection.selectedAgent,
            requestKind: "update-script",
            targetScriptPath: targetScript.path,
            runtime: selection.runtime,
            modePreference: selection.modePreference,
            promptText: requestText,
        });
        await this.enqueueRun(run);
        this.logBuiltInAsideSkillSelected(run, event.entryId);
    }

    public async handlePdfToMarkdownRequest(event: SavedUserEntryEvent): Promise<void> {
        if (this.disposed) {
            return;
        }
        if (getLatestAgentRunForTriggerEntry(this.store.getRuns(), event.entryId)) {
            return;
        }

        const destinationPath = derivePdfToMarkdownDestinationPath(event.filePath);
        if (!destinationPath) {
            await this.appendCommandReply(event, PDF_TO_MARKDOWN_SOURCE_REQUIRED);
            return;
        }
        if (this.hasPdfToMarkdownDestination(destinationPath)) {
            await this.appendCommandReply(
                event,
                formatPdfToMarkdownDestinationConflict(destinationPath),
            );
            return;
        }
        if (!this.reservePdfToMarkdownDestination(destinationPath)) {
            await this.appendCommandReply(event, formatPdfToMarkdownInProgress(destinationPath));
            return;
        }

        try {
            const selection = await this.host.resolveDefaultAgentRuntimeSelection();
            if (this.disposed) {
                return;
            }
            if (selection.kind === "none") {
                await this.appendCommandReply(event, PDF_TO_MARKDOWN_NO_AGENT);
                return;
            }
            if (this.hasPdfToMarkdownDestination(destinationPath)) {
                await this.appendCommandReply(
                    event,
                    formatPdfToMarkdownDestinationConflict(destinationPath),
                );
                return;
            }

            const run = this.buildQueuedRun({
                threadId: event.threadId,
                triggerEntryId: event.entryId,
                filePath: event.filePath,
                requestedAgent: selection.selectedAgent,
                requestKind: "pdf-to-markdown",
                runtime: selection.runtime,
                modePreference: selection.modePreference,
                promptText: PDF_TO_MARKDOWN_DIRECTIVE,
            });
            await this.enqueueRun(run);
            this.logBuiltInAsideSkillSelected(run, event.entryId);
        } finally {
            this.releasePdfToMarkdownDestination(destinationPath);
        }
    }

    public async retryRun(runId: string): Promise<boolean> {
        if (this.disposed) {
            return false;
        }
        const previousRun = this.store.getRunById(runId);
        if (!previousRun) {
            this.host.showNotice("Unable to find that agent reply.");
            return false;
        }
        if (this.persistingReplyRunIds.has(runId)) {
            this.host.showNotice(AGENT_REPLY_SAVE_PENDING_NOTICE);
            return false;
        }

        const latestTriggerComment = this.host.getCommentManager().getCommentById(previousRun.triggerEntryId);
        return this.retryPromptForCommentInternal({
            triggerEntryId: previousRun.triggerEntryId,
            filePath: latestTriggerComment?.filePath ?? previousRun.filePath,
            retryOfRunId: previousRun.id,
            missingFileNotice: "Unable to reload that side note reply.",
            missingCommentNotice: "Unable to find the latest saved side note entry.",
        });
    }

    public async retryPromptForComment(commentId: string, filePath: string): Promise<boolean> {
        if (this.disposed) {
            return false;
        }
        return this.retryPromptForCommentInternal({
            triggerEntryId: commentId,
            filePath,
            missingFileNotice: "Unable to reload that side note prompt.",
            missingCommentNotice: "Unable to find that saved side note entry.",
        });
    }

    private async retryPromptForCommentInternal(options: RetryPromptOptions): Promise<boolean> {
        if (this.preparingRetryTriggerEntryIds.has(options.triggerEntryId)) {
            this.host.showNotice(AGENT_REPLY_SAVE_PENDING_NOTICE);
            return false;
        }

        this.preparingRetryTriggerEntryIds.add(options.triggerEntryId);
        try {
            return await this.prepareRetryPromptForComment(options);
        } finally {
            this.preparingRetryTriggerEntryIds.delete(options.triggerEntryId);
        }
    }

    private async prepareRetryPromptForComment(options: RetryPromptOptions): Promise<boolean> {
        const file = this.host.getFileByPath(options.filePath);
        if (!this.host.isPageNoteCapableFile(file)) {
            this.host.showNotice(options.missingFileNotice);
            return false;
        }

        await this.host.loadCommentsForFile(file);
        const latestComment = this.host.getCommentManager().getCommentById(options.triggerEntryId);
        if (!latestComment) {
            this.host.showNotice(options.missingCommentNotice);
            return false;
        }
        const activeRunForTrigger = this.store.getRuns().find((run) => (
            run.triggerEntryId === latestComment.id
            && (run.status === "queued" || run.status === "running")
        ));
        if (activeRunForTrigger) {
            this.host.showNotice(AGENT_REPLY_SAVE_PENDING_NOTICE);
            return false;
        }

        const thread = this.host.getCommentManager().getThreadById(options.triggerEntryId);
        if (!thread) {
            this.host.showNotice("Unable to find that side note thread.");
            return false;
        }

        const retryOfRunId = options.retryOfRunId
            ?? getLatestAgentRunForTriggerEntry(this.store.getRuns(), latestComment.id)?.id;
        if (retryOfRunId && this.persistingReplyRunIds.has(retryOfRunId)) {
            this.host.showNotice(AGENT_REPLY_SAVE_PENDING_NOTICE);
            return false;
        }
        const previousRun = retryOfRunId
            ? this.store.getRunById(retryOfRunId)
            : null;
        let requestedAgent: AsideAgentTarget;
        let runtime: AgentRunRuntime;
        let modePreference: AgentRuntimeModePreference;
        let promptText: string;
        let requestKind: AgentRunRequestKind | undefined;
        let targetScriptPath: string | undefined;
        let reservedPdfDestinationPath: string | undefined;
        let preflightDiagnostic: string | undefined;

        if (previousRun?.requestKind === "pdf-to-markdown") {
            const commandEvent = {
                threadId: thread.id,
                entryId: latestComment.id,
                filePath: latestComment.filePath,
                body: latestComment.comment,
            };
            const pdfResolution = parsePdfToMarkdownDirective(latestComment.comment);
            if (pdfResolution.kind !== "request") {
                await this.appendCommandReply(
                    commandEvent,
                    pdfResolution.kind === "rejected"
                        ? pdfResolution.message
                        : PDF_TO_MARKDOWN_USAGE,
                );
                return false;
            }
            const destinationPath = derivePdfToMarkdownDestinationPath(latestComment.filePath);
            if (!destinationPath) {
                await this.appendCommandReply(commandEvent, PDF_TO_MARKDOWN_SOURCE_REQUIRED);
                return false;
            }
            if (this.hasPdfToMarkdownDestination(destinationPath)) {
                await this.appendCommandReply(
                    commandEvent,
                    formatPdfToMarkdownDestinationConflict(destinationPath),
                );
                return false;
            }

            const selection = await this.host.resolveDefaultAgentRuntimeSelection();
            if (selection.kind === "none") {
                await this.appendCommandReply(commandEvent, PDF_TO_MARKDOWN_NO_AGENT);
                return false;
            }
            if (this.hasPdfToMarkdownDestination(destinationPath)) {
                await this.appendCommandReply(
                    commandEvent,
                    formatPdfToMarkdownDestinationConflict(destinationPath),
                );
                return false;
            }
            if (!this.reservePdfToMarkdownDestination(destinationPath)) {
                await this.appendCommandReply(
                    commandEvent,
                    formatPdfToMarkdownInProgress(destinationPath),
                );
                return false;
            }
            reservedPdfDestinationPath = destinationPath;
            requestedAgent = selection.selectedAgent;
            runtime = selection.runtime;
            modePreference = selection.modePreference;
            promptText = PDF_TO_MARKDOWN_DIRECTIVE;
            requestKind = "pdf-to-markdown";
        } else if (previousRun?.requestKind === "create-script") {
            const createResolution = parseCreateScriptDirective(latestComment.comment);
            if (createResolution.kind !== "request") {
                this.host.showNotice(
                    createResolution.kind === "rejected"
                        ? createResolution.message
                        : CREATE_SCRIPT_USAGE,
                );
                return false;
            }

            const selection = await this.host.resolveDefaultAgentRuntimeSelection();
            if (selection.kind === "none") {
                await this.appendCommandReply({
                    threadId: thread.id,
                    entryId: latestComment.id,
                    filePath: latestComment.filePath,
                    body: latestComment.comment,
                }, CREATE_SCRIPT_NO_AGENT);
                return false;
            }
            requestedAgent = selection.selectedAgent;
            runtime = selection.runtime;
            modePreference = selection.modePreference;
            promptText = createResolution.requestText;
            requestKind = "create-script";
        } else if (previousRun?.requestKind === "update-script") {
            const updateResolution = parseUpdateScriptDirective(latestComment.comment);
            if (updateResolution.kind !== "request") {
                await this.appendCommandReply({
                    threadId: thread.id,
                    entryId: latestComment.id,
                    filePath: latestComment.filePath,
                    body: latestComment.comment,
                }, updateResolution.kind === "rejected"
                    ? updateResolution.message
                    : UPDATE_SCRIPT_USAGE);
                return false;
            }

            const targetScript = this.host.resolveVaultScriptMention(updateResolution.targetMention);
            if (!targetScript) {
                await this.appendCommandReply({
                    threadId: thread.id,
                    entryId: latestComment.id,
                    filePath: latestComment.filePath,
                    body: latestComment.comment,
                }, `Script ${updateResolution.targetMention} is not available to update.`);
                return false;
            }

            const selection = await this.host.resolveDefaultAgentRuntimeSelection();
            if (selection.kind === "none") {
                await this.appendCommandReply({
                    threadId: thread.id,
                    entryId: latestComment.id,
                    filePath: latestComment.filePath,
                    body: latestComment.comment,
                }, UPDATE_SCRIPT_NO_AGENT);
                return false;
            }
            requestedAgent = selection.selectedAgent;
            runtime = selection.runtime;
            modePreference = selection.modePreference;
            promptText = updateResolution.requestText;
            requestKind = "update-script";
            targetScriptPath = targetScript.path;
        } else {
            const resolution = parseAgentDirectives(latestComment.comment);
            const resolvedTarget = this.resolveRetryTarget(resolution);
            if (!resolvedTarget) {
                return false;
            }
            const runtimeSelection = await this.host.resolveAgentRuntimeSelection(resolvedTarget);
            requestedAgent = resolvedTarget;
            runtime = runtimeSelection.runtime;
            modePreference = runtimeSelection.modePreference;
            promptText = latestComment.comment;
            if (runtimeSelection.kind === "blocked") {
                preflightDiagnostic = runtimeSelection.diagnostic;
            }
        }

        try {
            const storedRetryOutputEntryId = retryOfRunId
                ? this.store.getRunById(retryOfRunId)?.outputEntryId
                : undefined;
            const storedRetryOutput = storedRetryOutputEntryId
                ? this.host.getCommentManager().getCommentById(storedRetryOutputEntryId)
                : null;
            const retryOutputEntryId = storedRetryOutput && storedRetryOutput.deletedAt === undefined
                ? storedRetryOutput.id
                : undefined;
            const run = this.buildQueuedRun({
                threadId: thread.id,
                triggerEntryId: latestComment.id,
                filePath: latestComment.filePath,
                requestedAgent,
                ...(requestKind ? { requestKind } : {}),
                ...(targetScriptPath ? { targetScriptPath } : {}),
                runtime,
                modePreference,
                promptText,
                ...(retryOfRunId ? { retryOfRunId } : {}),
            });
            if (retryOutputEntryId) {
                run.outputEntryId = retryOutputEntryId;
            }
            if (retryOfRunId && this.retainedRunStreamIds.delete(retryOfRunId)) {
                this.clearRunStreamState(retryOfRunId);
            }
            if (preflightDiagnostic) {
                return this.persistPreflightFailure(run, preflightDiagnostic);
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
        } finally {
            if (reservedPdfDestinationPath) {
                this.releasePdfToMarkdownDestination(reservedPdfDestinationPath);
            }
        }
    }

    private reservePdfToMarkdownDestination(destinationPath: string): boolean {
        const destinationKey = this.normalizePdfToMarkdownDestinationKey(destinationPath);
        if (this.dispatchingPdfDestinationPaths.has(destinationKey)) {
            return false;
        }
        const hasActiveRun = this.store.getRuns().some((run) => {
            if (
                run.requestKind !== "pdf-to-markdown"
                || (run.status !== "queued" && run.status !== "running")
            ) {
                return false;
            }
            const activeDestinationPath = derivePdfToMarkdownDestinationPath(run.filePath);
            return activeDestinationPath
                ? this.normalizePdfToMarkdownDestinationKey(activeDestinationPath) === destinationKey
                : false;
        });
        if (hasActiveRun) {
            return false;
        }

        this.dispatchingPdfDestinationPaths.add(destinationKey);
        return true;
    }

    private hasPdfToMarkdownDestination(destinationPath: string): boolean {
        if (this.host.getFileByPath(destinationPath)) {
            return true;
        }
        const destinationKey = this.normalizePdfToMarkdownDestinationKey(destinationPath);
        return this.host.getFilePaths().some(
            (filePath) => this.normalizePdfToMarkdownDestinationKey(filePath) === destinationKey,
        );
    }

    private releasePdfToMarkdownDestination(destinationPath: string): void {
        this.dispatchingPdfDestinationPaths.delete(
            this.normalizePdfToMarkdownDestinationKey(destinationPath),
        );
    }

    private normalizePdfToMarkdownDestinationKey(destinationPath: string): string {
        return destinationPath.normalize("NFC").toLocaleLowerCase("en-US");
    }

    public async cancelRun(runId: string, options?: { message?: string }): Promise<boolean> {
        if (this.persistingReplyRunIds.has(runId)) {
            return false;
        }
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
        const replyText = partialText || cancellationMessage;
        if (run.outputEntryId) {
            let persistenceError: unknown = null;
            try {
                const committed = await this.commitRunReply(
                    run,
                    run.outputEntryId,
                    replyText,
                    this.host.now(),
                );
                if (!committed) {
                    persistenceError = new Error("Unable to save the cancelled agent reply.");
                }
            } catch (error) {
                persistenceError = error;
            }
            if (persistenceError) {
                await this.failReplyPersistence({
                    run,
                    replyText,
                    outputEntryId: run.outputEntryId,
                    startedAt: run.startedAt ?? run.createdAt,
                    error: persistenceError,
                    runError: cancellationMessage,
                });
                return true;
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
                processLogLines: existingStream?.processLogLines,
                partialText: replyText,
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
        if (this.disposed || this.processingQueue) {
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
        if (this.disposed) {
            return;
        }
        const queuedRun = this.store.getRunById(runId);
        if (!queuedRun || queuedRun.status !== "queued") {
            return;
        }

        const startedAt = queuedRun.startedAt ?? this.host.now();
        const outputEntryId = queuedRun.outputEntryId ?? this.host.createCommentId();
        const runtimeContext = await this.buildRuntimePromptContext(queuedRun);
        const latestQueuedRun = this.store.getRunById(runId);
        if (!latestQueuedRun || latestQueuedRun.status !== "queued") {
            return;
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
        const queuedStream = this.runStreams.get(runId);
        const initialStream = this.buildRunStreamState(runningRun, {
            status: "running",
            statusHintText: queuedStream?.statusHintText
                ?? formatAgentStartingHint(runningRun.requestedAgent),
            partialText: queuedStream?.partialText ?? "",
            startedAt: runningRun.startedAt ?? startedAt,
            updatedAt: this.host.now(),
            outputEntryId,
        });
        this.setRunStream(initialStream);
        void this.refreshStatusViews();

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
                startedAt: runningRun.startedAt ?? startedAt,
                runtimePrompt: runtimeContext.promptText,
                execution,
            });
        } catch (error: unknown) {
            if (this.isRunCancellationRequested(runId) || isAgentRuntimeCancelledError(error)) {
                return;
            }
            await this.failRun(runId, runningRun, summarizeError(error));
        } finally {
            this.persistingReplyRunIds.delete(runId);
            this.activeRunExecutions.delete(runId);
        }
    }

    private async failRun(runId: string, run: AgentRunRecord, message: string): Promise<void> {
        const existingStream = this.runStreams.get(runId);
        const knownFailureReply = formatKnownAgentFailureReply(
            run.requestedAgent,
            [message, existingStream?.partialText ?? ""].join("\n"),
        );
        const failureText = knownFailureReply
            ?? (existingStream?.partialText.trim().length
                ? existingStream.partialText
                : sanitizeAgentDiagnosticForDisplay(message));
        const failureMetadata = mergeAgentRunMetadata(run, existingStream ?? {});
        let failureReplyPersisted = false;
        let failureReplyPersistenceError: unknown = null;
        if (run.outputEntryId) {
            try {
                failureReplyPersisted = await this.commitRunReply(
                    run,
                    run.outputEntryId,
                    failureText,
                    this.host.now(),
                );
                if (!failureReplyPersisted) {
                    failureReplyPersistenceError = new Error("Unable to save the agent failure reply.");
                }
            } catch (error) {
                failureReplyPersistenceError = error;
                void this.host.log?.("warn", "agents", "agents.reply.failure_commit_failed", {
                    runId,
                    threadId: run.threadId,
                    outputEntryId: run.outputEntryId,
                    error,
                });
            }
        }
        if (run.outputEntryId && failureReplyPersistenceError) {
            await this.failReplyPersistence({
                run,
                replyText: failureText,
                outputEntryId: run.outputEntryId,
                startedAt: run.startedAt ?? run.createdAt,
                error: failureReplyPersistenceError,
                runError: message,
            });
            void this.host.log?.("warn", "agents", "agents.run.failed", {
                runId,
                threadId: run.threadId,
                requestedAgent: run.requestedAgent,
                runtime: run.runtime,
                error: message,
            });
            return;
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
                processLogLines: existingStream?.processLogLines,
                partialText: failureText,
                startedAt: failedRun.startedAt ?? run.createdAt,
                updatedAt: failedRun.endedAt ?? this.host.now(),
                outputEntryId: failedRun.outputEntryId,
                error: message,
            }));
            await this.refreshStatusViews();
            if (failureReplyPersisted) {
                this.clearRunStream(runId, run.threadId);
            } else {
                this.clearRunStreamPruneTimer(runId);
            }
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
        startedAt: number;
        runtimePrompt: string;
        execution: ActiveRunExecution;
    }): Promise<void> {
        const vaultRootPath = this.host.getVaultRootPath();
        const workingDirectory = options.run.requestKind === "create-script"
            || options.run.requestKind === "update-script"
            || options.run.requestKind === "pdf-to-markdown"
            ? vaultRootPath
            : this.host.getRuntimeWorkingDirectory(options.run.filePath);
        if (!workingDirectory) {
            await this.failRun(options.run.id, options.run, AGENT_DESKTOP_RUNTIME_NOTICE);
            return;
        }

        const runtimeResponse = await this.host.runAgentRuntime({
            target: options.run.requestedAgent,
            prompt: options.runtimePrompt,
            cwd: workingDirectory,
            vaultRootPath,
            requestKind: options.run.requestKind,
            targetScriptPath: options.run.targetScriptPath,
            abortSignal: options.execution.abortController.signal,
            onProgressText: (progressText) => {
                if (this.isRunCancellationRequested(options.run.id)) {
                    return;
                }

                const normalizedProgressText = progressText.trim();
                if (!normalizedProgressText) {
                    return;
                }

                const currentStream = this.runStreams.get(options.run.id);
                const processLogLines = appendAgentProcessLogLine(
                    currentStream?.processLogLines,
                    normalizedProgressText,
                );
                this.updateRunStream(
                    options.run.id,
                    this.buildRunStreamState({
                        ...options.run,
                        ...mergeAgentRunMetadata(options.run, currentStream ?? {}),
                    }, {
                        status: "running",
                        statusHintText: normalizedProgressText,
                        processLogLines,
                        partialText: currentStream?.partialText ?? "",
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
                        processLogLines: this.runStreams.get(options.run.id)?.processLogLines,
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
                        processLogLines: currentStream?.processLogLines,
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

        if (formatStandaloneAgentProviderFailureReply(options.run.requestedAgent, runtimeResponse.replyText)) {
            throw new Error(runtimeResponse.replyText);
        }

        await this.completeRunWithReply({
            run: options.run,
            runtime: runtimeResponse.runtime,
            replyText: runtimeResponse.replyText,
            replyMetadata: runtimeResponse,
            outputEntryId: options.outputEntryId,
            startedAt: options.startedAt,
        });
    }

    private commitRunReply(
        run: AgentRunRecord,
        outputEntryId: string,
        body: string,
        timestamp: number,
    ): Promise<boolean> {
        const currentRun = this.store.getRunById(run.id) ?? run;
        return this.host.commitThreadEntry(
            currentRun.filePath,
            currentRun.threadId,
            {
                id: outputEntryId,
                body,
                timestamp,
            },
            {
                insertAfterCommentId: currentRun.triggerEntryId,
                immediateAggregateRefresh: false,
                skipCommentViewRefresh: true,
                refreshEditorDecorations: false,
                refreshMarkdownPreviews: false,
            },
        );
    }

    private async finalizeSucceededRun(options: {
        run: AgentRunRecord;
        runtime: AgentRunRuntime;
        replyMetadata?: AgentRunMetadata;
        outputEntryId: string;
        endedAt: number;
    }): Promise<AgentRunRecord | null> {
        try {
            const completedRun = await this.store.updateRun(options.run.id, (run) => ({
                ...run,
                ...mergeAgentRunMetadata(run, options.replyMetadata ?? {}),
                runtime: options.runtime,
                status: "succeeded",
                endedAt: options.endedAt,
                outputEntryId: options.outputEntryId,
                error: undefined,
            }));
            if (!completedRun) {
                throw new Error("Unable to finalize the agent run.");
            }
            return completedRun;
        } catch (error) {
            void this.host.log?.("warn", "agents", "agents.run.finalize_failed", {
                runId: options.run.id,
                threadId: options.run.threadId,
                outputEntryId: options.outputEntryId,
                error,
            });
            return null;
        }
    }

    private async completeRunWithReply(options: {
        run: AgentRunRecord;
        runtime: AgentRunRuntime;
        replyText: string;
        replyMetadata?: AgentRunMetadata;
        outputEntryId: string;
        startedAt: number;
    }): Promise<void> {
        if (this.isRunCancellationRequested(options.run.id)) {
            return;
        }

        this.persistingReplyRunIds.add(options.run.id);
        const annotationResult = await this.applyAgentAnnotationProposals(options.run, options.replyText);
        const replyText = annotationResult.replyText.trim();
        if (!replyText) {
            throw new Error("The agent returned an empty response.");
        }

        const timestamp = this.host.now();
        this.retainedRunStreamIds.add(options.run.id);
        this.updateRunStream(options.run.id, this.buildRunStreamState({
            ...options.run,
            ...mergeAgentRunMetadata(options.run, this.runStreams.get(options.run.id) ?? {}),
        }, {
            status: "succeeded",
            statusHintText: undefined,
            processLogLines: this.runStreams.get(options.run.id)?.processLogLines,
            partialText: replyText,
            startedAt: options.startedAt,
            updatedAt: timestamp,
            outputEntryId: options.outputEntryId,
        }));
        try {
            const committed = await this.commitRunReply(
                options.run,
                options.outputEntryId,
                replyText,
                timestamp,
            );
            if (this.isRunCancellationRequested(options.run.id)) {
                return;
            }
            if (!committed) {
                throw new Error("Unable to save the agent reply.");
            }
        } catch (error) {
            await this.failReplyPersistence({
                run: options.run,
                replyText,
                outputEntryId: options.outputEntryId,
                startedAt: options.startedAt,
                error,
            });
            return;
        }

        const finalizeRun = () => this.finalizeSucceededRun({
            run: options.run,
            runtime: options.runtime,
            replyMetadata: options.replyMetadata,
            outputEntryId: options.outputEntryId,
            endedAt: timestamp,
        });
        const completedRun = await finalizeRun();

        try {
            await this.deleteDuplicateCompletedAgentReplies({
                threadId: options.run.threadId,
                triggerEntryId: options.run.triggerEntryId,
                outputEntryId: options.outputEntryId,
                replyText,
                startedAt: options.startedAt,
                completedAt: timestamp,
                runId: options.run.id,
            });
        } catch (error) {
            void this.host.log?.("warn", "agents", "agents.reply.cleanup_failed", {
                runId: options.run.id,
                threadId: options.run.threadId,
                outputEntryId: options.outputEntryId,
                error,
            });
        }

        const refreshed = await this.refreshStatusViews();
        this.persistingReplyRunIds.delete(options.run.id);
        if (refreshed && completedRun) {
            this.retainedRunStreamIds.delete(options.run.id);
            this.clearRunStream(options.run.id, options.run.threadId);
        } else {
            this.scheduleReplyHandoffRetry(
                options.run.id,
                options.run.threadId,
                completedRun ? undefined : async () => !!await finalizeRun(),
            );
        }
        void this.host.log?.("info", "agents", "agents.reply.appended", {
            runId: options.run.id,
            threadId: options.run.threadId,
            outputEntryId: options.outputEntryId,
        });
        if (completedRun) {
            void this.host.log?.("info", "agents", "agents.run.succeeded", {
                runId: options.run.id,
                threadId: options.run.threadId,
                runtime: options.runtime,
                outputEntryId: options.outputEntryId,
            });
        }
    }

    private async failReplyPersistence(options: {
        run: AgentRunRecord;
        replyText: string;
        outputEntryId: string;
        startedAt: number;
        error: unknown;
        runError?: string;
    }): Promise<void> {
        const message = summarizeError(options.error);
        const existingStream = this.runStreams.get(options.run.id);
        this.retainedRunStreamIds.add(options.run.id);
        this.setRunStream(this.buildRunStreamState({
            ...options.run,
            ...mergeAgentRunMetadata(options.run, existingStream ?? {}),
        }, {
            status: "failed",
            statusHintText: AGENT_REPLY_SAVE_FAILED_HINT,
            processLogLines: existingStream?.processLogLines,
            partialText: options.replyText,
            startedAt: options.startedAt,
            updatedAt: this.host.now(),
            outputEntryId: options.outputEntryId,
            error: message,
        }));
        this.persistingReplyRunIds.delete(options.run.id);
        try {
            await this.store.updateRun(options.run.id, (run) => ({
                ...run,
                ...mergeAgentRunMetadata(run, existingStream ?? {}),
                status: "failed",
                endedAt: this.host.now(),
                error: options.runError ?? message,
            }));
        } catch (storeError) {
            void this.host.log?.("warn", "agents", "agents.run.failure_persist_failed", {
                runId: options.run.id,
                threadId: options.run.threadId,
                outputEntryId: options.outputEntryId,
                error: storeError,
            });
        }
        void this.refreshStatusViews();
        void this.host.log?.("warn", "agents", "agents.reply.persist_failed", {
            runId: options.run.id,
            threadId: options.run.threadId,
            outputEntryId: options.outputEntryId,
            error: message,
        });
    }

    private async applyAgentAnnotationProposals(
        run: AgentRunRecord,
        replyText: string,
    ): Promise<{ replyText: string; createdCount: number; unmatchedCount: number }> {
        const extracted = extractAgentAnnotationProposals(replyText);
        if (!extracted.proposals.length) {
            return {
                replyText,
                createdCount: 0,
                unmatchedCount: 0,
            };
        }

        const file = this.host.getFileByPath(run.filePath);
        if (!file || !this.host.isCommentableFile(file)) {
            return {
                replyText: extracted.replyText
                    || "I could not create anchored side notes because the source note is unavailable.",
                createdCount: 0,
                unmatchedCount: extracted.proposals.length,
            };
        }

        let noteContent = "";
        try {
            noteContent = await this.host.getCurrentNoteContent(file);
        } catch (error) {
            void this.host.log?.("warn", "agents", "agents.annotations.note_read_failed", {
                runId: run.id,
                filePath: run.filePath,
                error,
            });
            return {
                replyText: extracted.replyText
                    || "I could not create anchored side notes because the source note could not be read.",
                createdCount: 0,
                unmatchedCount: extracted.proposals.length,
            };
        }

        let createdCount = 0;
        let unmatchedCount = 0;
        for (const proposal of extracted.proposals) {
            const resolved = resolveAgentAnnotationProposal(run.filePath, noteContent, proposal);
            if (!resolved) {
                unmatchedCount += 1;
                continue;
            }

            const timestamp = this.host.now();
            this.host.getCommentManager().addComment({
                ...resolved.comment,
                id: this.host.createCommentId(),
                timestamp,
                selectedTextHash: await this.host.hashText(resolved.comment.selectedText),
            });
            createdCount += 1;
        }

        if (createdCount > 0) {
            await this.host.persistCommentsForFile(file, {
                immediateAggregateRefresh: true,
                skipCommentViewRefresh: true,
            });
        }

        void this.host.log?.("info", "agents", "agents.annotations.applied", {
            runId: run.id,
            filePath: run.filePath,
            proposalCount: extracted.proposals.length,
            createdCount,
            unmatchedCount,
        });

        return {
            replyText: extracted.replyText || this.buildAnnotationStatusReply(createdCount, unmatchedCount),
            createdCount,
            unmatchedCount,
        };
    }

    private buildAnnotationStatusReply(createdCount: number, unmatchedCount: number): string {
        if (createdCount > 0 && unmatchedCount > 0) {
            return `Added ${createdCount} anchored side note${createdCount === 1 ? "" : "s"}; ${unmatchedCount} proposal${unmatchedCount === 1 ? "" : "s"} did not match the current note text.`;
        }
        if (createdCount > 0) {
            return `Added ${createdCount} anchored side note${createdCount === 1 ? "" : "s"}.`;
        }
        return "I could not create anchored side notes because the proposed source snippets did not match the current note text.";
    }

    private async deleteDuplicateCompletedAgentReplies(options: {
        threadId: string;
        triggerEntryId: string;
        outputEntryId: string;
        replyText: string;
        startedAt: number;
        completedAt: number;
        runId: string;
    }): Promise<void> {
        const thread = this.host.getCommentManager().getThreadById(options.threadId);
        if (!thread) {
            return;
        }

        const normalizedReplyText = normalizeAgentReplyDuplicateText(options.replyText);
        if (!normalizedReplyText) {
            return;
        }

        const triggerIndex = thread.entries.findIndex((entry) => entry.id === options.triggerEntryId);
        const protectedOutputEntryIds = new Set(
            this.store.getRuns()
                .map((run) => run.outputEntryId)
                .filter((outputEntryId): outputEntryId is string => !!outputEntryId),
        );
        const duplicateEntryIds = thread.entries
            .map((entry, index) => ({ entry, index }))
            .filter(({ entry, index }) =>
                entry.id !== options.outputEntryId
                && entry.id !== options.triggerEntryId
                && !entry.deletedAt
                && !protectedOutputEntryIds.has(entry.id)
                && (triggerIndex === -1 || index > triggerIndex)
                && entry.timestamp >= options.startedAt
                && entry.timestamp <= options.completedAt
                && normalizeAgentReplyDuplicateText(entry.body) === normalizedReplyText)
            .map(({ entry }) => entry.id);

        for (const duplicateEntryId of duplicateEntryIds) {
            try {
                await this.host.deleteComment(duplicateEntryId, { skipCommentViewRefresh: true });
                void this.host.log?.("info", "agents", "agents.reply.duplicate_removed", {
                    runId: options.runId,
                    threadId: options.threadId,
                    outputEntryId: options.outputEntryId,
                    duplicateEntryId,
                });
            } catch (error) {
                void this.host.log?.("warn", "agents", "agents.reply.duplicate_remove_failed", {
                    runId: options.runId,
                    threadId: options.threadId,
                    outputEntryId: options.outputEntryId,
                    duplicateEntryId,
                    error,
                });
            }
        }
    }

    private async buildRuntimePromptContext(
        run: Pick<
            AgentRunRecord,
            "id" | "threadId" | "triggerEntryId" | "filePath" | "promptText" | "retryOfRunId" | "outputEntryId"
        >,
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

        const promptThread = run.retryOfRunId && run.outputEntryId
            ? {
                ...thread,
                entries: thread.entries.filter((entry) => entry.id !== run.outputEntryId),
            }
            : thread;
        const context = buildAgentPromptContext({
            filePath: run.filePath,
            noteContent,
            thread: promptThread,
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
        preferredAgent?: AsideAgentTarget;
        requestKind?: AgentRunRequestKind;
        targetScriptPath?: string;
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
            ...(options.preferredAgent ? { preferredAgent: options.preferredAgent } : {}),
            ...(options.requestKind ? { requestKind: options.requestKind } : {}),
            ...(options.targetScriptPath ? { targetScriptPath: options.targetScriptPath } : {}),
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
            }, ...resolveRequestedAgentRunSkills({
                filePath: options.filePath,
                promptText: options.promptText,
            })],
            usedFiles: [
                options.filePath,
                ...(options.targetScriptPath ? [options.targetScriptPath] : []),
            ],
        };
    }

    private buildRunStreamState(
        run: Pick<AgentRunRecord, "id" | "threadId" | "triggerEntryId" | "requestedAgent" | "preferredAgent" | "requestKind" | "runtime"> & AgentRunMetadata,
        options: {
            status: AgentRunRecord["status"];
            statusText?: string;
            statusHintText?: string;
            processLogLines?: string[];
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
            triggerEntryId: run.triggerEntryId,
            requestedAgent: run.requestedAgent,
            preferredAgent: run.preferredAgent,
            requestKind: run.requestKind,
            runtime: run.runtime,
            status: options.status,
            statusText: options.statusText,
            statusHintText: options.statusHintText,
            processLogLines: options.processLogLines ? [...options.processLogLines] : undefined,
            partialText: options.partialText,
            startedAt: options.startedAt,
            updatedAt: options.updatedAt,
            outputEntryId: options.outputEntryId,
            error: options.error,
            ...metadata,
        };
    }

    private async enqueueRun(run: AgentRunRecord): Promise<void> {
        if (this.disposed) {
            return;
        }
        const queuedRun = run.outputEntryId
            ? run
            : { ...run, outputEntryId: this.host.createCommentId() };
        this.setRunStream(this.buildRunStreamState(queuedRun, {
            status: "queued",
            statusHintText: formatAgentStartingHint(queuedRun.requestedAgent),
            partialText: "",
            startedAt: queuedRun.createdAt,
            updatedAt: this.host.now(),
            outputEntryId: queuedRun.outputEntryId,
        }));
        void this.refreshStatusViews();
        try {
            await this.store.addRun(queuedRun);
        } catch (error) {
            this.clearRunStream(queuedRun.id, queuedRun.threadId);
            throw error;
        }
        if (this.disposed) {
            return;
        }
        void this.host.log?.("info", "agents", "agents.run.queued", {
            runId: queuedRun.id,
            threadId: queuedRun.threadId,
            requestedAgent: queuedRun.requestedAgent,
            runtime: queuedRun.runtime,
        });
        void this.processQueue();
    }

    private async persistPreflightFailure(run: AgentRunRecord, diagnostic: string): Promise<boolean> {
        const failureText = formatAgentPreflightFailureReply(run.requestedAgent, diagnostic);
        const outputEntryId = run.outputEntryId ?? this.host.createCommentId();
        await this.store.addRun({
            ...run,
            outputEntryId,
        });
        const persisted = run.outputEntryId
            ? await this.host.editComment(outputEntryId, failureText, { skipCommentViewRefresh: true })
            : await this.host.appendThreadEntry(run.threadId, {
                id: outputEntryId,
                body: failureText,
                timestamp: this.host.now(),
            }, {
                insertAfterCommentId: run.triggerEntryId,
                alwaysInsertAfterTarget: true,
                skipCommentViewRefresh: true,
            });
        const failedRun = await this.store.updateRun(run.id, (currentRun) => ({
            ...currentRun,
            status: "failed",
            endedAt: this.host.now(),
            error: persisted ? diagnostic : "Unable to append the agent reply to the thread.",
            ...(!persisted && !run.outputEntryId ? { outputEntryId: undefined } : {}),
        }));
        await this.refreshStatusViews();
        void this.host.log?.("warn", "agents", "agents.run.preflight-failed", {
            runId: run.id,
            threadId: run.threadId,
            requestedAgent: run.requestedAgent,
            runtime: run.runtime,
            error: diagnostic,
        });
        return !!failedRun && persisted;
    }

    private async appendCommandReply(event: SavedUserEntryEvent, body: string): Promise<void> {
        await this.host.appendThreadEntry(event.threadId, {
            id: this.host.createCommentId(),
            body,
            timestamp: this.host.now(),
        }, {
            insertAfterCommentId: event.entryId,
            alwaysInsertAfterTarget: true,
        });
    }

    private async refreshStatusViews(): Promise<boolean> {
        try {
            await this.host.refreshCommentViews?.();
            this.completePendingReplyHandoffs();
            return true;
        } catch (error) {
            void this.host.log?.("warn", "agents", "agents.refresh.warn", {
                error,
            });
            return false;
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
            && JSON.stringify(previous.processLogLines ?? []) === JSON.stringify(nextStream.processLogLines ?? [])
            && previous.error === nextStream.error
            && previous.outputEntryId === nextStream.outputEntryId
            && JSON.stringify(previous.usedSkills ?? []) === JSON.stringify(nextStream.usedSkills ?? [])
            && JSON.stringify(previous.usedTools ?? []) === JSON.stringify(nextStream.usedTools ?? [])
            && JSON.stringify(previous.usedFiles ?? []) === JSON.stringify(nextStream.usedFiles ?? [])
            && JSON.stringify(previous.usedUrls ?? []) === JSON.stringify(nextStream.usedUrls ?? [])
            && JSON.stringify(previous.usedToolErrors ?? []) === JSON.stringify(nextStream.usedToolErrors ?? [])
        ) {
            this.runStreams.set(runId, {
                ...previous,
                updatedAt: nextStream.updatedAt,
                statusText: nextStream.statusText,
                statusHintText: nextStream.statusHintText,
                processLogLines: nextStream.processLogLines ? [...nextStream.processLogLines] : undefined,
            });
            return;
        }

        this.setRunStream(nextStream);
    }

    private setRunStream(stream: AgentRunStreamState): void {
        this.setRunStreamState(stream);
        this.emitStreamUpdate(stream.runId, stream.threadId, stream);
    }

    private setRunStreamState(stream: AgentRunStreamState): void {
        this.clearRunStreamPruneTimer(stream.runId);
        this.runStreams.set(stream.runId, cloneAgentRunStreamState(stream));
        if (
            (stream.status === "succeeded" || stream.status === "failed" || stream.status === "cancelled")
            && !this.retainedRunStreamIds.has(stream.runId)
        ) {
            this.scheduleRunStreamPrune(stream.runId);
        }
    }

    private clearRunStream(runId: string, threadId: string): void {
        if (!this.clearRunStreamState(runId)) {
            return;
        }

        this.emitStreamUpdate(runId, threadId, null);
    }

    private clearRunStreamState(runId: string): boolean {
        this.clearReplyHandoffRetryState(runId);
        if (!this.runStreams.has(runId)) {
            return false;
        }

        this.clearRunStreamPruneTimer(runId);
        this.runStreams.delete(runId);
        return true;
    }

    private scheduleRunStreamPrune(runId: string): void {
        this.clearRunStreamPruneTimer(runId);
        const timerWindow = getTimerWindow();
        if (!timerWindow) {
            return;
        }

        const timer = timerWindow.setTimeout(() => {
            this.runStreamPruneTimers.delete(runId);
            const stream = this.runStreams.get(runId);
            if (!stream) {
                return;
            }

            this.runStreams.delete(runId);
            this.emitStreamUpdate(runId, stream.threadId, null);
        }, FINAL_STREAM_RETENTION_MS);
        this.runStreamPruneTimers.set(runId, timer);
    }

    private scheduleReplyHandoffRetry(
        runId: string,
        threadId: string,
        finalizeRun?: () => Promise<boolean>,
    ): void {
        this.clearReplyHandoffRetryTimer(runId);
        this.pendingReplyHandoffs.set(runId, threadId);
        const attempt = this.replyHandoffRetryAttempts.get(runId) ?? 0;
        if (attempt >= MAX_REPLY_HANDOFF_RETRIES) {
            return;
        }
        const timerWindow = getTimerWindow();
        if (!timerWindow) {
            return;
        }

        const timer = timerWindow.setTimeout(() => {
            this.replyHandoffRetryTimers.delete(runId);
            void this.retryReplyHandoff(runId, threadId, finalizeRun);
        }, REPLY_HANDOFF_RETRY_MS * (2 ** attempt));
        this.replyHandoffRetryAttempts.set(runId, attempt + 1);
        this.replyHandoffRetryTimers.set(runId, timer);
    }

    private async retryReplyHandoff(
        runId: string,
        threadId: string,
        finalizeRun?: () => Promise<boolean>,
    ): Promise<void> {
        if (!this.retainedRunStreamIds.has(runId) || !this.runStreams.has(runId)) {
            return;
        }
        if (finalizeRun && !await finalizeRun()) {
            this.scheduleReplyHandoffRetry(runId, threadId, finalizeRun);
            return;
        }
        if (await this.refreshStatusViews() && this.isReplyHandoffReady(runId)) {
            this.retainedRunStreamIds.delete(runId);
            this.clearRunStream(runId, threadId);
            return;
        }
        if (this.runStreams.has(runId)) {
            this.scheduleReplyHandoffRetry(runId, threadId, finalizeRun);
        }
    }

    private completePendingReplyHandoffs(): void {
        for (const [runId, threadId] of Array.from(this.pendingReplyHandoffs.entries())) {
            if (!this.retainedRunStreamIds.has(runId) || !this.runStreams.has(runId)) {
                this.clearReplyHandoffRetryState(runId);
                continue;
            }
            if (!this.isReplyHandoffReady(runId)) {
                continue;
            }
            this.retainedRunStreamIds.delete(runId);
            this.clearRunStream(runId, threadId);
        }
    }

    private isReplyHandoffReady(runId: string): boolean {
        const run = this.store.getRunById(runId);
        const stream = this.runStreams.get(runId);
        if (!run || !stream || run.status !== stream.status) {
            return false;
        }
        return run.status === "succeeded"
            || run.status === "failed"
            || run.status === "cancelled";
    }

    private clearReplyHandoffRetryTimer(runId: string): void {
        const timer = this.replyHandoffRetryTimers.get(runId);
        if (!timer) {
            return;
        }
        getTimerWindow()?.clearTimeout(timer);
        this.replyHandoffRetryTimers.delete(runId);
    }

    private clearReplyHandoffRetryState(runId: string): void {
        this.clearReplyHandoffRetryTimer(runId);
        this.replyHandoffRetryAttempts.delete(runId);
        this.pendingReplyHandoffs.delete(runId);
    }

    private clearRunStreamPruneTimer(runId: string): void {
        const timer = this.runStreamPruneTimers.get(runId);
        if (!timer) {
            return;
        }

        getTimerWindow()?.clearTimeout(timer);
        this.runStreamPruneTimers.delete(runId);
    }

    private emitStreamUpdate(
        runId: string,
        threadId: string,
        stream: AgentRunStreamState | null,
    ): void {
        const payload: AgentStreamUpdate = {
            threadId,
            runId,
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
