import type { CommentManager } from "../commentManager";
import type { SavedUserEntryEvent } from "../core/comments/savedUserEntry";
import {
    getLatestScriptRunForTriggerEntry,
    isLatestScriptRunRetryAttempt,
    type ScriptRunRecord,
} from "../core/scripts/scriptRuns";
import { resolveScriptDirective, type ScriptDirectiveResolution } from "./scriptDirectives";
import type { ScriptRunStore } from "./scriptRunStore";
import type { VaultScriptRegistry } from "./vaultScriptRegistry";
import type {
    VaultScriptRuntimeInvocation,
    VaultScriptRuntimeResult,
} from "./vaultScriptRuntime";

const MAX_SCRIPT_RESULT_WORDS = 250;
const MAX_SCRIPT_ERROR_CHARACTERS = 500;
const SCRIPT_RETRY_MISSING_NOTICE = "Unable to rerun: the saved trigger or vault script is no longer available.";
const SCRIPT_RETRY_REPLACE_NOTICE = "Unable to replace the previous script result.";
const SCRIPT_RETRY_PERSIST_NOTICE = "Unable to save the script retry.";
const SCRIPT_SESSION_INTERRUPTED_ERROR = "The previous vault script run did not finish. Regenerate it to run again.";
const SCRIPT_CHANGED_BEFORE_EXECUTION_ERROR = "The vault script changed or became ambiguous before execution. Regenerate it to run again.";

export interface CommentScriptHost {
    isScriptsEnabled(): boolean;
    createRunId(): string;
    now(): number;
    getVaultRootPath(): string | null;
    getCommentManager(): CommentManager;
    loadCommentsForFile(filePath: string): Promise<unknown>;
    appendThreadEntry(
        threadId: string,
        entry: { id: string; body: string; timestamp: number },
        options?: {
            insertAfterCommentId?: string;
            alwaysInsertAfterTarget?: boolean;
            refreshBeforePersist?: boolean;
            immediateAggregateRefresh?: boolean;
            skipCommentViewRefresh?: boolean;
            refreshEditorDecorations?: boolean;
            refreshMarkdownPreviews?: boolean;
            isStillValid?: () => boolean;
        },
    ): Promise<boolean>;
    editComment(
        commentId: string,
        body: string,
        options?: {
            skipCommentViewRefresh?: boolean;
            deferAggregateRefresh?: boolean;
            refreshEditorDecorations?: boolean;
            refreshMarkdownPreviews?: boolean;
            isStillValid?: () => boolean;
        },
    ): Promise<boolean>;
    refreshCommentViews(): Promise<void>;
    showNotice(message: string): void;
    getRegistry(): VaultScriptRegistry;
    runVaultScript(invocation: VaultScriptRuntimeInvocation): Promise<VaultScriptRuntimeResult>;
}

export interface SavedEntryScriptController {
    ownsSavedUserEntry(entryId: string): boolean;
    handleSavedUserEntry(event: SavedUserEntryEvent): Promise<boolean>;
}

export interface SavedEntryBuiltInController {
    handleSavedUserEntry(event: SavedUserEntryEvent): Promise<boolean>;
}

export interface SavedEntryAgentController {
    handleSavedUserEntry(event: SavedUserEntryEvent): Promise<void>;
}

export interface SavedEntryBuiltInControllers {
    updateScript: SavedEntryBuiltInController;
    createScript: SavedEntryBuiltInController;
    pdfToMarkdown: SavedEntryBuiltInController;
}

export interface SavedUserEntryRoute {
    event: SavedUserEntryEvent;
    isScriptsEnabled: () => boolean;
    builtInControllers: SavedEntryBuiltInControllers;
    scriptController: SavedEntryScriptController;
    agentController: SavedEntryAgentController;
}

export async function routeSavedUserEntry(route: SavedUserEntryRoute): Promise<void> {
    const {
        event,
        isScriptsEnabled,
        builtInControllers,
        scriptController,
        agentController,
    } = route;
    const fallBackToAgent = async (): Promise<void> => {
        if (scriptController.ownsSavedUserEntry(event.entryId)) {
            return;
        }
        await agentController.handleSavedUserEntry(event);
    };
    if (scriptController.ownsSavedUserEntry(event.entryId)) {
        return;
    }
    if (!isScriptsEnabled()) {
        await fallBackToAgent();
        return;
    }
    for (const builtInController of [
        builtInControllers.updateScript,
        builtInControllers.createScript,
        builtInControllers.pdfToMarkdown,
    ]) {
        if (!isScriptsEnabled()) {
            await fallBackToAgent();
            return;
        }
        const handled = await builtInController.handleSavedUserEntry(event);
        if (handled) {
            return;
        }
        if (!isScriptsEnabled()) {
            await fallBackToAgent();
            return;
        }
    }
    if (!isScriptsEnabled()) {
        await fallBackToAgent();
        return;
    }
    const handledByScript = await scriptController.handleSavedUserEntry(event);
    if (handledByScript) {
        return;
    }
    await fallBackToAgent();
}

