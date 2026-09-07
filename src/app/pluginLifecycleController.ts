import type { Plugin, TAbstractFile, TFile } from "obsidian";
import type { CommentManager } from "../commentManager";
import type { AggregateCommentIndex } from "../index/AggregateCommentIndex";
import { getPageCommentLabel } from "../core/anchors/commentAnchors";
import type { CommentThreadRetargetOptions } from "../domain/comments/commentThreadRetarget";
import type {
    CommentFileRetarget,
    CommentFileRetargetResult,
} from "../domain/comments/folderCommentRetarget";
import { retargetPathInFolder } from "../core/files/pathScope";
import {
    ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    type PluginEventExecutionContext,
} from "./pluginEventExecutionContext";

interface FolderRenameRetryState {
    pendingPublishedPaths: boolean;
    pendingAgentRuns: boolean;
    pendingScriptRuns: boolean;
    pendingCommentPersistence: CommentFileRetarget[];
    pendingLocalCache: CommentFileRetarget[];
    pendingAggregateIndex: CommentFileRetarget[];
    pendingRefresh: boolean;
}

export interface PluginLifecycleHost {
    app: Plugin["app"];
    getCommentManager(): CommentManager;
    getAggregateCommentIndex(): AggregateCommentIndex;
    renameAgentRuns(previousFilePath: string, nextFilePath: string): Promise<boolean>;
    renameScriptRuns(previousFilePath: string, nextFilePath: string): Promise<boolean>;
    renameStoredComments(
        previousFilePath: string,
        nextFilePath: string,
        retargetOptions: CommentThreadRetargetOptions,
    ): Promise<void>;
    renameAgentRunsInFolder(previousFolderPath: string, nextFolderPath: string): Promise<boolean>;
    renameScriptRunsInFolder(previousFolderPath: string, nextFolderPath: string): Promise<boolean>;
    renameStoredCommentsInFolder(
        retargets: readonly CommentFileRetarget[],
    ): Promise<CommentFileRetargetResult>;
    deleteStoredComments(filePath: string): Promise<void>;
    deleteStoredCommentsInFolder(folderPath: string): Promise<void>;
    renamePublishedPublicArtifactPath(previousFilePath: string, nextFilePath: string): Promise<void>;
    renamePublishedPublicArtifactPathsInFolder(
        previousFolderPath: string,
        nextFolderPath: string,
    ): Promise<void>;
    deletePublishedPublicArtifactPath(filePath: string): Promise<void>;
    deletePublishedPublicArtifactPathsInFolder(folderPath: string): Promise<void>;
    clearParsedNoteCache(filePath: string): void;
    clearDerivedCommentLinksForFile(filePath: string): void;
    isCommentableFile(file: TAbstractFile | null): file is TFile;
    isPageNoteCapableFile(file: TAbstractFile | null): file is TFile;
    hashText(text: string): Promise<string>;
    loadCommentsForFile(file: TFile | null): Promise<unknown>;
    refreshCommentViews(options?: { skipDataRefresh?: boolean }): Promise<void>;
    refreshEditorDecorations(): void;
    refreshAggregateNoteNow(): Promise<void>;
    scheduleAggregateNoteRefresh(): void;
    syncIndexNoteViewClasses(): void;
    handleMarkdownFileModified(file: TFile): Promise<void>;
    detachSidebarViews(): void;
    scheduleTimer(callback: () => void, ms: number): number;
    clearTimer(timerId: number): void;
    warn(message: string, error: unknown): void;
    log?(level: "info" | "warn" | "error", area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
}

export class FolderRenameError extends Error {
    constructor(
        message: string,
        public readonly errors: unknown[],
    ) {
        super(message);
        this.name = "FolderRenameError";
    }
}

export class PluginLifecycleController {
    private readonly editorUpdateTimers: Record<string, number> = {};
    private readonly folderRenameRetries = new Map<string, FolderRenameRetryState>();

    constructor(private readonly host: PluginLifecycleHost) {}

    private isActive(context: PluginEventExecutionContext): boolean {
        return !context.signal.aborted && context.isActive();
    }

    private getFolderRenameKey(previousFolderPath: string, nextFolderPath: string): string {
        return `${previousFolderPath}\u0000${nextFolderPath}`;
    }

    private getFolderChildren(file: TAbstractFile): TAbstractFile[] {
        const children = (file as { children?: unknown }).children;
        return Array.isArray(children)
            ? children.filter((child): child is TAbstractFile => !!child && typeof (child as TAbstractFile).path === "string")
            : [];
    }

    private isFolder(file: TAbstractFile): boolean {
        return !("extension" in file);
    }

    private isFile(file: TAbstractFile): file is TFile {
        return "extension" in file;
    }

