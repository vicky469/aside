import type { DraftComment } from "./drafts";

export class DraftSessionStore {
    private draftComment: DraftComment | null = null;
    private draftHostFilePath: string | null = null;
    private savingDraftCommentId: string | null = null;

    public getDraftComment(): DraftComment | null {
        return this.draftComment;
    }

    public getSavingDraftCommentId(): string | null {
        return this.savingDraftCommentId;
    }

    public getDraftHostFilePath(): string | null {
        return this.draftHostFilePath;
    }

    public getDraftForFile(filePath: string): DraftComment | null {
        return this.draftComment?.filePath === filePath ? this.draftComment : null;
    }

    public getDraftForView(filePath: string): DraftComment | null {
        return this.draftComment && this.draftHostFilePath === filePath
            ? this.draftComment
            : null;
    }

    public isSavingDraft(commentId: string): boolean {
        return this.savingDraftCommentId === commentId;
    }

    public updateDraftCommentText(commentId: string, commentText: string): boolean {
        if (this.draftComment?.id !== commentId) {
            return false;
        }

        this.draftComment.comment = commentText;
        return true;
    }

    public updateDraftCommentBookmarkState(commentId: string, isBookmark: boolean): boolean {
        if (this.draftComment?.id !== commentId) {
            return false;
        }

        this.draftComment.isBookmark = isBookmark === true;
        return true;
    }

    public setDraftComment(
        draftComment: DraftComment | null,
        hostFilePath: string | null = draftComment?.filePath ?? null,
    ): void {
        this.draftComment = draftComment;
        this.draftHostFilePath = draftComment ? hostFilePath : null;
    }

    public setDraftCommentValue(draftComment: DraftComment | null): void {
        this.draftComment = draftComment;
        if (!draftComment) {
            this.draftHostFilePath = null;
        }
    }

    public clearDraftState(): void {
        this.draftComment = null;
        this.draftHostFilePath = null;
    }

    public setSavingDraftCommentId(commentId: string | null): void {
        this.savingDraftCommentId = commentId;
    }

    public cancelDraft(commentId?: string): boolean {
        if (!this.draftComment) {
            return false;
        }

        if (commentId && this.draftComment.id !== commentId) {
            return false;
        }

        this.clearDraftState();
        return true;
    }

    public setDraftHostFilePath(hostFilePath: string | null): void {
        this.draftHostFilePath = hostFilePath;
    }
}
