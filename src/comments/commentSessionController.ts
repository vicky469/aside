import { DraftSessionStore } from "../domain/DraftSessionStore";
import { RevealedCommentSelectionStore } from "../domain/RevealedCommentSelectionStore";
import type { DraftComment } from "../domain/drafts";

export interface CommentSessionHost {
    refreshCommentViews(options?: { skipDataRefresh?: boolean }): Promise<void>;
    refreshEditorDecorations(): void;
    refreshMarkdownPreviews(): void;
    clearMarkdownSelection(filePath: string): void;
}

export interface RevealedCommentStateUpdateOptions {
    refreshMarkdownPreviews?: boolean;
}

export interface SetDraftCommentOptions {
    skipCommentViewRefresh?: boolean;
    refreshEditorDecorations?: boolean;
}

export interface SetSidebarViewStateOptions {
    skipCommentViewRefresh?: boolean;
}

export class CommentSessionController {
    private readonly draftSessionStore = new DraftSessionStore();
    private readonly revealedCommentSelectionStore = new RevealedCommentSelectionStore();
    private readonly nestedCommentThreadOverrideIds = new Set<string>();
    private showResolvedComments = false;
    private showDeletedComments = false;
    private showNestedComments = true;

    constructor(private readonly host: CommentSessionHost) {}

    public getDraftComment(): DraftComment | null {
        return this.draftSessionStore.getDraftComment();
    }

    public getSavingDraftCommentId(): string | null {
        return this.draftSessionStore.getSavingDraftCommentId();
    }

    public getDraftHostFilePath(): string | null {
        return this.draftSessionStore.getDraftHostFilePath();
    }

    public getDraftForFile(filePath: string): DraftComment | null {
        return this.draftSessionStore.getDraftForFile(filePath);
    }

    public getDraftForView(filePath: string): DraftComment | null {
        return this.draftSessionStore.getDraftForView(filePath);
    }

    public isSavingDraft(commentId: string): boolean {
        return this.draftSessionStore.isSavingDraft(commentId);
    }

    public updateDraftCommentText(commentId: string, commentText: string): boolean {
        return this.draftSessionStore.updateDraftCommentText(commentId, commentText);
    }

    public async setDraftComment(
        draftComment: DraftComment | null,
        hostFilePath: string | null = draftComment?.filePath ?? null,
        options: SetDraftCommentOptions = {},
    ): Promise<void> {
        this.draftSessionStore.setDraftComment(draftComment, hostFilePath);
        if (!options.skipCommentViewRefresh) {
            await this.host.refreshCommentViews({
                skipDataRefresh: true,
            });
        }
        if (options.refreshEditorDecorations !== false) {
            this.host.refreshEditorDecorations();
        }
    }

    public setDraftCommentValue(draftComment: DraftComment | null): void {
        this.draftSessionStore.setDraftCommentValue(draftComment);
    }

    public clearDraftState(): void {
        this.draftSessionStore.clearDraftState();
    }

    public setSavingDraftCommentId(commentId: string | null): void {
        this.draftSessionStore.setSavingDraftCommentId(commentId);
    }

    public async cancelDraft(commentId?: string): Promise<boolean> {
        if (!this.draftSessionStore.cancelDraft(commentId)) {
            return false;
        }

        await this.host.refreshCommentViews({
            skipDataRefresh: true,
        });
        this.host.refreshEditorDecorations();
        return true;
    }

    public setDraftHostFilePath(hostFilePath: string | null): void {
        this.draftSessionStore.setDraftHostFilePath(hostFilePath);
    }

    public shouldShowResolvedComments(): boolean {
        return this.showResolvedComments;
    }

    public async setShowResolvedComments(
        showResolved: boolean,
        options: SetSidebarViewStateOptions = {},
    ): Promise<boolean> {
        if (this.showResolvedComments === showResolved) {
            return false;
        }

        this.showResolvedComments = showResolved;
        if (!options.skipCommentViewRefresh) {
            await this.host.refreshCommentViews({
                skipDataRefresh: true,
            });
        }
        this.host.refreshEditorDecorations();
        this.host.refreshMarkdownPreviews();
        return true;
    }

    public shouldShowNestedComments(): boolean {
        return this.showNestedComments;
    }

    public shouldShowNestedCommentsForThread(threadId: string): boolean {
        if (this.showNestedComments) {
            return !this.nestedCommentThreadOverrideIds.has(threadId);
        }

        return this.nestedCommentThreadOverrideIds.has(threadId);
    }

    public shouldShowDeletedComments(): boolean {
        return this.showDeletedComments;
    }

    public async setShowDeletedComments(
        showDeleted: boolean,
        options: SetSidebarViewStateOptions = {},
    ): Promise<boolean> {
        if (this.showDeletedComments === showDeleted) {
            return false;
        }

        this.showDeletedComments = showDeleted;
        if (!options.skipCommentViewRefresh) {
            await this.host.refreshCommentViews({
                skipDataRefresh: true,
            });
        }
        return true;
    }

    public async setShowNestedComments(
        showNested: boolean,
        options: SetSidebarViewStateOptions = {},
    ): Promise<boolean> {
        const hasThreadOverrides = this.nestedCommentThreadOverrideIds.size > 0;
        if (this.showNestedComments === showNested && !hasThreadOverrides) {
            return false;
        }

        this.showNestedComments = showNested;
        this.nestedCommentThreadOverrideIds.clear();
        if (!options.skipCommentViewRefresh) {
            await this.host.refreshCommentViews({
                skipDataRefresh: true,
            });
        }
        return true;
    }

    public async setShowNestedCommentsForThread(
        threadId: string,
        showNested: boolean,
        options: SetSidebarViewStateOptions = {},
    ): Promise<boolean> {
        const isVisible = this.shouldShowNestedCommentsForThread(threadId);
        if (isVisible === showNested) {
            return false;
        }

        if (showNested === this.showNestedComments) {
            this.nestedCommentThreadOverrideIds.delete(threadId);
        } else {
            this.nestedCommentThreadOverrideIds.add(threadId);
        }
        if (!options.skipCommentViewRefresh) {
            await this.host.refreshCommentViews({
                skipDataRefresh: true,
            });
        }
        return true;
    }

    public getRevealedCommentId(filePath: string): string | null {
        return this.revealedCommentSelectionStore.getRevealedCommentId(filePath);
    }

    public setRevealedCommentState(
        filePath: string,
        commentId: string,
        options: RevealedCommentStateUpdateOptions = {},
    ): boolean {
        if (!this.revealedCommentSelectionStore.setRevealedCommentState(filePath, commentId)) {
            return false;
        }

        this.host.refreshEditorDecorations();
        if (options.refreshMarkdownPreviews !== false) {
            this.host.refreshMarkdownPreviews();
        }
        return true;
    }

    public clearRevealedCommentSelection(): void {
        const revealedCommentState = this.revealedCommentSelectionStore.clearRevealedCommentState();
        this.host.refreshEditorDecorations();
        this.host.refreshMarkdownPreviews();

        if (!revealedCommentState) {
            return;
        }

        this.host.clearMarkdownSelection(revealedCommentState.filePath);
    }
}
