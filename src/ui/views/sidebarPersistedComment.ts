import type { Comment } from "../../commentManager";
import { isOrphanedComment, isPageComment } from "../../core/anchors/commentAnchors";
import { normalizeCommentMarkdownForRender } from "../editor/commentMarkdownRendering";
import { decorateRenderedCommentMentions } from "../editor/commentEditorStyling";
import { shouldActivateSidebarComment } from "./commentPointerAction";
import { formatSidebarCommentMeta } from "./sidebarCommentSections";

export interface PersistedCommentPresentation {
    classes: string[];
    metaText: string;
    resolveAction: {
        ariaLabel: string;
        title: string;
        icon: string;
    };
}

export interface SidebarPersistedCommentHost {
    activeCommentId: string | null;
    currentFilePath: string | null;
    getEventTargetElement(target: EventTarget | null): HTMLElement | null;
    isSelectionInsideSidebarContent(selection?: Selection | null): boolean;
    claimSidebarInteractionOwnership(focusTarget?: HTMLElement | null): void;
    renderMarkdown(markdown: string, container: HTMLElement, sourcePath: string): Promise<void>;
    openSidebarInternalLink(href: string, sourcePath: string, focusTarget: HTMLElement): Promise<void>;
    openCommentInEditor(comment: Comment): Promise<void>;
    resolveComment(commentId: string): void;
    unresolveComment(commentId: string): void;
    startEditDraft(commentId: string, hostFilePath: string | null): void;
    deleteCommentWithConfirm(commentId: string): void;
    setIcon(element: HTMLElement, icon: string): void;
}

export function buildPersistedCommentPresentation(
    comment: Comment,
    activeCommentId: string | null,
): PersistedCommentPresentation {
    const classes = ["sidenote2-comment-item"];
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
        resolveAction: {
            ariaLabel: comment.resolved ? "Reopen side note" : "Resolve side note",
            title: comment.resolved ? "Reopen side note" : "Resolve side note",
            icon: comment.resolved ? "rotate-ccw" : "check",
        },
    };
}

export async function renderPersistedCommentCard(
    commentsContainer: HTMLDivElement,
    comment: Comment,
    host: SidebarPersistedCommentHost,
): Promise<void> {
    const presentation = buildPersistedCommentPresentation(comment, host.activeCommentId);
    const commentEl = commentsContainer.createDiv(presentation.classes.join(" "));
    commentEl.setAttribute("data-comment-id", comment.id);
    commentEl.setAttribute("data-start-line", String(comment.startLine));

    const headerEl = commentEl.createDiv("sidenote2-comment-header");
    headerEl.createEl("small", {
        text: presentation.metaText,
        cls: "sidenote2-timestamp",
    });

    const actionsEl = headerEl.createDiv("sidenote2-comment-actions");

    commentEl.addEventListener("click", (event: MouseEvent) => {
        const target = host.getEventTargetElement(event.target);
        const selection = window.getSelection();
        if (!shouldActivateSidebarComment({
            clickedInteractiveElement: !!target?.closest("button, a"),
            clickedInsideCommentContent: !!target?.closest(".sidenote2-comment-content"),
            selection,
            selectionInsideSidebarCommentContent: host.isSelectionInsideSidebarContent(selection),
        })) {
            return;
        }

        void host.openCommentInEditor(comment);
    });

    const contentWrapper = commentEl.createDiv({ cls: "sidenote2-comment-content" });
    contentWrapper.tabIndex = -1;
    await host.renderMarkdown(
        normalizeCommentMarkdownForRender(comment.comment || ""),
        contentWrapper,
        comment.filePath,
    );
    decorateRenderedCommentMentions(contentWrapper);

    const focusContentWrapper = () => {
        host.claimSidebarInteractionOwnership(contentWrapper);
    };
    const stopContentPointerPropagation = (event: MouseEvent) => {
        focusContentWrapper();
        event.stopPropagation();
    };

    contentWrapper.addEventListener("mousedown", stopContentPointerPropagation);
    contentWrapper.addEventListener("mouseup", stopContentPointerPropagation);
    contentWrapper.addEventListener("dblclick", stopContentPointerPropagation);
    contentWrapper.addEventListener("click", (event: MouseEvent) => {
        const target = host.getEventTargetElement(event.target);
        const link = target?.closest("a") as HTMLAnchorElement | null;

        focusContentWrapper();
        event.stopPropagation();
        if (!link) {
            return;
        }

        if (link.classList.contains("internal-link")) {
            event.preventDefault();
            const href = link.getAttribute("href") || link.getAttribute("data-href") || link.innerText;
            if (href) {
                void host.openSidebarInternalLink(href, comment.filePath, contentWrapper);
            }
        }
    });

    const resolveButton = actionsEl.createEl("button", {
        cls: "sidenote2-comment-action-button sidenote2-comment-action-resolve",
    });
    resolveButton.setAttribute("type", "button");
    resolveButton.setAttribute("aria-label", presentation.resolveAction.ariaLabel);
    resolveButton.setAttribute("title", presentation.resolveAction.title);
    host.setIcon(resolveButton, presentation.resolveAction.icon);
    resolveButton.onclick = (event) => {
        event.stopPropagation();
        if (comment.resolved) {
            host.unresolveComment(comment.id);
        } else {
            host.resolveComment(comment.id);
        }
    };

    const editButton = actionsEl.createEl("button", {
        cls: "sidenote2-comment-action-button sidenote2-comment-action-edit",
    });
    editButton.setAttribute("type", "button");
    editButton.setAttribute("aria-label", "Edit side note");
    editButton.setAttribute("title", "Edit side note");
    host.setIcon(editButton, "pencil");
    editButton.onclick = (event) => {
        event.stopPropagation();
        host.startEditDraft(comment.id, host.currentFilePath);
    };

    const deleteButton = actionsEl.createEl("button", {
        cls: "sidenote2-comment-action-button sidenote2-comment-action-delete",
    });
    deleteButton.setAttribute("type", "button");
    deleteButton.setAttribute("aria-label", "Delete side note");
    deleteButton.setAttribute("title", "Delete side note");
    host.setIcon(deleteButton, "trash-2");
    deleteButton.onclick = (event) => {
        event.stopPropagation();
        host.deleteCommentWithConfirm(comment.id);
    };
}
