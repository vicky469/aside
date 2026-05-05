import type { Comment, CommentThread, CommentThreadEntry } from "../../commentManager";
import { getFirstThreadEntry, threadEntryToComment } from "../../commentManager";
import { isOrphanedComment, isPageComment } from "../../core/anchors/commentAnchors";
import { getAgentActorLabel } from "../../core/agents/agentActorRegistry";
import {
    getAgentRunByOutputEntryId,
    getLatestAgentRunForTriggerEntry,
    type AgentRunRecord,
    type AgentRunStreamState,
} from "../../core/agents/agentRuns";
import type { SideNote2AgentTarget } from "../../core/config/agentTargets";
import { getVisibleNoteContent } from "../../core/storage/noteCommentStorage";
import { parseAgentDirectives } from "../../core/text/agentDirectives";
import { splitTrailingSideNoteReferenceSection, type TrailingSideNoteReferenceSection } from "../../core/text/commentReferences";
import { stripMarkdownLinksForPreview } from "../../core/text/commentUrls";
import type { DraftComment } from "../../domain/drafts";
import { normalizeCommentMarkdownForRenderWithOptions } from "../editor/commentMarkdownRendering";
import { decorateRenderedCommentMentions } from "../editor/commentEditorStyling";
import { SIDE_NOTE2_REGENERATE_ICON_ID } from "../sideNote2Icon";
import {
    isSidebarCommentOpenBlockingTarget,
    shouldRefocusSidebarCommentContent,
    shouldActivateSidebarComment,
} from "./commentPointerAction";
import {
    attachSidebarActionButtonInteractions,
    renderAddEntryButton,
    renderDeleteButton,
    renderEditButton,
    renderEntryMoveHandle,
    renderMoveActionButton,
    renderPermanentDeleteButton,
    renderPinActionButton,
    renderReorderHandle,
    renderRestoreButton,
    renderSourceRedirectButton,
    runSidebarPendingButtonAction,
} from "./sidebarCommentActions";
import {
    formatSidebarCommentMeta,
    formatSidebarCommentSelectedTextPreview,
} from "./sidebarCommentSections";
export {
    buildPersistedCommentPinActionPresentation,
    type PersistedCommentPinActionPresentation,
} from "./sidebarCommentActions";

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
    moveAction: {
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
    showBookmarkAndPinControls: boolean;
    showDeletedComments: boolean;
    enablePageThreadReorder: boolean;
    enableChildEntryMove: boolean;
    enableSoftDeleteActions: boolean;
    showNestedComments: boolean;
    showNestedCommentsByDefault: boolean;
    getKnownCommentById(commentId: string): Comment | null;
    editDraftComment: DraftComment | null;
    appendDraftComment: DraftComment | null;
    agentRun: AgentRunRecord | null;
    agentStream: AgentRunStreamState | null;
    threadAgentRuns: AgentRunRecord[];
    getEventTargetElement(target: EventTarget | null): HTMLElement | null;
    isSelectionInsideSidebarContent(selection?: Selection | null): boolean;
    claimSidebarInteractionOwnership(focusTarget?: HTMLElement | null): void;
    insertCommentMarkdownIntoFile(markdown: string): Promise<boolean>;
    renderMarkdown(markdown: string, container: HTMLElement, sourcePath: string): Promise<void>;
    openSidebarInternalLink(href: string, sourcePath: string, focusTarget: HTMLElement): Promise<void>;
    openCommentFromCard(comment: Comment): Promise<void>;
    openCommentInEditor(comment: Comment): Promise<void>;
    shareComment(comment: Comment): Promise<void>;
    saveVisibleDraftIfPresent(): Promise<boolean>;
    setShowNestedCommentsForThread(threadId: string, showNestedComments: boolean): void;
    resolveComment(commentId: string): Promise<boolean> | Promise<void> | boolean | void;
    unresolveComment(commentId: string): Promise<boolean> | Promise<void> | boolean | void;
    moveCommentThread(threadId: string, sourceFilePath: string): void;
    restoreComment(commentId: string): Promise<boolean> | Promise<void> | boolean | void;
    clearDeletedComment(commentId: string): Promise<boolean> | Promise<void> | boolean | void;
    startEditDraft(commentId: string, hostFilePath: string | null): void;
    isPinnedThread(threadId: string): boolean;
    togglePinnedThread(threadId: string): Promise<void> | void;
    startAppendEntryDraft(commentId: string, hostFilePath: string | null): void;
    retryAgentRun(runId: string): Promise<boolean> | boolean;
    retryAgentPromptForComment(commentId: string, filePath: string): Promise<boolean> | boolean;
    reanchorCommentThreadToCurrentSelection(commentId: string): void;
    deleteCommentWithConfirm(commentId: string): Promise<boolean> | Promise<void> | boolean | void;
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
    return formatSidebarCommentSelectedTextPreview(comment)
        ?? formatSidebarCommentSourceFileLabel(comment.filePath);
}