    private collectPageNoteCapableFiles(file: TAbstractFile): TFile[] {
        if (this.isFile(file) && this.host.isPageNoteCapableFile(file)) {
            return [file];
        }

        return this.getFolderChildren(file)
            .flatMap((child) => this.collectPageNoteCapableFiles(child));
    }

    private collectFiles(file: TAbstractFile): TFile[] {
        if (this.isFile(file)) {
            return [file];
        }

        return this.getFolderChildren(file)
            .flatMap((child) => this.collectFiles(child));
    }

    private async clearDeletedCommentFile(
        filePath: string,
        context: PluginEventExecutionContext,
    ): Promise<void> {
        if (!this.isActive(context)) {
            return;
        }
        await this.host.deleteStoredComments(filePath);
        if (!this.isActive(context)) {
            return;
        }
        this.clearDeletedCommentFileCache(filePath);
    }

    private clearDeletedCommentFileCache(filePath: string): void {
        this.host.getCommentManager().replaceCommentsForFile(filePath, []);
        this.host.clearParsedNoteCache(filePath);
        this.host.getAggregateCommentIndex().deleteFile(filePath);
        this.host.clearDerivedCommentLinksForFile(filePath);
    }

    private async refreshAfterCommentDelete(context: PluginEventExecutionContext): Promise<void> {
        if (!this.isActive(context)) {
            return;
        }
        this.host.refreshEditorDecorations();
        if (!this.isActive(context)) {
            return;
        }
        await Promise.all([
            Promise.resolve().then(() => this.host.refreshCommentViews()),
            Promise.resolve().then(() => this.host.refreshAggregateNoteNow()),
        ]);
    }

    public async handleLayoutReady(
        context: PluginEventExecutionContext = ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    ): Promise<void> {
        if (!this.isActive(context)) {
            return;
        }
        this.host.syncIndexNoteViewClasses();
        if (!this.isActive(context)) {
            return;
        }
        await this.host.log?.("info", "startup", "startup.layout.ready");
    }

    public async handleFileCreate(
        file: TFile | null,
        context: PluginEventExecutionContext = ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    ): Promise<void> {
        if (!file || !this.isActive(context)) {
            return;
        }

        await this.host.refreshCommentViews({ skipDataRefresh: true });
    }

    public async handleMetadataResolved(
        context: PluginEventExecutionContext = ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    ): Promise<void> {
        if (!this.isActive(context)) {
            return;
        }
        await this.host.refreshCommentViews({ skipDataRefresh: true });
    }

    private async applyFileRename(
        file: TFile,
        oldPath: string,
        context: PluginEventExecutionContext,
    ): Promise<boolean> {
        if (!this.isActive(context)) {
            return false;
        }
        await this.host.renamePublishedPublicArtifactPath(oldPath, file.path);
        if (!this.isActive(context)) {
            return false;
        }
        if (!this.host.isPageNoteCapableFile(file)) {
            return false;
        }

        await this.host.renameAgentRuns(oldPath, file.path);
        if (!this.isActive(context)) {
            return false;
        }
        await this.host.renameScriptRuns(oldPath, file.path);
        if (!this.isActive(context)) {
            return false;
        }
        const pageLabelHash = await this.host.hashText(getPageCommentLabel(file.path));
        if (!this.isActive(context)) {
            return false;
        }
        const retargetOptions = {
            selectionCapable: this.host.isCommentableFile(file),
            pageLabelHash,
        };
        await this.host.renameStoredComments(oldPath, file.path, retargetOptions);
        if (!this.isActive(context)) {
            return false;
        }
        this.host.clearParsedNoteCache(oldPath);
        if (!this.isActive(context)) {
            return false;
        }
        this.host.clearParsedNoteCache(file.path);
        if (!this.isActive(context)) {
            return false;
        }
        this.host.getAggregateCommentIndex().renameFile(oldPath, file.path, retargetOptions);
        if (!this.isActive(context)) {
            return false;
        }
        this.host.clearDerivedCommentLinksForFile(oldPath);
        if (!this.isActive(context)) {
            return false;
        }
        const liveFile = this.host.app.vault.getAbstractFileByPath(file.path);
        if (liveFile && this.isFile(liveFile)) {
            await this.host.loadCommentsForFile(liveFile);
            if (!this.isActive(context)) {
                return false;
            }
        }
        return true;
    }

    private async refreshAfterFileRename(context: PluginEventExecutionContext): Promise<void> {
        if (!this.isActive(context)) {
            return;
        }
        this.host.refreshEditorDecorations();
        if (!this.isActive(context)) {
            return;
        }
        this.host.scheduleAggregateNoteRefresh();
        if (!this.isActive(context)) {
            return;
        }
        await this.host.refreshCommentViews();
    }

