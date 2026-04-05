import type { TFile } from "obsidian";
import type { Comment, CommentManager } from "../commentManager";
import { resolveAnchorRange } from "../core/anchors/anchorResolver";
import { getVisibleNoteContent } from "../core/storage/noteCommentStorage";
import type { DraftComment } from "../domain/drafts";
import { debugCount, debugLog } from "../debug";

type PersistOptions = {
    immediateAggregateRefresh?: boolean;
};

export interface CommentMutationHost {
    getAllCommentsNotePath(): string;
    getSidebarTargetFilePath(): string | null;
    getDraftComment(): DraftComment | null;
    getSavingDraftCommentId(): string | null;
    shouldShowResolvedComments(): boolean;
    setShowResolvedComments(showResolved: boolean): Promise<boolean>;
    setDraftComment(draftComment: DraftComment | null, hostFilePath?: string | null): Promise<void>;
    setDraftCommentValue(draftComment: DraftComment | null): void;
    clearDraftState(): void;
    setSavingDraftCommentId(commentId: string | null): void;
    refreshCommentViews(): Promise<void>;
    refreshEditorDecorations(): void;
    getKnownCommentById(commentId: string): Comment | null;
    getLoadedCommentById(commentId: string): Comment | null;
    getFileByPath(filePath: string): TFile | null;
    getCurrentNoteContent(file: TFile): Promise<string>;
    isCommentableFile(file: TFile | null): file is TFile;
    loadCommentsForFile(file: TFile): Promise<unknown>;
    persistCommentsForFile(file: TFile, options?: PersistOptions): Promise<void>;
    getCommentManager(): CommentManager;
    activateViewAndHighlightComment(commentId: string): Promise<void>;
    showNotice(message: string): void;
    now(): number;
}

export class CommentMutationController {
    private readonly duplicateAddWindowMs = 800;
    private lastAddFingerprint: { key: string; at: number } | null = null;

    constructor(private readonly host: CommentMutationHost) {}

    public async startEditDraft(
        commentId: string,
        hostFilePath: string | null = this.host.getSidebarTargetFilePath(),
    ): Promise<boolean> {
        const latestTarget = await this.loadLatestCommentTarget(commentId);
        if (!latestTarget) {
            return false;
        }

        await this.host.setDraftComment(
            {
                ...latestTarget.latestComment,
                mode: "edit",
            },
            hostFilePath ?? latestTarget.latestComment.filePath,
        );
        await this.host.activateViewAndHighlightComment(latestTarget.latestComment.id);
        return true;
    }

    public async saveDraft(commentId: string): Promise<void> {
        const draft = this.host.getDraftComment();
        if (!draft || draft.id !== commentId || this.host.getSavingDraftCommentId() === commentId) {
            return;
        }

        const commentBody = draft.comment.trim();
        if (!commentBody) {
            this.host.showNotice("Please enter a comment before saving.");
            return;
        }

        const trimmedDraft: DraftComment = {
            ...draft,
            comment: commentBody,
        };
        this.host.setDraftCommentValue(trimmedDraft);
        this.host.setSavingDraftCommentId(commentId);
        await this.host.refreshCommentViews();

        let preparedDraft: DraftComment | null;
        try {
            preparedDraft = trimmedDraft.mode === "new"
                ? await this.prepareNewDraftForSave(trimmedDraft)
                : trimmedDraft;
        } catch (error) {
            this.host.setSavingDraftCommentId(null);
            await this.host.refreshCommentViews();
            this.host.refreshEditorDecorations();
            throw error;
        }

        if (!preparedDraft) {
            this.host.setSavingDraftCommentId(null);
            await this.host.refreshCommentViews();
            this.host.refreshEditorDecorations();
            return;
        }

        this.host.setDraftCommentValue(preparedDraft);

        let saved = false;
        try {
            if (preparedDraft.mode === "new") {
                saved = await this.addComment(this.toPersistedComment(preparedDraft));
            } else {
                saved = await this.editComment(commentId, preparedDraft.comment);
            }
        } finally {
            if (saved && this.host.getDraftComment()?.id === commentId) {
                this.host.clearDraftState();
            }
            this.host.setSavingDraftCommentId(null);
            await this.host.refreshCommentViews();
            this.host.refreshEditorDecorations();
        }
    }

