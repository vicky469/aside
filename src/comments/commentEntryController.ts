import type { Editor, TFile } from "obsidian";
import type { Comment } from "../commentManager";
import { getPageCommentLabel } from "../core/anchors/commentAnchors";
import { isMarkdownCommentableFile } from "../core/rules/commentableFiles";
import type { DraftComment, DraftSelection } from "../domain/drafts";
import type { SetDraftCommentOptions } from "./commentSessionController";
import {
    findMatchingEditorSelectionAnchor,
    type EditorSelectionCommentAction,
} from "./editorSelectionCommentAction";

export interface CommentEntryHost {
    getAllCommentsNotePath(): string;
    getFileByPath(filePath: string): TFile | null;
    isCommentableFile(file: TFile | null): file is TFile;
    isPageNoteCapableFile(file: TFile | null): file is TFile;
    loadCommentsForFile(file: TFile): Promise<unknown>;
    getKnownCommentById(commentId: string): Comment | null;
    getKnownThreadIdByCommentId(commentId: string): string | null;
    getCommentsForFile(filePath: string): Comment[];
    markDraftFileActive(file: TFile): void;
    setDraftComment(
        draftComment: DraftComment | null,
        hostFilePath?: string | null,
        options?: SetDraftCommentOptions,
    ): Promise<void>;
    orphanCommentThreadAnchor(commentId: string): Promise<boolean>;
    activateViewAndHighlightComment(commentId: string): Promise<void>;
    createCommentId(): string;
    showNotice(message: string): void;
    log?(level: "info" | "warn" | "error", area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
}

export class CommentEntryController {
    constructor(private readonly host: CommentEntryHost) {}

    public getEditorSelectionAction(editor: Editor, file: TFile | null): EditorSelectionCommentAction {
        return this.findMatchingSelectionAnchor(editor, file) ? "orphan-anchor" : "add-comment";
    }

    public async startDraftFromEditorSelection(editor: Editor, file: TFile | null): Promise<boolean> {
        const selection = this.readEditorSelection(editor, file);
        if (!selection) {
            this.host.showNotice("Please select some text to add a comment.");
            return false;
        }

        const existingAnchor = this.findMatchingSelectionAnchorForSelection(selection);
        if (existingAnchor) {
            return this.host.orphanCommentThreadAnchor(existingAnchor.id);
        }

        return this.startNewCommentDraft(selection);
    }

    public async startPageCommentDraft(file: TFile | null): Promise<boolean> {
        if (!this.host.isPageNoteCapableFile(file)) {
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

        if (!(comment && commentFile && this.isSourceFileValidForComment(commentFile, comment))) {
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
        if (!this.isSourceFileValidForSelection(selection)) {
            if (selection.anchorKind !== "page") {
                this.host.showNotice("Text-anchored side notes are only supported in markdown files.");
            }
            return false;
        }

        const draft = this.buildDraftComment(selection);
        this.host.markDraftFileActive(selection.file);
        const setDraftOptions: SetDraftCommentOptions = {
            skipCommentViewRefresh: true,
        };
        if (draft.anchorKind === "page") {
            setDraftOptions.refreshEditorDecorations = false;
        }
        await this.host.setDraftComment(draft, selection.file.path, setDraftOptions);
        void this.host.log?.("info", "draft", selection.anchorKind === "page" ? "draft.page.created" : "draft.selection.created", {
            filePath: selection.file.path,
            commentId: draft.id,
            anchorKind: draft.anchorKind,
        });
        await this.host.activateViewAndHighlightComment(draft.id);
        return true;
    }

    private isSourceFileValidForComment(file: TFile | null, comment: Pick<Comment, "anchorKind">): file is TFile {
        return comment.anchorKind === "page"
            ? this.host.isPageNoteCapableFile(file)
            : this.host.isCommentableFile(file);
    }

    private isSourceFileValidForSelection(selection: DraftSelection): boolean {
        return selection.anchorKind === "page"
            ? this.host.isPageNoteCapableFile(selection.file)
            : isMarkdownCommentableFile(selection.file, this.host.getAllCommentsNotePath());
    }

    private readEditorSelection(editor: Editor, file: TFile | null): DraftSelection | null {
        const selectedText = editor.getSelection();
        if (!(file && selectedText.trim().length > 0)) {
            return null;
        }

        const cursorStart = editor.getCursor("from");
        const cursorEnd = editor.getCursor("to");
        return {
            file,
            selectedText,
            startLine: cursorStart.line,
            startChar: cursorStart.ch,
            endLine: cursorEnd.line,
            endChar: cursorEnd.ch,
        };
    }

    private findMatchingSelectionAnchor(editor: Editor, file: TFile | null): Comment | null {
        const selection = this.readEditorSelection(editor, file);
        return this.findMatchingSelectionAnchorForSelection(selection);
    }

    private findMatchingSelectionAnchorForSelection(selection: DraftSelection | null): Comment | null {
        if (!selection) {
            return null;
        }

        return findMatchingEditorSelectionAnchor(
            this.host.getCommentsForFile(selection.file.path),
            {
                filePath: selection.file.path,
                selectedText: selection.selectedText,
                startLine: selection.startLine,
                startChar: selection.startChar,
                endLine: selection.endLine,
                endChar: selection.endChar,
            },
        );
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