    public async handleFileRename(
        file: TAbstractFile | null,
        oldPath: string,
        context: PluginEventExecutionContext = ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    ): Promise<void> {
        if (!file || !this.isActive(context)) {
            return;
        }

        if (this.isFile(file)) {
            if (await this.applyFileRename(file, oldPath, context) && this.isActive(context)) {
                await this.refreshAfterFileRename(context);
            }
            return;
        }

        const retryKey = this.getFolderRenameKey(oldPath, file.path);
        let plan = this.folderRenameRetries.get(retryKey);
        if (!plan) {
            const renamedPageNoteFiles = this.collectFiles(file)
                .map((renamedFile) => ({
                    renamedFile,
                    previousFilePath: retargetPathInFolder(renamedFile.path, file.path, oldPath),
                }))
                .filter((entry): entry is { renamedFile: TFile; previousFilePath: string } =>
                    entry.previousFilePath !== null
                    && this.host.isPageNoteCapableFile(entry.renamedFile));
            const commentRetargets: CommentFileRetarget[] = await Promise.all(
                renamedPageNoteFiles.map(async ({ renamedFile, previousFilePath }) => ({
                    previousFilePath,
                    nextFilePath: renamedFile.path,
                    retargetOptions: {
                        selectionCapable: this.host.isCommentableFile(renamedFile),
                        pageLabelHash: await this.host.hashText(getPageCommentLabel(renamedFile.path)),
                    },
                })),
            );
            if (!this.isActive(context)) {
                return;
            }
            plan = {
                pendingPublishedPaths: true,
                pendingAgentRuns: true,
                pendingScriptRuns: true,
                pendingCommentPersistence: commentRetargets,
                pendingLocalCache: [],
                pendingAggregateIndex: [],
                pendingRefresh: false,
            };
        }

        const attemptedCommentRetargets = plan.pendingCommentPersistence;
        const [publishedResult, agentResult, scriptResult, commentsResult] = await Promise.allSettled([
            plan.pendingPublishedPaths
                ? this.host.renamePublishedPublicArtifactPathsInFolder(oldPath, file.path)
                : Promise.resolve(),
            plan.pendingAgentRuns
                ? this.host.renameAgentRunsInFolder(oldPath, file.path)
                : Promise.resolve(false),
            plan.pendingScriptRuns
                ? this.host.renameScriptRunsInFolder(oldPath, file.path)
                : Promise.resolve(false),
            attemptedCommentRetargets.length > 0
                ? this.host.renameStoredCommentsInFolder(attemptedCommentRetargets)
                : Promise.resolve({ successfulRetargets: [], failures: [] }),
        ]);
        if (!this.isActive(context)) {
            return;
        }
        const successfulCommentRetargets = commentsResult.status === "fulfilled"
            ? commentsResult.value.successfulRetargets
            : [];
        const failures: Array<{ path: string; error: unknown }> = [];
        const nextPlan: FolderRenameRetryState = {
            pendingPublishedPaths: plan.pendingPublishedPaths && publishedResult.status === "rejected",
            pendingAgentRuns: plan.pendingAgentRuns && agentResult.status === "rejected",
            pendingScriptRuns: plan.pendingScriptRuns && scriptResult.status === "rejected",
            pendingCommentPersistence: [],
            pendingLocalCache: [],
            pendingAggregateIndex: [],
            pendingRefresh: false,
        };
        for (const [domain, wasPending, result] of [
            ["published paths", plan.pendingPublishedPaths, publishedResult],
            ["agent runs", plan.pendingAgentRuns, agentResult],
            ["script runs", plan.pendingScriptRuns, scriptResult],
        ] as const) {
            if (wasPending && result.status === "rejected") {
                failures.push({ path: domain, error: result.reason });
            }
        }
        if (commentsResult.status === "rejected") {
            failures.push({ path: "stored comments", error: commentsResult.reason });
            nextPlan.pendingCommentPersistence = [...attemptedCommentRetargets];
        } else {
            nextPlan.pendingCommentPersistence = commentsResult.value.failures.map((failure) => failure.retarget);
            failures.push(...commentsResult.value.failures.map((failure) => ({
                path: failure.retarget.previousFilePath,
                error: failure.error,
            })));
        }

        const localCacheRetargets = Array.from(new Map(
            [...plan.pendingLocalCache, ...successfulCommentRetargets]
                .map((retarget) => [`${retarget.previousFilePath}\u0000${retarget.nextFilePath}`, retarget]),
        ).values());
        for (const retarget of localCacheRetargets) {
            try {
                if (!this.isActive(context)) {
                    return;
                }
                this.host.clearParsedNoteCache(retarget.previousFilePath);
                if (!this.isActive(context)) {
                    return;
                }
                this.host.clearParsedNoteCache(retarget.nextFilePath);
                if (!this.isActive(context)) {
                    return;
                }
                this.host.clearDerivedCommentLinksForFile(retarget.previousFilePath);
            } catch (error) {
                failures.push({ path: retarget.previousFilePath, error });
                nextPlan.pendingLocalCache.push(retarget);
            }
        }

        const aggregateIndexRetargets = Array.from(new Map(
            [...plan.pendingAggregateIndex, ...successfulCommentRetargets]
                .map((retarget) => [`${retarget.previousFilePath}\u0000${retarget.nextFilePath}`, retarget]),
        ).values());
        if (aggregateIndexRetargets.length > 0) {
            try {
                if (!this.isActive(context)) {
                    return;
                }
                this.host.getAggregateCommentIndex().renameFiles(aggregateIndexRetargets);
            } catch (error) {
                failures.push({ path: "aggregate comment index", error });
                nextPlan.pendingAggregateIndex = aggregateIndexRetargets;
            }
        }

        const shouldRefresh = plan.pendingRefresh
            || localCacheRetargets.length > 0
            || aggregateIndexRetargets.length > 0
            || (attemptedCommentRetargets.length > 0 && successfulCommentRetargets.length === 0);
        if (shouldRefresh) {
            try {
                await this.refreshAfterFileRename(context);
                if (!this.isActive(context)) {
                    return;
                }
            } catch (error) {
                failures.push({ path: "comment views", error });
                nextPlan.pendingRefresh = true;
            }
        }
        if (failures.length > 0) {
            if (!this.isActive(context)) {
                return;
            }
            this.folderRenameRetries.set(retryKey, nextPlan);
            throw new FolderRenameError(
                `Folder rename left ${failures.length} repairable retarget failure(s): ${failures
                    .map((failure) => failure.path)
                    .join(", ")}`,
                failures.map((failure) => failure.error),
            );
        }
        if (!this.isActive(context)) {
            return;
        }
        this.folderRenameRetries.delete(retryKey);
    }

