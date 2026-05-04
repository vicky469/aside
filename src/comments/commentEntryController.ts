import type { Editor, TFile } from "obsidian";
import type { Comment } from "../commentManager";
import { getPageCommentLabel } from "../core/anchors/commentAnchors";
import { isMarkdownCommentableFile } from "../core/rules/commentableFiles";
import type { DraftComment, DraftSelection } from "../domain/drafts";
import type { SetDraftCommentOptions } from "./commentSessionController";

export interface CommentEntryHost {
    getAllCommentsNotePath(): string;
    getFileByPath(filePath: string): TFile | null;
    isCommentableFile(file: TFile | null): file is TFile;
    loadCommentsForFile(file: TFile): Promise<unknown>;
    getKnownCommentById(commentId: string): Comment | null;
    getKnownThreadIdByCommentId(commentId: string): string | null;
    markDraftFileActive(file: TFile): void;
    setDraftComment(
        draftComment: DraftComment | null,
        hostFilePath?: string | null,
        options?: SetDraftCommentOptions,
    ): Promise<void>;
    activateViewAndHighlightComment(commentId: string): Promise<void>;
    createCommentId(): string;
    showNotice(message: string): void;
    log?(level: "info" | "warn" | "error", area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
}

export class CommentEntryController {
    constructor(private readonly host: CommentEntryHost) {}

    public async startDraftFromEditorSelection(editor: Editor, file: TFile | null): Promise<boolean> {
        const selectedText = editor.getSelection();
        if (!(file && selectedText.trim().length > 0)) {
            this.host.showNotice("Please select some text to add a comment.");
            return false;
        }

        const cursorStart = editor.getCursor("from");
        const cursorEnd = editor.getCursor("to");
        return this.startNewCommentDraft({
            file,
            selectedText,
            startLine: cursorStart.line,
            startChar: cursorStart.ch,
            endLine: cursorEnd.line,
            endChar: cursorEnd.ch,
        });
    }

    public async startPageCommentDraft(file: TFile | null): Promise<boolean> {
        if (!isMarkdownCommentableFile(file, this.host.getAllCommentsNotePath())) {
            return false;
        }

        return this.startNewCommentDraft({
            file,
            selectedText: getPageCommentLabel(file.path),
            startLine: 0,
            startChar: 0,
            endLine: 0,
            endChar: 0,
            anchorKind: "page",
        });
    }

    public async startAppendEntryDraft(
        commentId: string,
        hostFilePath: string | null = null,
    ): Promise<boolean> {
        const comment = this.host.getKnownCommentById(commentId);
        const normalizedThreadId = this.host.getKnownThreadIdByCommentId(commentId) ?? commentId;
        const commentFile = comment ? this.host.getFileByPath(comment.filePath) : null;

        if (!(comment && commentFile && this.host.isCommentableFile(commentFile))) {
            this.host.showNotice("Unable to find that side note thread.");
            return false;
        }

        await this.host.loadCommentsForFile(commentFile);
        const draft: DraftComment = {
            ...comment,
            id: this.host.createCommentId(),
            comment: "",
            timestamp: Date.now(),
            mode: "append",
            threadId: normalizedThreadId,
            appendAfterCommentId: commentId,
        };
        this.host.markDraftFileActive(commentFile);
        await this.host.setDraftComment(draft, hostFilePath ?? comment.filePath, {
            skipCommentViewRefresh: true,
        });
        void this.host.log?.("info", "draft", "draft.append.created", {
            filePath: comment.filePath,
            threadId: normalizedThreadId,
            appendAfterCommentId: commentId,
            commentId: draft.id,
        });
        await this.host.activateViewAndHighlightComment(draft.id);
        return true;
    }

    private async startNewCommentDraft(selection: DraftSelection): Promise<boolean> {
        if (!isMarkdownCommentableFile(selection.file, this.host.getAllCommentsNotePath())) {
            if (selection.anchorKind !== "page") {
                this.host.showNotice("Text-anchored side notes are only supported in markdown files.");
            }
            return false;
        }

        const draft = this.buildDraftComment(selection);
        this.host.markDraftFileActive(selection.file);
        await this.host.setDraftComment(draft, selection.file.path, {
            skipCommentViewRefresh: true,
        });
        void this.host.log?.("info", "draft", selection.anchorKind === "page" ? "draft.page.created" : "draft.selection.created", {
            filePath: selection.file.path,
            commentId: draft.id,
            anchorKind: draft.anchorKind,
        });
        await this.host.activateViewAndHighlightComment(draft.id);
        return true;
    }

    private buildDraftComment(selection: DraftSelection): DraftComment {
        const id = this.host.createCommentId();
        return {
            id,
            filePath: selection.file.path,
            startLine: selection.startLine,
            startChar: selection.startChar,
            endLine: selection.endLine,
            endChar: selection.endChar,
            selectedText: selection.selectedText,
            selectedTextHash: "",
            comment: "",
            timestamp: Date.now(),
            anchorKind: selection.anchorKind === "page" ? "page" : "selection",
            orphaned: false,
            mode: "new",
            threadId: id,
        };
    }
}