function normalizeResultWords(value: string): string[] {
    const normalized = value.trim();
    return normalized ? normalized.split(/\s+/u) : [];
}

export function formatScriptResult(mentionName: string, value: string): string {
    const words = normalizeResultWords(value);
    let content = words.length === 0
        ? "Completed."
        : words.slice(0, MAX_SCRIPT_RESULT_WORDS).join(" ");
    if (words.length > MAX_SCRIPT_RESULT_WORDS) {
        content += "\n\n[output truncated]";
    }
    return `Script /${mentionName}:\n\n${content}`;
}

export function summarizeScriptError(error: unknown): string {
    const errorRecord = error && typeof error === "object"
        ? error as { message?: unknown; stderr?: unknown }
        : null;
    const normalizeErrorText = (value: unknown): string => typeof value === "string"
        ? value.replace(/\s+/gu, " ").trim()
        : "";
    const stderr = normalizeErrorText(errorRecord?.stderr);
    const message = normalizeErrorText(errorRecord?.message ?? error);
    const concise = stderr || message || "Script failed.";
    if (concise.length <= MAX_SCRIPT_ERROR_CHARACTERS) {
        return concise;
    }
    return `${concise.slice(0, MAX_SCRIPT_ERROR_CHARACTERS - 1).trimEnd()}…`;
}

export class CommentScriptController {
    private executionQueue: Promise<void> = Promise.resolve();
    private readonly claimingSavedEntryGenerations = new Map<string, number>();
    private readonly retryingTriggerEntryGenerations = new Map<string, number>();
    private readonly retryingOutputEntryGenerations = new Map<string, number>();
    private lifecycleGeneration = 0;
    private disposed = false;

    constructor(
        private readonly host: CommentScriptHost,
        private readonly store: ScriptRunStore,
    ) {}

    public initialize(): void {
        this.lifecycleGeneration += 1;
        this.disposed = false;
        this.executionQueue = Promise.resolve();
    }

    public dispose(): void {
        this.lifecycleGeneration += 1;
        this.disposed = true;
        this.claimingSavedEntryGenerations.clear();
        this.retryingTriggerEntryGenerations.clear();
        this.retryingOutputEntryGenerations.clear();
    }

    public getRuns(): ScriptRunRecord[] {
        return this.store.getRuns();
    }

    public getLocallyOwnedRunIds(): string[] {
        return this.store.getActiveRunIds();
    }

    public async reconcilePendingRunsFromPreviousSession(): Promise<boolean> {
        return this.store.failPendingRuns(SCRIPT_SESSION_INTERRUPTED_ERROR, this.host.now());
    }

    public ownsSavedUserEntry(entryId: string): boolean {
        return this.claimingSavedEntryGenerations.has(entryId)
            || getLatestScriptRunForTriggerEntry(this.store.getRuns(), entryId) !== null;
    }