    public async handleFileDelete(
        file: TAbstractFile | null,
        context: PluginEventExecutionContext = ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    ): Promise<void> {
        if (!file || !this.isActive(context)) {
            return;
        }

        if (this.isFile(file)) {
            await this.host.deletePublishedPublicArtifactPath(file.path);
            if (!this.isActive(context)) {
                return;
            }

            if (!this.host.isPageNoteCapableFile(file)) {
                return;
            }

            await this.clearDeletedCommentFile(file.path, context);
            if (!this.isActive(context)) {
                return;
            }
            await this.refreshAfterCommentDelete(context);
            return;
        }

        await this.host.deletePublishedPublicArtifactPathsInFolder(file.path);
        if (!this.isActive(context)) {
            return;
        }

        const deletedFiles = this.collectPageNoteCapableFiles(file);
        await this.host.deleteStoredCommentsInFolder(file.path);
        if (!this.isActive(context)) {
            return;
        }
        for (const deletedFile of deletedFiles) {
            if (!this.isActive(context)) {
                return;
            }
            this.clearDeletedCommentFileCache(deletedFile.path);
        }

        if (!this.isActive(context)) {
            return;
        }
        this.host.getCommentManager().deleteFolder(file.path);
        if (!this.isActive(context)) {
            return;
        }
        this.host.getAggregateCommentIndex().deleteFolder(file.path);
        if (!this.isActive(context)) {
            return;
        }
        await this.refreshAfterCommentDelete(context);
    }

    public async handleFileModify(
        file: TFile | null,
        context: PluginEventExecutionContext = ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    ): Promise<void> {
        if (!(file && file.extension === "md") || !this.isActive(context)) {
            return;
        }

        await this.host.handleMarkdownFileModified(file);
    }

    public handleEditorChange(filePath: string | null | undefined): void {
        if (!filePath) {
            return;
        }

        const existingTimer = this.editorUpdateTimers[filePath];
        if (existingTimer !== undefined) {
            this.host.clearTimer(existingTimer);
        }

        this.editorUpdateTimers[filePath] = this.host.scheduleTimer(() => {
            delete this.editorUpdateTimers[filePath];
            try {
                this.host.refreshEditorDecorations();
            } catch (error) {
                this.host.warn("Failed to refresh decorations on editor-change", error);
            }
        }, 250);
    }

    public clearPendingEditorRefreshes(): void {
        for (const timerId of Object.values(this.editorUpdateTimers)) {
            this.host.clearTimer(timerId);
        }

        for (const filePath of Object.keys(this.editorUpdateTimers)) {
            delete this.editorUpdateTimers[filePath];
        }
    }

    public handleUnload(): void {
        this.folderRenameRetries.clear();
        this.clearPendingEditorRefreshes();
        this.host.detachSidebarViews();
    }
}
