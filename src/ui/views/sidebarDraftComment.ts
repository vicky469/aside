import { isOrphanedComment, isPageComment } from "../../core/anchors/commentAnchors";
import type { DraftComment } from "../../domain/drafts";
import { renderStyledDraftCommentHtml } from "../editor/commentEditorStyling";
import { formatSidebarCommentMeta } from "./sidebarCommentSections";
import type { SidebarDraftEditorController } from "./sidebarDraftEditor";
import { estimateDraftTextareaRows } from "./sidebarDraftEditor";

export interface DraftCommentPresentation {
    classes: string[];
    metaText: string;
    saveLabel: string;
}

export interface SidebarDraftCommentHost {
    activeCommentId: string | null;
    isSavingDraft(commentId: string): boolean;
    updateDraftCommentText(commentId: string, commentText: string): void;
    saveDraft(commentId: string): void;
    cancelDraft(commentId: string): void;
}

export function buildDraftCommentPresentation(
    comment: DraftComment,
    activeCommentId: string | null,
): DraftCommentPresentation {
    const classes = ["sidenote2-comment-item", "sidenote2-comment-draft", comment.mode === "edit" ? "is-edit" : "is-new"];
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
        saveLabel: comment.mode === "new" ? "Add" : "Save",
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

    const editorWrap = commentEl.createDiv("sidenote2-inline-editor");
    // Sidebar draft formatting is button-only for now. Keyboard shortcuts such as Cmd+B
    // and Option+H are unreliable in this editor surface, so keep the explicit controls.
    const formatRow = editorWrap.createDiv("sidenote2-inline-editor-toolbar");
    const boldButton = formatRow.createEl("button", {
        text: "B",
        cls: "sidenote2-inline-format-button",
    });
    boldButton.setAttribute("type", "button");
    boldButton.setAttribute("aria-label", "Bold");
    boldButton.setAttribute("title", "Wrap selection with **bold**");
    const highlightButton = formatRow.createEl("button", {
        text: "H",
        cls: "sidenote2-inline-format-button",
    });
    highlightButton.setAttribute("type", "button");
    highlightButton.setAttribute("aria-label", "Highlight");
    highlightButton.setAttribute("title", "Wrap selection with ==highlight==");
    const editorShell = editorWrap.createDiv("sidenote2-inline-editor-shell");
    const preview = editorShell.createDiv("sidenote2-inline-editor-preview");
    const textarea = editorShell.createEl("textarea", {
        cls: "sidenote2-inline-textarea",
    });
    textarea.value = comment.comment;
    textarea.setAttribute("placeholder", "Write a side note. Use B or H for styling, or type @name.");
    textarea.setAttribute("aria-label", "Side note draft");
    textarea.rows = estimateDraftTextareaRows(comment.comment, comment.mode === "edit");

    const syncPreview = () => {
        if (!textarea.value) {
            preview.empty();
            preview.addClass("is-empty");
            preview.setText("Write a side note. Use B or H for styling, or type @name.");
        } else {
            preview.removeClass("is-empty");
            preview.innerHTML = renderStyledDraftCommentHtml(textarea.value);
        }

        preview.scrollTop = textarea.scrollTop;
        preview.scrollLeft = textarea.scrollLeft;
    };
    syncPreview();

    const actionRow = editorWrap.createDiv("sidenote2-inline-editor-actions");
    const cancelButton = actionRow.createEl("button", {
        text: "Cancel",
        cls: "sidenote2-inline-cancel-button",
    });
    const saveButton = actionRow.createEl("button", {
        text: presentation.saveLabel,
        cls: "mod-cta sidenote2-inline-save-button",
    });
    saveButton.setAttribute("title", "Save");

    const saving = host.isSavingDraft(comment.id);
    textarea.disabled = saving;
    boldButton.disabled = saving;
    highlightButton.disabled = saving;
    cancelButton.disabled = saving;
    saveButton.disabled = saving;

    const stopPropagation = (event: Event) => {
        event.stopPropagation();
    };

    textarea.addEventListener("click", stopPropagation);
    textarea.addEventListener("input", (event) => {
        const target = event.target as HTMLTextAreaElement;
        host.updateDraftCommentText(comment.id, target.value);
        target.rows = estimateDraftTextareaRows(target.value, comment.mode === "edit");
        syncPreview();

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

    boldButton.onclick = (event) => {
        stopPropagation(event);
        draftEditorController.applyDraftBold(comment.id, textarea, comment.mode === "edit");
        textarea.focus();
    };
    highlightButton.onclick = (event) => {
        stopPropagation(event);
        draftEditorController.applyDraftHighlight(comment.id, textarea, comment.mode === "edit");
        textarea.focus();
    };
    cancelButton.onclick = (event) => {
        stopPropagation(event);
        host.cancelDraft(comment.id);
    };
    saveButton.onclick = (event) => {
        stopPropagation(event);
        host.saveDraft(comment.id);
    };
}
