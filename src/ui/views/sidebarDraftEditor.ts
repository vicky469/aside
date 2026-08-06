import type { Comment } from "../../commentManager";
import { compareCommentsForSidebarOrder } from "../../core/anchors/commentSectionOrder";
import { extractTagsFromText, normalizeTagText } from "../../core/text/commentTags";
import type { DraftComment } from "../../domain/drafts";
import {
    continueMarkdownList,
    toggleMarkdownBold,
    toggleMarkdownHighlight,
    type TextEditResult,
} from "../editor/commentEditorFormatting";
import {
    findOpenMentionQuery,
    replaceOpenMentionQuery,
    type OpenMentionQuery,
    type SideNoteMentionSuggestion,
} from "../editor/commentMentionSuggestions";
import { findOpenWikiLinkQuery, replaceOpenWikiLinkQuery } from "../editor/commentEditorLinks";
import {
    findOpenTagQuery,
    replaceOpenTagQuery,
    type TagQueryMatch,
} from "../editor/commentEditorTags";

interface InlineSuggestionChoice {
    value: string;
    title: string;
    note: string;
}

interface VaultTagRecord {
    normalized: string;
    canonical: string;
    usageCount: number;
    tag: string;
}

interface InlineSuggestionState {
    listId: string;
    kind: "mention" | "tag";
    textarea: HTMLTextAreaElement;
    container: HTMLDivElement;
    list: HTMLUListElement;
    optionElements: HTMLElement[];
    selectedIndex: number;
    items: InlineSuggestionChoice[];
    query: OpenMentionQuery | TagQueryMatch;
    onChoose: (
        value: string,
        query: OpenMentionQuery | TagQueryMatch,
    ) => Promise<void> | void;
    onClose: () => void;
    onOutsideMouseDown: (event: MouseEvent) => void;
}

type DropdownItemKind = "mention" | "tag";

let nextInlineSuggestionListId = 1;

