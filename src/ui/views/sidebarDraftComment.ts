import { isOrphanedComment, isPageComment } from "../../core/anchors/commentAnchors";
import { MAX_SIDENOTE_WORDS, countCommentWords, exceedsCommentWordLimit } from "../../core/text/commentWordLimit";
import { canSaveDraftWithoutComment, type DraftComment } from "../../domain/drafts";
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

export function isDraftSaveActionDisabled(
    comment: Pick<DraftComment, "mode" | "anchorKind">,
    commentText: string,
): boolean {
    const allowEmptyComment = comment.mode === "edit" || canSaveDraftWithoutComment(comment);
    return exceedsCommentWordLimit(commentText)
        || (commentText.trim().length === 0 && !allowEmptyComment);
}

export function buildDraftCommentPresentation(
    comment: DraftComment,
    activeCommentId: string | null,
): DraftCommentPresentation {
    const classes = [
        "aside-comment-item",
        "aside-comment-draft",
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

    const headerEl = commentEl.createDiv("aside-comment-header");
    headerEl.createEl("small", {
        text: presentation.metaText,
        cls: "aside-timestamp",
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
        cls: "aside-inline-format-button",
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
    const container = textarea.closest(".aside-view-container");
    return container instanceof HTMLElement
        ? container
        : null;
}

export function computePinnedDraftScrollTop(
    currentScrollTop: number,
    draftTop: number,
    draftBottom: number,
    containerTop: number,
    containerBottom: number,
    bottomObstructionTop?: number,
): number {
    const visibleTop = containerTop + 8;
    const visibleBottom = Math.min(
        containerBottom - 8,
        bottomObstructionTop === undefined ? Number.POSITIVE_INFINITY : bottomObstructionTop - 8,
    );
    if (draftTop < visibleTop) {
        return Math.max(0, currentScrollTop + draftTop - visibleTop);
    }
    if (draftBottom > visibleBottom) {
        return Math.max(0, currentScrollTop + draftBottom - visibleBottom);
    }
    return currentScrollTop;
}

function getDraftBottomObstructionTop(scrollContainer: HTMLElement, containerRect: DOMRect): number | undefined {
    const supportSlot = scrollContainer.querySelector?.(".aside-support-button-slot");
    if (!(supportSlot instanceof HTMLElement)) {
        return undefined;
    }
    const supportRect = supportSlot.getBoundingClientRect();
    if (supportRect.bottom <= containerRect.top || supportRect.top >= containerRect.bottom) {
        return undefined;
    }
    return supportRect.top;
}

export function pinDraftToTopOnMobile(textarea: HTMLTextAreaElement): void {
    const draftEl = textarea.closest(".aside-comment-draft");
    const scrollContainer = getSidebarScrollContainer(textarea);
    if (!(draftEl instanceof HTMLElement) || !scrollContainer) {
        return;
    }

    const draftRect = draftEl.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    const nextScrollTop = computePinnedDraftScrollTop(
        scrollContainer.scrollTop,
        draftRect.top,
        draftRect.bottom,
        containerRect.top,
        containerRect.bottom,
        getDraftBottomObstructionTop(scrollContainer, containerRect),
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
        "aside-inline-editor",
        layout === "inline-edit" ? "is-inline-edit" : "is-card-edit",
    ].join(" "));
    // Sidebar draft formatting is button-only for now. Keyboard shortcuts such as Cmd+B
    // and Option+H are unreliable in this editor surface, so keep the explicit controls.
    const toolbarRow = layout === "card"
        ? editorWrap.createDiv("aside-inline-editor-toolbar")
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
    const editorShell = editorWrap.createDiv("aside-inline-editor-shell");
    const preview = editorShell.createDiv("aside-inline-editor-preview");
    const textarea = editorShell.createEl("textarea", {
        cls: "aside-inline-textarea",
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

    const actionRow = editorWrap.createDiv("aside-inline-editor-actions");
    if (layout === "inline-edit") {
        actionRow.addClass("is-inline-edit");
    }
    const wordCountEl = actionRow.createDiv("aside-inline-word-count");
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
    const cancelButton = actionRow.createEl("button", {
        text: "Cancel",
        cls: "aside-inline-cancel-button",
    });
    const saveButton = actionRow.createEl("button", {
        text: presentation.saveLabel,
        cls: "mod-cta aside-inline-save-button",
    });
    [
        boldButton,
        highlightButton,
        inlineEditBoldButton,
        inlineEditHighlightButton,
        cancelButton,
        saveButton,
    ]
        .filter((button): button is HTMLButtonElement => !!button)
        .forEach((button) => attachDraftActionButtonInteractions(button, host));

    let savePending = host.isSavingDraft(comment.id);
    const syncActionState = () => {
        const wordCount = countCommentWords(textarea.value);
        wordCountEl.setText(`${wordCount}/${MAX_SIDENOTE_WORDS} words`);
        saveButton.disabled = isDraftSaveActionDisabled(comment, textarea.value);
    };

    syncActionState();

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
        syncActionState();

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
    boldButton?.addEventListener("click", applyBold);
    highlightButton?.addEventListener("click", applyHighlight);
    inlineEditBoldButton?.addEventListener("click", applyBold);
    inlineEditHighlightButton?.addEventListener("click", applyHighlight);
    cancelButton.onclick = (event) => {
        stopPropagation(event);
        host.cancelDraft(comment.id);
    };
    saveButton.onclick = (event) => {
        stopPropagation(event);
        if (savePending) {
            return;
        }
        savePending = true;
        void (async () => {
            try {
                await host.saveDraft(comment.id);
            } finally {
                savePending = false;
            }
        })();
    };
}
