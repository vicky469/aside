import type { TFile } from "obsidian";
import type { Comment, CommentManager } from "../commentManager";
import { lineChToOffset, offsetToLineCh } from "../core/anchors/anchorResolver";
import { shortenBareUrlsInMarkdown } from "../core/text/commentUrls";
import { MAX_SIDENOTE_WORDS, countCommentWords, exceedsCommentWordLimit } from "../core/text/commentWordLimit";
import { resolveAnchorRange } from "../core/anchors/anchorResolver";
import { getManagedSectionRange, getVisibleNoteContent } from "../core/storage/noteCommentStorage";
import type { DraftComment, DraftSelection } from "../domain/drafts";
import type { SavedUserEntryEvent } from "./commentAgentController";

type PersistOptions = {
    immediateAggregateRefresh?: boolean;
    skipCommentViewRefresh?: boolean;
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
    getCurrentSelectionForFile(file: TFile): DraftSelection | null;
    isCommentableFile(file: TFile | null): file is TFile;
    loadCommentsForFile(file: TFile): Promise<unknown>;
    persistCommentsForFile(file: TFile, options?: PersistOptions): Promise<void>;
    getCommentManager(): CommentManager;
    activateViewAndHighlightComment(commentId: string): Promise<void>;
    hashText(text: string): Promise<string>;
    showNotice(message: string): void;
    now(): number;
    handleSavedUserEntry?(event: SavedUserEntryEvent): Promise<void>;
    log?(level: "info" | "warn" | "error", area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
}

export class CommentMutationController {
    private readonly duplicateAddWindowMs = 800;
    private lastAddFingerprint: { key: string; at: number } | null = null;

    constructor(private readonly host: CommentMutationHost) {}

    public async startEditDraft(
        commentId: string,
        hostFilePath: string | null = this.host.getSidebarTargetFilePath(),
    ): Promise<boolean> {
        void this.host.log?.("info", "draft", "draft.edit.begin", {
            commentId,
            hostFilePath,
        });
        const latestTarget = await this.loadLatestCommentTarget(commentId);
        if (!latestTarget) {
            return false;
        }

        await this.host.setDraftComment(
            {
                ...latestTarget.latestComment,
                mode: "edit",
                threadId: this.host.getCommentManager().getThreadById(commentId)?.id ?? latestTarget.latestComment.id,
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

        const commentBody = shortenBareUrlsInMarkdown(draft.comment).trim();
        if (!commentBody) {
            this.host.showNotice("Please enter a comment before saving.");
            return;
        }
        if (exceedsCommentWordLimit(commentBody)) {
            this.host.showNotice(`Side notes are limited to ${MAX_SIDENOTE_WORDS} words.`);
            return;
        }

        const trimmedDraft: DraftComment = {
            ...draft,
            comment: commentBody,
        };
        void this.host.log?.("info", "draft", "draft.save.begin", {
            commentId,
            draftMode: draft.mode,
            filePath: draft.filePath,
            wordCount: countCommentWords(commentBody),
        });
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
            } else if (preparedDraft.mode === "append") {
                saved = await this.appendEntry(preparedDraft);
            } else {
                saved = await this.editComment(preparedDraft.id, preparedDraft.comment);
            }
            if (saved) {
                void this.host.log?.("info", "draft", preparedDraft.mode === "edit" ? "draft.edit.success" : "draft.save.success", {
                    commentId,
                    draftMode: preparedDraft.mode,
                    filePath: preparedDraft.filePath,
                });
                if (preparedDraft.mode !== "edit") {
                    try {
                        await this.host.handleSavedUserEntry?.({
                            threadId: preparedDraft.threadId ?? preparedDraft.id,
                            entryId: preparedDraft.id,
                            filePath: preparedDraft.filePath,
                            body: preparedDraft.comment,
                        });
                    } catch (agentError) {
                        void this.host.log?.("error", "agents", "agents.dispatch.error", {
                            commentId,
                            filePath: preparedDraft.filePath,
                            error: agentError,
                        });
                    }
                }
            }
        } catch (error) {
            void this.host.log?.("error", "draft", "draft.save.error", {
                commentId,
                draftMode: preparedDraft.mode,
                filePath: preparedDraft.filePath,
                error,
            });
            throw error;
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

    public async editComment(commentId: string, newCommentText: string, options: { skipCommentViewRefresh?: boolean } = {}): Promise<boolean> {
        const latestTarget = await this.loadLatestCommentTarget(commentId);
        if (!latestTarget) {
            return false;
        }

        this.host.getCommentManager().editComment(commentId, newCommentText);
        await this.host.persistCommentsForFile(latestTarget.file, {
            immediateAggregateRefresh: true,
            skipCommentViewRefresh: options.skipCommentViewRefresh,
        });
        return true;
    }

    public async appendEntry(draftComment: DraftComment): Promise<boolean> {
        const threadId = draftComment.threadId;
        if (!threadId) {
            return false;
        }

        const latestTarget = await this.loadLatestCommentTarget(threadId);
        if (!latestTarget) {
            return false;
        }

        this.host.getCommentManager().appendEntry(threadId, {
            id: draftComment.id,
            body: draftComment.comment,
            timestamp: draftComment.timestamp,
        });
        if (draftComment.appendAfterCommentId && draftComment.appendAfterCommentId !== threadId) {
            this.host.getCommentManager().reorderThreadEntries(
                threadId,
                draftComment.id,
                draftComment.appendAfterCommentId,
                "after",
            );
        }
        await this.host.persistCommentsForFile(latestTarget.file, { immediateAggregateRefresh: true });
        return true;
    }

    public async appendThreadEntry(
        threadId: string,
        entry: {
            id: string;
            body: string;
            timestamp: number;
        },
        options: PersistOptions = {},
    ): Promise<boolean> {
        const latestTarget = await this.loadLatestCommentTarget(threadId);
        if (!latestTarget) {
            return false;
        }

        this.host.getCommentManager().appendEntry(threadId, {
            id: entry.id,
            body: entry.body,
            timestamp: entry.timestamp,
        });
        await this.host.persistCommentsForFile(latestTarget.file, {
            immediateAggregateRefresh: true,
            skipCommentViewRefresh: options.skipCommentViewRefresh,
        });
        return true;
    }

    public async deleteComment(commentId: string, options: PersistOptions = {}): Promise<void> {
        void this.host.log?.("info", "draft", "thread.delete", { commentId });
        const latestTarget = await this.loadLatestCommentTarget(commentId);
        if (!latestTarget) {
            return;
        }

        this.host.getCommentManager().deleteComment(commentId, this.host.now());
        await this.host.persistCommentsForFile(latestTarget.file, {
            immediateAggregateRefresh: true,
            skipCommentViewRefresh: options.skipCommentViewRefresh,
        });
    }

    public async restoreComment(commentId: string): Promise<void> {
        void this.host.log?.("info", "draft", "thread.restore", { commentId });
        const latestTarget = await this.loadLatestCommentTarget(commentId);
        if (!latestTarget) {
            return;
        }

        this.host.getCommentManager().restoreComment(commentId, this.host.now());
        await this.host.persistCommentsForFile(latestTarget.file, { immediateAggregateRefresh: true });
    }

    public async clearDeletedCommentsForFile(filePath: string): Promise<boolean> {
        void this.host.log?.("info", "draft", "thread.delete.clear", { filePath });
        const file = this.host.getFileByPath(filePath);
        if (!this.host.isCommentableFile(file)) {
            return false;
        }

        await this.host.loadCommentsForFile(file);
        const changed = this.host.getCommentManager().clearDeletedCommentsForFile(file.path, this.host.now());
        if (!changed) {
            return false;
        }

        await this.host.persistCommentsForFile(file, { immediateAggregateRefresh: true });
        return true;
    }

    public async resolveComment(commentId: string): Promise<void> {
        void this.host.log?.("info", "draft", "thread.resolve", { commentId });
        const latestTarget = await this.loadLatestCommentTarget(commentId);
        if (!latestTarget) {
            return;
        }

        this.host.getCommentManager().resolveComment(commentId);
        await this.host.persistCommentsForFile(latestTarget.file, { immediateAggregateRefresh: true });
    }

    public async unresolveComment(commentId: string): Promise<void> {
        void this.host.log?.("info", "draft", "thread.reopen", { commentId });
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

    public async reanchorCommentThreadToCurrentSelection(commentId: string): Promise<boolean> {
        void this.host.log?.("info", "draft", "thread.reanchor.begin", { commentId });
        const latestTarget = await this.loadLatestCommentTarget(commentId);
        if (!latestTarget) {
            return false;
        }

        if (latestTarget.latestComment.anchorKind === "page") {
            this.host.showNotice("Only anchored side notes can be re-anchored.");
            return false;
        }

        const currentSelection = this.host.getCurrentSelectionForFile(latestTarget.file);
        if (!currentSelection || !currentSelection.selectedText.trim()) {
            this.host.showNotice("Select text in the source note to re-anchor this side note.");
            return false;
        }

        const noteContent = await this.host.getCurrentNoteContent(latestTarget.file);
        const nextAnchor = await this.prepareCurrentSelectionAnchorForSave(noteContent, currentSelection);
        if (!nextAnchor) {
            void this.host.log?.("warn", "draft", "thread.reanchor.error", {
                commentId,
                filePath: latestTarget.file.path,
            });
            return false;
        }

        this.host.getCommentManager().reanchorCommentThread(commentId, nextAnchor);
        await this.host.persistCommentsForFile(latestTarget.file, { immediateAggregateRefresh: true });
        void this.host.log?.("info", "draft", "thread.reanchor.success", {
            commentId,
            filePath: latestTarget.file.path,
        });
        return true;
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

    private async prepareCurrentSelectionAnchorForSave(
        noteContent: string,
        selection: DraftSelection,
    ): Promise<{
        startLine: number;
        startChar: number;
        endLine: number;
        endChar: number;
        selectedText: string;
        selectedTextHash: string;
    } | null> {
        const normalizedNoteContent = noteContent.replace(/\r\n/g, "\n");
        const rawStartOffset = lineChToOffset(normalizedNoteContent, selection.startLine, selection.startChar);
        const rawEndOffset = lineChToOffset(normalizedNoteContent, selection.endLine, selection.endChar);
        if (rawStartOffset === null || rawEndOffset === null || rawEndOffset <= rawStartOffset) {
            this.host.showNotice("Select text in the source note to re-anchor this side note.");
            return null;
        }

        const managedRange = getManagedSectionRange(normalizedNoteContent);
        if (managedRange && rawStartOffset < managedRange.toOffset && rawEndOffset > managedRange.fromOffset) {
            this.host.showNotice("Select text outside the SideNote2 comments block to re-anchor this side note.");
            return null;
        }

        const managedSectionLength = managedRange
            ? managedRange.toOffset - managedRange.fromOffset
            : 0;
        const adjustedStartOffset = managedRange && rawStartOffset >= managedRange.toOffset
            ? rawStartOffset - managedSectionLength
            : rawStartOffset;
        const adjustedEndOffset = managedRange && rawEndOffset >= managedRange.toOffset
            ? rawEndOffset - managedSectionLength
            : rawEndOffset;
        const visibleNoteContent = getVisibleNoteContent(normalizedNoteContent);
        const selectedText = visibleNoteContent.slice(adjustedStartOffset, adjustedEndOffset);
        if (!selectedText.trim()) {
            this.host.showNotice("Select text in the source note to re-anchor this side note.");
            return null;
        }

        const start = offsetToLineCh(visibleNoteContent, adjustedStartOffset);
        const end = offsetToLineCh(visibleNoteContent, adjustedEndOffset);
        return {
            startLine: start.line,
            startChar: start.ch,
            endLine: end.line,
            endChar: end.ch,
            selectedText,
            selectedTextHash: await this.host.hashText(selectedText),
        };
    }

    private toPersistedComment(draftComment: DraftComment): Comment {
        const { mode, threadId, appendAfterCommentId, ...comment } = draftComment;
        void mode;
        void threadId;
        void appendAfterCommentId;
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
