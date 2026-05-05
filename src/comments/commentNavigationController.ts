import { FileView, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import type { Plugin } from "obsidian";
import type { Comment } from "../commentManager";
import type { RevealedCommentStateUpdateOptions } from "./commentSessionController";
import type { DraftComment } from "../domain/drafts";
import { isPageComment } from "../core/anchors/commentAnchors";
import { resolveAnchorRange } from "../core/anchors/anchorResolver";
import { parseNoteComments } from "../core/storage/noteCommentStorage";
import {
    buildCommentRevealScrollTarget,
    pickExactFileLeafCandidate,
    pickPreferredFileLeafCandidate,
    resolveIndexSidebarScopeRootPath,
    shouldRevealSidebarLeaf,
    type PreferredFileLeafCandidate,
} from "./commentNavigationPlanner";
import { resolveIndexLeafMode } from "../app/workspaceContextPlanner";

interface SidebarViewLike {
    getViewType(): string;
    getCurrentFile(): TFile | null;
    updateActiveFile(file: TFile | null, options?: { skipDataRefresh?: boolean }): Promise<void>;
    highlightComment(commentId: string): void;
    highlightAndFocusDraft(commentId: string): Promise<void>;
    setIndexFileFilterRootPath?(filePath: string | null): Promise<void>;
}

function isSidebarViewLike(view: unknown): view is SidebarViewLike {
    return !!view
        && typeof (view as SidebarViewLike).getViewType === "function"
        && (view as SidebarViewLike).getViewType() === "sidenote2-view"
        && typeof (view as SidebarViewLike).getCurrentFile === "function"
        && typeof (view as SidebarViewLike).updateActiveFile === "function"
        && typeof (view as SidebarViewLike).highlightComment === "function"
        && typeof (view as SidebarViewLike).highlightAndFocusDraft === "function";
}

export interface CommentNavigationHost {
    app: Plugin["app"];
    getSidebarTargetFile(): TFile | null;
    getDraftComment(): DraftComment | null;
    getKnownCommentById(commentId: string): Comment | null;
    isAllCommentsNotePath(filePath: string): boolean;
    setRevealedCommentState(
        filePath: string,
        commentId: string,
        options?: RevealedCommentStateUpdateOptions,
    ): void;
    getFileByPath(path: string): TFile | null;
    loadCommentsForFile(file: TFile): Promise<unknown>;
    getLoadedCommentById(commentId: string): Comment | undefined;
    showNotice(message: string): void;
    log?(level: "info" | "warn" | "error", area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
}

export class CommentNavigationController {
    constructor(private readonly host: CommentNavigationHost) {}

    private resolveSidebarRevealFile(filePath: string | null): TFile | null {
        if (filePath) {
            const file = this.host.getFileByPath(filePath);
            if (file) {
                return file;
            }
        }

        return this.host.getSidebarTargetFile();
    }

    private async resolveCommentById(
        commentId: string,
        filePathHint?: string | null,
    ): Promise<Comment | null> {
        const knownComment = this.host.getKnownCommentById(commentId);
        if (knownComment) {
            return knownComment;
        }

        if (!filePathHint) {
            return null;
        }

        const file = this.host.getFileByPath(filePathHint);
        if (!file) {
            return null;
        }

        await this.host.loadCommentsForFile(file);
        return this.host.getLoadedCommentById(commentId) ?? null;
    }

    private async syncIndexSidebarScope(
        leaf: WorkspaceLeaf,
        sidebarFile: TFile | null,
        scopeRootFilePath: string | null,
    ): Promise<void> {
        const nextScopeRootFilePath = resolveIndexSidebarScopeRootPath(
            sidebarFile?.path ?? null,
            scopeRootFilePath,
            (filePath) => this.host.isAllCommentsNotePath(filePath),
        );
        if (
            !nextScopeRootFilePath
            || !isSidebarViewLike(leaf.view)
            || !leaf.view.setIndexFileFilterRootPath
        ) {
            return;
        }

        await leaf.view.setIndexFileFilterRootPath(nextScopeRootFilePath);
    }

    private async ensureMarkdownLeafReadyForReveal(leaf: WorkspaceLeaf): Promise<MarkdownView | null> {
        if (!(leaf.view instanceof MarkdownView)) {
            return null;
        }

        const viewState = leaf.getViewState();
        const targetViewState = resolveIndexLeafMode({
            isMarkdownLeaf: viewState.type === "markdown",
            isIndexLeaf: false,
            currentViewMode: leaf.view.getMode(),
            isSourceMode: typeof viewState.state?.source === "boolean" ? viewState.state.source : undefined,
        });

        if (targetViewState && viewState.type === "markdown") {
            await leaf.setViewState({
                ...viewState,
                state: {
                    ...(viewState.state ?? {}),
                    mode: targetViewState.mode,
                    source: targetViewState.sourceMode,
                },
            });
        }

        return leaf.view instanceof MarkdownView ? leaf.view : null;
    }

    private async activateSidebarView(options: {
        skipViewUpdate?: boolean;
        revealLeaf?: boolean;
        targetFile?: TFile | null;
    } = {}): Promise<void> {
        const { workspace } = this.host.app;
        const sidebarFile = options.targetFile ?? this.host.getSidebarTargetFile();
        const skipViewUpdate = options.skipViewUpdate === true;

        let leaf: WorkspaceLeaf | null = null;
        let createdLeaf = false;
        const leaves = workspace.getLeavesOfType("sidenote2-view");

        if (leaves.length > 0) {
            leaf = leaves[0];
            if (!isSidebarViewLike(leaf.view)) {
                createdLeaf = true;
                await leaf.setViewState({
                    type: "sidenote2-view",
                    state: { filePath: sidebarFile?.path ?? null },
                    active: true,
                });
            }
        } else {
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                leaf = rightLeaf;
                createdLeaf = true;
                await leaf.setViewState({
                    type: "sidenote2-view",
                    state: { filePath: sidebarFile?.path ?? null },
                    active: true,
                });
            }
        }

        if (!leaf) {
            return;
        }

        if (shouldRevealSidebarLeaf(options.revealLeaf, createdLeaf)) {
            await workspace.revealLeaf(leaf);
        }

        if (isSidebarViewLike(leaf.view)) {
            const shouldSkipLeafViewUpdate = skipViewUpdate
                && leaf.view.getCurrentFile()?.path === sidebarFile?.path;
            if (!shouldSkipLeafViewUpdate) {
                await leaf.view.updateActiveFile(sidebarFile);
            }
        }
    }

    private getKnownOrDraftComment(commentId: string): Comment | DraftComment | null {
        const draftComment = this.host.getDraftComment();
        if (draftComment?.id === commentId) {
            return draftComment;
        }

        return this.host.getKnownCommentById(commentId);
    }

    private async activateViewAndHighlightCommentForFile(
        commentId: string,
        revealedFilePath: string | null,
        options: {
            revealedCommentOptions?: RevealedCommentStateUpdateOptions;
            revealSidebar?: boolean;
        } = {},
    ): Promise<void> {
        const comment = this.getKnownOrDraftComment(commentId);
        const draftComment = this.host.getDraftComment();
        const isDraftTarget = draftComment?.id === commentId;
        if (comment && revealedFilePath && !isDraftTarget) {
            this.host.setRevealedCommentState(
                revealedFilePath,
                comment.id,
                options.revealedCommentOptions,
            );
        }

        const skipViewUpdate = this.host.getDraftComment() !== null;
        const scopeRootFilePath = comment?.filePath ?? revealedFilePath;
        const sidebarFile = this.resolveSidebarRevealFile(scopeRootFilePath);
        await this.activateSidebarView({
            skipViewUpdate,
            revealLeaf: options.revealSidebar,
            targetFile: sidebarFile,
        });

        const leaves = this.host.app.workspace.getLeavesOfType("sidenote2-view");
        for (const leaf of leaves) {
            if (isSidebarViewLike(leaf.view)) {
                await this.syncIndexSidebarScope(leaf, sidebarFile, scopeRootFilePath);
                void this.host.log?.("info", "sidebar", "sidebar.focus.requested", {
                    commentId,
                    filePath: scopeRootFilePath,
                });
                await leaf.view.highlightAndFocusDraft(commentId);
            }
        }
    }

    public async updateSidebarViews(file: TFile | null, options: { skipDataRefresh?: boolean } = {}): Promise<void> {
        const leaves = this.host.app.workspace.getLeavesOfType("sidenote2-view");
        for (const leaf of leaves) {
            if (isSidebarViewLike(leaf.view)) {
                await leaf.view.updateActiveFile(file, options);
            }
        }
    }

    public async syncIndexFileFilter(indexFile: TFile | null, sourceFilePath: string): Promise<void> {
        const leaves = this.host.app.workspace.getLeavesOfType("sidenote2-view");
        for (const leaf of leaves) {
            if (isSidebarViewLike(leaf.view)) {
                await leaf.view.updateActiveFile(indexFile, { skipDataRefresh: true });
                if (leaf.view.setIndexFileFilterRootPath) {
                    await leaf.view.setIndexFileFilterRootPath(sourceFilePath);
                }
            }
        }
    }

    public async activateView(skipViewUpdate = false): Promise<void> {
        await this.activateSidebarView({ skipViewUpdate });
    }

    public async revealSidebarView(skipViewUpdate = false): Promise<void> {
        await this.activateSidebarView({
            skipViewUpdate,
            revealLeaf: true,
        });
    }

    public async ensureSidebarView(skipViewUpdate = false): Promise<void> {
        await this.activateSidebarView({
            skipViewUpdate,
            revealLeaf: false,
        });
    }

    public async activateViewAndHighlightComment(commentId: string): Promise<void> {
        const comment = this.getKnownOrDraftComment(commentId);
        await this.activateViewAndHighlightCommentForFile(commentId, comment?.filePath ?? null);
    }

    public async syncSidebarSelection(
        commentId: string,
        file: TFile | null,
        options: {
            indexScopeRootFilePath?: string | null;
        } = {},
    ): Promise<void> {
        const leaves = this.host.app.workspace.getLeavesOfType("sidenote2-view");
        for (const leaf of leaves) {
            if (isSidebarViewLike(leaf.view)) {
                await leaf.view.updateActiveFile(file);
                if (options.indexScopeRootFilePath !== undefined && leaf.view.setIndexFileFilterRootPath) {
                    await leaf.view.setIndexFileFilterRootPath(options.indexScopeRootFilePath);
                }
                leaf.view.highlightComment(commentId);
            }
        }
    }

    public async syncSidebarIndexScope(
        file: TFile | null,
        sourceFilePath: string,
    ): Promise<void> {
        const leaves = this.host.app.workspace.getLeavesOfType("sidenote2-view");
        for (const leaf of leaves) {
            if (isSidebarViewLike(leaf.view)) {
                await leaf.view.updateActiveFile(file);
                if (leaf.view.setIndexFileFilterRootPath) {
                    await leaf.view.setIndexFileFilterRootPath(sourceFilePath);
                }
            }
        }
    }

    public getPreferredFileLeaf(filePath?: string): WorkspaceLeaf | null {
        return pickPreferredFileLeafCandidate(this.getFileLeafCandidates(), filePath);
    }

    public getOpenFileLeaf(filePath: string): WorkspaceLeaf | null {
        return pickExactFileLeafCandidate(this.getFileLeafCandidates(), filePath);
    }

    private getFileLeafCandidates(): PreferredFileLeafCandidate<WorkspaceLeaf>[] {
        const workspace = this.host.app.workspace;
        const activeLeaf = workspace.getActiveViewOfType(FileView)?.leaf ?? null;
        const recentLeaf = workspace.getMostRecentLeaf(workspace.rootSplit);
        const candidates: PreferredFileLeafCandidate<WorkspaceLeaf>[] = [];

        workspace.iterateAllLeaves((leaf) => {
            const fileView = leaf.view instanceof FileView ? leaf.view : null;
            const isEligible = !!fileView && fileView.getViewType() !== "sidenote2-view";
            candidates.push({
                value: leaf,
                filePath: fileView?.file?.path ?? null,
                eligible: isEligible,
                active: leaf === activeLeaf,
                recent: leaf === recentLeaf,
            });
        });

        return candidates;
    }

    public async revealComment(comment: Comment): Promise<void> {
        void this.host.log?.("info", "navigation", "navigation.reveal.requested", {
            commentId: comment.id,
            filePath: comment.filePath,
        });
        const file = this.host.getFileByPath(comment.filePath);
        if (!file) {
            this.host.showNotice("Unable to find that file.");
            return;
        }

        let targetLeaf = this.getPreferredFileLeaf(comment.filePath);
        if (!targetLeaf) {
            targetLeaf = this.host.app.workspace.getLeaf(false);
        }

        if (!targetLeaf) {
            this.host.showNotice("Failed to open that file.");
            return;
        }

        if (!(targetLeaf.view instanceof FileView) || targetLeaf.view.file?.path !== file.path) {
            await targetLeaf.openFile(file);
        }

        this.host.app.workspace.setActiveLeaf(targetLeaf, { focus: true });

        if (!(targetLeaf.view instanceof MarkdownView)) {
            await targetLeaf.openFile(file);
        }

        const markdownView = await this.ensureMarkdownLeafReadyForReveal(targetLeaf);
        if (!markdownView) {
            this.host.showNotice("Failed to jump to Markdown view.");
            return;
        }

        const editor = markdownView.editor;
        if (isPageComment(comment)) {
            editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 0 });
            editor.scrollIntoView(
                {
                    from: { line: 0, ch: 0 },
                    to: { line: 0, ch: 0 },
                },
                true,
            );
            editor.focus();
            void this.host.log?.("info", "navigation", "navigation.reveal.resolved", {
                commentId: comment.id,
                filePath: comment.filePath,
                anchorKind: "page",
            });
            await this.activateViewAndHighlightComment(comment.id);
            return;
        }

        const currentContent = editor.getValue();
        const parsed = parseNoteComments(currentContent, comment.filePath);
        const resolvedAnchor = resolveAnchorRange(parsed.mainContent, comment);

        if (resolvedAnchor) {
            editor.setSelection(
                { line: resolvedAnchor.startLine, ch: resolvedAnchor.startChar },
                { line: resolvedAnchor.endLine, ch: resolvedAnchor.endChar },
            );
            editor.scrollIntoView(buildCommentRevealScrollTarget(comment, resolvedAnchor), true);
            void this.host.log?.("info", "navigation", "navigation.reveal.resolved", {
                commentId: comment.id,
                filePath: comment.filePath,
                anchorKind: "selection",
            });
        } else {
            this.host.showNotice("Side note anchor text is missing; showing the stored location.");
            void this.host.log?.("warn", "navigation", "navigation.reveal.fallback", {
                commentId: comment.id,
                filePath: comment.filePath,
            });
            editor.scrollIntoView(buildCommentRevealScrollTarget(comment), true);
        }

        editor.focus();
        await this.activateViewAndHighlightComment(comment.id);
    }

    public async highlightCommentById(filePath: string | null, commentId: string): Promise<void> {
        const comment = await this.resolveCommentById(commentId, filePath);
        if (!comment) {
            if (filePath && !this.host.getFileByPath(filePath)) {
                this.host.showNotice("Unable to find that file.");
                return;
            }

            this.host.showNotice("Unable to find that side comment.");
            return;
        }

        await this.activateViewAndHighlightComment(commentId);
    }

    public async openCommentById(filePath: string | null, commentId: string): Promise<void> {
        const comment = await this.resolveCommentById(commentId, filePath);
        if (!comment) {
            if (filePath && !this.host.getFileByPath(filePath)) {
                this.host.showNotice("Unable to find that file.");
                return;
            }

            this.host.showNotice("Unable to find that side comment.");
            return;
        }

        await this.revealComment(comment);
    }
}