    public async handleSavedUserEntry(event: SavedUserEntryEvent): Promise<boolean> {
        // A stored run is the durable routing receipt for this saved entry. This check
        // intentionally precedes both the current capability gate and body/registry
        // resolution so refreshes cannot reroute an already-claimed trigger.
        if (this.ownsSavedUserEntry(event.entryId)) {
            return true;
        }
        if (!this.canStartScriptRun()) {
            return false;
        }
        const generation = this.lifecycleGeneration;
        const resolution = resolveScriptDirective(event.body, this.host.getRegistry());
        if (resolution.kind === "none") {
            return false;
        }
        if (!this.canStartScriptRun()) {
            return false;
        }

        this.claimingSavedEntryGenerations.set(event.entryId, generation);
        try {
            if (resolution.kind === "rejected") {
                const rejectedRun = this.buildRejectedRun(event, resolution);
                if (!this.canStartScriptRun()) {
                    return false;
                }
                await this.store.addRun(rejectedRun);
                if (!this.isGenerationActive(generation)) {
                    return true;
                }
                let outputEntryId: string;
                try {
                    outputEntryId = await this.writeOutput(
                        rejectedRun,
                        formatScriptResult(resolution.mentionName, resolution.message),
                        generation,
                    );
                } catch (error) {
                    if (!this.isGenerationActive(generation)) {
                        return true;
                    }
                    throw error;
                }
                if (!this.isGenerationActive(generation)) {
                    return true;
                }
                await this.store.updateRun(rejectedRun.id, (current) => {
                    if (!this.isGenerationActive(generation)) {
                        return current;
                    }
                    return {
                        ...current,
                        outputEntryId,
                    };
                });
                if (this.isGenerationActive(generation)) {
                    await this.host.refreshCommentViews();
                }
                return true;
            }

            const run = this.buildQueuedRun(event, resolution);
            if (!this.canStartScriptRun()) {
                return false;
            }
            await this.store.addRun(run);
            if (!this.isGenerationActive(generation)) {
                await this.terminalizeRunFromRetiredGeneration(run.id, generation);
                return true;
            }
            try {
                await this.appendPendingOutput(run, generation);
            } catch (error) {
                if (!this.isGenerationActive(generation)) {
                    await this.terminalizeRunFromRetiredGeneration(run.id, generation);
                    return true;
                }
                const message = summarizeScriptError(error);
                await this.terminalizeFailedRun(run.id, message, generation);
                this.host.showNotice(message);
                await this.refreshCommentViewsBestEffort(generation);
                return true;
            }
            if (!this.isGenerationActive(generation)) {
                await this.terminalizeRunFromRetiredGeneration(run.id, generation);
                return true;
            }
            await this.refreshCommentViewsBestEffort(generation);
            if (this.isGenerationActive(generation)) {
                void this.enqueue(run, generation);
            }
            return true;
        } finally {
            if (this.claimingSavedEntryGenerations.get(event.entryId) === generation) {
                this.claimingSavedEntryGenerations.delete(event.entryId);
            }
        }
    }

    public async retryRun(runId: string): Promise<boolean> {
        if (!this.canStartScriptRun()) {
            return false;
        }
        const previous = this.store.getRunById(runId);
        if (!previous || !this.isLatestRetryAttempt(previous)) {
            return false;
        }
        const generation = this.lifecycleGeneration;
        if (!this.claimRetryOwnership(previous, generation)) {
            return false;
        }

        try {
            await this.host.loadCommentsForFile(previous.filePath);
            if (
                !this.isGenerationActive(generation)
                || !this.host.isScriptsEnabled()
                || !this.isLatestRetryAttempt(previous)
            ) {
                return false;
            }
            const trigger = this.host.getCommentManager().getCommentById(previous.triggerEntryId);
            const thread = this.host.getCommentManager().getThreadById(previous.triggerEntryId);
            const script = this.host.getRegistry().resolve(previous.mentionName);
            if (!trigger || !thread || !script) {
                this.host.showNotice(SCRIPT_RETRY_MISSING_NOTICE);
                return false;
            }
            const reusesExistingOutput = Boolean(
                previous.outputEntryId
                && this.host.getCommentManager().getCommentById(previous.outputEntryId),
            );

            const next: ScriptRunRecord = {
                ...previous,
                id: this.host.createRunId(),
                threadId: thread.id,
                filePath: trigger.filePath,
                scriptPath: script.path,
                status: "queued",
                promptText: trigger.comment,
                createdAt: this.host.now(),
                retryOfRunId: previous.id,
                outputEntryId: reusesExistingOutput
                    ? previous.outputEntryId
                    : this.host.createRunId(),
                startedAt: undefined,
                endedAt: undefined,
                error: undefined,
            };
            try {
                const added = await this.store.addRetryRunIfLatest(previous, next);
                if (!added) {
                    return false;
                }
            } catch {
                if (this.isGenerationActive(generation)) {
                    this.host.showNotice(SCRIPT_RETRY_PERSIST_NOTICE);
                    await this.refreshCommentViewsBestEffort(generation);
                }
                return false;
            }
            if (!this.isGenerationActive(generation)) {
                await this.terminalizeRunFromRetiredGeneration(next.id, generation);
                return false;
            }
            await this.refreshCommentViewsBestEffort(generation);

            if (reusesExistingOutput && previous.outputEntryId) {
                let cleared = false;
                try {
                    cleared = await this.host.editComment(
                        previous.outputEntryId,
                        "",
                        {
                            skipCommentViewRefresh: true,
                            isStillValid: () => this.isGenerationActive(generation),
                        },
                    );
                } catch {
                    cleared = false;
                }
                if (!this.isGenerationActive(generation)) {
                    await this.terminalizeRunFromRetiredGeneration(next.id, generation);
                    return false;
                }
                if (!cleared) {
                    await this.terminalizeFailedRun(
                        next.id,
                        SCRIPT_RETRY_REPLACE_NOTICE,
                        generation,
                    );
                    this.host.showNotice(SCRIPT_RETRY_REPLACE_NOTICE);
                    await this.refreshCommentViewsBestEffort(generation);
                    return false;
                }
                if (!this.isGenerationActive(generation)) {
                    await this.terminalizeRunFromRetiredGeneration(next.id, generation);
                    return false;
                }
                await this.refreshCommentViewsBestEffort(generation);
            } else {
                try {
                    await this.appendPendingOutput(next, generation);
                } catch (error) {
                    if (!this.isGenerationActive(generation)) {
                        await this.terminalizeRunFromRetiredGeneration(next.id, generation);
                        return false;
                    }
                    const message = summarizeScriptError(error);
                    await this.terminalizeFailedRun(next.id, message, generation);
                    this.host.showNotice(message);
                    await this.refreshCommentViewsBestEffort(generation);
                    return false;
                }
                if (!this.isGenerationActive(generation)) {
                    await this.terminalizeRunFromRetiredGeneration(next.id, generation);
                    return false;
                }
                await this.refreshCommentViewsBestEffort(generation);
            }

            if (!this.isGenerationActive(generation)) {
                await this.terminalizeRunFromRetiredGeneration(next.id, generation);
                return false;
            }
            await this.enqueue(next, generation);
            return true;
        } finally {
            this.releaseRetryOwnership(previous, generation);
        }
    }

