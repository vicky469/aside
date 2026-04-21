import type { Comment, CommentThread, CommentThreadEntry } from "../../commentManager";
import { getFirstThreadEntry, threadEntryToComment } from "../../commentManager";
import { isOrphanedComment, isPageComment } from "../../core/anchors/commentAnchors";
import { getAgentActorLabel } from "../../core/agents/agentActorRegistry";
import { getAgentRunByOutputEntryId, type AgentRunRecord, type AgentRunStreamState } from "../../core/agents/agentRuns";
import type { SideNote2AgentTarget } from "../../core/config/agentTargets";
import type { DraftComment } from "../../domain/drafts";
import { normalizeCommentMarkdownForRender } from "../editor/commentMarkdownRendering";
import { decorateRenderedCommentMentions } from "../editor/commentEditorStyling";
import { SIDE_NOTE2_REGENERATE_ICON_ID } from "../sideNote2Icon";
import {
    isSidebarCommentOpenBlockingTarget,
    shouldRefocusSidebarCommentContent,
    shouldActivateSidebarComment,
    shouldOpenSidebarCommentOnDoubleClick,
} from "./commentPointerAction";
import {
    formatSidebarCommentMeta,
    formatSidebarCommentSelectedTextPreview,
} from "./sidebarCommentSections";

interface BasePersistedCommentPresentation {
    classes: string[];
    metaText: string;
    metaPreviewText: string | null;
}