function normalizeTagQuery(query: string): string {
    return query.trim().replace(/^#+/, "");
}

function normalizeTagMatchValue(value: string): string {
    return normalizeTagText(value)
        .slice(1)
        .toLowerCase()
        .replace(/-/g, "");
}

function collectTagRecords(indexedTags: readonly string[]): VaultTagRecord[] {
    const tagCounts = new Map<string, VaultTagRecord>();

    for (const rawTag of indexedTags) {
        const normalizedTag = normalizeTagText(rawTag);
        if (!normalizedTag) {
            continue;
        }

        const canonical = normalizeTagMatchValue(normalizedTag);
        const existing = tagCounts.get(canonical);
        if (existing) {
            existing.usageCount += 1;
            continue;
        }

        tagCounts.set(canonical, {
            normalized: normalizedTag.slice(1).toLowerCase(),
            canonical,
            usageCount: 1,
            tag: normalizedTag,
        });
    }

    return Array.from(tagCounts.values());
}

function getTagMatchScore(query: string, queryCanonical: string, tag: VaultTagRecord): number {
    if (!query) {
        return 0;
    }

    if (tag.canonical === queryCanonical) {
        return 0;
    }

    if (tag.canonical.startsWith(queryCanonical)) {
        return 1;
    }

    if (tag.canonical.split("/").some((segment) => {
        return segment.startsWith(queryCanonical);
    })) {
        return 2;
    }

    if (tag.canonical.includes(queryCanonical)) {
        return 3;
    }

    return Number.POSITIVE_INFINITY;
}

function buildTagSuggestionChoices(rawQuery: string, indexedTags: readonly string[]): InlineSuggestionChoice[] {
    const normalizedQuery = normalizeTagQuery(rawQuery);
    const normalizedQueryCanonical = normalizeTagMatchValue(normalizedQuery);
    const matchingTags = collectTagRecords(indexedTags)
        .map((tag) => ({
            tag,
            score: getTagMatchScore(normalizedQuery, normalizedQueryCanonical, tag),
        }))
        .filter((entry) => entry.score !== Number.POSITIVE_INFINITY)
        .sort((left, right) => {
            if (normalizedQuery && left.score !== right.score) {
                return left.score - right.score;
            }

            if (left.tag.usageCount !== right.tag.usageCount) {
                return right.tag.usageCount - left.tag.usageCount;
            }

            return left.tag.tag.localeCompare(right.tag.tag);
        })
        .map<InlineSuggestionChoice>(({ tag }) => ({
            value: tag.tag,
            title: tag.tag,
            note: tag.usageCount === 1
                ? "Used once"
                : `Used ${tag.usageCount} times`,
        }));

    return matchingTags;
}

function toMentionSuggestionChoices(mentions: readonly SideNoteMentionSuggestion[]): InlineSuggestionChoice[] {
    return mentions.map((mentionSuggestion) => ({
        value: mentionSuggestion.mention,
        title: mentionSuggestion.mention,
        note: mentionSuggestion.kind === "script"
            ? mentionSuggestion.scriptPath
            : mentionSuggestion.label,
    }));
}

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

type MentionSuggestCallbacks = {
    initialQuery: string;
    getSuggestions: (query: string) => SideNoteMentionSuggestion[];
    onChooseMention: (mention: string) => void | Promise<void>;
    onCloseModal: () => void;
};

export interface SidebarDraftEditorHost {
    getAllIndexedComments(): Comment[];
    updateDraftCommentText(commentId: string, commentText: string): void;
    renderComments(): Promise<void>;
    scheduleDraftFocus(commentId: string): void;
    getMentionSuggestions(query: string): SideNoteMentionSuggestion[];
    openMentionSuggestModal(options: MentionSuggestCallbacks): void;
    openLinkSuggestModal(options: LinkSuggestCallbacks): void;
    openTagSuggestModal(options: TagSuggestCallbacks): void;
}

export function getSidebarComments(
    persistedComments: Comment[],
    draftComment: DraftComment | null,
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
    const visibleDraft = !draftComment
        || (!selectedFileSet || selectedFileSet.has(draftComment.filePath))
        ? draftComment
        : null;
    const mergedComments: Array<Comment | DraftComment> = visibleDraft
        ? [...fileScopedComments, visibleDraft]
        : [...fileScopedComments];

    return mergedComments
        .slice()
        .sort(compareCommentsForSidebarOrder);
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
    private activeInlineSuggest: "mention" | "link" | "tag" | null = null;
    private inlineSuggestionState: InlineSuggestionState | null = null;

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

    public applyDraftListContinuation(
        commentId: string,
        textarea: HTMLTextAreaElement,
        isEditMode: boolean,
    ): boolean {
        const edit = continueMarkdownList(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
        );
        if (!edit) {
            return false;
        }

        this.applyDraftEditorEdit(commentId, textarea, edit, isEditMode);
        return true;
    }

    public handleDraftSuggestionKeydown(
        event: KeyboardEvent,
        textarea: HTMLTextAreaElement,
    ): boolean {
        const state = this.inlineSuggestionState;
        if (!state || state.textarea !== textarea) {
            return false;
        }

        const consumeShortcut = () => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        };

        if (event.key === "ArrowDown") {
            consumeShortcut();
            this.setInlineSuggestionSelectedIndex(
                state,
                Math.min(state.items.length - 1, state.selectedIndex + 1),
            );
            return true;
        }

        if (event.key === "ArrowUp") {
            consumeShortcut();
            this.setInlineSuggestionSelectedIndex(state, Math.max(0, state.selectedIndex - 1));
            return true;
        }

        if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
            consumeShortcut();
            if (state.items.length === 0) {
                this.closeInlineSuggestion();
                return true;
            }
            void this.chooseInlineSuggestion(state, state.selectedIndex);
            return true;
        }

        if (event.key === "Escape") {
            consumeShortcut();
            this.closeInlineSuggestion();
            return true;
        }

        return false;
    }

    public handleDraftInputSuggestion(
        comment: DraftComment,
        textarea: HTMLTextAreaElement,
        isEditMode: boolean,
        inputType: string,
        inputData: string | null = null,
    ): boolean {
        const value = textarea.value;
        const selectionStart = textarea.selectionStart;
        const selectionEnd = textarea.selectionEnd;

        if (this.inlineSuggestionState && this.inlineSuggestionState.textarea !== textarea) {
            this.closeInlineSuggestion();
        }

        if (this.refreshActiveInlineSuggestion(textarea)) {
            return true;
        }

        const isTextInsertion = inputType === "insertText"
            || inputType === "insertFromComposition"
            || inputType === "insertCompositionText";
        const previousChar = value.slice(selectionStart - 1, selectionStart);
        if (
            !this.activeInlineSuggest
            && isTextInsertion
            && selectionStart === selectionEnd
            && selectionStart > 0
            && (previousChar === "@" || previousChar === "/")
        ) {
            return this.openDraftMentionSuggest(comment, textarea, isEditMode);
        }

        if (this.activeInlineSuggest) {
            return false;
        }

        if (inputType !== "insertText" || !inputData) {
            return false;
        }

        if (
            inputData === "["
            && selectionStart >= 2
            && value.slice(selectionStart - 2, selectionStart) === "[["
        ) {
            return this.openDraftLinkSuggest(comment, textarea, isEditMode);
        }

        if (inputData === "#") {
            return this.openDraftTagSuggest(comment, textarea, isEditMode);
        }

        return false;
    }

    private refreshActiveInlineSuggestion(
        textarea: HTMLTextAreaElement,
    ): boolean {
        const state = this.inlineSuggestionState;
        if (!state || state.textarea !== textarea) {
            return false;
        }

        if (state.kind === "mention") {
            const mentionQuery = findOpenMentionQuery(
                textarea.value,
                textarea.selectionStart,
                textarea.selectionEnd,
            );
            if (!mentionQuery || findOpenWikiLinkQuery(
                textarea.value,
                textarea.selectionStart,
                textarea.selectionEnd,
            )) {
                this.closeInlineSuggestion();
                return false;
            }

            const nextChoices = toMentionSuggestionChoices(
                this.host.getMentionSuggestions(`${mentionQuery.trigger}${mentionQuery.query}`),
            ).slice(0, 40);
            if (!nextChoices.length) {
                this.closeInlineSuggestion();
                return false;
            }

            this.updateInlineSuggestion(state, mentionQuery, nextChoices);
            return true;
        }

        const tagQuery = findOpenTagQuery(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
        );
        if (!tagQuery) {
            this.closeInlineSuggestion();
            return false;
        }

        const nextChoices = buildTagSuggestionChoices(
            tagQuery.query,
            [
                ...this.host.getAllIndexedComments().flatMap((storedComment) => extractTagsFromText(storedComment.comment ?? "")),
                ...extractTagsFromText(textarea.value),
            ],
        );
        if (!nextChoices.length) {
            this.closeInlineSuggestion();
            return false;
        }

        this.updateInlineSuggestion(state, tagQuery, nextChoices);
        return true;
    }

    private collectTagSources(textarea: HTMLTextAreaElement): string[] {
        return [
            ...this.host.getAllIndexedComments().flatMap((storedComment) => extractTagsFromText(storedComment.comment ?? "")),
            ...extractTagsFromText(textarea.value),
        ];
    }

    private updateInlineSuggestion(
        state: InlineSuggestionState,
        query: OpenMentionQuery | TagQueryMatch,
        items: InlineSuggestionChoice[],
    ): void {
        state.query = query;
        state.items = items;
        state.selectedIndex = 0;
        this.renderInlineSuggestionChoices(state);
    }

    private openInlineSuggestion(
        textarea: HTMLTextAreaElement,
        kind: DropdownItemKind,
        initialQuery: OpenMentionQuery | TagQueryMatch,
        initialChoices: InlineSuggestionChoice[],
        onChoose: (
            choiceValue: string,
            query: OpenMentionQuery | TagQueryMatch,
        ) => Promise<void> | void,
        onClose: () => void,
    ): boolean {
        if (!initialChoices.length) {
            return false;
        }

        const editorShell = textarea.closest(".aside-inline-editor-shell");
        if (!editorShell) {
            return false;
        }

        const previousState = this.inlineSuggestionState;
        if (previousState) {
            this.closeInlineSuggestion();
        }

        const listId = `aside-inline-suggest-list-${nextInlineSuggestionListId++}`;
        const container = editorShell.createDiv("aside-inline-suggest-dropdown");
        const list = container.createEl("ul", {
            cls: "aside-inline-suggest-list",
        });
        list.id = listId;
        list.setAttribute("role", "listbox");
        textarea.setAttribute("aria-controls", listId);
        textarea.setAttribute("aria-expanded", "true");
        textarea.setAttribute("aria-haspopup", "listbox");
        const state: InlineSuggestionState = {
            listId,
            kind,
            textarea,
            container,
            list,
            optionElements: [],
            selectedIndex: 0,
            items: initialChoices,
            query: initialQuery,
            onChoose,
            onClose,
            onOutsideMouseDown: () => {},
        };

        this.inlineSuggestionState = state;
        this.activeInlineSuggest = kind;
        this.renderInlineSuggestionChoices(state);

        const onOutsideMouseDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && (state.container.contains(target) || state.textarea === target)) {
                return;
            }
            this.closeInlineSuggestion();
        };
        state.onOutsideMouseDown = onOutsideMouseDown;
        const doc = textarea.ownerDocument;
        if (doc) {
            doc.addEventListener("mousedown", onOutsideMouseDown, true);
        }

        return true;
    }

    private closeInlineSuggestion(): void {
        const state = this.inlineSuggestionState;
        if (!state) {
            return;
        }

        const doc = state.textarea.ownerDocument;
        if (doc) {
            doc.removeEventListener("mousedown", state.onOutsideMouseDown, true);
        }
        state.container.remove();
        state.textarea.removeAttribute("aria-controls");
        state.textarea.removeAttribute("aria-activedescendant");
        state.textarea.setAttribute("aria-expanded", "false");
        this.inlineSuggestionState = null;
        this.activeInlineSuggest = null;
        state.onClose();
    }

    private setInlineSuggestionSelectedIndex(
        state: InlineSuggestionState,
        index: number,
    ): void {
        if (!state.items.length) {
            state.selectedIndex = -1;
            return;
        }

        state.selectedIndex = Math.min(Math.max(0, index), state.items.length - 1);
        this.renderInlineSuggestionChoices(state);
        const selectedOption = state.optionElements[state.selectedIndex];
        if (selectedOption && typeof selectedOption.scrollIntoView === "function") {
            selectedOption.scrollIntoView({ block: "nearest" });
        }
    }

    private renderInlineSuggestionChoices(
        state: InlineSuggestionState,
    ): void {
        while (state.list.firstChild) {
            state.list.removeChild(state.list.firstChild);
        }
        state.optionElements = [];

        state.items.forEach((item, index) => {
            const suggestionItem = state.list.createEl("li", {
                cls: "aside-inline-suggest-item",
            });
            suggestionItem.id = `${state.listId}-option-${index}`;
            suggestionItem.setAttribute("role", "option");
            suggestionItem.setAttribute("aria-selected", index === state.selectedIndex ? "true" : "false");
            state.optionElements.push(suggestionItem);
            if (index === state.selectedIndex) {
                suggestionItem.addClass("is-selected");
            }

            suggestionItem.createDiv({
                cls: "aside-inline-suggest-title",
                text: item.title,
            });
            suggestionItem.createDiv({
                cls: "aside-inline-suggest-note",
                text: item.note,
            });

            suggestionItem.addEventListener("mousedown", (event) => {
                event.preventDefault();
                event.stopPropagation();
                void this.chooseInlineSuggestion(state, index);
            });
            suggestionItem.addEventListener("mouseenter", () => {
                this.setInlineSuggestionSelectedIndex(state, index);
            });
        });
        const selectedOption = state.optionElements[state.selectedIndex];
        if (selectedOption) {
            state.textarea.setAttribute("aria-activedescendant", selectedOption.id);
        } else {
            state.textarea.removeAttribute("aria-activedescendant");
        }
    }

    private async chooseInlineSuggestion(
        state: InlineSuggestionState,
        index: number,
    ): Promise<void> {
        const item = state.items[index];
        if (!item) {
            this.closeInlineSuggestion();
            return;
        }

        const query = state.query;
        this.closeInlineSuggestion();
        await Promise.resolve(state.onChoose(item.value, query));
    }

    public openDraftMentionSuggest(
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

        const mentionQuery = findOpenMentionQuery(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
        );
        if (!mentionQuery) {
            return false;
        }

        const onChooseMention = async (
            mention: string,
            activeQuery: OpenMentionQuery | TagQueryMatch = mentionQuery,
        ) => {
            const edit = replaceOpenMentionQuery(textarea.value, activeQuery as OpenMentionQuery, mention);
            if (textarea.isConnected) {
                this.applyDraftEditorEdit(comment.id, textarea, edit, isEditMode);
                textarea.focus();
                return;
            }

            this.host.updateDraftCommentText(comment.id, edit.value);
            await this.host.renderComments();
            this.host.scheduleDraftFocus(comment.id);
        };

        const queryPrefix = mentionQuery.trigger;
        const query = `${queryPrefix}${mentionQuery.query}`;

        if (!textarea.isConnected) {
            this.activeInlineSuggest = "mention";
            this.host.openMentionSuggestModal({
                initialQuery: mentionQuery.query,
                getSuggestions: (nextQuery) => this.host.getMentionSuggestions(nextQuery),
                onChooseMention: (mention) => {
                    void onChooseMention(mention);
                },
                onCloseModal: () => {
                    this.activeInlineSuggest = null;
                },
            });
            return true;
        }

        const choices = toMentionSuggestionChoices(
            this.host.getMentionSuggestions(query),
        ).slice(0, 40);
        if (!choices.length) {
            this.activeInlineSuggest = null;
            return false;
        }

        this.activeInlineSuggest = "mention";

        return this.openInlineSuggestion(
            textarea,
            "mention",
            mentionQuery,
            choices,
            onChooseMention,
            () => {
                this.activeInlineSuggest = null;
            },
        );
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

        if (!textarea.isConnected) {
            return false;
        }

        this.activeInlineSuggest = "tag";
        const tagSources = this.collectTagSources(textarea);
        const initialChoices = buildTagSuggestionChoices(tagQuery.query, tagSources);
        if (!initialChoices.length) {
            this.activeInlineSuggest = null;
            return false;
        }

        return this.openInlineSuggestion(
            textarea,
            "tag",
            tagQuery,
            initialChoices,
            (
                tagText,
                activeQuery: OpenMentionQuery | TagQueryMatch = tagQuery,
            ) => {
                const edit = replaceOpenTagQuery(textarea.value, activeQuery as TagQueryMatch, tagText);
                this.applyDraftEditorEdit(comment.id, textarea, edit, isEditMode);
                textarea.focus();
            },
            () => {
                this.activeInlineSuggest = null;
            },
        );
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