const SIDEBAR_SIDE_NOTE_REFERENCE_PREVIEW_LIMIT = 48;
const RAW_SIDE_NOTE_REFERENCE_URL_PATTERN = /obsidian:\/\/side-note2-comment\?[^)\]\s]+/g;

function clipSidebarSideNoteReferencePreview(value: string): string {
    const normalized = stripMarkdownLinksForPreview(
        value.replace(RAW_SIDE_NOTE_REFERENCE_URL_PATTERN, "side note"),
    )
        .replace(/\r\n/g, "\n")
        .replace(/\s+/g, " ")
        .trim();

    if (!normalized) {
        return "";
    }

    if (normalized.length <= SIDEBAR_SIDE_NOTE_REFERENCE_PREVIEW_LIMIT) {
        return normalized;
    }

    return `${normalized.slice(0, SIDEBAR_SIDE_NOTE_REFERENCE_PREVIEW_LIMIT - 3).trimEnd()}...`;
}

export function formatSidebarSideNoteReferenceLabel(
    comment: Pick<Comment, "anchorKind" | "selectedText" | "comment" | "filePath"> | null,
    targetFilePath: string | null,
): string {
    const fallbackFilePath = targetFilePath ?? comment?.filePath ?? "";
    const fileLabel = formatSidebarCommentSourceFileLabel(fallbackFilePath);
    if (!comment) {
        return fileLabel || "Side note";
    }

    const preview = isPageComment(comment)
        ? clipSidebarSideNoteReferencePreview(comment.comment)
        : clipSidebarSideNoteReferencePreview(comment.selectedText);

    if (!preview) {
        return fileLabel || "Side note";
    }

    return fileLabel ? `${fileLabel}: ${preview}` : preview;
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
        moveAction: {
            ariaLabel: "Move to another file",
            icon: "arrow-right-left",
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

export function getRetryableAgentRunForSidebarComment(
    commentId: string,
    threadAgentRuns: readonly AgentRunRecord[],
): AgentRunRecord | null {
    return getLatestAgentRunForTriggerEntry(threadAgentRuns, commentId);
}

export function shouldShowRetryActionForSidebarComment(
    commentId: string,
    commentBody: string,
    threadAgentRuns: readonly AgentRunRecord[],
): boolean {
    if (getRetryableAgentRunForSidebarComment(commentId, threadAgentRuns)) {
        return true;
    }

    return parseAgentDirectives(commentBody).target !== null;
}

export function getInsertableSidebarCommentMarkdown(
    commentId: string,
    entryBody: string,
    threadAgentRuns: readonly AgentRunRecord[],
): string | null {
    if (!getAgentRunByOutputEntryId(threadAgentRuns, commentId)) {
        return null;
    }

    const markdown = splitTrailingSideNoteReferenceSection(
        getVisibleNoteContent(entryBody).replace(/\n{3,}/g, "\n\n"),
    ).body.trim();
    return markdown || null;
}

export function isRetryableAgentRunBusy(run: Pick<AgentRunRecord, "status"> | null): boolean {
    return run?.status === "queued" || run?.status === "running";
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

export function shouldRenderChildEntryMoveHandle(options: {
    enableChildEntryMove: boolean;
    showSourceRedirectAction: boolean;
    entryDeleted: boolean;
    threadDeleted: boolean;
}): boolean {
    return options.enableChildEntryMove
        && !options.showSourceRedirectAction
        && !options.entryDeleted
        && !options.threadDeleted;
}

function interceptSideNoteProtocolLinks(
    container: HTMLElement,
    sourcePath: string,
    host: SidebarPersistedCommentHost,
): void {
    const links = container.querySelectorAll<HTMLAnchorElement>('a[href^="obsidian://side-note2-comment"]');
    for (let i = 0; i < links.length; i++) {
        const linkEl = links[i];
        linkEl.addEventListener("click", (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            void host.openSidebarInternalLink(linkEl.href, sourcePath, linkEl);
        });
    }
}

async function renderThreadEntryContent(
    container: HTMLDivElement,
    thread: CommentThread,
    entryBodySection: TrailingSideNoteReferenceSection,
    host: SidebarPersistedCommentHost,
): Promise<void> {
    const bodyMarkdown = entryBodySection.body;
    if (bodyMarkdown.trim()) {
        await host.renderMarkdown(
            normalizeCommentMarkdownForRenderWithOptions(bodyMarkdown, {
                resolveSideNoteReferenceLabel: (match) => formatSidebarSideNoteReferenceLabel(
                    host.getKnownCommentById(match.target.commentId),
                    match.target.filePath,
                ),
            }),
            container,
            thread.filePath,
        );
        decorateRenderedCommentMentions(container);
        interceptSideNoteProtocolLinks(container, thread.filePath, host);
    }
}

export function getRenderableThreadEntries(
    thread: CommentThread,
    _agentStream: AgentRunStreamState | null = null,
): CommentThreadEntry[] {
    return thread.entries.length > 0
        ? thread.entries
        : [getFirstThreadEntry(thread)];
}

export function getDeletedRenderableThreadEntries(
    thread: CommentThread,
    agentStream: AgentRunStreamState | null = null,
): {
    parentEntry: CommentThreadEntry | null;
    childEntries: CommentThreadEntry[];
} {
    const entries = getRenderableThreadEntries(thread, agentStream);
    const parentEntry = entries[0] ?? null;
    if (!parentEntry) {
        return {
            parentEntry: null,
            childEntries: [],
        };
    }

    if (thread.deletedAt || parentEntry.deletedAt) {
        return {
            parentEntry,
            childEntries: entries.slice(1),
        };
    }

    return {
        parentEntry: null,
        childEntries: entries.slice(1).filter((entry) => !!entry.deletedAt),
    };
}

export function shouldRenderNestedThreadEntries(
    thread: CommentThread,
    options: {
        activeCommentId: string | null;
        showNestedComments: boolean;
        showNestedCommentsByDefault: boolean;
        hasEditDraftComment: boolean;
        hasAppendDraftComment: boolean;
        hasAgentStream: boolean;
        hasAgentReplies?: boolean;
        hasDeletedEntriesVisible?: boolean;
    },
): boolean {
    const childEntries = getRenderableThreadEntries(thread).slice(1);
    if (childEntries.length === 0) {
        return options.hasEditDraftComment
            || options.hasAppendDraftComment
            || options.hasAgentStream;
    }

    if (
        options.showNestedComments
        || options.hasEditDraftComment
        || options.hasAppendDraftComment
        || options.hasAgentStream
    ) {
        return true;
    }
    return false;
}

export function shouldRenderThreadNestedToggle(options: {
    hasStoredChildEntries: boolean;
    hasInlineEditDraft: boolean;
    hasAppendDraftComment: boolean;
    hasChildEditDraft: boolean;
}): boolean {
    return options.hasStoredChildEntries
        && !options.hasInlineEditDraft
        && !options.hasAppendDraftComment
        && !options.hasChildEditDraft;
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
    const openCommentFromClick = (
        event: MouseEvent,
        clickedInsideCommentContent?: boolean,
    ): boolean => {
        const target = host.getEventTargetElement(event.target);
        const selection = window.getSelection();
        if (!shouldActivateSidebarComment({
            clickedInteractiveElement: isSidebarCommentOpenBlockingTarget(target),
            clickedInsideCommentContent: clickedInsideCommentContent ?? !!target?.closest(".sidenote2-comment-content"),
            selection,
            selectionInsideSidebarCommentContent: host.isSelectionInsideSidebarContent(selection),
        })) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();
        void host.openCommentFromCard(comment);
        return true;
    };

    commentEl.addEventListener("click", (event: MouseEvent) => {
        openCommentFromClick(event);
    });

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
    contentWrapper.addEventListener("click", (event: MouseEvent) => {
        const target = host.getEventTargetElement(event.target);
        const link = target?.closest("a") as HTMLAnchorElement | null;

        claimContentOwnership(target);
        event.stopPropagation();
        if (!link) {
            openCommentFromClick(event, false);
            return;
        }

        if (link.classList.contains("internal-link")) {
            event.preventDefault();
            const href = link.getAttribute("href") || link.getAttribute("data-href") || link.innerText;
            if (href) {
                void host.openSidebarInternalLink(href, comment.filePath, contentWrapper);
            }
            return;
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

function renderCommentMeta(
    headerEl: HTMLElement,
    comment: Comment,
    meta: Pick<BasePersistedCommentPresentation, "metaText" | "metaPreviewText">,
    host: SidebarPersistedCommentHost,
): void {
    const metaEl = headerEl.createEl("small", {
        cls: "sidenote2-timestamp sidenote2-comment-meta",
    });

    if (host.showSourceRedirectAction) {
        const leadLabel = formatSidebarCommentIndexLeadLabel(comment);
        const usesSelectedTextPreview = !isPageComment(comment) && !!meta.metaPreviewText;
        const sourceLabelEl = metaEl.createSpan({
            cls: usesSelectedTextPreview
                ? "sidenote2-comment-meta-preview"
                : "sidenote2-comment-source-label",
            text: leadLabel,
        });
        sourceLabelEl.setAttribute(
            "title",
            usesSelectedTextPreview ? leadLabel : comment.filePath,
        );
        metaEl.createSpan({
            cls: "sidenote2-comment-meta-value",
            text: meta.metaText,
        });
        return;
    }

    if (meta.metaPreviewText) {
        metaEl.createSpan({
            cls: "sidenote2-comment-meta-preview",
            text: meta.metaPreviewText,
        });
    }

    metaEl.createSpan({
        cls: "sidenote2-comment-meta-value",
        text: meta.metaText,
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
    const parsedEntryBody = splitTrailingSideNoteReferenceSection(options.entryBody);

    const headerEl = commentEl.createDiv("sidenote2-comment-header");
    const headerMainEl = headerEl.createDiv("sidenote2-comment-header-main");
    renderCommentMeta(headerMainEl, options.comment, options.presentation, options.host);
    const actionsEl = headerEl.createDiv("sidenote2-comment-actions");

    const contentWrapper = commentEl.createDiv("sidenote2-comment-content");
    contentWrapper.addClass("markdown-rendered");
    contentWrapper.tabIndex = -1;
    if (options.interactive !== false) {
        attachSidebarCommentCardInteractions(commentEl, contentWrapper, options.comment, options.host);
    }

    return {
        commentEl,
        actionsEl,
        renderTask: options.inlineEditDraft
            ? Promise.resolve(options.host.renderInlineEditDraft(contentWrapper, options.inlineEditDraft))
            : renderThreadEntryContent(contentWrapper, options.thread, parsedEntryBody, options.host),
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
        disableRetryAction?: boolean;
        nestedToggleAction?: {
            showNestedComments: boolean;
            threadId: string;
        } | null;
        moveAction?: {
            ariaLabel: string;
            icon: string;
            onMove: () => Promise<void> | void;
        } | null;
        insertAction?: {
            markdown: string;
        } | null;
    },
    host: SidebarPersistedCommentHost,
): void {
    const footerEl = commentEl.createDiv("sidenote2-thread-footer");
    const footerMetaEl = footerEl.createDiv("sidenote2-thread-footer-meta");
    if (options.nestedToggleAction) {
        renderThreadNestedToggleButton(
            footerMetaEl,
            options.nestedToggleAction.threadId,
            options.nestedToggleAction.showNestedComments,
            host,
        );
    }
    renderCommentAuthorIndicator(footerMetaEl, author);
    if (agentRun) {
        renderAgentRunStatus(footerMetaEl, agentRun);
    }
    if (options.insertAction) {
        const insertAction = options.insertAction;
        footerMetaEl.createSpan({
            cls: "sidenote2-thread-footer-meta-separator",
            text: "·",
        });
        const addButton = footerMetaEl.createSpan({
            cls: "sidenote2-thread-footer-meta-action",
            text: "Add to file",
        });
        attachSidebarActionButtonInteractions(addButton, host);
        addButton.tabIndex = 0;
        addButton.setAttribute("role", "button");
        const runInsert = async (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!(await host.saveVisibleDraftIfPresent())) {
                return;
            }
            await host.insertCommentMarkdownIntoFile(insertAction.markdown);
        };
        addButton.addEventListener("click", (event) => {
            void runInsert(event);
        });
        addButton.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }

            void runInsert(event);
        });
    }

    if (!(options.showShareAction || options.showAddEntryAction || options.showRetryAction || options.moveAction)) {
        return;
    }

    const footerActionsEl = footerEl.createDiv("sidenote2-thread-footer-actions");
    if (options.moveAction) {
        renderMoveActionButton(footerActionsEl, host, {
            ariaLabel: options.moveAction.ariaLabel,
            icon: options.moveAction.icon,
            onMove: options.moveAction.onMove,
        });
    }

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
    retryButton.disabled = options.disableRetryAction === true;
    host.setIcon(retryButton, SIDE_NOTE2_REGENERATE_ICON_ID);
    retryButton.onclick = async (event) => {
        event.stopPropagation();
        if (retryButton.disabled) {
            return;
        }
        retryButton.disabled = true;
        if (!(await host.saveVisibleDraftIfPresent())) {
            retryButton.disabled = options.disableRetryAction === true;
            return;
        }
        const started = retryRunId
            ? await host.retryAgentRun(retryRunId)
            : await host.retryAgentPromptForComment(comment.id, comment.filePath);
        if (!started) {
            retryButton.disabled = options.disableRetryAction === true;
        }
    };
}

function renderThreadNestedToggleButton(
    container: HTMLElement,
    threadId: string,
    showNestedComments: boolean,
    host: SidebarPersistedCommentHost,
): void {
    const toggleButton = container.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-thread-nested-toggle-button",
    });
    attachSidebarActionButtonInteractions(toggleButton, host);
    toggleButton.setAttribute("type", "button");
    toggleButton.classList.toggle("is-expanded", showNestedComments);
    toggleButton.setAttribute("aria-expanded", showNestedComments ? "true" : "false");
    toggleButton.setAttribute("aria-label", showNestedComments ? "Collapse details" : "Expand details");
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

function renderStoredThreadEntry(
    container: HTMLDivElement,
    thread: CommentThread,
    entry: CommentThreadEntry,
    host: SidebarPersistedCommentHost,
    options: {
        inlineEditDraft?: DraftComment | null;
    } = {},
): Promise<void> {
    const entryComment = threadEntryToComment(thread, entry);
    const entryPresentation = buildPersistedThreadEntryPresentation(thread, entry, host.activeCommentId);
    const renderedEntry = renderPersistedEntryCard(container, {
        comment: entryComment,
        thread,
        entryBody: entry.body || "",
        presentation: entryPresentation,
        host,
        interactive: !entryComment.deletedAt && !thread.deletedAt,
        inlineEditDraft: options.inlineEditDraft ?? null,
    });
    const entryEl = renderedEntry.commentEl;
    const entryActionsEl = renderedEntry.actionsEl;
    const entryEditDraft = options.inlineEditDraft ?? null;

    if (!entryEditDraft) {
        if (thread.deletedAt) {
            // Parent restore controls the whole soft-deleted thread.
        } else if (entryComment.deletedAt && host.enableSoftDeleteActions && !host.showSourceRedirectAction) {
            renderRestoreButton(entryActionsEl, entryComment.id, host, "Restore deleted side note entry");
            renderPermanentDeleteButton(entryActionsEl, entryComment.id, host, "Permanently delete side note entry");
        } else {
            if (!host.showSourceRedirectAction) {
                renderEditButton(entryActionsEl, entryComment.id, host, "Edit side note");
            }
            if (host.enableSoftDeleteActions && !host.showSourceRedirectAction) {
                renderDeleteButton(entryActionsEl, entryComment.id, host, "Delete side note entry");
            }
        }
        if (shouldRenderChildEntryMoveHandle({
            enableChildEntryMove: host.enableChildEntryMove,
            showSourceRedirectAction: host.showSourceRedirectAction,
            entryDeleted: !!entryComment.deletedAt,
            threadDeleted: !!thread.deletedAt,
        })) {
            renderEntryMoveHandle(entryActionsEl, entryComment.id, thread.id, host);
        }
        const entryAuthor = resolveSidebarCommentAuthor(entryComment.id, host.threadAgentRuns, host.currentUserLabel);
        const entryAgentRun = getAgentRunByOutputEntryId(host.threadAgentRuns, entryComment.id);
        const entryRetryRun = getRetryableAgentRunForSidebarComment(entryComment.id, host.threadAgentRuns);
        const entryInsertMarkdown = !entryComment.deletedAt && !thread.deletedAt
            ? getInsertableSidebarCommentMarkdown(entryComment.id, entry.body || "", host.threadAgentRuns)
            : null;
        renderThreadFooterActions(
            entryEl,
            entryComment,
            entryRetryRun?.id ?? null,
            entryAuthor,
            entryAgentRun,
            {
                showShareAction: !host.showSourceRedirectAction && !entryComment.deletedAt && !thread.deletedAt,
                showAddEntryAction: !host.showSourceRedirectAction && !entryComment.deletedAt && !thread.deletedAt,
                showRetryAction: shouldShowRetryActionForSidebarComment(
                    entryComment.id,
                    entryComment.comment,
                    host.threadAgentRuns,
                ) && !host.showSourceRedirectAction && !entryComment.deletedAt && !thread.deletedAt,
                disableRetryAction: isRetryableAgentRunBusy(entryRetryRun),
                moveAction: null,
                insertAction: entryInsertMarkdown && !host.showSourceRedirectAction
                    ? {
                        markdown: entryInsertMarkdown,
                    }
                    : null,
            },
            host,
        );
    }

    return renderedEntry.renderTask;
}

export async function renderPersistedCommentCard(
    commentsContainer: HTMLDivElement,
    thread: CommentThread,
    host: SidebarPersistedCommentHost,
): Promise<void> {
    const deletedRenderableEntries = host.showDeletedComments
        ? getDeletedRenderableThreadEntries(thread, host.agentStream)
        : null;
    const entries = deletedRenderableEntries?.parentEntry
        ? [deletedRenderableEntries.parentEntry, ...deletedRenderableEntries.childEntries]
        : getRenderableThreadEntries(thread, host.agentStream);
    const comment = threadEntryToComment(thread, entries[0]);
    const presentation = buildPersistedCommentPresentation(thread, host.activeCommentId);
    const threadEl = commentsContainer.createDiv("sidenote2-thread-stack");
    threadEl.setAttribute("data-thread-id", thread.id);
    if (host.showDeletedComments && deletedRenderableEntries && !deletedRenderableEntries.parentEntry) {
        await Promise.all(
            deletedRenderableEntries.childEntries.map((entry) => renderStoredThreadEntry(threadEl, thread, entry, host)),
        );
        return;
    }
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
    const hasAgentReplyEntries = entries.slice(1).some((entry) =>
        !!getAgentRunByOutputEntryId(host.threadAgentRuns, entry.id)
    );
    const hasStoredChildEntries = entries.length > 1;
    const parentEditDraft = host.editDraftComment?.id === comment.id
        ? host.editDraftComment
        : null;
    const shouldRenderStoredChildren = host.showNestedComments
        || hasChildEditDraft
        || host.agentStream !== null
        || !!host.appendDraftComment;
    const shouldRenderDetailsToggle = shouldRenderThreadNestedToggle({
        hasStoredChildEntries,
        hasInlineEditDraft: !!parentEditDraft,
        hasAppendDraftComment: !!host.appendDraftComment,
        hasChildEditDraft,
    });
    const shouldRenderChildComments = shouldRenderNestedThreadEntries(thread, {
        activeCommentId: host.activeCommentId,
        showNestedComments: host.showNestedComments,
        showNestedCommentsByDefault: host.showNestedCommentsByDefault,
        hasEditDraftComment: hasChildEditDraft,
        hasAppendDraftComment: !!host.appendDraftComment,
        hasAgentStream: !!host.agentStream,
        hasAgentReplies: hasAgentReplyEntries,
        hasDeletedEntriesVisible: hasVisibleDeletedEntries(thread),
    });
    const appendDraftAfterEntryId = getAppendDraftInsertAfterEntryId(thread, host.appendDraftComment);
    const parentAuthor = resolveSidebarCommentAuthor(comment.id, host.threadAgentRuns, host.currentUserLabel);
    const renderTasks: Array<Promise<void>> = [];
    const canShowHeaderPinAction = host.showBookmarkAndPinControls
        && comment.id === thread.id
        && !comment.deletedAt
        && !thread.deletedAt;
    const renderedParent = renderPersistedEntryCard(threadEl, {
        comment,
        thread,
        entryBody: entries[0]?.body || "",
        presentation,
        host,
        interactive: !comment.deletedAt && !thread.deletedAt,
        inlineEditDraft: parentEditDraft,
    });
    const commentEl = renderedParent.commentEl;
    const actionsEl = renderedParent.actionsEl;
    renderTasks.push(renderedParent.renderTask);
    if (hasStoredChildEntries) {
        commentEl.addClass("sidenote2-has-child-entries");
    }
    if (!parentEditDraft) {
        const parentRetryRun = getRetryableAgentRunForSidebarComment(comment.id, host.threadAgentRuns);
        const parentInsertMarkdown = !comment.deletedAt && !thread.deletedAt
            ? getInsertableSidebarCommentMarkdown(comment.id, entries[0]?.body || "", host.threadAgentRuns)
            : null;
        if (comment.deletedAt && host.enableSoftDeleteActions && !host.showSourceRedirectAction) {
            renderRestoreButton(actionsEl, comment.id, host, "Restore deleted side note");
            renderPermanentDeleteButton(actionsEl, comment.id, host, "Permanently delete side note");
        } else {
            if (canShowHeaderPinAction) {
                renderPinActionButton(actionsEl, thread.id, host.isPinnedThread(thread.id), host);
            } else if (host.showSourceRedirectAction && !comment.deletedAt && !thread.deletedAt) {
                renderSourceRedirectButton(
                    actionsEl,
                    comment,
                    presentation.redirectHint.ariaLabel,
                    presentation.redirectHint.icon,
                    host,
                );
            }
            const resolveButton = actionsEl.createEl("button", {
                cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-resolve",
            });
            attachSidebarActionButtonInteractions(resolveButton, host);
            resolveButton.setAttribute("type", "button");
            resolveButton.setAttribute("aria-label", presentation.resolveAction.ariaLabel);
            host.setIcon(resolveButton, presentation.resolveAction.icon);
            resolveButton.onclick = async (event) => {
                await runSidebarPendingButtonAction(resolveButton, host, event, async () => {
                    if (thread.resolved) {
                        await host.unresolveComment(thread.id);
                    } else {
                        await host.resolveComment(thread.id);
                    }
                });
            };

            if (!host.showSourceRedirectAction) {
                renderEditButton(actionsEl, comment.id, host, "Edit side note");
            }
            if (host.enableSoftDeleteActions && !host.showSourceRedirectAction) {
                renderDeleteButton(actionsEl, comment.id, host, "Delete side note thread");
            }
        }
        if (isDraggablePageThread) {
            renderReorderHandle(actionsEl, thread.id, host);
        }
        if (presentation.reanchorAction && !comment.deletedAt) {
            renderThreadReanchorAction(commentEl, thread.id, presentation.reanchorAction.label, host);
        }
        renderThreadFooterActions(commentEl, comment, parentRetryRun?.id ?? null, parentAuthor, null, {
            showShareAction: !host.showSourceRedirectAction && !comment.deletedAt,
            showAddEntryAction: !host.showSourceRedirectAction && !comment.deletedAt,
            showRetryAction: shouldShowRetryActionForSidebarComment(
                comment.id,
                comment.comment,
                host.threadAgentRuns,
            ) && !host.showSourceRedirectAction && !comment.deletedAt && !thread.deletedAt,
            disableRetryAction: isRetryableAgentRunBusy(parentRetryRun),
            nestedToggleAction: shouldRenderDetailsToggle
                ? {
                    threadId: thread.id,
                    showNestedComments: host.showNestedComments,
                }
                : null,
            moveAction: !host.showSourceRedirectAction && !comment.deletedAt && !thread.deletedAt
                ? {
                    ariaLabel: presentation.moveAction.ariaLabel,
                    icon: presentation.moveAction.icon,
                    onMove: () => {
                        host.moveCommentThread(thread.id, thread.filePath);
                    },
                }
                : null,
            insertAction: parentInsertMarkdown && !host.showSourceRedirectAction
                ? {
                    markdown: parentInsertMarkdown,
                }
                : null,
        }, host);
    }

    if (!shouldRenderChildComments) {
        await Promise.all(renderTasks);
        return;
    }

    const childCommentsEl = threadEl.createDiv("sidenote2-thread-replies");
    let renderedAppendDraft = false;
    if (shouldRenderStoredChildren) {
        for (const entry of entries.slice(1)) {
            const entryEditDraft = host.editDraftComment?.id === entry.id
                ? host.editDraftComment
                : null;
            renderTasks.push(renderStoredThreadEntry(childCommentsEl, thread, entry, host, {
                inlineEditDraft: entryEditDraft,
            }));

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