    private isLatestRetryAttempt(run: ScriptRunRecord): boolean {
        return isLatestScriptRunRetryAttempt(this.store.getRuns(), run);
    }

    private claimRetryOwnership(run: ScriptRunRecord, generation: number): boolean {
        if (
            this.retryingTriggerEntryGenerations.has(run.triggerEntryId)
            || (run.outputEntryId && this.retryingOutputEntryGenerations.has(run.outputEntryId))
        ) {
            return false;
        }
        this.retryingTriggerEntryGenerations.set(run.triggerEntryId, generation);
        if (run.outputEntryId) {
            this.retryingOutputEntryGenerations.set(run.outputEntryId, generation);
        }
        return true;
    }

    private releaseRetryOwnership(run: ScriptRunRecord, generation: number): void {
        if (this.retryingTriggerEntryGenerations.get(run.triggerEntryId) === generation) {
            this.retryingTriggerEntryGenerations.delete(run.triggerEntryId);
        }
        if (
            run.outputEntryId
            && this.retryingOutputEntryGenerations.get(run.outputEntryId) === generation
        ) {
            this.retryingOutputEntryGenerations.delete(run.outputEntryId);
        }
    }

    private buildQueuedRun(
        event: SavedUserEntryEvent,
        resolution: Extract<ScriptDirectiveResolution, { kind: "script" }>,
    ): ScriptRunRecord {
        return {
            id: this.host.createRunId(),
            threadId: event.threadId,
            triggerEntryId: event.entryId,
            filePath: event.filePath,
            scriptPath: resolution.script.path,
            mentionName: resolution.script.mentionName,
            status: "queued",
            promptText: event.body,
            createdAt: this.host.now(),
            outputEntryId: this.host.createRunId(),
        };
    }

    private buildRejectedRun(
        event: SavedUserEntryEvent,
        resolution: Extract<ScriptDirectiveResolution, { kind: "rejected" }>,
    ): ScriptRunRecord {
        const timestamp = this.host.now();
        return {
            id: this.host.createRunId(),
            threadId: event.threadId,
            triggerEntryId: event.entryId,
            filePath: event.filePath,
            scriptPath: this.host.getRegistry().resolve(resolution.mentionName)?.path
                ?? `unresolved:@${resolution.mentionName}`,
            mentionName: resolution.mentionName,
            status: "failed",
            promptText: event.body,
            createdAt: timestamp,
            endedAt: timestamp,
            error: resolution.message,
        };
    }

