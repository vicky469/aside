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
import { splitTrailingSideNoteReferenceSection, type TrailingSideNoteReferenceSection } from "../../core/text/commentReferences";
import type { DraftComment } from "../../domain/drafts";
import type { SideNoteReferenceSearchDocument } from "../../index/SideNoteReferenceSearchIndex";
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
    moveAction: {
        ariaLabel: string;
        icon: string;
    };
    resolveAction: {
        ariaLabel: string;
        icon: string;
    };
}

export interface PersistedCommentBookmarkActionPresentation {
    active: boolean;
    ariaLabel: string;
}

export interface PersistedCommentPinActionPresentation {
    active: boolean;
    ariaLabel: string;
}

export type PersistedThreadEntryPresentation = BasePersistedCommentPresentation;

export interface SidebarCommentAuthorPresentation {
    kind: "user" | SideNote2AgentTarget;
    label: string;
}

export interface SidebarSideNoteReferenceBacklink {
    filePath: string;
    fileTitle: string;
    preview: string;
    resolved: boolean;
    threadId: string;
    url: string;
}

export interface SidebarPersistedCommentHost {
    activeCommentId: string | null;
    currentFilePath: string | null;
    currentUserLabel: string;
    localVaultName: string | null;
    showSourceRedirectAction: boolean;
    showDeletedComments: boolean;
    enablePageThreadReorder: boolean;
    enableSoftDeleteActions: boolean;
    showNestedComments: boolean;
    showNestedCommentsByDefault: boolean;
    editDraftComment: DraftComment | null;
    appendDraftComment: DraftComment | null;
    agentRun: AgentRunRecord | null;
    agentStream: AgentRunStreamState | null;
    threadAgentRuns: AgentRunRecord[];
    getEventTargetElement(target: EventTarget | null): HTMLElement | null;
    isSelectionInsideSidebarContent(selection?: Selection | null): boolean;
    claimSidebarInteractionOwnership(focusTarget?: HTMLElement | null): void;
    insertCommentMarkdownIntoNote(filePath: string, markdown: string): Promise<boolean>;
    renderMarkdown(markdown: string, container: HTMLElement, sourcePath: string): Promise<void>;
    openSidebarInternalLink(href: string, sourcePath: string, focusTarget: HTMLElement): Promise<void>;
    openSideNoteReference(url: string): Promise<void>;
    activateComment(comment: Comment): Promise<void>;
    openCommentFromCard(comment: Comment): Promise<void>;
    openCommentInEditor(comment: Comment): Promise<void>;
    shareComment(comment: Comment): Promise<void>;
    getIncomingSideNoteReferenceBacklinks(threadId: string): SidebarSideNoteReferenceBacklink[];
    getSideNoteReferenceDocument(commentId: string): SideNoteReferenceSearchDocument | null;
    saveVisibleDraftIfPresent(): Promise<boolean>;
    setShowNestedCommentsForThread(threadId: string, showNestedComments: boolean): void;
    resolveComment(commentId: string): void;
    unresolveComment(commentId: string): void;
    moveCommentThread(threadId: string, sourceFilePath: string): void;
    restoreComment(commentId: string): Promise<void> | void;
    startEditDraft(commentId: string, hostFilePath: string | null): void;
    setCommentBookmarkState(commentId: string, isBookmark: boolean): Promise<void> | void;
    isPinnedThread(threadId: string): boolean;
    togglePinnedThread(threadId: string): Promise<void> | void;
    startAppendEntryDraft(commentId: string, hostFilePath: string | null): void;
    retryAgentRun(runId: string): Promise<boolean> | boolean;
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

export interface SidebarSideNoteReferencePresentation {
    preview: string | null;
    resolved: boolean;
    title: string;
    tooltip: string;
}

interface SidebarResolvedSideNoteReference {
    presentation: SidebarSideNoteReferencePresentation;
    url: string;
}

function normalizeSideNoteReferenceText(value: string | null | undefined): string {
    return (value ?? "").replace(/\s+/g, " ").trim();
}

export function buildSidebarSideNoteReferencePresentation(
    document: Pick<SideNoteReferenceSearchDocument, "bodyPreview" | "filePath" | "fileTitle" | "primaryLabel" | "resolved" | "selectedText"> | null,
    fallback: {
        filePath?: string | null;
        label?: string | null;
    } = {},
): SidebarSideNoteReferencePresentation {
    const title = normalizeSideNoteReferenceText(document?.fileTitle)
        || (fallback.filePath ? formatSidebarCommentSourceFileLabel(fallback.filePath) : "")
        || "Side note";
    const previewSource = normalizeSideNoteReferenceText(document?.bodyPreview)
        || normalizeSideNoteReferenceText(document?.selectedText)
        || normalizeSideNoteReferenceText(document?.primaryLabel)
        || normalizeSideNoteReferenceText(fallback.label);
    const preview = previewSource && previewSource !== title
        ? previewSource
        : null;
    const tooltip = [
        normalizeSideNoteReferenceText(document?.filePath) || normalizeSideNoteReferenceText(fallback.filePath),
        previewSource && previewSource !== title ? previewSource : null,
    ]
        .filter((value): value is string => !!value)
        .join("\n");

    return {
        preview,
        resolved: document?.resolved === true,
        title,
        tooltip: tooltip || title,
    };
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
        moveAction: {
            ariaLabel: "Move side note",
            icon: "arrow-right-left",
        },
        resolveAction: {
            ariaLabel: comment.resolved ? "Reopen side note" : "Resolve side note",
            icon: comment.resolved ? "rotate-ccw" : "check",
        },
    };
}