export interface PersistedCommentPresentation extends BasePersistedCommentPresentation {
    reanchorAction: {
        label: string;
    } | null;
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

export type PersistedThreadEntryPresentation = BasePersistedCommentPresentation;

export interface SidebarCommentAuthorPresentation {
    kind: "user" | SideNote2AgentTarget;
    label: string;
}

export interface SidebarPersistedCommentHost {
    activeCommentId: string | null;
    currentFilePath: string | null;
    currentUserLabel: string;
    showSourceRedirectAction: boolean;
    showDeletedComments: boolean;
    enablePageThreadReorder: boolean;
    enableSoftDeleteActions: boolean;
    showNestedComments: boolean;
    editDraftComment: DraftComment | null;
    appendDraftComment: DraftComment | null;
    agentRun: AgentRunRecord | null;
    agentStream: AgentRunStreamState | null;
    threadAgentRuns: AgentRunRecord[];
    getEventTargetElement(target: EventTarget | null): HTMLElement | null;
    isSelectionInsideSidebarContent(selection?: Selection | null): boolean;
    claimSidebarInteractionOwnership(focusTarget?: HTMLElement | null): void;
    renderMarkdown(markdown: string, container: HTMLElement, sourcePath: string): Promise<void>;
    openSidebarInternalLink(href: string, sourcePath: string, focusTarget: HTMLElement): Promise<void>;
    activateComment(comment: Comment): Promise<void>;
    openCommentFromCard(comment: Comment): Promise<void>;
    openCommentInEditor(comment: Comment): Promise<void>;
    shareComment(comment: Comment): Promise<void>;
    saveVisibleDraftIfPresent(): Promise<boolean>;
    setShowNestedCommentsForThread(threadId: string, showNestedComments: boolean): void;
    resolveComment(commentId: string): void;
    unresolveComment(commentId: string): void;
    restoreComment(commentId: string): Promise<void> | void;
    startEditDraft(commentId: string, hostFilePath: string | null): void;
    startAppendEntryDraft(commentId: string, hostFilePath: string | null): void;
    retryAgentRun(runId: string): void;
    reanchorCommentThreadToCurrentSelection(commentId: string): void;
    deleteCommentWithConfirm(commentId: string): Promise<void> | void;
    renderAppendDraft(container: HTMLDivElement, comment: DraftComment): void;
    renderInlineEditDraft(container: HTMLDivElement, comment: DraftComment): void;
    setIcon(element: HTMLElement, icon: string): void;
}

export interface AgentRunStatusPresentation {
    marker: string | null;
    markerKind: "text" | "spinner";
}

export function getAgentRunStatusPresentation(status: AgentRunRecord["status"]): AgentRunStatusPresentation {
    switch (status) {
        case "queued":
            return { marker: "…", markerKind: "text" };
        case "running":
            return { marker: null, markerKind: "spinner" };
        case "failed":
            return { marker: "✕", markerKind: "text" };
        case "succeeded":
            return { marker: "✓", markerKind: "text" };
        case "cancelled":
            return { marker: "–", markerKind: "text" };
        default:
            return { marker: "?", markerKind: "text" };
    }
}

function getAgentLabel(target: AgentRunRecord["requestedAgent"]): string {
    return getAgentActorLabel(target);
}

function buildSidebarCommentAuthorPresentation(
    currentUserLabel: string,
    run: AgentRunRecord | null,
): SidebarCommentAuthorPresentation {
    if (!run) {
        return {
            kind: "user",
            label: currentUserLabel,
        };
    }

    return {
        kind: run.requestedAgent,
        label: getAgentLabel(run.requestedAgent),
    };
}

function renderAgentRunStatus(
    metaEl: HTMLElement,
    run: AgentRunRecord,
): void {
    const presentation = getAgentRunStatusPresentation(run.status);
    const statusEl = metaEl.createSpan({
        cls: `sidenote2-agent-run-status is-${run.status}`,
    });
    const markEl = statusEl.createSpan({
        cls: `sidenote2-agent-run-status-mark is-${presentation.markerKind}`,
    });
    if (presentation.marker) {
        markEl.setText(presentation.marker);
    } else {
        markEl.setAttribute("aria-hidden", "true");
    }
    const agentLabel = getAgentLabel(run.requestedAgent);
    statusEl.setAttribute("aria-label", `${agentLabel} ${run.status}`);
    if (run.error) {
        statusEl.setAttribute("title", run.error);
    }
}

export function formatSidebarCommentSourceFileLabel(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
    return fileName.replace(/\.md$/i, "");
}

export function formatSidebarCommentIndexLeadLabel(comment: Pick<Comment, "anchorKind" | "selectedText" | "filePath">): string {
    return formatSidebarCommentSourceFileLabel(comment.filePath);
}

function renderObsidianExternalLinkIcon(container: HTMLElement): void {
    const svgNamespace = "http://www.w3.org/2000/svg";
    const svgEl = document.createElementNS(svgNamespace, "svg");
    svgEl.setAttribute("xmlns", svgNamespace);
    svgEl.setAttribute("class", "svg-icon sidenote2-obsidian-external-link-icon");
    svgEl.setAttribute("viewBox", "0 0 32 32");
    svgEl.setAttribute("fill", "none");
    svgEl.setAttribute("stroke", "currentColor");
    svgEl.setAttribute("stroke-width", "3");
    svgEl.setAttribute("stroke-linecap", "round");
    svgEl.setAttribute("stroke-linejoin", "round");
    svgEl.setAttribute("aria-hidden", "true");

    const paths = [
        "M14 9H3v20h20V18",
        "M18 4h10v10",
        "M28 4 14 18",
    ];
    for (const d of paths) {
        const pathEl = document.createElementNS(svgNamespace, "path");
        pathEl.setAttribute("d", d);
        svgEl.appendChild(pathEl);
    }

    container.replaceChildren(svgEl);
}

function buildBasePersistedCommentPresentation(
    comment: Comment,
    activeCommentId: string | null,
    extraClasses: string[] = [],
): BasePersistedCommentPresentation {
    const classes = ["sidenote2-comment-item", "sidenote2-thread-item", ...extraClasses];
    if (isPageComment(comment)) {
        classes.push("page-note");
    }
    if (comment.isBookmark === true) {
        classes.push("bookmark");
    }
    if (isOrphanedComment(comment)) {
        classes.push("orphaned");
    }
    if (comment.resolved) {
        classes.push("resolved");
    }
    if (comment.deletedAt) {
        classes.push("deleted");
    }
    if (activeCommentId === comment.id) {
        classes.push("active");
    }

    return {
        classes,
        metaText: formatSidebarCommentMeta(comment),
        metaPreviewText: formatSidebarCommentSelectedTextPreview(comment),
    };
}

export function buildPersistedCommentPresentation(
    thread: CommentThread,
    activeCommentId: string | null,
): PersistedCommentPresentation {
    const comment = threadEntryToComment(thread, getFirstThreadEntry(thread));
    const basePresentation = buildBasePersistedCommentPresentation(comment, activeCommentId);

    return {
        ...basePresentation,
        reanchorAction: isOrphanedComment(comment) && !isPageComment(comment)
            ? {
                label: "Re-anchor to current selection",
            }
            : null,
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

export function resolveSidebarCommentAuthor(
    commentId: string,
    threadAgentRuns: readonly AgentRunRecord[],
    currentUserLabel: string,
): SidebarCommentAuthorPresentation {
    return buildSidebarCommentAuthorPresentation(
        currentUserLabel,
        getAgentRunByOutputEntryId(threadAgentRuns, commentId),
    );
}

export function buildPersistedThreadEntryPresentation(
    thread: CommentThread,
    entry: CommentThreadEntry,
    activeCommentId: string | null,
): PersistedThreadEntryPresentation {
    const comment = threadEntryToComment(thread, entry);
    const presentation = buildBasePersistedCommentPresentation(comment, activeCommentId, [
        "sidenote2-thread-entry-item",
    ]);
    return {
        ...presentation,
        metaPreviewText: null,
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
        container,
        thread.filePath,
    );
    decorateRenderedCommentMentions(container);
}

export function getRenderableThreadEntries(
    thread: CommentThread,
    _agentStream: AgentRunStreamState | null = null,
): CommentThreadEntry[] {
    return thread.entries.length > 0
        ? thread.entries
        : [getFirstThreadEntry(thread)];
}

function isActiveCommentInThread(thread: CommentThread, activeCommentId: string | null): boolean {
    if (!activeCommentId) {
        return false;
    }

    if (thread.id === activeCommentId) {
        return true;
    }

    return getRenderableThreadEntries(thread).slice(1).some((entry) => entry.id === activeCommentId);
}

export function shouldRenderNestedThreadEntries(
    thread: CommentThread,
    options: {
        activeCommentId: string | null;
        showNestedComments: boolean;
        hasEditDraftComment: boolean;
        hasAppendDraftComment: boolean;
        hasAgentStream: boolean;
        hasDeletedEntriesVisible?: boolean;
    },
): boolean {
    const childEntries = getRenderableThreadEntries(thread).slice(1);
    if (childEntries.length === 0) {
        return options.hasEditDraftComment || options.hasAppendDraftComment || options.hasAgentStream || options.hasDeletedEntriesVisible === true;
    }

    if (options.showNestedComments || options.hasEditDraftComment || options.hasAppendDraftComment || options.hasAgentStream || options.hasDeletedEntriesVisible) {
        return true;
    }

    return isActiveCommentInThread(thread, options.activeCommentId);
}

export function getAppendDraftInsertAfterEntryId(
    thread: CommentThread,
    draft: DraftComment | null,
): string | null {
    if (!draft || draft.mode !== "append") {
        return null;
    }

    const targetId = draft.appendAfterCommentId ?? draft.threadId ?? null;
    if (!targetId || targetId === thread.id) {
        return null;
    }

    return thread.entries.slice(1).some((entry) => entry.id === targetId)
        ? targetId
        : null;
}

function attachSidebarCommentCardInteractions(
    commentEl: HTMLDivElement,
    contentWrapper: HTMLDivElement,
    comment: Comment,
    host: SidebarPersistedCommentHost,
): void {
    const openCommentOnDoubleClick = (event: MouseEvent): boolean => {
        const target = host.getEventTargetElement(event.target);
        if (!shouldOpenSidebarCommentOnDoubleClick({
            clickedInteractiveElement: isSidebarCommentOpenBlockingTarget(target),
        })) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();
        void host.openCommentFromCard(comment);
        return true;
    };

    commentEl.addEventListener("click", (event: MouseEvent) => {
        const target = host.getEventTargetElement(event.target);
        const selection = window.getSelection();
        if (!shouldActivateSidebarComment({
            clickedInteractiveElement: isSidebarCommentOpenBlockingTarget(target),
            clickedInsideCommentContent: !!target?.closest(".sidenote2-comment-content"),
            selection,
            selectionInsideSidebarCommentContent: host.isSelectionInsideSidebarContent(selection),
        })) {
            return;
        }

        void host.activateComment(comment);
    });
    commentEl.addEventListener("dblclick", openCommentOnDoubleClick);

    const claimContentOwnership = (target: HTMLElement | null) => {
        host.claimSidebarInteractionOwnership(
            shouldRefocusSidebarCommentContent(target) ? contentWrapper : null,
        );
    };
    const stopContentPointerPropagation = (event: MouseEvent) => {
        const target = host.getEventTargetElement(event.target);
        claimContentOwnership(target);
        event.stopPropagation();
    };

    contentWrapper.addEventListener("mousedown", stopContentPointerPropagation);
    contentWrapper.addEventListener("mouseup", stopContentPointerPropagation);
    contentWrapper.addEventListener("dblclick", (event: MouseEvent) => {
        const target = host.getEventTargetElement(event.target);
        claimContentOwnership(target);
        if (!openCommentOnDoubleClick(event)) {
            event.stopPropagation();
        }
    });
    contentWrapper.addEventListener("click", (event: MouseEvent) => {
        const target = host.getEventTargetElement(event.target);
        const link = target?.closest("a") as HTMLAnchorElement | null;
        const selection = window.getSelection();

        claimContentOwnership(target);
        event.stopPropagation();
        if (!link) {
            if (shouldActivateSidebarComment({
                clickedInteractiveElement: isSidebarCommentOpenBlockingTarget(target),
                clickedInsideCommentContent: false,
                selection,
                selectionInsideSidebarCommentContent: host.isSelectionInsideSidebarContent(selection),
            })) {
                void host.activateComment(comment);
            }
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

function renderCommentAuthorIndicator(
    metaEl: HTMLElement,
    author: SidebarCommentAuthorPresentation,
): void {
    if (!shouldRenderSidebarCommentAuthor(author)) {
        return;
    }

    metaEl.createSpan({
        cls: `sidenote2-comment-author-indicator is-${author.kind}`,
        text: author.label,
    });
}

export function shouldRenderSidebarCommentAuthor(author: SidebarCommentAuthorPresentation): boolean {
    return author.kind !== "user";
}

function renderBookmarkStateIndicator(
    metaEl: HTMLElement,
    host: SidebarPersistedCommentHost,
): void {
    const indicatorEl = metaEl.createSpan({
        cls: "sidenote2-comment-bookmark-indicator",
    });
    indicatorEl.setAttribute("aria-label", "Bookmarked");
    indicatorEl.setAttribute("title", "Bookmarked");
    host.setIcon(indicatorEl, "bookmark");
}

function renderCommentMeta(
    headerEl: HTMLElement,
    comment: Comment,
    meta: Pick<BasePersistedCommentPresentation, "metaText" | "metaPreviewText">,
    host: SidebarPersistedCommentHost,
    options: {
        showBookmarkState?: boolean;
    } = {},
): void {
    const metaEl = headerEl.createEl("small", {
        cls: "sidenote2-timestamp sidenote2-comment-meta",
    });

    if (host.showSourceRedirectAction) {
        const leadLabel = formatSidebarCommentIndexLeadLabel(comment);
        const sourceLabelEl = metaEl.createSpan({
            cls: "sidenote2-comment-source-label",
            text: leadLabel,
        });
        sourceLabelEl.setAttribute(
            "title",
            comment.filePath,
        );
        if (options.showBookmarkState) {
            renderBookmarkStateIndicator(metaEl, host);
        }
        metaEl.createSpan({
            cls: "sidenote2-comment-meta-value",
            text: meta.metaText,
        });
        return;
    }

    if (meta.metaPreviewText) {
        if (options.showBookmarkState) {
            renderBookmarkStateIndicator(metaEl, host);
        }
        metaEl.createSpan({
            cls: "sidenote2-comment-meta-preview",
            text: meta.metaPreviewText,
        });
    }

    if (!meta.metaPreviewText && options.showBookmarkState) {
        renderBookmarkStateIndicator(metaEl, host);
    }

    metaEl.createSpan({
        cls: "sidenote2-comment-meta-value",
        text: meta.metaText,
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
    attachSidebarActionButtonInteractions(redirectButton, host);
    redirectButton.setAttribute("type", "button");
    redirectButton.setAttribute("aria-label", ariaLabel);
    if (icon === "obsidian-external-link") {
        renderObsidianExternalLinkIcon(redirectButton);
    } else {
        host.setIcon(redirectButton, icon);
    }
    redirectButton.onclick = async (event) => {
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
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
    attachSidebarActionButtonInteractions(editButton, host);
    editButton.setAttribute("type", "button");
    editButton.setAttribute("aria-label", ariaLabel);
    host.setIcon(editButton, "pencil");
    editButton.onclick = async (event) => {
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
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
    attachSidebarActionButtonInteractions(deleteButton, host);
    deleteButton.setAttribute("type", "button");
    deleteButton.setAttribute("aria-label", ariaLabel);
    host.setIcon(deleteButton, "trash-2");
    deleteButton.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        await host.deleteCommentWithConfirm(commentId);
    };
}

function renderRestoreButton(
    actionsEl: HTMLDivElement,
    commentId: string,
    host: SidebarPersistedCommentHost,
    ariaLabel: string,
): void {
    const restoreButton = actionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-restore",
    });
    attachSidebarActionButtonInteractions(restoreButton, host);
    restoreButton.setAttribute("type", "button");
    restoreButton.setAttribute("aria-label", ariaLabel);
    host.setIcon(restoreButton, "rotate-ccw");
    restoreButton.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        await host.restoreComment(commentId);
    };
}

function renderAddEntryButton(
    actionsEl: HTMLDivElement,
    commentId: string,
    host: SidebarPersistedCommentHost,
    options: {
        ariaLabel: string;
        extraClasses?: string[];
        icon?: string;
    },
): void {
    const addEntryButton = actionsEl.createEl("button", {
        cls: [
            "clickable-icon",
            "sidenote2-comment-action-button",
            "sidenote2-comment-action-add-entry",
            ...(options.extraClasses ?? []),
        ].join(" "),
    });
    attachSidebarActionButtonInteractions(addEntryButton, host);
    addEntryButton.setAttribute("type", "button");
    addEntryButton.setAttribute("aria-label", options.ariaLabel);
    host.setIcon(addEntryButton, options.icon ?? "plus");
    addEntryButton.onclick = async (event) => {
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        host.startAppendEntryDraft(commentId, host.currentFilePath);
    };
}

function renderReorderHandle(
    actionsEl: HTMLDivElement,
    threadId: string,
    host: SidebarPersistedCommentHost,
): void {
    const handleEl = actionsEl.createDiv("sidenote2-comment-drag-handle");
    handleEl.setAttribute("draggable", "true");
    handleEl.setAttribute("aria-hidden", "true");
    handleEl.setAttribute("data-sidenote2-drag-kind", "thread");
    handleEl.setAttribute("data-sidenote2-thread-id", threadId);
    handleEl.setAttribute("title", "Drag to reorder page notes");

    const stopPropagation = (event: Event) => {
        event.stopPropagation();
    };
    handleEl.addEventListener("mousedown", stopPropagation);
    handleEl.addEventListener("click", stopPropagation);
    host.setIcon(handleEl, "grip-vertical");
}

function attachSidebarActionButtonInteractions(
    buttonEl: HTMLButtonElement,
    host: SidebarPersistedCommentHost,
): void {
    buttonEl.addEventListener("mousedown", (event: MouseEvent) => {
        host.claimSidebarInteractionOwnership();
        event.stopPropagation();
    });
}

function renderPersistedEntryCard(
    container: HTMLDivElement,
    options: {
        comment: Comment;
        thread: CommentThread;
        entryBody: string;
        presentation: BasePersistedCommentPresentation;
        host: SidebarPersistedCommentHost;
        interactive?: boolean;
        inlineEditDraft?: DraftComment | null;
    },
): {
    commentEl: HTMLDivElement;
    actionsEl: HTMLDivElement;
    renderTask: Promise<void>;
} {
    const commentEl = container.createDiv(options.presentation.classes.join(" "));
    commentEl.setAttribute("data-comment-id", options.comment.id);
    commentEl.setAttribute("data-start-line", String(options.comment.startLine));
    if (options.inlineEditDraft) {
        commentEl.addClass("is-inline-editing");
        commentEl.setAttribute("data-draft-id", options.inlineEditDraft.id);
    }

    const headerEl = commentEl.createDiv("sidenote2-comment-header");
    const headerMainEl = headerEl.createDiv("sidenote2-comment-header-main");
    renderCommentMeta(headerMainEl, options.comment, options.presentation, options.host, {
        showBookmarkState: options.comment.isBookmark === true && options.comment.id === options.thread.id,
    });
    const actionsEl = headerEl.createDiv("sidenote2-comment-actions");

    const contentWrapper = commentEl.createDiv("sidenote2-comment-content");
    contentWrapper.tabIndex = -1;
    if (options.interactive !== false) {
        attachSidebarCommentCardInteractions(commentEl, contentWrapper, options.comment, options.host);
    }

    return {
        commentEl,
        actionsEl,
        renderTask: options.inlineEditDraft
            ? Promise.resolve(options.host.renderInlineEditDraft(contentWrapper, options.inlineEditDraft))
            : renderThreadEntryContent(contentWrapper, options.thread, options.entryBody, options.host),
    };
}

function renderThreadFooterActions(
    commentEl: HTMLDivElement,
    comment: Comment,
    retryRunId: string | null,
    author: SidebarCommentAuthorPresentation,
    agentRun: AgentRunRecord | null,
    options: {
        showShareAction: boolean;
        showAddEntryAction: boolean;
        showRetryAction?: boolean;
    },
    host: SidebarPersistedCommentHost,
): void {
    const footerEl = commentEl.createDiv("sidenote2-thread-footer");
    const footerMetaEl = footerEl.createDiv("sidenote2-thread-footer-meta");
    renderCommentAuthorIndicator(footerMetaEl, author);
    if (agentRun) {
        renderAgentRunStatus(footerMetaEl, agentRun);
    }

    if (!(options.showShareAction || options.showAddEntryAction || options.showRetryAction)) {
        return;
    }

    const footerActionsEl = footerEl.createDiv("sidenote2-thread-footer-actions");
    if (options.showShareAction) {
        const shareButton = footerActionsEl.createEl("button", {
            cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-share sidenote2-thread-share-button",
        });
        attachSidebarActionButtonInteractions(shareButton, host);
        shareButton.setAttribute("type", "button");
        shareButton.setAttribute("aria-label", "Share side note");
        host.setIcon(shareButton, "share");
        shareButton.onclick = async (event) => {
            event.stopPropagation();
            if (!(await host.saveVisibleDraftIfPresent())) {
                return;
            }
            void host.shareComment(comment);
        };
    }

    if (options.showAddEntryAction) {
        renderAddEntryButton(footerActionsEl, comment.id, host, {
            ariaLabel: "Add to thread",
            extraClasses: ["sidenote2-thread-add-entry-button"],
        });
    }

    if (!options.showRetryAction) {
        return;
    }

    const retryButton = footerActionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-retry sidenote2-thread-footer-regenerate-button",
    });
    attachSidebarActionButtonInteractions(retryButton, host);
    retryButton.setAttribute("type", "button");
    retryButton.setAttribute("aria-label", "Generate");
    host.setIcon(retryButton, SIDE_NOTE2_REGENERATE_ICON_ID);
    retryButton.onclick = async (event) => {
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        if (retryRunId) {
            host.retryAgentRun(retryRunId);
        }
    };
}

function renderThreadNestedToggleButton(
    commentEl: HTMLDivElement,
    threadId: string,
    showNestedComments: boolean,
    host: SidebarPersistedCommentHost,
): void {
    const toggleButton = commentEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-thread-nested-toggle-button",
    });
    attachSidebarActionButtonInteractions(toggleButton, host);
    toggleButton.setAttribute("type", "button");
    toggleButton.setAttribute("aria-label", showNestedComments ? "Hide thread comments" : "Show thread comments");
    host.setIcon(toggleButton, showNestedComments ? "chevrons-up" : "chevrons-down");
    toggleButton.onclick = async (event) => {
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        host.setShowNestedCommentsForThread(threadId, !showNestedComments);
    };
}

function hasVisibleDeletedEntries(thread: CommentThread): boolean {
    return thread.entries.slice(1).some((entry) => !!entry.deletedAt);
}

function renderThreadReanchorAction(
    commentEl: HTMLDivElement,
    threadId: string,
    label: string,
    host: SidebarPersistedCommentHost,
): void {
    const actionRow = commentEl.createDiv("sidenote2-thread-reanchor");
    const button = actionRow.createEl("button", {
        cls: "sidenote2-thread-reanchor-button",
        text: label,
    });
    button.setAttribute("type", "button");
    button.onclick = async (event) => {
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        host.reanchorCommentThreadToCurrentSelection(threadId);
    };
}

export async function renderPersistedCommentCard(
    commentsContainer: HTMLDivElement,
    thread: CommentThread,
    host: SidebarPersistedCommentHost,
): Promise<void> {
    const entries = getRenderableThreadEntries(thread, host.agentStream);
    const comment = threadEntryToComment(thread, entries[0]);
    const presentation = buildPersistedCommentPresentation(thread, host.activeCommentId);
    const threadEl = commentsContainer.createDiv("sidenote2-thread-stack");
    threadEl.setAttribute("data-thread-id", thread.id);
    const isDraggablePageThread = host.enablePageThreadReorder
        && isPageComment(comment)
        && !host.showSourceRedirectAction
        && !host.showDeletedComments
        && !comment.deletedAt
        && !thread.deletedAt;
    if (isDraggablePageThread) {
        threadEl.setAttribute("data-sidenote2-page-thread", "true");
    }
    const hasChildEditDraft = !!host.editDraftComment && host.editDraftComment.id !== comment.id;
    const shouldRenderStoredChildren = host.showNestedComments
        || hasChildEditDraft
        || isActiveCommentInThread(thread, host.activeCommentId)
        || hasVisibleDeletedEntries(thread);
    const shouldRenderChildComments = shouldRenderNestedThreadEntries(thread, {
        activeCommentId: host.activeCommentId,
        showNestedComments: host.showNestedComments,
        hasEditDraftComment: hasChildEditDraft,
        hasAppendDraftComment: !!host.appendDraftComment,
        hasAgentStream: !!host.agentStream,
        hasDeletedEntriesVisible: hasVisibleDeletedEntries(thread),
    });
    const appendDraftAfterEntryId = getAppendDraftInsertAfterEntryId(thread, host.appendDraftComment);
    const hasStoredChildEntries = entries.length > 1;
    const parentAuthor = resolveSidebarCommentAuthor(comment.id, host.threadAgentRuns, host.currentUserLabel);
    const renderTasks: Array<Promise<void>> = [];
    const parentEditDraft = host.editDraftComment?.id === comment.id
        ? host.editDraftComment
        : null;
    const renderedParent = renderPersistedEntryCard(threadEl, {
        comment,
        thread,
        entryBody: entries[0]?.body || "",
        presentation,
        host,
        inlineEditDraft: parentEditDraft,
    });
    const commentEl = renderedParent.commentEl;
    const actionsEl = renderedParent.actionsEl;
    renderTasks.push(renderedParent.renderTask);
    if (isDraggablePageThread && !parentEditDraft) {
        renderReorderHandle(actionsEl, thread.id, host);
    }

    if (!parentEditDraft) {
        if (comment.deletedAt && host.enableSoftDeleteActions) {
            renderRestoreButton(actionsEl, comment.id, host, "Restore deleted side note");
        } else {
            const resolveButton = actionsEl.createEl("button", {
                cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-resolve",
            });
            attachSidebarActionButtonInteractions(resolveButton, host);
            resolveButton.setAttribute("type", "button");
            resolveButton.setAttribute("aria-label", presentation.resolveAction.ariaLabel);
            host.setIcon(resolveButton, presentation.resolveAction.icon);
            resolveButton.onclick = async (event) => {
                event.stopPropagation();
                if (!(await host.saveVisibleDraftIfPresent())) {
                    return;
                }
                if (thread.resolved) {
                    host.unresolveComment(thread.id);
                } else {
                    host.resolveComment(thread.id);
                }
            };

            renderEditButton(actionsEl, comment.id, host, "Edit side note");
            if (host.enableSoftDeleteActions) {
                renderDeleteButton(actionsEl, comment.id, host, "Delete side note thread");
            }
        }
        if (host.showSourceRedirectAction && !comment.deletedAt) {
            renderSourceRedirectButton(
                actionsEl,
                comment,
                presentation.redirectHint.ariaLabel,
                presentation.redirectHint.icon,
                host,
            );
        }
        if (presentation.reanchorAction && !comment.deletedAt) {
            renderThreadReanchorAction(commentEl, thread.id, presentation.reanchorAction.label, host);
        }
        renderThreadFooterActions(commentEl, comment, null, parentAuthor, null, {
            showShareAction: !comment.deletedAt,
            showAddEntryAction: !comment.deletedAt,
            showRetryAction: false,
        }, host);
    }
    if (hasStoredChildEntries) {
        renderThreadNestedToggleButton(commentEl, thread.id, host.showNestedComments, host);
    }

    if (!shouldRenderChildComments) {
        await Promise.all(renderTasks);
        return;
    }

    const childCommentsEl = threadEl.createDiv("sidenote2-thread-replies");
    let renderedAppendDraft = false;
    if (shouldRenderStoredChildren) {
        for (const entry of entries.slice(1)) {
            const entryComment = threadEntryToComment(thread, entry);
            const entryPresentation = buildPersistedThreadEntryPresentation(thread, entry, host.activeCommentId);
            const entryEditDraft = host.editDraftComment?.id === entry.id
                ? host.editDraftComment
                : null;
            const renderedEntry = renderPersistedEntryCard(childCommentsEl, {
                comment: entryComment,
                thread,
                entryBody: entry.body || "",
                presentation: entryPresentation,
                host,
                inlineEditDraft: entryEditDraft,
            });
            const entryEl = renderedEntry.commentEl;
            const entryActionsEl = renderedEntry.actionsEl;
            renderTasks.push(renderedEntry.renderTask);
            if (!entryEditDraft) {
                if (thread.deletedAt) {
                    // Parent restore controls the whole soft-deleted thread.
                } else if (entryComment.deletedAt && host.enableSoftDeleteActions) {
                    renderRestoreButton(entryActionsEl, entryComment.id, host, "Restore deleted side note entry");
                } else {
                    renderEditButton(entryActionsEl, entryComment.id, host, "Edit side note");
                    if (host.enableSoftDeleteActions) {
                        renderDeleteButton(entryActionsEl, entryComment.id, host, "Delete side note entry");
                    }
                }
                if (host.showSourceRedirectAction && !entryComment.deletedAt && !thread.deletedAt) {
                    renderSourceRedirectButton(entryActionsEl, entryComment, "Open source note", "obsidian-external-link", host);
                }
                const entryAuthor = resolveSidebarCommentAuthor(entryComment.id, host.threadAgentRuns, host.currentUserLabel);
                const entryAgentRun = getAgentRunByOutputEntryId(host.threadAgentRuns, entryComment.id);
                renderThreadFooterActions(
                    entryEl,
                    entryComment,
                    entryAgentRun?.id ?? null,
                    entryAuthor,
                    entryAgentRun,
                    {
                        showShareAction: !entryComment.deletedAt && !thread.deletedAt,
                        showAddEntryAction: !entryComment.deletedAt && !thread.deletedAt,
                        showRetryAction: !!entryAgentRun && !entryComment.deletedAt && !thread.deletedAt,
                    },
                    host,
                );
            }

            if (host.appendDraftComment && appendDraftAfterEntryId === entry.id) {
                host.renderAppendDraft(childCommentsEl, host.appendDraftComment);
                renderedAppendDraft = true;
            }
        }
    }

    if (host.appendDraftComment && !renderedAppendDraft) {
        host.renderAppendDraft(childCommentsEl, host.appendDraftComment);
    }

    await Promise.all(renderTasks);
}