    private enqueue(run: ScriptRunRecord, generation: number): Promise<void> {
        const execution = this.executionQueue.then(() => this.execute(run, generation));
        const recovered = execution.catch(async (error) => {
            if (!this.isGenerationActive(generation)) return;
            const current = this.store.getRunById(run.id);
            if (!current || (current.status !== "queued" && current.status !== "running")) {
                return;
            }
            const message = summarizeScriptError(error);
            try {
                await this.finishRun(
                    current,
                    "failed",
                    formatScriptResult(current.mentionName, message),
                    message,
                    generation,
                );
            } catch (recoveryError) {
                if (this.isGenerationActive(generation)) {
                    this.host.showNotice(summarizeScriptError(recoveryError));
                }
            }
        });
        this.executionQueue = recovered.then(
            () => undefined,
            () => undefined,
        );
        return recovered;
    }

    private async execute(run: ScriptRunRecord, generation: number): Promise<void> {
        if (!this.isGenerationActive(generation)) {
            await this.terminalizeRunFromRetiredGeneration(run.id, generation);
            return;
        }
        if (!this.isRunScriptCurrent(run)) {
            await this.finishRun(
                run,
                "failed",
                formatScriptResult(run.mentionName, SCRIPT_CHANGED_BEFORE_EXECUTION_ERROR),
                SCRIPT_CHANGED_BEFORE_EXECUTION_ERROR,
                generation,
            );
            return;
        }
        let started = false;
        const runningRun = await this.store.updateRun(run.id, (current) => {
            if (!this.isGenerationActive(generation) || current.status !== "queued") {
                return current;
            }
            started = true;
            return {
                ...current,
                status: "running",
                startedAt: this.host.now(),
            };
        });
        if (!runningRun || !this.isGenerationActive(generation) || !started) {
            if (!this.isGenerationActive(generation)) {
                await this.terminalizeRunFromRetiredGeneration(run.id, generation);
            }
            return;
        }
        await this.refreshCommentViewsBestEffort(generation);
        if (!this.isGenerationActive(generation)) {
            await this.terminalizeRunFromRetiredGeneration(runningRun.id, generation);
            return;
        }
        if (!this.isRunScriptCurrent(runningRun)) {
            await this.finishRun(
                runningRun,
                "failed",
                formatScriptResult(runningRun.mentionName, SCRIPT_CHANGED_BEFORE_EXECUTION_ERROR),
                SCRIPT_CHANGED_BEFORE_EXECUTION_ERROR,
                generation,
            );
            return;
        }

        let status: "succeeded" | "failed";
        let body: string;
        let runtimeError: string | undefined;
        try {
            const vaultRootPath = this.host.getVaultRootPath();
            if (!vaultRootPath) {
                throw new Error("Vault scripts require desktop Obsidian with a filesystem-backed vault.");
            }
            const result = await this.host.runVaultScript({
                vaultRootPath,
                scriptPath: runningRun.scriptPath,
                notePath: runningRun.filePath,
            });
            status = "succeeded";
            body = formatScriptResult(runningRun.mentionName, result.stdout);
        } catch (error) {
            runtimeError = summarizeScriptError(error);
            status = "failed";
            body = formatScriptResult(runningRun.mentionName, runtimeError);
        }
        if (!this.isGenerationActive(generation)) {
            await this.terminalizeRunFromRetiredGeneration(runningRun.id, generation);
            return;
        }

        await this.finishRun(runningRun, status, body, runtimeError, generation);
    }

    private isRunScriptCurrent(run: ScriptRunRecord): boolean {
        return this.host.getRegistry().resolve(run.mentionName)?.path === run.scriptPath;
    }

    private canStartScriptRun(): boolean {
        return !this.disposed && this.host.isScriptsEnabled();
    }

    private isGenerationActive(generation: number): boolean {
        return !this.disposed && this.lifecycleGeneration === generation;
    }

    private async terminalizeRunFromRetiredGeneration(
        runId: string,
        generation: number,
    ): Promise<void> {
        if (this.disposed || this.lifecycleGeneration === generation) {
            return;
        }
        const run = this.store.getRunById(runId);
        if (!run || (run.status !== "queued" && run.status !== "running")) {
            return;
        }
        await this.store.updateRun(runId, (current) => {
            if (current.status !== "queued" && current.status !== "running") {
                return current;
            }
            return {
                ...current,
                status: "failed",
                endedAt: this.host.now(),
                error: SCRIPT_SESSION_INTERRUPTED_ERROR,
            };
        });
    }

