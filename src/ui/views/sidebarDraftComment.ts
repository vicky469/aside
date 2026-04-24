import { isOrphanedComment, isPageComment } from "../../core/anchors/commentAnchors";
import { MAX_SIDENOTE_WORDS, countCommentWords, exceedsCommentWordLimit } from "../../core/text/commentWordLimit";
import type { DraftComment } from "../../domain/drafts";
import { renderStyledDraftCommentFragment } from "../editor/commentEditorStyling";
import { formatSidebarCommentMeta } from "./sidebarCommentSections";
import type { SidebarDraftEditorController } from "./sidebarDraftEditor";
import { estimateDraftTextareaRows } from "./sidebarDraftEditor";

export interface DraftCommentPresentation {
    classes: string[];
    metaText: string;
    saveLabel: string;
    placeholder: string;
}

export interface SidebarDraftCommentHost {
    activeCommentId: string | null;
    shouldPinFocusedDraftToTop: boolean;
    isSavingDraft(commentId: string): boolean;
    updateDraftCommentText(commentId: string, commentText: string): void;
    updateDraftCommentBookmarkState(commentId: string, isBookmark: boolean): void;
    setIcon(element: HTMLElement, icon: string): void;
    claimSidebarInteractionOwnership(focusTarget?: HTMLElement | null): void;
    saveDraft(
        commentId: string,
        options?: {
            skipPreSaveRefresh?: boolean;
            skipAnchorRevalidation?: boolean;
            deferAggregateRefresh?: boolean;
            skipPersistedViewRefresh?: boolean;
        },
    ): Promise<void> | void;
    cancelDraft(commentId: string): void;
}

type DraftEditorLayout = "card" | "inline-edit";

export function buildDraftCommentPresentation(
    comment: DraftComment,
    activeCommentId: string | null,
): DraftCommentPresentation {
    const classes = [
        "sidenote2-comment-item",
        "sidenote2-comment-draft",
        comment.mode === "edit" ? "is-edit" : comment.mode === "append" ? "is-append" : "is-new",
    ];
    if (isPageComment(comment)) {
        classes.push("page-note");
    }
    if (isOrphanedComment(comment)) {
        classes.push("orphaned");
    }
    if (comment.resolved) {
        classes.push("resolved");
    }
    if (activeCommentId === comment.id) {
        classes.push("active");
    }

    return {
        classes,
        metaText: formatSidebarCommentMeta(comment),
        saveLabel: comment.mode === "edit" ? "Save" : "Add",
        placeholder: comment.mode === "append"
            ? "Add another entry to this thread."
            : "Write a side note. Use B or H for styling, or type @codex.",
    };
}

export function renderDraftCommentCard(
    commentsContainer: HTMLDivElement,
    comment: DraftComment,
    host: SidebarDraftCommentHost,
    draftEditorController: SidebarDraftEditorController,
): void {
    const presentation = buildDraftCommentPresentation(comment, host.activeCommentId);
    const commentEl = commentsContainer.createDiv(presentation.classes.join(" "));
    commentEl.setAttribute("data-draft-id", comment.id);
    commentEl.setAttribute("data-start-line", String(comment.startLine));

    const headerEl = commentEl.createDiv("sidenote2-comment-header");
    headerEl.createEl("small", {
        text: presentation.metaText,
        cls: "sidenote2-timestamp",
    });

    renderDraftEditor(commentEl, comment, presentation, host, draftEditorController, "card");
}

export function renderInlineEditDraftContent(
    container: HTMLElement,
    comment: DraftComment,
    host: SidebarDraftCommentHost,
    draftEditorController: SidebarDraftEditorController,
): void {
    const presentation = buildDraftCommentPresentation(comment, host.activeCommentId);
    renderDraftEditor(container, comment, presentation, host, draftEditorController, "inline-edit");
}

export function shouldRenderBookmarkDraftButton(comment: Pick<DraftComment, "mode" | "anchorKind">): boolean {
    return comment.mode !== "append" && !isPageComment(comment);
}