export function buildPersistedCommentBookmarkActionPresentation(
    comment: Pick<Comment, "isBookmark">,
): PersistedCommentBookmarkActionPresentation {
    if (comment.isBookmark === true) {
        return {
            active: true,
            ariaLabel: "Remove bookmark",
        };
    }

    return {
        active: false,
        ariaLabel: "Mark as bookmark",
    };
}

export function buildPersistedCommentPinActionPresentation(isPinned: boolean): PersistedCommentPinActionPresentation {
    return {
        active: isPinned,
        ariaLabel: isPinned ? "Unpin this side note" : "Pin this side note",
    };
}

export function shouldRenderPersistedCommentBookmarkIndicator(
    comment: Pick<Comment, "id" | "isBookmark">,
    thread: Pick<CommentThread, "id">,
): boolean {
    return comment.id === thread.id && comment.isBookmark === true;
}

export function shouldRenderPersistedCommentPinIndicator(
    comment: Pick<Comment, "id">,
    thread: Pick<CommentThread, "id">,
    isPinned: boolean,
): boolean {
    return comment.id === thread.id && isPinned;
}

export function shouldRenderPersistedCommentBookmarkAction(
    comment: Pick<Comment, "deletedAt" | "id" | "isBookmark">,
    thread: Pick<CommentThread, "deletedAt" | "id">,
): boolean {
    return comment.id === thread.id
        && comment.isBookmark !== true
        && !comment.deletedAt
        && !thread.deletedAt;
}

export function shouldRenderPersistedCommentPinAction(
    comment: Pick<Comment, "deletedAt" | "id">,
    thread: Pick<CommentThread, "deletedAt" | "id">,
    isPinned: boolean,
): boolean {
    return comment.id === thread.id
        && !isPinned
        && !comment.deletedAt
        && !thread.deletedAt;
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

export function getInsertableSidebarCommentMarkdown(
    commentId: string,
    entryBody: string,
    threadAgentRuns: readonly AgentRunRecord[],
): string | null {
    if (!getAgentRunByOutputEntryId(threadAgentRuns, commentId)) {
        return null;
    }

    const markdown = splitTrailingSideNoteReferenceSection(entryBody).body.trim();
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

async function renderThreadEntryContent(
    container: HTMLDivElement,
    thread: CommentThread,
    entryBodySection: TrailingSideNoteReferenceSection,
    host: SidebarPersistedCommentHost,
): Promise<void> {
    const bodyMarkdown = entryBodySection.body;
    if (bodyMarkdown.trim()) {
        await host.renderMarkdown(
            normalizeCommentMarkdownForRender(bodyMarkdown),
            container,
            thread.filePath,
        );
        decorateRenderedCommentMentions(container);
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

export function threadHasLocalSideNoteReferences(
    thread: CommentThread,
    localVaultName: string | null,
): boolean {
    return getRenderableThreadEntries(thread).some((entry) => splitTrailingSideNoteReferenceSection(entry.body, {
        localOnly: true,
        localVaultName,
    }).references.length > 0);
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
        hasOutgoingSideNoteReferences?: boolean;
        hasIncomingSideNoteReferences?: boolean;
    },
): boolean {
    const childEntries = getRenderableThreadEntries(thread).slice(1);
    if (childEntries.length === 0) {
        return options.hasEditDraftComment
            || options.hasAppendDraftComment
            || options.hasAgentStream
            || (
                options.showNestedComments
                && (
                    options.hasOutgoingSideNoteReferences === true
                    || options.hasIncomingSideNoteReferences === true
                )
            );
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
    hasOutgoingSideNoteReferences?: boolean;
    hasIncomingSideNoteReferences?: boolean;
    hasInlineEditDraft: boolean;
    hasAppendDraftComment: boolean;
    hasChildEditDraft: boolean;
}): boolean {
    return (
        options.hasStoredChildEntries
        || options.hasOutgoingSideNoteReferences === true
        || options.hasIncomingSideNoteReferences === true
    )
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
            return;
        }

        const url = link.dataset.sidenote2CommentReferenceUrl
            || ((link.getAttribute("href") || "").startsWith("obsidian://side-note2-comment?")
                ? link.getAttribute("href")
                : null);
        if (!url) {
            return;
        }

        event.preventDefault();
        void (async () => {
            if (!(await host.saveVisibleDraftIfPresent())) {
                return;
            }

            await host.openSideNoteReference(url);
        })();
    });
}