    private async terminalizeFailedRun(
        runId: string,
        error: string,
        generation: number,
    ): Promise<void> {
        if (!this.isGenerationActive(generation)) {
            return;
        }
        await this.store.updateRun(runId, (current) => {
            if (
                !this.isGenerationActive(generation)
                || (current.status !== "queued" && current.status !== "running")
            ) {
                return current;
            }
            return {
                ...current,
                status: "failed",
                endedAt: this.host.now(),
                error,
            };
        });
    }

    private async refreshCommentViewsBestEffort(generation?: number): Promise<void> {
        if (generation !== undefined && !this.isGenerationActive(generation)) {
            return;
        }
        try {
            await this.host.refreshCommentViews();
        } catch (error) {
            if (generation === undefined || this.isGenerationActive(generation)) {
                this.host.showNotice(summarizeScriptError(error));
            }
        }
    }

    private async appendPendingOutput(run: ScriptRunRecord, generation: number): Promise<void> {
        const outputEntryId = run.outputEntryId;
        if (!outputEntryId) {
            throw new Error("Unable to save the vault script result.");
        }
        const appended = await this.host.appendThreadEntry(
            run.threadId,
            {
                id: outputEntryId,
                body: "",
                timestamp: this.host.now(),
            },
            {
                insertAfterCommentId: run.triggerEntryId,
                alwaysInsertAfterTarget: true,
                refreshBeforePersist: true,
                immediateAggregateRefresh: false,
                skipCommentViewRefresh: true,
                refreshEditorDecorations: false,
                refreshMarkdownPreviews: false,
                isStillValid: () => this.isGenerationActive(generation),
            },
        );
        if (!appended) {
            throw new Error("Unable to save the vault script result.");
        }
    }

    private async finishRun(
        run: ScriptRunRecord,
        status: "succeeded" | "failed",
        body: string,
        error?: string,
        generation = this.lifecycleGeneration,
    ): Promise<void> {
        if (!this.isGenerationActive(generation)) {
            return;
        }
        const currentBeforeOutput = this.store.getRunById(run.id);
        if (
            !currentBeforeOutput
            || (currentBeforeOutput.status !== "queued" && currentBeforeOutput.status !== "running")
        ) {
            return;
        }
        try {
            const outputEntryId = await this.writeOutput(run, body, generation);
            if (!this.isGenerationActive(generation)) {
                await this.terminalizeRunFromRetiredGeneration(run.id, generation);
                return;
            }
            let completed = false;
            await this.store.updateRun(run.id, (current) => {
                if (
                    !this.isGenerationActive(generation)
                    || (current.status !== "queued" && current.status !== "running")
                ) {
                    return current;
                }
                completed = true;
                return {
                    ...current,
                    status,
                    endedAt: this.host.now(),
                    outputEntryId,
                    error,
                };
            });
            if (!completed) {
                return;
            }
        } catch (outputError) {
            if (!this.isGenerationActive(generation)) {
                await this.terminalizeRunFromRetiredGeneration(run.id, generation);
                return;
            }
            const message = summarizeScriptError(outputError);
            await this.terminalizeFailedRun(run.id, message, generation);
            this.host.showNotice(message);
        }
        await this.refreshCommentViewsBestEffort(generation);
    }

    private async writeOutput(run: ScriptRunRecord, body: string, generation: number): Promise<string> {
        if (run.outputEntryId) {
            const edited = await this.host.editComment(
                run.outputEntryId,
                body,
                {
                    skipCommentViewRefresh: true,
                    deferAggregateRefresh: true,
                    refreshEditorDecorations: false,
                    refreshMarkdownPreviews: false,
                    isStillValid: () => this.isGenerationActive(generation),
                },
            );
            if (!edited) {
                throw new Error(SCRIPT_RETRY_REPLACE_NOTICE);
            }
            return run.outputEntryId;
        }

        const outputEntryId = this.host.createRunId();
        const appended = await this.host.appendThreadEntry(
            run.threadId,
            {
                id: outputEntryId,
                body,
                timestamp: this.host.now(),
            },
            {
                insertAfterCommentId: run.triggerEntryId,
                alwaysInsertAfterTarget: true,
                immediateAggregateRefresh: false,
                skipCommentViewRefresh: true,
                refreshEditorDecorations: false,
                refreshMarkdownPreviews: false,
                isStillValid: () => this.isGenerationActive(generation),
            },
        );
        if (!appended) {
            throw new Error("Unable to save the vault script result.");
        }
        return outputEntryId;
    }
}
