import type { Plugin, TAbstractFile, TFile } from "obsidian";
import type { CommentManager } from "../commentManager";
import type { AggregateCommentIndex } from "../index/AggregateCommentIndex";

export interface PluginLifecycleHost {
    app: Plugin["app"];
    ensureSidebarView(): Promise<void>;
    getCommentManager(): CommentManager;
    getAggregateCommentIndex(): AggregateCommentIndex;
    renameStoredComments(previousFilePath: string, nextFilePath: string): Promise<void>;
    deleteStoredComments(filePath: string): Promise<void>;
    clearParsedNoteCache(filePath: string): void;
    clearDerivedCommentLinksForFile(filePath: string): void;
    isCommentableFile(file: TAbstractFile | null): file is TFile;
    loadCommentsForFile(file: TFile | null): Promise<unknown>;
    refreshCommentViews(): Promise<void>;
    refreshEditorDecorations(): void;
    refreshAggregateNoteNow(): Promise<void>;
    scheduleAggregateNoteRefresh(): void;
    syncIndexNoteViewClasses(): void;
    handleMarkdownFileModified(file: TFile): Promise<void>;
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

    private collectCommentableFiles(file: TAbstractFile): TFile[] {
        if (this.isFile(file) && this.host.isCommentableFile(file)) {
            return [file];
        }

        return this.getFolderChildren(file)
            .flatMap((child) => this.collectCommentableFiles(child));
    }

    private async clearDeletedCommentFile(filePath: string): Promise<void> {
        await this.host.deleteStoredComments(filePath);
        this.host.getCommentManager().replaceCommentsForFile(filePath, []);
        this.host.clearParsedNoteCache(filePath);
        this.host.getAggregateCommentIndex().deleteFile(filePath);
        this.host.clearDerivedCommentLinksForFile(filePath);
    }

    private refreshAfterCommentDelete(): void {
        void this.host.refreshCommentViews();
        this.host.refreshEditorDecorations();
        void this.host.refreshAggregateNoteNow();
    }

    public async handleLayoutReady(): Promise<void> {
        await this.host.ensureSidebarView();
        void this.host.log?.("info", "startup", "startup.sidebar.ready");
        await this.host.refreshCommentViews();
        this.host.refreshEditorDecorations();
        this.host.syncIndexNoteViewClasses();
        void this.host.log?.("info", "startup", "startup.layout.ready");
    }

    public async handleFileRename(file: TFile | null, oldPath: string): Promise<void> {
        if (!file) {
            return;
        }

        await this.host.renameStoredComments(oldPath, file.path);
        this.host.getCommentManager().renameFile(oldPath, file.path);
        this.host.clearParsedNoteCache(oldPath);
        this.host.clearParsedNoteCache(file.path);
        this.host.getAggregateCommentIndex().renameFile(oldPath, file.path);
        this.host.clearDerivedCommentLinksForFile(oldPath);
        void this.host.loadCommentsForFile(file);
        void this.host.refreshCommentViews();
        this.host.refreshEditorDecorations();
        this.host.scheduleAggregateNoteRefresh();
    }

    public async handleFileDelete(file: TAbstractFile | null): Promise<void> {
        if (!file) {
            return;
        }

        if (this.isFile(file)) {
            if (!this.host.isCommentableFile(file)) {
                return;
            }

            await this.clearDeletedCommentFile(file.path);
            this.refreshAfterCommentDelete();
            return;
        }

        const deletedFiles = this.collectCommentableFiles(file);
        for (const deletedFile of deletedFiles) {
            await this.clearDeletedCommentFile(deletedFile.path);
        }

        this.host.getCommentManager().deleteFolder(file.path);
        this.host.getAggregateCommentIndex().deleteFolder(file.path);
        this.refreshAfterCommentDelete();
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
}
