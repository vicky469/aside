import type { Comment } from "../../commentManager";
import {
    parseSideNoteReferenceUrl,
    replaceRawSideNoteReferenceUrls,
    SIDE_NOTE_REFERENCE_SECTION_HEADER,
} from "../../core/text/commentReferences";
import { compareCommentsForSidebarOrder } from "../../core/anchors/commentSectionOrder";
import { matchesResolvedCommentVisibility, filterCommentsByResolvedVisibility } from "../../core/rules/resolvedCommentVisibility";
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

type SideNoteReferenceSuggestCallbacks = {
    excludeThreadId?: string | null;
    initialQuery: string;
    onChooseReference: (commentId: string) => Promise<void>;
    onCloseModal: () => void;
    sourcePath: string;
};

export interface SidebarDraftEditorHost {
    buildSideNoteReferenceMarkdownForComment(commentId: string, label?: string): string | null;
    getAllIndexedComments(): Comment[];
    localVaultName: string | null;
    updateDraftCommentText(commentId: string, commentText: string): void;
    renderComments(): Promise<void>;
    scheduleDraftFocus(commentId: string): void;
    openLinkSuggestModal(options: LinkSuggestCallbacks): void;
    openSideNoteReferenceSuggestModal(options: SideNoteReferenceSuggestCallbacks): void;
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
    const visibleComments = filterCommentsByResolvedVisibility(fileScopedComments, showResolved);
    const visibleDraft = !draftComment
        || (!selectedFileSet || selectedFileSet.has(draftComment.filePath))
            && matchesResolvedCommentVisibility(draftComment, showResolved)
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
    const minRows = 2;
    const maxRows = isEditMode ? 18 : 10;
    const approximateCharsPerRow = 48;
    const lines = commentText.split("\n");
    const estimatedRows = lines.reduce((total, line) => (
        total + Math.max(1, Math.ceil(Math.max(line.length, 1) / approximateCharsPerRow))
    ), 0);

    return Math.min(maxRows, Math.max(minRows, estimatedRows));
}

export class SidebarDraftEditorController {
    private activeInlineSuggest: "link" | "reference" | "tag" | null = null;

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

    public openDraftSideNoteReferenceSuggest(
        comment: DraftComment,
        textarea: HTMLTextAreaElement,
        isEditMode: boolean,
    ): boolean {
        if (this.activeInlineSuggest) {
            return false;
        }

        const initialValue = textarea.value;
        const selectionStart = textarea.selectionStart;
        const selectionEnd = textarea.selectionEnd;
        const initialQuery = selectionStart === selectionEnd
            ? ""
            : initialValue.slice(selectionStart, selectionEnd).trim();
        const initialCursor = selectionEnd;
        let inserted = false;
        this.activeInlineSuggest = "reference";

        this.host.openSideNoteReferenceSuggestModal({
            excludeThreadId: comment.threadId ?? comment.id,
            initialQuery,
            onChooseReference: async (commentId) => {
                const markdown = this.host.buildSideNoteReferenceMarkdownForComment(commentId);
                if (!markdown) {
                    return;
                }

                inserted = true;
                const edit = appendMentionedReference(initialValue, markdown);
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
            sourcePath: comment.filePath,
        });

        return true;
    }

    public normalizePastedSideNoteReferences(
        comment: DraftComment,
        textarea: HTMLTextAreaElement,
        pastedText: string,
        isEditMode: boolean,
    ): boolean {
        const normalized = replaceRawSideNoteReferenceUrls(pastedText, (match) => {
            const target = parseSideNoteReferenceUrl(match.url);
            if (!target) {
                return match.url;
            }

            return this.host.buildSideNoteReferenceMarkdownForComment(target.commentId) ?? match.url;
        }, {
            localOnly: true,
            localVaultName: this.host.localVaultName,
        });
        if (normalized === pastedText) {
            return false;
        }

        const edit = replaceSelection(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
            normalized,
        );
        this.applyDraftEditorEdit(comment.id, textarea, edit, isEditMode);
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

function replaceSelection(
    value: string,
    selectionStart: number,
    selectionEnd: number,
    replacement: string,
): TextEditResult {
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    const nextValue = value.slice(0, start) + replacement + value.slice(end);
    const nextCursor = start + replacement.length;
    return {
        value: nextValue,
        selectionStart: nextCursor,
        selectionEnd: nextCursor,
    };
}

export function appendMentionedReference(
    value: string,
    markdown: string,
): TextEditResult {
    const bullet = `- ${markdown}`;
    const mentionedHeaderIndex = value.indexOf(SIDE_NOTE_REFERENCE_SECTION_HEADER);
    if (mentionedHeaderIndex !== -1) {
        const lines = value.split("\n");
        const headerLineIndex = lines.findIndex((line) => line.trim() === SIDE_NOTE_REFERENCE_SECTION_HEADER);
        if (headerLineIndex !== -1) {
            let insertLineIndex = headerLineIndex + 1;
            while (
                insertLineIndex < lines.length
                && (lines[insertLineIndex].trim() === "" || lines[insertLineIndex].startsWith("- "))
            ) {
                insertLineIndex += 1;
            }
            lines.splice(insertLineIndex, 0, bullet);
            const nextValue = lines.join("\n");
            const insertedPrefixLength = lines
                .slice(0, insertLineIndex + 1)
                .join("\n")
                .length;
            return {
                value: nextValue,
                selectionStart: insertedPrefixLength,
                selectionEnd: insertedPrefixLength,
            };
        }
    }

    const trimmedValue = value.replace(/\s+$/, "");
    const nextValue = trimmedValue
        ? `${trimmedValue}\n\n${SIDE_NOTE_REFERENCE_SECTION_HEADER}\n${bullet}`
        : `${SIDE_NOTE_REFERENCE_SECTION_HEADER}\n${bullet}`;
    return {
        value: nextValue,
        selectionStart: nextValue.length,
        selectionEnd: nextValue.length,
    };
}
