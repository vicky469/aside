import type { CommentManager } from "../commentManager";
import type { SavedUserEntryEvent } from "../core/comments/savedUserEntry";
import {
    getLatestScriptRunForTriggerEntry,
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
const SCRIPT_DISPOSED_ERROR = "Vault script execution stopped because Aside unloaded.";

export interface CommentScriptHost {
    createRunId(): string;
    now(): number;
    getVaultRootPath(): string | null;
    getCommentManager(): CommentManager;
    loadCommentsForFile(filePath: string): Promise<unknown>;
    appendThreadEntry(
        threadId: string,
        entry: { id: string; body: string; timestamp: number },
        options?: { insertAfterCommentId?: string; skipCommentViewRefresh?: boolean },
    ): Promise<boolean>;
    editComment(
        commentId: string,
        body: string,
        options?: { skipCommentViewRefresh?: boolean },
    ): Promise<boolean>;
    refreshCommentViews(): Promise<void>;
    showNotice(message: string): void;
    getRegistry(): VaultScriptRegistry;
    runVaultScript(invocation: VaultScriptRuntimeInvocation): Promise<VaultScriptRuntimeResult>;
}

export interface SavedEntryScriptController {
    handleSavedUserEntry(event: SavedUserEntryEvent): Promise<boolean>;
}

export interface SavedEntryAgentController {
    handleSavedUserEntry(event: SavedUserEntryEvent): Promise<void>;
}

export async function routeSavedUserEntry(
    event: SavedUserEntryEvent,
    scriptController: SavedEntryScriptController | null,
    agentController: SavedEntryAgentController,
): Promise<void> {
    const handledByScript = await scriptController?.handleSavedUserEntry(event) ?? false;
    if (!handledByScript) {
        await agentController.handleSavedUserEntry(event);
    }
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
    return `Script @${mentionName}:\n\n${content}`;
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
    private readonly claimingSavedEntryIds = new Set<string>();
    private readonly retryingRunIds = new Set<string>();
    private disposed = false;

    constructor(
        private readonly host: CommentScriptHost,
        private readonly store: ScriptRunStore,
    ) {}

    public initialize(): void {
        this.disposed = false;
    }

    public dispose(): void {
        this.disposed = true;
        this.claimingSavedEntryIds.clear();
        this.retryingRunIds.clear();
    }

    public getRuns(): ScriptRunRecord[] {
        return this.store.getRuns();
    }

    public async reconcilePendingRunsFromPreviousSession(): Promise<boolean> {
        return this.store.failPendingRuns(SCRIPT_SESSION_INTERRUPTED_ERROR, this.host.now());
    }

    public async handleSavedUserEntry(event: SavedUserEntryEvent): Promise<boolean> {
        // A stored run is the durable routing receipt for this saved entry. This check
        // intentionally precedes current body/registry resolution so refreshes, edits,
        // or storage changes cannot reroute or repeat an already-claimed trigger.
        if (
            this.claimingSavedEntryIds.has(event.entryId)
            || getLatestScriptRunForTriggerEntry(this.store.getRuns(), event.entryId)
        ) {
            return true;
        }
        if (this.disposed) {
            return false;
        }
        const resolution = resolveScriptDirective(event.body, this.host.getRegistry());
        if (resolution.kind === "none") {
            return false;
        }

        this.claimingSavedEntryIds.add(event.entryId);
        try {
            if (resolution.kind === "rejected") {
                const rejectedRun = this.buildRejectedRun(event, resolution);
                await this.store.addRun(rejectedRun);
                const outputEntryId = await this.writeOutput(
                    rejectedRun,
                    formatScriptResult(resolution.mentionName, resolution.message),
                );
                await this.store.updateRun(rejectedRun.id, (current) => ({
                    ...current,
                    outputEntryId,
                }));
                await this.host.refreshCommentViews();
                return true;
            }

            const run = this.buildQueuedRun(event, resolution);
            await this.store.addRun(run);
            await this.enqueue(run);
            return true;
        } finally {
            this.claimingSavedEntryIds.delete(event.entryId);
        }
    }

    public async retryRun(runId: string): Promise<boolean> {
        if (this.disposed || this.retryingRunIds.has(runId)) {
            return false;
        }
        const previous = this.store.getRunById(runId);
        if (!previous || previous.status === "queued" || previous.status === "running") {
            return false;
        }

        this.retryingRunIds.add(runId);
        try {
            await this.host.loadCommentsForFile(previous.filePath);
            const trigger = this.host.getCommentManager().getCommentById(previous.triggerEntryId);
            const thread = this.host.getCommentManager().getThreadById(previous.triggerEntryId);
            const script = this.host.getRegistry().resolve(previous.mentionName);
            if (!trigger || !thread || !script) {
                this.host.showNotice(SCRIPT_RETRY_MISSING_NOTICE);
                return false;
            }

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
                startedAt: undefined,
                endedAt: undefined,
                error: undefined,
            };
            try {
                await this.store.addRun(next);
            } catch {
                this.host.showNotice(SCRIPT_RETRY_PERSIST_NOTICE);
                await this.host.refreshCommentViews();
                return false;
            }

            if (next.outputEntryId) {
                let cleared = false;
                try {
                    cleared = await this.host.editComment(
                        next.outputEntryId,
                        "",
                        { skipCommentViewRefresh: true },
                    );
                } catch {
                    cleared = false;
                }
                if (!cleared) {
                    await this.terminalizeFailedRun(next.id, SCRIPT_RETRY_REPLACE_NOTICE);
                    this.host.showNotice(SCRIPT_RETRY_REPLACE_NOTICE);
                    await this.host.refreshCommentViews();
                    return false;
                }
            }

            await this.enqueue(next);
            return true;
        } finally {
            this.retryingRunIds.delete(runId);
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

    private enqueue(run: ScriptRunRecord): Promise<void> {
        const execution = this.executionQueue.then(() => this.execute(run));
        this.executionQueue = execution.then(
            () => undefined,
            () => undefined,
        );
        return execution;
    }

    private async execute(run: ScriptRunRecord): Promise<void> {
        if (this.disposed) {
            await this.terminalizeFailedRun(run.id, SCRIPT_DISPOSED_ERROR);
            await this.host.refreshCommentViews();
            return;
        }
        await this.store.updateRun(run.id, (current) => ({
            ...current,
            status: "running",
            startedAt: this.host.now(),
        }));

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
                scriptPath: run.scriptPath,
                notePath: run.filePath,
            });
            status = "succeeded";
            body = formatScriptResult(run.mentionName, result.stdout);
        } catch (error) {
            runtimeError = summarizeScriptError(error);
            status = "failed";
            body = formatScriptResult(run.mentionName, runtimeError);
        }

        try {
            const outputEntryId = await this.writeOutput(
                run,
                body,
            );
            await this.store.updateRun(run.id, (current) => ({
                ...current,
                status,
                endedAt: this.host.now(),
                outputEntryId,
                error: runtimeError,
            }));
        } catch (outputError) {
            const message = summarizeScriptError(outputError);
            await this.terminalizeFailedRun(run.id, message);
            this.host.showNotice(message);
        }
        await this.host.refreshCommentViews();
    }

    private async terminalizeFailedRun(runId: string, error: string): Promise<void> {
        await this.store.updateRun(runId, (current) => ({
            ...current,
            status: "failed",
            endedAt: this.host.now(),
            error,
        }));
    }

    private async writeOutput(run: ScriptRunRecord, body: string): Promise<string> {
        if (run.outputEntryId) {
            const edited = await this.host.editComment(
                run.outputEntryId,
                body,
                { skipCommentViewRefresh: true },
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
                skipCommentViewRefresh: true,
            },
        );
        if (!appended) {
            throw new Error("Unable to save the vault script result.");
        }
        return outputEntryId;
    }
}
