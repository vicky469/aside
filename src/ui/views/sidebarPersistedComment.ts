import type { Comment, CommentThread, CommentThreadEntry } from "../../commentManager";
import { getFirstThreadEntry, threadEntryToComment } from "../../commentManager";
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

export interface PersistedThreadEntryPresentation {
    classes: string[];
    metaText: string;
}

export interface SidebarPersistedCommentHost {
    activeCommentId: string | null;
    currentFilePath: string | null;
    showSourceRedirectAction: boolean;
    showChildComments: boolean;
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

function renderObsidianExternalLinkIcon(container: HTMLElement): void {
    container.innerHTML = `
        <svg
            xmlns="http://www.w3.org/2000/svg"
            class="svg-icon sidenote2-obsidian-external-link-icon"
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <path d="M14 9H3v20h20V18"></path>
            <path d="M18 4h10v10"></path>
            <path d="M28 4 14 18"></path>
        </svg>
    `;
}

export function buildPersistedCommentPresentation(
    thread: CommentThread,
    activeCommentId: string | null,
): PersistedCommentPresentation {
    const comment = threadEntryToComment(thread, getFirstThreadEntry(thread));
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

    return {
        classes,
        metaText: formatSidebarCommentMeta(comment),
        redirectHint: {
            ariaLabel: "Open source note",
            icon: "obsidian-external-link",
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

export function buildPersistedThreadEntryPresentation(
    thread: CommentThread,
    entry: CommentThreadEntry,
    activeCommentId: string | null,
): PersistedThreadEntryPresentation {
    const comment = threadEntryToComment(thread, entry);
    const classes = ["sidenote2-comment-item", "sidenote2-thread-item", "sidenote2-thread-entry-item"];

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

function getRenderableThreadEntries(thread: CommentThread): CommentThreadEntry[] {
    if (thread.entries.length > 0) {
        return thread.entries;
    }

    return [getFirstThreadEntry(thread)];
}

function attachSidebarCommentCardInteractions(
    commentEl: HTMLDivElement,
    contentWrapper: HTMLDivElement,
    comment: Comment,
    host: SidebarPersistedCommentHost,
): void {
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
}

function renderCommentMeta(
    headerEl: HTMLDivElement,
    comment: Comment,
    metaText: string,
    host: SidebarPersistedCommentHost,
): void {
    const metaEl = headerEl.createEl("small", {
        cls: "sidenote2-timestamp sidenote2-comment-meta",
    });

    if (host.showSourceRedirectAction) {
        const sourceLabelEl = metaEl.createSpan({
            cls: "sidenote2-comment-source-label",
            text: formatSidebarCommentSourceFileLabel(comment.filePath),
        });
        sourceLabelEl.setAttribute("title", comment.filePath);
    }

    metaEl.createSpan({
        cls: "sidenote2-comment-meta-value",
        text: metaText,
    });
}

function renderSourceRedirectButton(
    actionsEl: HTMLDivElement,
    comment: Comment,
    ariaLabel: string,
    icon: string,
    host: SidebarPersistedCommentHost,
): void {
    const redirectButton = actionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-redirect",
    });
    redirectButton.setAttribute("type", "button");
    redirectButton.setAttribute("aria-label", ariaLabel);
    if (icon === "obsidian-external-link") {
        renderObsidianExternalLinkIcon(redirectButton);
    } else {
        host.setIcon(redirectButton, icon);
    }
    redirectButton.onclick = (event) => {
        event.stopPropagation();
        void host.openCommentInEditor(comment);
    };
}

function renderEditButton(
    actionsEl: HTMLDivElement,
    commentId: string,
    host: SidebarPersistedCommentHost,
    ariaLabel: string,
): void {
    const editButton = actionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-edit",
    });
    editButton.setAttribute("type", "button");
    editButton.setAttribute("aria-label", ariaLabel);
    host.setIcon(editButton, "pencil");
    editButton.onclick = (event) => {
        event.stopPropagation();
        host.startEditDraft(commentId, host.currentFilePath);
    };
}

function renderDeleteButton(
    actionsEl: HTMLDivElement,
    commentId: string,
    host: SidebarPersistedCommentHost,
    ariaLabel: string,
): void {
    const deleteButton = actionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-delete",
    });
    deleteButton.setAttribute("type", "button");
    deleteButton.setAttribute("aria-label", ariaLabel);
    host.setIcon(deleteButton, "trash-2");
    deleteButton.onclick = (event) => {
        event.stopPropagation();
        host.deleteCommentWithConfirm(commentId);
    };
}