function renderSideNoteReferenceSection(
    container: HTMLDivElement,
    label: string,
    references: readonly SidebarResolvedSideNoteReference[],
    host: SidebarPersistedCommentHost,
): void {
    if (references.length === 0) {
        return;
    }

    const sectionEl = container.createDiv("sidenote2-comment-reference-section");
    sectionEl.createSpan({
        cls: "sidenote2-comment-reference-section-label",
        text: label,
    });
    const listEl = sectionEl.createDiv("sidenote2-comment-reference-section-list");

    for (const reference of references) {
        const entryEl = listEl.createSpan("sidenote2-side-note-reference-entry");
        entryEl.classList.toggle("is-resolved", reference.presentation.resolved);
        entryEl.classList.toggle("is-unresolved", !reference.presentation.resolved);
        const linkEl = entryEl.createEl("a", {
            cls: "sidenote2-comment-reference-link",
        });
        linkEl.setAttribute("href", reference.url);
        linkEl.setAttribute("title", reference.presentation.tooltip);
        linkEl.classList.toggle("is-resolved", reference.presentation.resolved);
        linkEl.classList.toggle("is-unresolved", !reference.presentation.resolved);
        linkEl.createSpan({
            cls: "sidenote2-side-note-reference-title",
            text: `[[${reference.presentation.title}]]`,
        });
        if (reference.presentation.preview) {
            entryEl.createSpan({
                cls: "sidenote2-side-note-reference-preview",
                text: reference.presentation.preview,
            });
        }

        linkEl.addEventListener("click", (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            void (async () => {
                if (!(await host.saveVisibleDraftIfPresent())) {
                    return;
                }

                await host.openSideNoteReference(reference.url);
            })();
        });
    }
}

function getIncomingSideNoteReferenceBacklinksForRender(
    threadId: string,
    host: SidebarPersistedCommentHost,
): SidebarResolvedSideNoteReference[] {
    const backlinks = host.getIncomingSideNoteReferenceBacklinks(threadId);
    return backlinks.map((backlink) => ({
        presentation: {
            preview: backlink.preview,
            resolved: backlink.resolved,
            title: backlink.fileTitle,
            tooltip: [backlink.filePath, backlink.preview].filter(Boolean).join("\n"),
        },
        url: backlink.url,
    }));
}

