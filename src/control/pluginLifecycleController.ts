import type { Plugin, TFile } from "obsidian";
import type { CommentManager } from "../commentManager";
import type { AggregateCommentIndex } from "../index/AggregateCommentIndex";

export interface PluginLifecycleHost {
    app: Plugin["app"];
    ensureSidebarView(): Promise<void>;
    getCommentManager(): CommentManager;
    getAggregateCommentIndex(): AggregateCommentIndex;
    clearParsedNoteCache(filePath: string): void;
    clearDerivedCommentLinksForFile(filePath: string): void;
    isCommentableFile(file: TFile | null): file is TFile;
    isAttachmentCommentableFile(file: TFile | null): file is TFile;
    isAttachmentCommentablePath(filePath: string): boolean;
    saveSettings(): Promise<void>;
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
}

export class PluginLifecycleController {
    private readonly editorUpdateTimers: Record<string, number> = {};

    constructor(private readonly host: PluginLifecycleHost) {}

    public async handleLayoutReady(): Promise<void> {
        await this.host.ensureSidebarView();
        await this.host.refreshCommentViews();
        this.host.refreshEditorDecorations();
        this.host.scheduleAggregateNoteRefresh();
        this.host.syncIndexNoteViewClasses();
    }

    public handleFileRename(file: TFile | null, oldPath: string): void {
        if (!file) {
            return;
        }

        this.host.getCommentManager().renameFile(oldPath, file.path);
        this.host.clearParsedNoteCache(oldPath);
        this.host.clearParsedNoteCache(file.path);
        this.host.getAggregateCommentIndex().renameFile(oldPath, file.path);
        this.host.clearDerivedCommentLinksForFile(oldPath);
        if (this.host.isAttachmentCommentablePath(oldPath) || this.host.isAttachmentCommentableFile(file)) {
            void this.host.saveSettings();
        }
        void this.host.loadCommentsForFile(file);
        void this.host.refreshCommentViews();
        this.host.refreshEditorDecorations();
        this.host.scheduleAggregateNoteRefresh();
    }

    public handleFileDelete(file: TFile | null): void {
        if (!this.host.isCommentableFile(file)) {
            return;
        }

        this.host.getCommentManager().replaceCommentsForFile(file.path, []);
        this.host.clearParsedNoteCache(file.path);
        this.host.getAggregateCommentIndex().deleteFile(file.path);
        this.host.clearDerivedCommentLinksForFile(file.path);
        if (this.host.isAttachmentCommentableFile(file)) {
            void this.host.saveSettings();
        }
        void this.host.refreshCommentViews();
        this.host.refreshEditorDecorations();
        void this.host.refreshAggregateNoteNow();
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
