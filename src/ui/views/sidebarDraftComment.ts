import { isOrphanedComment, isPageComment } from "../../core/anchors/commentAnchors";
import type { DraftComment } from "../../domain/drafts";
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
    const textarea = editorWrap.createEl("textarea", {
        cls: "sidenote2-inline-textarea",
    });
    textarea.value = comment.comment;
    textarea.setAttribute("placeholder", "Write a side note. Type [[ for links or # for tags.");
    textarea.rows = estimateDraftTextareaRows(comment.comment, comment.mode === "edit");

    const actionRow = editorWrap.createDiv("sidenote2-inline-editor-actions");
    const cancelButton = actionRow.createEl("button", {
        text: "Cancel",
        cls: "sidenote2-inline-cancel-button",
    });
    const saveButton = actionRow.createEl("button", {
        text: presentation.saveLabel,
        cls: "mod-cta sidenote2-inline-save-button",
    });
    saveButton.setAttribute("title", "Save (Enter; Shift+Enter for newline)");

    const saving = host.isSavingDraft(comment.id);
    textarea.disabled = saving;
    cancelButton.disabled = saving;
    saveButton.disabled = saving;

    const stopPropagation = (event: Event) => {
        event.stopPropagation();
    };

    textarea.addEventListener("click", stopPropagation);
    textarea.addEventListener("focus", () => {
        void draftEditorController.refreshFormattingHotkeys();
    });
    textarea.addEventListener("input", (event) => {
        const target = event.target as HTMLTextAreaElement;
        host.updateDraftCommentText(comment.id, target.value);
        target.rows = estimateDraftTextareaRows(target.value, comment.mode === "edit");

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

        if (draftEditorController.toggleDraftHighlight(event, comment.id, textarea, comment.mode === "edit")) {
            consumeShortcut();
            return;
        }

        if (draftEditorController.shouldSaveDraftFromEnter(event)) {
            consumeShortcut();
            host.saveDraft(comment.id);
            return;
        }

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

    cancelButton.onclick = (event) => {
        stopPropagation(event);
        host.cancelDraft(comment.id);
    };
    saveButton.onclick = (event) => {
        stopPropagation(event);
        host.saveDraft(comment.id);
    };
}