function getThreadLocalSideNoteReferences(
    thread: CommentThread,
    host: SidebarPersistedCommentHost,
): SidebarResolvedSideNoteReference[] {
    const references: SidebarResolvedSideNoteReference[] = [];
    const seenUrls = new Set<string>();

    for (const entry of getRenderableThreadEntries(thread)) {
        const parsedEntry = splitTrailingSideNoteReferenceSection(entry.body || "", {
            localOnly: true,
            localVaultName: host.localVaultName,
        });
        for (const reference of parsedEntry.references) {
            if (seenUrls.has(reference.url)) {
                continue;
            }

            seenUrls.add(reference.url);
            references.push({
                presentation: buildSidebarSideNoteReferencePresentation(
                    host.getSideNoteReferenceDocument(reference.target.commentId),
                    {
                        filePath: reference.target.filePath,
                        label: reference.label,
                    },
                ),
                url: reference.url,
            });
        }
    }

    return references;
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

function renderCommentHeaderIndicator(
    metaEl: HTMLElement,
    host: SidebarPersistedCommentHost,
    options: {
        ariaLabel: string;
        className: string;
        icon: string;
        title?: string;
    },
): void {
    const indicatorEl = metaEl.createSpan({
        cls: `sidenote2-comment-header-indicator ${options.className}`,
    });
    indicatorEl.setAttribute("aria-label", options.ariaLabel);
    if (options.title) {
        indicatorEl.setAttribute("title", options.title);
    }
    host.setIcon(indicatorEl, options.icon);
}

function renderSideNoteReferenceStateIndicator(
    metaEl: HTMLElement,
    host: SidebarPersistedCommentHost,
): void {
    renderCommentHeaderIndicator(metaEl, host, {
        ariaLabel: "Contains side note links",
        className: "sidenote2-comment-reference-indicator",
        icon: "link-2",
    });
}

function renderBookmarkStateIndicator(
    metaEl: HTMLElement,
    commentId: string,
    host: SidebarPersistedCommentHost,
): void {
    const indicatorEl = metaEl.createEl("button", {
        cls: "sidenote2-comment-header-indicator sidenote2-comment-bookmark-indicator is-interactive",
    });
    attachSidebarActionButtonInteractions(indicatorEl, host);
    indicatorEl.setAttribute("type", "button");
    indicatorEl.setAttribute("aria-label", "Remove bookmark");
    indicatorEl.setAttribute("aria-pressed", "true");
    indicatorEl.setAttribute("title", "Remove bookmark");
    host.setIcon(indicatorEl, "bookmark");
    indicatorEl.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        await host.setCommentBookmarkState(commentId, false);
    };
}

function renderPinStateIndicator(
    metaEl: HTMLElement,
    threadId: string,
    host: SidebarPersistedCommentHost,
): void {
    const indicatorEl = metaEl.createEl("button", {
        cls: "sidenote2-comment-header-indicator sidenote2-comment-pin-indicator is-interactive",
    });
    attachSidebarActionButtonInteractions(indicatorEl, host);
    indicatorEl.setAttribute("type", "button");
    indicatorEl.setAttribute("aria-label", "Unpin this side note");
    indicatorEl.setAttribute("aria-pressed", "true");
    host.setIcon(indicatorEl, "pin");
    indicatorEl.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        await host.togglePinnedThread(threadId);
    };
}