export function buildBookmarkDraftButtonPresentation(comment: Pick<DraftComment, "mode" | "isBookmark">): {
    ariaLabel: string;
    active: boolean;
} {
    if (comment.mode === "new") {
        if (comment.isBookmark === true) {
            return {
                ariaLabel: "Remove bookmark",
                active: true,
            };
        }

        return {
            ariaLabel: "Save as bookmark",
            active: false,
        };
    }

    if (comment.isBookmark === true) {
        return {
            ariaLabel: "Remove bookmark",
            active: true,
        };
    }

    return {
        ariaLabel: "Mark as bookmark",
        active: false,
    };
}

export function toggleBookmarkDraftState(isBookmark: boolean): boolean {
    return !isBookmark;
}

export function shouldAutoSaveBookmarkDraft(comment: Pick<DraftComment, "mode">, isBookmark: boolean): boolean {
    return comment.mode === "new" && isBookmark;
}

function createDraftFormatButton(
    container: HTMLElement,
    host: SidebarDraftCommentHost,
    options: {
        label?: string;
        icon?: string;
        ariaLabel: string;
    },
): HTMLButtonElement {
    const button = container.createEl("button", {
        cls: "sidenote2-inline-format-button",
    });
    button.setAttribute("type", "button");
    button.setAttribute("aria-label", options.ariaLabel);
    if (options.label) {
        button.setText(options.label);
    }
    if (options.icon) {
        button.addClass("is-icon-only");
        host.setIcon(button, options.icon);
    }
    return button;
}

function attachDraftActionButtonInteractions(
    button: HTMLButtonElement,
    host: SidebarDraftCommentHost,
): void {
    button.addEventListener("mousedown", (event: MouseEvent) => {
        host.claimSidebarInteractionOwnership();
        event.stopPropagation();
    });
}

function getSidebarScrollContainer(textarea: HTMLTextAreaElement): HTMLElement | null {
    const container = textarea.closest(".sidenote2-view-container");
    return container instanceof HTMLElement
        ? container
        : null;
}

export function computePinnedDraftScrollTop(
    currentScrollTop: number,
    draftTop: number,
    containerTop: number,
): number {
    return Math.max(
        0,
        currentScrollTop + (draftTop - containerTop) - 8,
    );
}

export function pinDraftToTopOnMobile(textarea: HTMLTextAreaElement): void {
    const draftEl = textarea.closest(".sidenote2-comment-draft");
    const scrollContainer = getSidebarScrollContainer(textarea);
    if (!(draftEl instanceof HTMLElement) || !scrollContainer) {
        return;
    }

    const draftRect = draftEl.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    const nextScrollTop = computePinnedDraftScrollTop(
        scrollContainer.scrollTop,
        draftRect.top,
        containerRect.top,
    );
    if (Math.abs(scrollContainer.scrollTop - nextScrollTop) < 2) {
        return;
    }
    scrollContainer.scrollTo({
        top: nextScrollTop,
        behavior: "auto",
    });
}

