import type { Comment } from "../../commentManager";
import { compareCommentsForSidebarOrder } from "../../core/anchors/commentSectionOrder";
import { extractTagsFromText } from "../../core/text/commentTags";
import type { DraftComment } from "../../domain/drafts";
import { toggleMarkdownBold, toggleMarkdownHighlight, type TextEditResult } from "../editor/commentEditorFormatting";
import { findOpenWikiLinkQuery, replaceOpenWikiLinkQuery } from "../editor/commentEditorLinks";
import { findOpenTagQuery, replaceOpenTagQuery } from "../editor/commentEditorTags";

type LinkSuggestCallbacks = {
    initialQuery: string;
    sourcePath: string;
    onChooseLink: (linkText: string) => Promise<void>;
    onCloseModal: () => void;
};

type TagSuggestCallbacks = {
    extraTags: string[];
    initialQuery: string;
    onChooseTag: (tagText: string) => Promise<void>;
    onCloseModal: () => void;
};

export interface SidebarDraftEditorHost {
    getAllIndexedComments(): Comment[];
    updateDraftCommentText(commentId: string, commentText: string): void;
    renderComments(): Promise<void>;
    scheduleDraftFocus(commentId: string): void;
    openLinkSuggestModal(options: LinkSuggestCallbacks): void;
    openTagSuggestModal(options: TagSuggestCallbacks): void;
}

export function getSidebarComments(
    persistedComments: Comment[],
    draftComment: DraftComment | null,
    showResolved: boolean,
    selectedFilePaths: readonly string[] = [],
): Array<Comment | DraftComment> {
    const selectedFileSet = selectedFilePaths.length
        ? new Set(selectedFilePaths)
        : null;
    const commentsWithoutDraft = draftComment
        ? persistedComments.filter((comment) => comment.id !== draftComment.id)
        : persistedComments.slice();
    const fileScopedComments = selectedFileSet
        ? commentsWithoutDraft.filter((comment) => selectedFileSet.has(comment.filePath))
        : commentsWithoutDraft;
    const visibleComments = showResolved
        ? fileScopedComments
        : fileScopedComments.filter((comment) => !comment.resolved);
    const visibleDraft = !draftComment || !selectedFileSet || selectedFileSet.has(draftComment.filePath)
        ? draftComment
        : null;
    const mergedComments = visibleDraft
        ? visibleComments.concat(visibleDraft)
        : visibleComments;

    return mergedComments
        .slice()
        .sort(compareCommentsForSidebarOrder) as Array<Comment | DraftComment>;
}

export function estimateDraftTextareaRows(commentText: string, isEditMode: boolean): number {
    const minRows = isEditMode ? 6 : 4;
    const maxRows = isEditMode ? 18 : 10;
    const approximateCharsPerRow = 48;
    const lines = commentText.split("\n");
    const estimatedRows = lines.reduce((total, line) => (
        total + Math.max(1, Math.ceil(Math.max(line.length, 1) / approximateCharsPerRow))
    ), 0);

    return Math.min(maxRows, Math.max(minRows, estimatedRows));
}

export class SidebarDraftEditorController {
    private activeInlineSuggest: "link" | "tag" | null = null;

    constructor(private readonly host: SidebarDraftEditorHost) {}

    public applyDraftHighlight(
        commentId: string,
        textarea: HTMLTextAreaElement,
        isEditMode: boolean,
    ): void {
        const edit = toggleMarkdownHighlight(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
        );
        this.applyDraftEditorEdit(commentId, textarea, edit, isEditMode);
    }

    public applyDraftBold(
        commentId: string,
        textarea: HTMLTextAreaElement,
        isEditMode: boolean,
    ): void {
        const edit = toggleMarkdownBold(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
        );
        this.applyDraftEditorEdit(commentId, textarea, edit, isEditMode);
    }

    public openDraftLinkSuggest(
        comment: DraftComment,
        textarea: HTMLTextAreaElement,
        isEditMode: boolean,
    ): boolean {
        if (this.activeInlineSuggest) {
            return false;
        }

        const linkQuery = findOpenWikiLinkQuery(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
        );
        if (!linkQuery) {
            return false;
        }

        const initialValue = textarea.value;
        const initialCursor = linkQuery.end;
        let inserted = false;
        this.activeInlineSuggest = "link";

        this.host.openLinkSuggestModal({
            initialQuery: linkQuery.query,
            sourcePath: comment.filePath,
            onChooseLink: async (linkText) => {
                inserted = true;
                const edit = replaceOpenWikiLinkQuery(initialValue, linkQuery, linkText);
                if (textarea.isConnected) {
                    this.applyDraftEditorEdit(comment.id, textarea, edit, isEditMode);
                    textarea.focus();
                    return;
                }

                this.host.updateDraftCommentText(comment.id, edit.value);
                await this.host.renderComments();
                this.host.scheduleDraftFocus(comment.id);
            },
            onCloseModal: () => {
                this.activeInlineSuggest = null;
                if (inserted || !textarea.isConnected) {
                    return;
                }

                window.requestAnimationFrame(() => {
                    textarea.focus();
                    textarea.setSelectionRange(initialCursor, initialCursor);
                });
            },
        });

        return true;
    }

    public openDraftTagSuggest(
        comment: DraftComment,
        textarea: HTMLTextAreaElement,
        isEditMode: boolean,
    ): boolean {
        if (this.activeInlineSuggest || findOpenWikiLinkQuery(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
        )) {
            return false;
        }

        const tagQuery = findOpenTagQuery(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
        );
        if (!tagQuery) {
            return false;
        }

        const initialValue = textarea.value;
        const initialCursor = tagQuery.end;
        let inserted = false;
        this.activeInlineSuggest = "tag";

        this.host.openTagSuggestModal({
            extraTags: [
                ...this.host.getAllIndexedComments().flatMap((storedComment) => extractTagsFromText(storedComment.comment ?? "")),
                ...extractTagsFromText(textarea.value),
            ],
            initialQuery: tagQuery.query,
            onChooseTag: async (tagText) => {
                inserted = true;
                const edit = replaceOpenTagQuery(initialValue, tagQuery, tagText);
                if (textarea.isConnected) {
                    this.applyDraftEditorEdit(comment.id, textarea, edit, isEditMode);
                    textarea.focus();
                    return;
                }

                this.host.updateDraftCommentText(comment.id, edit.value);
                await this.host.renderComments();
                this.host.scheduleDraftFocus(comment.id);
            },
            onCloseModal: () => {
                this.activeInlineSuggest = null;
                if (inserted || !textarea.isConnected) {
                    return;
                }

                window.requestAnimationFrame(() => {
                    textarea.focus();
                    textarea.setSelectionRange(initialCursor, initialCursor);
                });
            },
        });

        return true;
    }

    private applyDraftEditorEdit(
        commentId: string,
        textarea: HTMLTextAreaElement,
        edit: TextEditResult,
        isEditMode: boolean,
    ): void {
        textarea.value = edit.value;
        textarea.rows = estimateDraftTextareaRows(edit.value, isEditMode);
        textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
}