    public async addComment(newComment: Comment): Promise<boolean> {
        debugCount("addComment");
        debugLog("addComment", { filePath: newComment.filePath, id: newComment.id });
        if (newComment.filePath === this.host.getAllCommentsNotePath()) {
            this.host.showNotice(`Cannot add comments to ${this.host.getAllCommentsNotePath()}.`);
            return false;
        }

        const file = this.host.getFileByPath(newComment.filePath);
        if (!this.host.isCommentableFile(file)) {
            this.host.showNotice("Unable to find the note for this side note.");
            return false;
        }

        await this.host.loadCommentsForFile(file);
        const now = this.host.now();
        const fingerprint = this.createAddFingerprint(newComment);
        if (
            this.lastAddFingerprint &&
            this.lastAddFingerprint.key === fingerprint &&
            now - this.lastAddFingerprint.at < this.duplicateAddWindowMs
        ) {
            return false;
        }

        this.lastAddFingerprint = { key: fingerprint, at: now };
        this.host.getCommentManager().addComment(newComment);
        await this.host.persistCommentsForFile(file, { immediateAggregateRefresh: true });
        return true;
    }

    public async editComment(commentId: string, newCommentText: string): Promise<boolean> {
        debugCount("editComment");
        debugLog("editComment", { id: commentId, length: newCommentText.length });
        const latestTarget = await this.loadLatestCommentTarget(commentId);
        if (!latestTarget) {
            return false;
        }

        this.host.getCommentManager().editComment(commentId, newCommentText);
        await this.host.persistCommentsForFile(latestTarget.file, { immediateAggregateRefresh: true });
        return true;
    }

    public async deleteComment(commentId: string): Promise<void> {
        debugCount("deleteComment");
        debugLog("deleteComment", { id: commentId });
        const latestTarget = await this.loadLatestCommentTarget(commentId);
        if (!latestTarget) {
            return;
        }

        this.host.getCommentManager().deleteComment(commentId);
        await this.host.persistCommentsForFile(latestTarget.file, { immediateAggregateRefresh: true });
    }

    public async resolveComment(commentId: string): Promise<void> {
        debugCount("resolveComment");
        debugLog("resolveComment", { id: commentId });
        const latestTarget = await this.loadLatestCommentTarget(commentId);
        if (!latestTarget) {
            return;
        }

        this.host.getCommentManager().resolveComment(commentId);
        await this.host.persistCommentsForFile(latestTarget.file, { immediateAggregateRefresh: true });
    }

    public async unresolveComment(commentId: string): Promise<void> {
        debugCount("unresolveComment");
        debugLog("unresolveComment", { id: commentId });
        const latestTarget = await this.loadLatestCommentTarget(commentId);
        if (!latestTarget) {
            return;
        }

        this.host.getCommentManager().unresolveComment(commentId);
        await this.host.persistCommentsForFile(latestTarget.file, { immediateAggregateRefresh: true });
        if (this.host.shouldShowResolvedComments()) {
            await this.host.setShowResolvedComments(false);
        }
    }

    private async loadLatestCommentTarget(
        commentId: string,
    ): Promise<{ file: TFile; latestComment: Comment } | null> {
        const existingComment = this.host.getKnownCommentById(commentId);
        const file = existingComment ? this.host.getFileByPath(existingComment.filePath) : null;
        if (!existingComment || !this.host.isCommentableFile(file)) {
            this.host.showNotice("Unable to find that side note.");
            return null;
        }

        await this.host.loadCommentsForFile(file);
        const latestComment = this.host.getLoadedCommentById(commentId);
        if (!latestComment) {
            this.host.showNotice("Unable to find that side note.");
            return null;
        }

        return { file, latestComment };
    }

    private async prepareNewDraftForSave(draftComment: DraftComment): Promise<DraftComment | null> {
        if (draftComment.anchorKind === "page") {
            return draftComment;
        }

        const file = this.host.getFileByPath(draftComment.filePath);
        if (!this.host.isCommentableFile(file)) {
            this.host.showNotice("Unable to find the note for this side note.");
            return null;
        }

        const currentNoteContent = await this.host.getCurrentNoteContent(file);
        const visibleNoteContent = getVisibleNoteContent(currentNoteContent);
        const resolvedAnchor = resolveAnchorRange(visibleNoteContent, draftComment);
        if (!resolvedAnchor) {
            this.host.showNotice("Selected text changed before save. Review the draft and reselect the anchor text.");
            return null;
        }

        return {
            ...draftComment,
            startLine: resolvedAnchor.startLine,
            startChar: resolvedAnchor.startChar,
            endLine: resolvedAnchor.endLine,
            endChar: resolvedAnchor.endChar,
            selectedText: resolvedAnchor.text,
            orphaned: false,
        };
    }

    private toPersistedComment(draftComment: DraftComment): Comment {
        const { mode: _mode, ...comment } = draftComment;
        return comment;
    }

    private createAddFingerprint(comment: Comment): string {
        return [
            comment.filePath,
            comment.anchorKind ?? "selection",
            comment.startLine,
            comment.startChar,
            comment.endLine,
            comment.endChar,
            comment.selectedText,
            comment.comment,
        ].join("|");
    }
}
