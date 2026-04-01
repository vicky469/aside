import { FileView, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import type { Plugin } from "obsidian";
import type { Comment } from "../commentManager";
import type { DraftComment } from "../domain/drafts";
import { isPageComment } from "../core/anchors/commentAnchors";
import { resolveAnchorRange } from "../core/anchors/anchorResolver";
import { isAttachmentCommentableFile } from "../core/rules/commentableFiles";
import { parseNoteComments } from "../core/storage/noteCommentStorage";
import {
    pickPreferredFileLeafCandidate,
    type PreferredFileLeafCandidate,
} from "./commentNavigationPlanner";

interface SidebarViewLike {
    getViewType(): string;
    updateActiveFile(file: TFile | null): Promise<void>;
    highlightAndFocusDraft(commentId: string): Promise<void>;
}

function isSidebarViewLike(view: unknown): view is SidebarViewLike {
    return !!view
        && typeof (view as SidebarViewLike).getViewType === "function"
        && (view as SidebarViewLike).getViewType() === "sidenote2-view"
        && typeof (view as SidebarViewLike).updateActiveFile === "function"
        && typeof (view as SidebarViewLike).highlightAndFocusDraft === "function";
}

export interface CommentNavigationHost {
    app: Plugin["app"];
    getSidebarTargetFile(): TFile | null;
    getDraftComment(): DraftComment | null;
    getKnownCommentById(commentId: string): Comment | null;
    setRevealedCommentState(filePath: string, commentId: string): void;
    getFileByPath(path: string): TFile | null;
    isCommentableFile(file: TFile | null): file is TFile;
    loadCommentsForFile(file: TFile): Promise<unknown>;
    getLoadedCommentById(commentId: string): Comment | undefined;
    showNotice(message: string): void;
}

export class CommentNavigationController {
    constructor(private readonly host: CommentNavigationHost) {}

    public async updateSidebarViews(file: TFile | null): Promise<void> {
        const leaves = this.host.app.workspace.getLeavesOfType("sidenote2-view");
        for (const leaf of leaves) {
            if (isSidebarViewLike(leaf.view)) {
                await leaf.view.updateActiveFile(file);
            }
        }
    }

    public async activateView(skipViewUpdate = false): Promise<void> {
        const { workspace } = this.host.app;
        const sidebarFile = this.host.getSidebarTargetFile();

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType("sidenote2-view");

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                leaf = rightLeaf;
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

        workspace.revealLeaf(leaf);
        if (!skipViewUpdate && isSidebarViewLike(leaf.view)) {
            await leaf.view.updateActiveFile(sidebarFile);
        }
    }

    public async activateViewAndHighlightComment(commentId: string): Promise<void> {
        const draftComment = this.host.getDraftComment();
        const comment = draftComment?.id === commentId
            ? draftComment
            : this.host.getKnownCommentById(commentId);
        if (comment) {
            this.host.setRevealedCommentState(comment.filePath, comment.id);
        }

        const skipViewUpdate = draftComment !== null;
        await this.activateView(skipViewUpdate);

        const leaves = this.host.app.workspace.getLeavesOfType("sidenote2-view");
        for (const leaf of leaves) {
            if (isSidebarViewLike(leaf.view)) {
                await leaf.view.highlightAndFocusDraft(commentId);
            }
        }
    }

    public getPreferredFileLeaf(filePath?: string): WorkspaceLeaf | null {
        const workspace = this.host.app.workspace;
        const activeLeaf = workspace.activeLeaf;
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

        return pickPreferredFileLeafCandidate(candidates, filePath);
    }

    public async revealComment(comment: Comment): Promise<void> {
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

        if (isAttachmentCommentableFile(file)) {
            await this.activateViewAndHighlightComment(comment.id);
            return;
        }

        if (!(targetLeaf.view instanceof MarkdownView)) {
            await targetLeaf.openFile(file);
        }

        if (!(targetLeaf.view instanceof MarkdownView)) {
            this.host.showNotice("Failed to jump to Markdown view.");
            return;
        }

        const editor = targetLeaf.view.editor;
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
            await this.activateViewAndHighlightComment(comment.id);
            return;
        }

        const currentContent = editor.getValue();
        const parsed = parseNoteComments(currentContent, comment.filePath);
        const resolvedAnchor = resolveAnchorRange(parsed.mainContent, comment);

        if (resolvedAnchor) {
            editor.setSelection(
                { line: resolvedAnchor.startLine, ch: resolvedAnchor.startChar },
                { line: resolvedAnchor.startLine, ch: resolvedAnchor.startChar },
            );
            editor.scrollIntoView(
                {
                    from: { line: resolvedAnchor.startLine, ch: 0 },
                    to: { line: resolvedAnchor.endLine, ch: 0 },
                },
                true,
            );
        } else {
            this.host.showNotice("Side note anchor text is missing; showing the stored location.");
            editor.scrollIntoView(
                {
                    from: { line: comment.startLine, ch: 0 },
                    to: { line: comment.startLine, ch: 0 },
                },
                true,
            );
        }

        editor.focus();
        await this.activateViewAndHighlightComment(comment.id);
    }

    public async highlightCommentById(filePath: string, commentId: string): Promise<void> {
        const knownComment = this.host.getKnownCommentById(commentId);
        if (knownComment?.filePath === filePath) {
            await this.activateViewAndHighlightComment(commentId);
            return;
        }

        const file = this.host.getFileByPath(filePath);
        if (!file) {
            this.host.showNotice("Unable to find that file.");
            return;
        }

        await this.host.loadCommentsForFile(file);
        const comment = this.host.getLoadedCommentById(commentId);
        if (!comment || comment.filePath !== file.path) {
            this.host.showNotice("Unable to find that side comment.");
            return;
        }

        await this.activateViewAndHighlightComment(comment.id);
    }

    public async openCommentById(filePath: string, commentId: string): Promise<void> {
        const file = this.host.getFileByPath(filePath);
        if (!file) {
            this.host.showNotice("Unable to find that file.");
            return;
        }

        await this.host.loadCommentsForFile(file);
        const comment = this.host.getLoadedCommentById(commentId);
        if (!comment || comment.filePath !== file.path) {
            this.host.showNotice("Unable to find that side comment.");
            return;
        }

        await this.revealComment(comment);
    }
}