function renderCommentMeta(
    headerEl: HTMLElement,
    comment: Comment,
    meta: Pick<BasePersistedCommentPresentation, "metaText" | "metaPreviewText">,
    host: SidebarPersistedCommentHost,
    options: {
        showPinState?: boolean;
        showBookmarkState?: boolean;
        showSideNoteReferenceState?: boolean;
    } = {},
): void {
    const metaEl = headerEl.createEl("small", {
        cls: "sidenote2-timestamp sidenote2-comment-meta",
    });
    const renderLeadingIndicators = () => {
        if (options.showPinState) {
            renderPinStateIndicator(metaEl, comment.id, host);
        }
        if (options.showBookmarkState) {
            renderBookmarkStateIndicator(metaEl, comment.id, host);
        }
        if (options.showSideNoteReferenceState) {
            renderSideNoteReferenceStateIndicator(metaEl, host);
        }
    };

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
        renderLeadingIndicators();
        metaEl.createSpan({
            cls: "sidenote2-comment-meta-value",
            text: meta.metaText,
        });
        return;
    }

    if (meta.metaPreviewText) {
        renderLeadingIndicators();
        metaEl.createSpan({
            cls: "sidenote2-comment-meta-preview",
            text: meta.metaPreviewText,
        });
    }

    if (!meta.metaPreviewText) {
        renderLeadingIndicators();
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

function renderBookmarkButton(
    actionsEl: HTMLDivElement,
    commentId: string,
    isBookmark: boolean,
    host: SidebarPersistedCommentHost,
): void {
    const presentation = buildPersistedCommentBookmarkActionPresentation({ isBookmark });
    const bookmarkButton = actionsEl.createEl("button", {
        cls: [
            "clickable-icon",
            "sidenote2-comment-action-button",
            "sidenote2-comment-action-bookmark",
            presentation.active ? "is-active" : "",
        ].filter((value) => value.length > 0).join(" "),
    });
    attachSidebarActionButtonInteractions(bookmarkButton, host);
    bookmarkButton.setAttribute("type", "button");
    bookmarkButton.setAttribute("aria-label", presentation.ariaLabel);
    bookmarkButton.setAttribute("aria-pressed", presentation.active ? "true" : "false");
    host.setIcon(bookmarkButton, "bookmark");
    bookmarkButton.onclick = async (event) => {
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        await host.setCommentBookmarkState(commentId, !presentation.active);
    };
}

function renderPinButton(
    actionsEl: HTMLDivElement,
    threadId: string,
    host: SidebarPersistedCommentHost,
): void {
    const presentation = buildPersistedCommentPinActionPresentation(host.isPinnedThread(threadId));
    const pinButton = actionsEl.createEl("button", {
        cls: [
            "clickable-icon",
            "sidenote2-comment-action-button",
            "sidenote2-comment-action-pin",
            presentation.active ? "is-active" : "",
        ].filter((value) => value.length > 0).join(" "),
    });
    attachSidebarActionButtonInteractions(pinButton, host);
    pinButton.setAttribute("type", "button");
    pinButton.setAttribute("aria-label", presentation.ariaLabel);
    pinButton.setAttribute("aria-pressed", presentation.active ? "true" : "false");
    host.setIcon(pinButton, "pin");
    pinButton.onclick = async (event) => {
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        await host.togglePinnedThread(threadId);
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

function renderMoveThreadButton(
    actionsEl: HTMLDivElement,
    threadId: string,
    sourceFilePath: string,
    host: SidebarPersistedCommentHost,
    options: {
        ariaLabel: string;
        icon: string;
    },
): void {
    const moveButton = actionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-move",
    });
    attachSidebarActionButtonInteractions(moveButton, host);
    moveButton.setAttribute("type", "button");
    moveButton.setAttribute("aria-label", options.ariaLabel);
    host.setIcon(moveButton, options.icon);
    moveButton.onclick = async (event) => {
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        host.moveCommentThread(threadId, sourceFilePath);
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
    buttonEl: HTMLElement,
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
        showSideNoteReferenceState?: boolean;
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
    const parsedEntryBody = splitTrailingSideNoteReferenceSection(options.entryBody, {
        localOnly: true,
        localVaultName: options.host.localVaultName,
    });

    const headerEl = commentEl.createDiv("sidenote2-comment-header");
    const headerMainEl = headerEl.createDiv("sidenote2-comment-header-main");
    renderCommentMeta(headerMainEl, options.comment, options.presentation, options.host, {
        showPinState: shouldRenderPersistedCommentPinIndicator(
            options.comment,
            options.thread,
            options.host.isPinnedThread(options.thread.id),
        ),
        showBookmarkState: shouldRenderPersistedCommentBookmarkIndicator(options.comment, options.thread),
        showSideNoteReferenceState: options.showSideNoteReferenceState ?? parsedEntryBody.references.length > 0,
    });
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
        moveAction?: {
            threadId: string;
            sourceFilePath: string;
            ariaLabel: string;
            icon: string;
        } | null;
        insertAction?: {
            filePath: string;
            markdown: string;
        } | null;
    },
    host: SidebarPersistedCommentHost,
): void {
    const footerEl = commentEl.createDiv("sidenote2-thread-footer");
    const footerMetaEl = footerEl.createDiv("sidenote2-thread-footer-meta");
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
            text: "Add to source",
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
            await host.insertCommentMarkdownIntoNote(insertAction.filePath, insertAction.markdown);
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
        renderMoveThreadButton(footerActionsEl, options.moveAction.threadId, options.moveAction.sourceFilePath, host, {
            ariaLabel: options.moveAction.ariaLabel,
            icon: options.moveAction.icon,
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
        if (retryRunId) {
            const started = await host.retryAgentRun(retryRunId);
            if (!started) {
                retryButton.disabled = options.disableRetryAction === true;
            }
            return;
        }
        retryButton.disabled = options.disableRetryAction === true;
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
    const hasAgentReplyEntries = entries.slice(1).some((entry) =>
        !!getAgentRunByOutputEntryId(host.threadAgentRuns, entry.id)
    );
    const outgoingSideNoteReferences = getThreadLocalSideNoteReferences(thread, host);
    const incomingSideNoteReferenceBacklinks = getIncomingSideNoteReferenceBacklinksForRender(thread.id, host);
    const threadHasOutgoingSideNoteReferences = outgoingSideNoteReferences.length > 0;
    const threadHasIncomingSideNoteReferences = incomingSideNoteReferenceBacklinks.length > 0;
    const shouldRenderStoredChildren = host.showNestedComments
        || hasChildEditDraft
        || host.agentStream !== null
        || !!host.appendDraftComment;
    const shouldRenderChildComments = shouldRenderNestedThreadEntries(thread, {
        activeCommentId: host.activeCommentId,
        showNestedComments: host.showNestedComments,
        showNestedCommentsByDefault: host.showNestedCommentsByDefault,
        hasEditDraftComment: hasChildEditDraft,
        hasAppendDraftComment: !!host.appendDraftComment,
        hasAgentStream: !!host.agentStream,
        hasAgentReplies: hasAgentReplyEntries,
        hasDeletedEntriesVisible: hasVisibleDeletedEntries(thread),
        hasOutgoingSideNoteReferences: threadHasOutgoingSideNoteReferences,
        hasIncomingSideNoteReferences: threadHasIncomingSideNoteReferences,
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
        showSideNoteReferenceState: threadHasOutgoingSideNoteReferences,
    });
    const commentEl = renderedParent.commentEl;
    const actionsEl = renderedParent.actionsEl;
    renderTasks.push(renderedParent.renderTask);
    if (isDraggablePageThread && !parentEditDraft) {
        renderReorderHandle(actionsEl, thread.id, host);
    }
    if (!parentEditDraft) {
        const parentRetryRun = getRetryableAgentRunForSidebarComment(comment.id, host.threadAgentRuns);
        const parentInsertMarkdown = !comment.deletedAt && !thread.deletedAt
            ? getInsertableSidebarCommentMarkdown(comment.id, entries[0]?.body || "", host.threadAgentRuns)
            : null;
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

            if (shouldRenderPersistedCommentBookmarkAction(comment, thread)) {
                renderBookmarkButton(actionsEl, thread.id, comment.isBookmark === true, host);
            }
            if (shouldRenderPersistedCommentPinAction(comment, thread, host.isPinnedThread(thread.id))) {
                renderPinButton(actionsEl, thread.id, host);
            }
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
        renderThreadFooterActions(commentEl, comment, parentRetryRun?.id ?? null, parentAuthor, null, {
            showShareAction: !comment.deletedAt,
            showAddEntryAction: !comment.deletedAt,
            showRetryAction: !!parentRetryRun && !comment.deletedAt && !thread.deletedAt,
            disableRetryAction: isRetryableAgentRunBusy(parentRetryRun),
            moveAction: !comment.deletedAt && !thread.deletedAt
                ? {
                    threadId: thread.id,
                    sourceFilePath: thread.filePath,
                    ariaLabel: presentation.moveAction.ariaLabel,
                    icon: presentation.moveAction.icon,
                }
                : null,
            insertAction: parentInsertMarkdown
                ? {
                    filePath: comment.filePath,
                    markdown: parentInsertMarkdown,
                }
                : null,
        }, host);
    }
    if (shouldRenderThreadNestedToggle({
        hasStoredChildEntries,
        hasOutgoingSideNoteReferences: threadHasOutgoingSideNoteReferences,
        hasIncomingSideNoteReferences: threadHasIncomingSideNoteReferences,
        hasInlineEditDraft: !!parentEditDraft,
        hasAppendDraftComment: !!host.appendDraftComment,
        hasChildEditDraft,
    })) {
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
                        showShareAction: !entryComment.deletedAt && !thread.deletedAt,
                        showAddEntryAction: !entryComment.deletedAt && !thread.deletedAt,
                        showRetryAction: !!entryRetryRun && !entryComment.deletedAt && !thread.deletedAt,
                        disableRetryAction: isRetryableAgentRunBusy(entryRetryRun),
                        moveAction: null,
                        insertAction: entryInsertMarkdown
                            ? {
                                filePath: entryComment.filePath,
                                markdown: entryInsertMarkdown,
                            }
                            : null,
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

    if (outgoingSideNoteReferences.length > 0) {
        renderSideNoteReferenceSection(childCommentsEl, "Mentioned", outgoingSideNoteReferences, host);
    }
    if (incomingSideNoteReferenceBacklinks.length > 0) {
        renderSideNoteReferenceSection(childCommentsEl, "Mentioned by", incomingSideNoteReferenceBacklinks, host);
    }

    await Promise.all(renderTasks);
}
