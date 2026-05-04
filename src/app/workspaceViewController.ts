import type { EditorView } from "@codemirror/view";
import type { MarkdownView, Plugin, TFile } from "obsidian";

interface FileViewLike {
    file: TFile | null | undefined;
}

interface EditorLike {
    getValue(): string;
    getCursor?(which?: string): unknown;
    setSelection?(from: unknown, to: unknown): void;
    cm?: {
        hasFocus?: boolean;
    } | null;
}

interface MarkdownViewLike extends FileViewLike {
    editor: EditorLike;
    contentEl: {
        contains(node: unknown): boolean;
    };
    getMode(): string;
    getViewData?(): string;
    previewMode?: {
        rerender(force: boolean): void;
    };
}

interface SidebarViewLike {
    getViewType(): string;
    renderComments(options?: { skipDataRefresh?: boolean }): Promise<void>;
    file?: TFile | null | undefined;
}

export interface WorkspaceViewHost {
    app: Plugin["app"];
    isSidebarSupportedFile(file: TFile | null): file is TFile;
    isAllCommentsNotePath(filePath: string): boolean;
    ensureIndexedCommentsLoaded(): Promise<void>;
    hasPendingAggregateRefresh(): boolean;
    refreshAggregateNoteNow(): Promise<void>;
    loadCommentsForFile(file: TFile | null): Promise<unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object";
}

function isTFileLike(value: unknown): value is TFile {
    return isObject(value)
        && typeof value.path === "string"
        && typeof value.basename === "string"
        && typeof value.extension === "string";
}

function isFileViewLike(view: unknown): view is FileViewLike {
    return isObject(view) && "file" in view;
}

function isEditorLike(value: unknown): value is EditorLike {
    return isObject(value) && typeof value.getValue === "function";
}

function hasContainment(value: unknown): value is { contains(node: unknown): boolean } {
    return isObject(value) && typeof value.contains === "function";
}

function isMarkdownViewLike(view: unknown): view is MarkdownViewLike {
    if (!isObject(view)) {
        return false;
    }

    const candidate = view as Partial<MarkdownViewLike>;
    return "file" in candidate
        && isEditorLike(candidate.editor)
        && hasContainment(candidate.contentEl)
        && typeof candidate.getMode === "function";
}

function isSidebarViewLike(view: unknown): view is SidebarViewLike {
    if (!isObject(view)) {
        return false;
    }

    const candidate = view as Partial<SidebarViewLike>;
    return typeof candidate.getViewType === "function"
        && candidate.getViewType() === "sidenote2-view"
        && typeof candidate.renderComments === "function";
}

export class WorkspaceViewController {
    constructor(private readonly host: WorkspaceViewHost) {}

    public getFileByPath(filePath: string): TFile | null {
        const file = this.host.app.vault.getAbstractFileByPath(filePath);
        return isTFileLike(file) ? file : null;
    }

    public getMarkdownFileByPath(filePath: string): TFile | null {
        const file = this.getFileByPath(filePath);
        return file?.extension === "md" ? file : null;
    }

    public getMarkdownViewForFile(file: TFile): MarkdownView | null {
        const recentLeaf = this.host.app.workspace.getMostRecentLeaf?.() ?? null;
        const recentView = recentLeaf?.view;
        if (isMarkdownViewLike(recentView) && recentView.file?.path === file.path) {
            return recentView as MarkdownView;
        }

        let matchedView: MarkdownView | null = null;
        this.host.app.workspace.iterateAllLeaves((leaf) => {
            if (matchedView) {
                return;
            }

            if (isMarkdownViewLike(leaf.view) && leaf.view.file?.path === file.path) {
                matchedView = leaf.view as MarkdownView;
            }
        });

        return matchedView;
    }

    public getMarkdownViewForEditorView(editorView: EditorView): MarkdownView | null {
        let matchedView: MarkdownView | null = null;
        this.host.app.workspace.iterateAllLeaves((leaf) => {
            if (matchedView || !isMarkdownViewLike(leaf.view)) {
                return;
            }

            const cm = leaf.view.editor.cm;
            if (cm === editorView || leaf.view.contentEl.contains(editorView.dom)) {
                matchedView = leaf.view as MarkdownView;
            }
        });

        return matchedView;
    }

