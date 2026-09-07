import type { Plugin, TAbstractFile, TFile } from "obsidian";
import type { CommentManager } from "../commentManager";
import type { AggregateCommentIndex } from "../index/AggregateCommentIndex";
import { getPageCommentLabel } from "../core/anchors/commentAnchors";
import type { CommentThreadRetargetOptions } from "../domain/comments/commentThreadRetarget";

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
    deleteStoredComments(filePath: string): Promise<void>;
    deleteStoredCommentsInFolder(folderPath: string): Promise<void>;
    renamePublishedPublicArtifactPath(previousFilePath: string, nextFilePath: string): Promise<void>;
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

export class PluginLifecycleController {
    private readonly editorUpdateTimers: Record<string, number> = {};

    constructor(private readonly host: PluginLifecycleHost) {}

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

    private async clearDeletedCommentFile(filePath: string): Promise<void> {
        await this.host.deleteStoredComments(filePath);
        this.clearDeletedCommentFileCache(filePath);
    }

    private clearDeletedCommentFileCache(filePath: string): void {
        this.host.getCommentManager().replaceCommentsForFile(filePath, []);
        this.host.clearParsedNoteCache(filePath);
        this.host.getAggregateCommentIndex().deleteFile(filePath);
        this.host.clearDerivedCommentLinksForFile(filePath);
    }

    private async refreshAfterCommentDelete(): Promise<void> {
        this.host.refreshEditorDecorations();
        await Promise.all([
            Promise.resolve().then(() => this.host.refreshCommentViews()),
            Promise.resolve().then(() => this.host.refreshAggregateNoteNow()),
        ]);
    }

    public async handleLayoutReady(): Promise<void> {
        this.host.syncIndexNoteViewClasses();
        await this.host.log?.("info", "startup", "startup.layout.ready");
    }

    public async handleFileCreate(file: TFile | null): Promise<void> {
        if (!file) {
            return;
        }

        await this.host.refreshCommentViews({ skipDataRefresh: true });
    }

    public async handleMetadataResolved(): Promise<void> {
        await this.host.refreshCommentViews({ skipDataRefresh: true });
    }

    private async applyFileRename(file: TFile, oldPath: string): Promise<boolean> {
        await this.host.renamePublishedPublicArtifactPath(oldPath, file.path);
        if (!this.host.isPageNoteCapableFile(file)) {
            return false;
        }

        await this.host.renameAgentRuns(oldPath, file.path);
        await this.host.renameScriptRuns(oldPath, file.path);
        const retargetOptions = {
            selectionCapable: this.host.isCommentableFile(file),
            pageLabelHash: await this.host.hashText(getPageCommentLabel(file.path)),
        };
        await this.host.renameStoredComments(oldPath, file.path, retargetOptions);
        this.host.clearParsedNoteCache(oldPath);
        this.host.clearParsedNoteCache(file.path);
        this.host.getAggregateCommentIndex().renameFile(oldPath, file.path, retargetOptions);
        this.host.clearDerivedCommentLinksForFile(oldPath);
        const liveFile = this.host.app.vault.getAbstractFileByPath(file.path);
        if (liveFile && this.isFile(liveFile)) {
            await this.host.loadCommentsForFile(liveFile);
        }
        return true;
    }

    private async refreshAfterFileRename(): Promise<void> {
        this.host.refreshEditorDecorations();
        this.host.scheduleAggregateNoteRefresh();
        await this.host.refreshCommentViews();
    }

    public async handleFileRename(file: TAbstractFile | null, oldPath: string): Promise<void> {
        if (!file) {
            return;
        }

        if (this.isFile(file)) {
            if (await this.applyFileRename(file, oldPath)) {
                await this.refreshAfterFileRename();
            }
            return;
        }

        const nextFolderPrefix = `${file.path}/`;
        let renamedPageNote = false;
        for (const renamedFile of this.collectFiles(file)) {
            const relativePath = renamedFile.path.startsWith(nextFolderPrefix)
                ? renamedFile.path.slice(nextFolderPrefix.length)
                : renamedFile.path;
            const previousFilePath = oldPath ? `${oldPath}/${relativePath}` : relativePath;
            renamedPageNote = await this.applyFileRename(renamedFile, previousFilePath)
                || renamedPageNote;
        }
        if (renamedPageNote) {
            await this.refreshAfterFileRename();
        }
    }

    public async handleFileDelete(file: TAbstractFile | null): Promise<void> {
        if (!file) {
            return;
        }

        if (this.isFile(file)) {
            await this.host.deletePublishedPublicArtifactPath(file.path);

            if (!this.host.isPageNoteCapableFile(file)) {
                return;
            }

            await this.clearDeletedCommentFile(file.path);
            await this.refreshAfterCommentDelete();
            return;
        }

        await this.host.deletePublishedPublicArtifactPathsInFolder(file.path);

        const deletedFiles = this.collectPageNoteCapableFiles(file);
        await this.host.deleteStoredCommentsInFolder(file.path);
        for (const deletedFile of deletedFiles) {
            this.clearDeletedCommentFileCache(deletedFile.path);
        }

        this.host.getCommentManager().deleteFolder(file.path);
        this.host.getAggregateCommentIndex().deleteFolder(file.path);
        await this.refreshAfterCommentDelete();
    }

    public async handleFileModify(file: TFile | null): Promise<void> {
        if (!(file && file.extension === "md")) {
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
        this.clearPendingEditorRefreshes();
        this.host.detachSidebarViews();
    }
}