function renderThreadFooterActions(
    commentEl: HTMLDivElement,
    comment: Comment,
    host: SidebarPersistedCommentHost,
): void {
    const footerEl = commentEl.createDiv("sidenote2-thread-footer");
    const footerActionsEl = footerEl.createDiv("sidenote2-thread-footer-actions");
    if (host.showSourceRedirectAction) {
        renderSourceRedirectButton(footerActionsEl, comment, "Open source note", "obsidian-external-link", host);
    }

    const shareButton = footerActionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-share sidenote2-thread-share-button",
    });
    shareButton.setAttribute("type", "button");
    shareButton.setAttribute("aria-label", "Share side note");
    host.setIcon(shareButton, "share");
    shareButton.onclick = (event) => {
        event.stopPropagation();
        void host.shareComment(comment);
    };

    const addEntryButton = footerActionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-add-entry sidenote2-thread-add-entry-button",
    });
    addEntryButton.setAttribute("type", "button");
    addEntryButton.setAttribute("aria-label", "Add to thread");
    host.setIcon(addEntryButton, "plus");
    addEntryButton.onclick = (event) => {
        event.stopPropagation();
        host.startAppendEntryDraft(comment.id, host.currentFilePath);
    };
}

export async function renderPersistedCommentCard(
    commentsContainer: HTMLDivElement,
    thread: CommentThread,
    host: SidebarPersistedCommentHost,
): Promise<void> {
    const entries = getRenderableThreadEntries(thread);
    const showChildComments = host.showChildComments
        || entries.slice(1).some((entry) => entry.id === host.activeCommentId);
    const comment = threadEntryToComment(thread, entries[0]);
    const presentation = buildPersistedCommentPresentation(thread, host.activeCommentId);
    const threadEl = commentsContainer.createDiv("sidenote2-thread-stack");
    threadEl.setAttribute("data-thread-id", thread.id);
    if (entries.length > 1) {
        threadEl.addClass("has-thread-entries");
    }
    if (showChildComments && entries.length > 1) {
        threadEl.addClass("shows-thread-entries");
    }

    const commentEl = threadEl.createDiv(presentation.classes.join(" "));
    commentEl.setAttribute("data-comment-id", comment.id);
    commentEl.setAttribute("data-start-line", String(comment.startLine));

    const headerEl = commentEl.createDiv("sidenote2-comment-header");
    renderCommentMeta(headerEl, comment, presentation.metaText, host);

    const actionsEl = headerEl.createDiv("sidenote2-comment-actions");

    const contentWrapper = commentEl.createDiv("sidenote2-comment-content");
    contentWrapper.tabIndex = -1;
    attachSidebarCommentCardInteractions(commentEl, contentWrapper, comment, host);
    const renderTasks: Array<Promise<void>> = [
        renderThreadEntryContent(contentWrapper, thread, entries[0]?.body || "", host),
    ];

    const resolveButton = actionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-resolve",
    });
    resolveButton.setAttribute("type", "button");
    resolveButton.setAttribute("aria-label", presentation.resolveAction.ariaLabel);
    host.setIcon(resolveButton, presentation.resolveAction.icon);
    resolveButton.onclick = (event) => {
        event.stopPropagation();
        if (thread.resolved) {
            host.unresolveComment(thread.id);
        } else {
            host.resolveComment(thread.id);
        }
    };

    renderEditButton(actionsEl, comment.id, host, "Edit side note");
    renderDeleteButton(actionsEl, comment.id, host, "Delete side note thread");
    renderThreadFooterActions(commentEl, comment, host);

    if (!showChildComments) {
        await Promise.all(renderTasks);
        return;
    }

    const repliesEl = threadEl.createDiv("sidenote2-thread-replies");
    for (const entry of entries.slice(1)) {
        const entryComment = threadEntryToComment(thread, entry);
        const entryPresentation = buildPersistedThreadEntryPresentation(thread, entry, host.activeCommentId);
        const entryEl = repliesEl.createDiv(entryPresentation.classes.join(" "));
        entryEl.setAttribute("data-comment-id", entryComment.id);
        entryEl.setAttribute("data-start-line", String(entryComment.startLine));

        const entryHeaderEl = entryEl.createDiv("sidenote2-comment-header");
        renderCommentMeta(entryHeaderEl, entryComment, entryPresentation.metaText, host);
        const entryActionsEl = entryHeaderEl.createDiv("sidenote2-comment-actions");
        renderEditButton(entryActionsEl, entryComment.id, host, "Edit side note");
        renderDeleteButton(entryActionsEl, entryComment.id, host, "Delete side note entry");

        const entryContentEl = entryEl.createDiv("sidenote2-comment-content");
        entryContentEl.tabIndex = -1;
        attachSidebarCommentCardInteractions(entryEl, entryContentEl, entryComment, host);
        renderTasks.push(renderThreadEntryContent(entryContentEl, thread, entry.body || "", host));
        renderThreadFooterActions(entryEl, entryComment, host);
    }

    await Promise.all(renderTasks);
}
