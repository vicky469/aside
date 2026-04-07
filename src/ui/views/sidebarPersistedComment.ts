import type { Comment, CommentThread } from "../../commentManager";
import { threadToComment } from "../../commentManager";
import { isOrphanedComment, isPageComment } from "../../core/anchors/commentAnchors";
import { normalizeCommentMarkdownForRender } from "../editor/commentMarkdownRendering";
import { decorateRenderedCommentMentions } from "../editor/commentEditorStyling";
import { shouldActivateSidebarComment } from "./commentPointerAction";
import { formatSidebarCommentMeta } from "./sidebarCommentSections";

export interface PersistedCommentPresentation {
    classes: string[];
    metaText: string;
    redirectHint: {
        ariaLabel: string;
        icon: string;
    };
    shareAction: {
        ariaLabel: string;
        icon: string;
    };
    resolveAction: {
        ariaLabel: string;
        icon: string;
    };
}

export interface SidebarPersistedCommentHost {
    activeCommentId: string | null;
    currentFilePath: string | null;
    showSourceRedirectAction: boolean;
    getEventTargetElement(target: EventTarget | null): HTMLElement | null;
    isSelectionInsideSidebarContent(selection?: Selection | null): boolean;
    claimSidebarInteractionOwnership(focusTarget?: HTMLElement | null): void;
    renderMarkdown(markdown: string, container: HTMLElement, sourcePath: string): Promise<void>;
    openSidebarInternalLink(href: string, sourcePath: string, focusTarget: HTMLElement): Promise<void>;
    activateComment(comment: Comment): Promise<void>;
    openCommentInEditor(comment: Comment): Promise<void>;
    shareComment(comment: Comment): Promise<void>;
    resolveComment(commentId: string): void;
    unresolveComment(commentId: string): void;
    startEditDraft(commentId: string, hostFilePath: string | null): void;
    startAppendEntryDraft(commentId: string, hostFilePath: string | null): void;
    deleteCommentWithConfirm(commentId: string): void;
    setIcon(element: HTMLElement, icon: string): void;
}

export function formatSidebarCommentSourceFileLabel(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
    return fileName.replace(/\.md$/i, "");
}

export function buildPersistedCommentPresentation(
    thread: CommentThread,
    activeCommentId: string | null,
): PersistedCommentPresentation {
    const comment = threadToComment(thread);
    const classes = ["sidenote2-comment-item", "sidenote2-thread-item"];
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

    const metaSegments = [formatSidebarCommentMeta(comment)];
    if (thread.entries.length > 1) {
        metaSegments.push(`${thread.entries.length} notes`);
    }

    return {
        classes,
        metaText: metaSegments.join(" · "),
        redirectHint: {
            ariaLabel: "Open source note",
            icon: "arrow-up-right",
        },
        shareAction: {
            ariaLabel: "Share side note",
            icon: "share",
        },
        resolveAction: {
            ariaLabel: comment.resolved ? "Reopen side note" : "Resolve side note",
            icon: comment.resolved ? "rotate-ccw" : "check",
        },
    };
}

async function renderThreadEntryContent(
    container: HTMLElement,
    thread: CommentThread,
    entryBody: string,
    host: SidebarPersistedCommentHost,
): Promise<void> {
    await host.renderMarkdown(
        normalizeCommentMarkdownForRender(entryBody),
        container as HTMLElement,
        thread.filePath,
    );
    decorateRenderedCommentMentions(container as HTMLElement);
}

export async function renderPersistedCommentCard(
    commentsContainer: HTMLDivElement,
    thread: CommentThread,
    host: SidebarPersistedCommentHost,
): Promise<void> {
    const comment = threadToComment(thread);
    const presentation = buildPersistedCommentPresentation(thread, host.activeCommentId);
    const commentEl = commentsContainer.createDiv(presentation.classes.join(" "));
    commentEl.setAttribute("data-comment-id", comment.id);
    commentEl.setAttribute("data-start-line", String(comment.startLine));

    const headerEl = commentEl.createDiv("sidenote2-comment-header");
    const metaEl = headerEl.createEl("small", {
        cls: "sidenote2-timestamp sidenote2-comment-meta",
    });

    if (host.showSourceRedirectAction) {
        const sourceLabelEl = metaEl.createSpan({
            cls: "sidenote2-comment-source-label",
            text: formatSidebarCommentSourceFileLabel(comment.filePath),
        });
        sourceLabelEl.setAttribute("title", comment.filePath);

        metaEl.createSpan({
            cls: "sidenote2-comment-meta-separator",
            text: "·",
        });
    }

    metaEl.createSpan({
        cls: "sidenote2-comment-meta-value",
        text: presentation.metaText,
    });

    const actionsEl = headerEl.createDiv("sidenote2-comment-actions");

    if (host.showSourceRedirectAction) {
        const redirectButton = actionsEl.createEl("button", {
            cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-redirect",
        });
        redirectButton.setAttribute("type", "button");
        redirectButton.setAttribute("aria-label", presentation.redirectHint.ariaLabel);
        host.setIcon(redirectButton, presentation.redirectHint.icon);
        redirectButton.onclick = (event) => {
            event.stopPropagation();
            void host.openCommentInEditor(comment);
        };
    }

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

        void host.activateComment(comment);
    });

    const contentWrapper = commentEl.createDiv({ cls: "sidenote2-comment-content sidenote2-thread-content" });
    contentWrapper.tabIndex = -1;

    for (const entry of thread.entries) {
        const entryEl = contentWrapper.createDiv("sidenote2-thread-entry");
        const entryBodyEl = entryEl.createDiv("sidenote2-thread-entry-body");
        await renderThreadEntryContent(entryBodyEl, thread, entry.body || "", host);
    }

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
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-resolve",
    });
    resolveButton.setAttribute("type", "button");
    resolveButton.setAttribute("aria-label", presentation.resolveAction.ariaLabel);
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
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-edit",
    });
    editButton.setAttribute("type", "button");
    editButton.setAttribute("aria-label", "Edit latest side note entry");
    host.setIcon(editButton, "pencil");
    editButton.onclick = (event) => {
        event.stopPropagation();
        host.startEditDraft(comment.id, host.currentFilePath);
    };

    const deleteButton = actionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-delete",
    });
    deleteButton.setAttribute("type", "button");
    deleteButton.setAttribute("aria-label", "Delete side note thread");
    host.setIcon(deleteButton, "trash-2");
    deleteButton.onclick = (event) => {
        event.stopPropagation();
        host.deleteCommentWithConfirm(comment.id);
    };

    const footerEl = commentEl.createDiv("sidenote2-thread-footer");
    const shareButton = footerEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-share sidenote2-thread-share-button",
    });
    shareButton.setAttribute("type", "button");
    shareButton.setAttribute("aria-label", presentation.shareAction.ariaLabel);
    host.setIcon(shareButton, presentation.shareAction.icon);
    shareButton.onclick = (event) => {
        event.stopPropagation();
        void host.shareComment(comment);
    };

    const addEntryButton = footerEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-add-entry sidenote2-thread-add-entry-button",
    });
    addEntryButton.setAttribute("type", "button");
    addEntryButton.setAttribute("aria-label", "Add to thread");
    host.setIcon(addEntryButton, "plus");
    addEntryButton.onclick = (event) => {
        event.stopPropagation();
        host.startAppendEntryDraft(thread.id, host.currentFilePath);
    };
}