function renderDraftEditor(
    container: HTMLElement,
    comment: DraftComment,
    presentation: DraftCommentPresentation,
    host: SidebarDraftCommentHost,
    draftEditorController: SidebarDraftEditorController,
    layout: DraftEditorLayout,
): void {
    const editorWrap = container.createDiv([
        "sidenote2-inline-editor",
        layout === "inline-edit" ? "is-inline-edit" : "is-card-edit",
    ].join(" "));
    // Sidebar draft formatting is button-only for now. Keyboard shortcuts such as Cmd+B
    // and Option+H are unreliable in this editor surface, so keep the explicit controls.
    const toolbarRow = layout === "card"
        ? editorWrap.createDiv("sidenote2-inline-editor-toolbar")
        : null;
    const boldButton = toolbarRow
        ? createDraftFormatButton(toolbarRow, host, {
            label: "B",
            ariaLabel: "Bold",
        })
        : null;
    const highlightButton = toolbarRow
        ? createDraftFormatButton(toolbarRow, host, {
            label: "H",
            ariaLabel: "Highlight",
        })
        : null;
    const bookmarkButton = toolbarRow && shouldRenderBookmarkDraftButton(comment)
        ? (() => {
            const presentation = buildBookmarkDraftButtonPresentation(comment);
            const button = createDraftFormatButton(toolbarRow, host, {
                icon: "bookmark",
                ariaLabel: presentation.ariaLabel,
            });
            button.toggleClass("is-active", presentation.active);
            return button;
        })()
        : null;
    const editorShell = editorWrap.createDiv("sidenote2-inline-editor-shell");
    const preview = editorShell.createDiv("sidenote2-inline-editor-preview");
    const textarea = editorShell.createEl("textarea", {
        cls: "sidenote2-inline-textarea",
    });
    textarea.value = comment.comment;
    textarea.setAttribute("placeholder", presentation.placeholder);
    textarea.rows = estimateDraftTextareaRows(comment.comment, comment.mode === "edit");

    const syncPreview = () => {
        if (!textarea.value) {
            preview.empty();
            preview.addClass("is-empty");
            preview.setText(presentation.placeholder);
        } else {
            preview.removeClass("is-empty");
            preview.replaceChildren(renderStyledDraftCommentFragment(preview.ownerDocument, textarea.value));
        }

        preview.scrollTop = textarea.scrollTop;
        preview.scrollLeft = textarea.scrollLeft;
    };
    syncPreview();

    const actionRow = editorWrap.createDiv("sidenote2-inline-editor-actions");
    if (layout === "inline-edit") {
        actionRow.addClass("is-inline-edit");
    }
    const wordCountEl = actionRow.createDiv("sidenote2-inline-word-count");
    const inlineEditBoldButton = layout === "inline-edit"
        ? createDraftFormatButton(actionRow, host, {
            label: "B",
            ariaLabel: "Bold",
        })
        : null;
    const inlineEditHighlightButton = layout === "inline-edit"
        ? createDraftFormatButton(actionRow, host, {
            label: "H",
            ariaLabel: "Highlight",
        })
        : null;
    let isBookmark = comment.isBookmark === true;
    const syncBookmarkButtons = () => {
        const bookmarkPresentation = buildBookmarkDraftButtonPresentation({
            mode: comment.mode,
            isBookmark,
        });
        [bookmarkButton]
            .filter((button): button is HTMLButtonElement => !!button)
            .forEach((button) => {
                button.setAttribute("aria-label", bookmarkPresentation.ariaLabel);
                button.toggleClass("is-active", bookmarkPresentation.active);
            });
    };
    syncBookmarkButtons();
    const cancelButton = actionRow.createEl("button", {
        text: "Cancel",
        cls: "sidenote2-inline-cancel-button",
    });
    const saveButton = actionRow.createEl("button", {
        text: presentation.saveLabel,
        cls: "mod-cta sidenote2-inline-save-button",
    });
    [
        boldButton,
        highlightButton,
        bookmarkButton,
        inlineEditBoldButton,
        inlineEditHighlightButton,
        cancelButton,
        saveButton,
    ]
        .filter((button): button is HTMLButtonElement => !!button)
        .forEach((button) => attachDraftActionButtonInteractions(button, host));

    const saving = host.isSavingDraft(comment.id);
    const syncWordCount = () => {
        const wordCount = countCommentWords(textarea.value);
        wordCountEl.setText(`${wordCount}/${MAX_SIDENOTE_WORDS} words`);
        saveButton.disabled = saving || exceedsCommentWordLimit(textarea.value);
    };

    textarea.disabled = saving;
    if (boldButton) {
        boldButton.disabled = saving;
    }
    if (highlightButton) {
        highlightButton.disabled = saving;
    }
    if (bookmarkButton) {
        bookmarkButton.disabled = saving;
    }
    if (inlineEditBoldButton) {
        inlineEditBoldButton.disabled = saving;
    }
    if (inlineEditHighlightButton) {
        inlineEditHighlightButton.disabled = saving;
    }
    cancelButton.disabled = saving;
    saveButton.disabled = saving;
    syncWordCount();

    const stopPropagation = (event: Event) => {
        event.stopPropagation();
    };

    textarea.addEventListener("mousedown", stopPropagation);
    textarea.addEventListener("mouseup", stopPropagation);
    textarea.addEventListener("click", stopPropagation);
    textarea.addEventListener("dblclick", stopPropagation);
    if (host.shouldPinFocusedDraftToTop) {
        let viewportListenerAttached = false;
        const viewport = window.visualViewport ?? null;
        const pinFocusedDraft = () => {
            if (document.activeElement === textarea) {
                pinDraftToTopOnMobile(textarea);
            }
        };
        const attachViewportListener = () => {
            if (!viewport || viewportListenerAttached) {
                return;
            }

            viewport.addEventListener("resize", pinFocusedDraft);
            viewportListenerAttached = true;
        };
        const detachViewportListener = () => {
            if (!viewport || !viewportListenerAttached) {
                return;
            }

            viewport.removeEventListener("resize", pinFocusedDraft);
            viewportListenerAttached = false;
        };

        textarea.addEventListener("focus", () => {
            window.requestAnimationFrame(pinFocusedDraft);
            window.setTimeout(pinFocusedDraft, 120);
            window.setTimeout(pinFocusedDraft, 320);
            attachViewportListener();
        });
        textarea.addEventListener("blur", () => {
            detachViewportListener();
        });
    }
    textarea.addEventListener("input", (event) => {
        const target = event.target as HTMLTextAreaElement;
        host.updateDraftCommentText(comment.id, target.value);
        target.rows = estimateDraftTextareaRows(target.value, comment.mode === "edit");
        syncPreview();
        syncWordCount();

        if (!(event instanceof InputEvent) || event.inputType !== "insertText" || !event.data) {
            return;
        }

        if (
            event.data === "["
            && target.selectionStart >= 2
            && target.value.slice(target.selectionStart - 2, target.selectionStart) === "[["
        ) {
            draftEditorController.openDraftLinkSuggest(comment, target, comment.mode === "edit");
            return;
        }

        if (event.data === "#") {
            draftEditorController.openDraftTagSuggest(comment, target, comment.mode === "edit");
            return;
        }
    });
    textarea.addEventListener("keydown", (event: KeyboardEvent) => {
        const consumeShortcut = () => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        };

        event.stopPropagation();

        if (event.key === "Tab" && !event.shiftKey) {
            if (
                draftEditorController.openDraftLinkSuggest(comment, textarea, comment.mode === "edit")
                || draftEditorController.openDraftTagSuggest(comment, textarea, comment.mode === "edit")
            ) {
                consumeShortcut();
                return;
            }
        }
        if (event.key === "Escape") {
            event.preventDefault();
            host.cancelDraft(comment.id);
        }
    }, { capture: true });
    textarea.addEventListener("scroll", syncPreview);

    const applyBold = (event: Event) => {
        stopPropagation(event);
        draftEditorController.applyDraftBold(comment.id, textarea, comment.mode === "edit");
        textarea.focus();
    };
    const applyHighlight = (event: Event) => {
        stopPropagation(event);
        draftEditorController.applyDraftHighlight(comment.id, textarea, comment.mode === "edit");
        textarea.focus();
    };
    const applyBookmark = (event: Event) => {
        stopPropagation(event);
        isBookmark = toggleBookmarkDraftState(isBookmark);
        host.updateDraftCommentBookmarkState(comment.id, isBookmark);
        syncBookmarkButtons();
        if (shouldAutoSaveBookmarkDraft(comment, isBookmark)) {
            void host.saveDraft(comment.id, {
                skipPreSaveRefresh: true,
                skipAnchorRevalidation: true,
                deferAggregateRefresh: true,
                skipPersistedViewRefresh: true,
            });
            return;
        }
        textarea.focus();
    };
    boldButton?.addEventListener("click", applyBold);
    highlightButton?.addEventListener("click", applyHighlight);
    bookmarkButton?.addEventListener("click", applyBookmark);
    inlineEditBoldButton?.addEventListener("click", applyBold);
    inlineEditHighlightButton?.addEventListener("click", applyHighlight);
    cancelButton.onclick = (event) => {
        stopPropagation(event);
        host.cancelDraft(comment.id);
    };
    saveButton.onclick = (event) => {
        stopPropagation(event);
        void host.saveDraft(comment.id);
    };
}