    public isMarkdownEditorFocused(file: TFile): boolean {
        const openView = this.getMarkdownViewForFile(file);
        if (!openView || !isMarkdownViewLike(openView)) {
            return false;
        }

        const openViewLike = openView as unknown as MarkdownViewLike;
        if (openViewLike.editor.cm?.hasFocus === true) {
            return true;
        }

        const activeElement = typeof document === "undefined" ? null : document.activeElement;
        return !!activeElement && openViewLike.contentEl.contains(activeElement);
    }

    public async getCurrentNoteContent(file: TFile): Promise<string> {
        const openView = this.getMarkdownViewForFile(file);
        if (openView && isMarkdownViewLike(openView)) {
            const openViewLike = openView as unknown as MarkdownViewLike;
            if (openViewLike.getMode() === "preview") {
                if (typeof openViewLike.getViewData === "function") {
                    return openViewLike.getViewData();
                }

                return this.host.app.vault.cachedRead(file);
            }

            return openViewLike.editor.getValue();
        }

        return this.host.app.vault.cachedRead(file);
    }

    public async getStoredNoteContent(file: TFile): Promise<string> {
        return this.host.app.vault.cachedRead(file);
    }

    public async loadVisibleFiles(): Promise<void> {
        const visibleFiles = this.getOpenSidebarFiles();
        for (const file of visibleFiles) {
            await this.syncSidebarFile(file);
        }

        const activeFile = this.host.app.workspace.getActiveFile();
        if (this.host.isSidebarSupportedFile(activeFile)) {
            await this.syncSidebarFile(activeFile);
        }
    }

    public async syncSidebarFile(file: TFile | null): Promise<void> {
        if (!file) {
            return;
        }

        if (this.host.isAllCommentsNotePath(file.path)) {
            await this.host.ensureIndexedCommentsLoaded();
            if (this.host.hasPendingAggregateRefresh()) {
                await this.host.refreshAggregateNoteNow();
            }
            return;
        }

        await this.host.loadCommentsForFile(file);
    }

    public async refreshCommentViews(options: { skipDataRefresh?: boolean } = {}): Promise<void> {
        await this.refreshSidebarViews(() => true, options);
    }

    public async refreshAllCommentsSidebarViews(options: { skipDataRefresh?: boolean } = {}): Promise<void> {
        await this.refreshSidebarViews(
            (view) => this.host.isAllCommentsNotePath(view.file?.path ?? ""),
            options,
        );
    }

    private async refreshSidebarViews(
        predicate: (view: SidebarViewLike) => boolean,
        options: { skipDataRefresh?: boolean } = {},
    ): Promise<void> {
        const leaves = this.host.app.workspace.getLeavesOfType("sidenote2-view");
        for (const leaf of leaves) {
            if (isSidebarViewLike(leaf.view) && predicate(leaf.view)) {
                await leaf.view.renderComments(options);
            }
        }
    }

    public refreshMarkdownPreviews(): void {
        this.host.app.workspace.iterateAllLeaves((leaf) => {
            if (!isMarkdownViewLike(leaf.view) || leaf.view.getMode() !== "preview") {
                return;
            }

            leaf.view.previewMode?.rerender(true);
        });
    }

    public clearMarkdownSelection(filePath: string): boolean {
        const file = this.getMarkdownFileByPath(filePath);
        if (!file) {
            return false;
        }

        const markdownView = this.getMarkdownViewForFile(file);
        if (!markdownView || !isMarkdownViewLike(markdownView)) {
            return false;
        }

        if (typeof markdownView.editor.getCursor !== "function" || typeof markdownView.editor.setSelection !== "function") {
            return false;
        }

        const cursor = markdownView.editor.getCursor("to");
        markdownView.editor.setSelection(cursor, cursor);
        return true;
    }

    private getOpenSidebarFiles(): TFile[] {
        const files = new Map<string, TFile>();
        this.host.app.workspace.iterateAllLeaves((leaf) => {
            if (!isFileViewLike(leaf.view)) {
                return;
            }

            const file = leaf.view.file ?? null;
            if (!this.host.isSidebarSupportedFile(file)) {
                return;
            }

            files.set(file.path, file);
        });

        return Array.from(files.values());
    }
}
