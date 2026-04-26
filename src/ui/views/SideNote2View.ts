import {
    ItemView,
    MarkdownView,
    MarkdownRenderer,
    Notice,
    TFile,
    WorkspaceLeaf,
    loadMermaid,
    setIcon,
    type ViewStateResult,
} from "obsidian";
import type { Comment, CommentThread, ReorderPlacement } from "../../commentManager";
import { buildCommentLocationUrl } from "../../core/derived/allCommentsNote";
import {
    getAgentRunsForCommentThread,
    type AgentRunRecord,
} from "../../core/agents/agentRuns";
import {
    buildIndexFileFilterGraph,
    type IndexFileFilterGraph,
} from "../../core/derived/indexFileFilterGraph";
import {
    buildThoughtTrailLines,
    extractThoughtTrailMermaidSource,
    getThoughtTrailMermaidRenderConfig,
} from "../../core/derived/thoughtTrail";
import type { DraftComment } from "../../domain/drafts";
import type SideNote2 from "../../main";
import type { AgentStreamUpdate } from "../../control/commentAgentController";
import SideNoteFileFilterModal from "../modals/SideNoteFileFilterModal";
import SideNoteLinkSuggestModal from "../modals/SideNoteLinkSuggestModal";
import SideNoteOpenFileSuggestModal from "../modals/SideNoteOpenFileSuggestModal";
import SideNoteTagSuggestModal from "../modals/SideNoteTagSuggestModal";
import { SIDE_NOTE2_ICON_ID } from "../sideNote2Icon";
import { copyTextToClipboard } from "../copyTextToClipboard";
import { SidebarDraftEditorController } from "./sidebarDraftEditor";
import {
    renderDraftCommentCard,
    renderInlineEditDraftContent,
} from "./sidebarDraftComment";
import {
    buildIndexFileFilterOptionsFromCounts,
    deriveIndexSidebarScopedFilePaths,
    getIndexFileFilterLabel,
    shouldLimitIndexSidebarList,
    type IndexFileFilterOption,
} from "./indexFileFilter";
import { INDEX_SIDEBAR_LIST_LIMIT, limitIndexSidebarListItems } from "./indexSidebarListLimit";
import { SidebarInteractionController } from "./sidebarInteractionController";
import {
    buildPageSidebarDraftRenderSignature,
    buildPageSidebarThreadRenderSignature,
} from "./sidebarPageRenderSignature";
import {
    countBookmarkThreads,
    filterThreadsByPinnedSidebarThreadIds,
    filterThreadsByPinnedSidebarViewState,
    filterThreadsBySidebarContentFilter,
    rankThreadsBySidebarSearchQuery,
    toggleDeletedSidebarViewState,
    toggleSidebarContentFilterState,
    unlockSidebarContentFilterForDraft,
    type SidebarContentFilter,
} from "./sidebarContentFilter";
import { renderPersistedCommentCard } from "./sidebarPersistedComment";
import {
    buildStoredOrderSidebarItems,
    getNestedThreadIdForEditDraft,
    getNestedThreadIdForAppendDraft,
    getReplacedThreadIdForEditDraft,
    matchesPinnedSidebarDraftVisibility,
    shouldRenderTopLevelDraftComment,
    sortSidebarRenderableItems,
    type SidebarRenderableItem,
} from "./sidebarRenderOrder";
import { extractThoughtTrailClickTargets, parseThoughtTrailOpenFilePath, resolveThoughtTrailNodeId } from "./thoughtTrailNodeLinks";
import { parseTrustedMermaidSvg } from "./thoughtTrailSvg";
import { buildRootedThoughtTrailScope } from "./sidebarThoughtTrailScope";
import { clearSidebarSearchHighlights, highlightSidebarSearchMatches } from "./sidebarSearchHighlight";
import {
    filterIndexThreadsByExistingSourceFiles,
    scopeIndexThreadsByFilePaths,
    shouldShowActiveIndexEmptyState,
    shouldShowIndexListToolbarChips,
    shouldShowNestedToolbarChip,
    shouldShowResolvedIndexEmptyState,
    shouldShowResolvedToolbarChip,
} from "./indexSidebarState";
import { StreamedAgentReplyController } from "./streamedAgentReplyController";
import {
    countDeletedComments,
    hasDeletedComments,
    isSoftDeleted,
} from "../../core/rules/deletedCommentVisibility";
import {
    normalizeSidebarPrimaryMode,
    normalizeIndexFileFilterRootPath,
    resolveIndexFileFilterRootPathFromState,
    resolvePinnedSidebarStateByFilePathFromState,
    type CustomViewState,
    type IndexSidebarMode,
    type PinnedSidebarFileState,
    type SidebarPrimaryMode,
} from "./viewState";
import { normalizeSidebarViewFile } from "./sidebarViewFileState";

function matchesResolvedVisibility(resolved: boolean | undefined, showResolved: boolean): boolean {
    return showResolved ? resolved === true : resolved !== true;
}

const EMPTY_PINNED_SIDEBAR_THREAD_IDS: ReadonlySet<string> = new Set<string>();

function matchesPageSidebarVisibility(
    thread: CommentThread,
    options: {
        showResolved: boolean;
        showDeleted: boolean;
    },
): boolean {
    if (options.showDeleted) {
        return isSoftDeleted(thread) || hasDeletedComments(thread);
    }

    if (isSoftDeleted(thread)) {
        return false;
    }

    return matchesResolvedVisibility(thread.resolved, options.showResolved);
}

function parseSidebarPrimaryMode(value: unknown): SidebarPrimaryMode | null {
    return normalizeSidebarPrimaryMode(value);
}

type SidebarReorderDragState =
    | {
        kind: "thread";
        filePath: string;
        threadId: string;
    }
    | {
        kind: "thread-entry";
        entryId: string;
        filePath: string;
        sourceThreadId: string;
    };

type NoteSidebarShell = {
    filePath: string;
    commentsContainerEl: HTMLDivElement;
    toolbarSlotEl: HTMLDivElement;
    commentsBodyEl: HTMLDivElement;
    supportSlotEl: HTMLDivElement;
};

type NoteSidebarRenderDescriptor = {
    key: string;
    signature: string;
    threadId: string | null;
    render: () => Promise<HTMLElement>;
};

type MermaidRenderResult = string | {
    bindFunctions?: (element: HTMLElement) => void;
    svg?: string;
};

type MermaidRuntimeLike = {
    getConfig?: () => unknown;
    initialize: (config: unknown) => void;
    mermaidAPI?: {
        getConfig?: () => unknown;
    };
    render: (id: string, source: string) => Promise<MermaidRenderResult>;
};

type OpenMarkdownFileInsertTarget = {
    file: TFile;
    leaf: WorkspaceLeaf;
    view: MarkdownView;
    active: boolean;
    recent: boolean;
    editable: boolean;
};

function isMermaidRuntimeLike(value: unknown): value is MermaidRuntimeLike {
    if (!value || typeof value !== "object") {
        return false;
    }

    const candidate = value as Partial<MermaidRuntimeLike>;
    return typeof candidate.initialize === "function"
        && typeof candidate.render === "function";
}

function buildAppendToFileEndText(
    noteContent: string,
    blockMarkdown: string,
): string {
    const normalizedBlock = blockMarkdown.trim();
    if (!normalizedBlock) {
        return "";
    }

    if (!noteContent) {
        return normalizedBlock;
    }

    if (noteContent.endsWith("\n\n")) {
        return normalizedBlock;
    }

    return noteContent.endsWith("\n")
        ? `\n${normalizedBlock}`
        : `\n\n${normalizedBlock}`;
}

function shouldReplaceOpenMarkdownFileInsertTarget(
    current: OpenMarkdownFileInsertTarget,
    candidate: OpenMarkdownFileInsertTarget,
): boolean {
    if (current.editable !== candidate.editable) {
        return candidate.editable;
    }

    if (current.active !== candidate.active) {
        return candidate.active;
    }

    if (current.recent !== candidate.recent) {
        return candidate.recent;
    }

    return false;
}

function compareOpenMarkdownFileInsertTargets(
    left: OpenMarkdownFileInsertTarget,
    right: OpenMarkdownFileInsertTarget,
): number {
    if (left.active !== right.active) {
        return left.active ? -1 : 1;
    }

    if (left.recent !== right.recent) {
        return left.recent ? -1 : 1;
    }

    const fileNameComparison = left.file.basename.localeCompare(right.file.basename);
    return fileNameComparison !== 0
        ? fileNameComparison
        : left.file.path.localeCompare(right.file.path);
}

async function ensureEditableMarkdownLeafForInsert(leaf: WorkspaceLeaf): Promise<MarkdownView | null> {
    if (!(leaf.view instanceof MarkdownView)) {
        return null;
    }

    if (leaf.view.getMode() !== "preview") {
        return leaf.view;
    }

    const viewState = leaf.getViewState();
    if (viewState.type !== "markdown") {
        return null;
    }

    await leaf.setViewState({
        ...viewState,
        state: {
            ...(viewState.state ?? {}),
            mode: "source",
            source: false,
        },
    });

    return leaf.view instanceof MarkdownView ? leaf.view : null;
}

export default class SideNote2View extends ItemView {
    private static readonly NOTE_SIDEBAR_SEARCH_DEBOUNCE_MS = 120;
    private file: TFile | null = null;
    private plugin: SideNote2;
    private renderVersion = 0;
    private readonly draftEditorController: SidebarDraftEditorController;
    private readonly interactionController: SidebarInteractionController;
    private indexSidebarMode: IndexSidebarMode = "list";
    private noteSidebarMode: SidebarPrimaryMode = "list";
    private noteSidebarContentFilter: SidebarContentFilter = "all";
    private noteSidebarSearchQuery = "";
    private noteSidebarSearchInputValue = "";
    private noteSidebarSearchDebounceTimer: number | null = null;
    private noteSidebarSearchRequestVersion = 0;
    private indexSidebarSearchQuery = "";
    private indexSidebarSearchInputValue = "";
    private indexSidebarSearchDebounceTimer: number | null = null;
    private indexSidebarSearchRequestVersion = 0;
    private pinnedSidebarThreadIds = new Set<string>();
    private showPinnedSidebarThreadsOnly = false;
    private pinnedSidebarStateByFilePath: Record<string, PinnedSidebarFileState> = {};
    private selectedIndexFileFilterRootPath: string | null = null;
    private indexFileFilterGraph: IndexFileFilterGraph | null = null;
    private reorderDragState: SidebarReorderDragState | null = null;
    private reorderDragSourceEl: HTMLElement | null = null;
    private reorderDropIndicatorEl: HTMLElement | null = null;
    private reorderDropIndicatorPlacement: ReorderPlacement | null = null;
    private noteSidebarShell: NoteSidebarShell | null = null;
    private readonly streamedReplyControllers = new Map<string, StreamedAgentReplyController>();
    private unsubscribeFromAgentStreamUpdates: (() => void) | null = null;

    private isNonDesktopClient(): boolean {
        const electronRequire = typeof window !== "undefined"
            ? (window as Window & { require?: unknown }).require
            : undefined;
        return typeof electronRequire !== "function";
    }

    private syncViewContainerClasses(): void {
        this.containerEl.addClass("sidenote2-view-container");
        this.containerEl.classList.toggle("is-non-desktop", this.isNonDesktopClient());
    }

    private getNormalizedPinnedSidebarStateFilePath(filePath: string | null | undefined): string | null {
        return normalizeIndexFileFilterRootPath(filePath);
    }

    private savePinnedSidebarStateForFilePath(filePath: string | null | undefined): void {
        const normalizedFilePath = this.getNormalizedPinnedSidebarStateFilePath(filePath);
        if (!normalizedFilePath) {
            return;
        }

        if (this.pinnedSidebarThreadIds.size === 0 && !this.showPinnedSidebarThreadsOnly) {
            delete this.pinnedSidebarStateByFilePath[normalizedFilePath];
            return;
        }

        this.pinnedSidebarStateByFilePath[normalizedFilePath] = {
            threadIds: Array.from(this.pinnedSidebarThreadIds),
            showPinnedThreadsOnly: this.showPinnedSidebarThreadsOnly,
        };
    }

    private restorePinnedSidebarStateForFilePath(filePath: string | null | undefined): void {
        const normalizedFilePath = this.getNormalizedPinnedSidebarStateFilePath(filePath);
        if (!normalizedFilePath) {
            this.pinnedSidebarThreadIds.clear();
            this.showPinnedSidebarThreadsOnly = false;
            return;
        }

        const fileState = this.pinnedSidebarStateByFilePath[normalizedFilePath];
        if (!fileState) {
            this.pinnedSidebarThreadIds.clear();
            this.showPinnedSidebarThreadsOnly = false;
            return;
        }

        this.pinnedSidebarThreadIds = new Set(fileState.threadIds);
        this.showPinnedSidebarThreadsOnly = fileState.showPinnedThreadsOnly;
    }

    private setCurrentFile(nextFile: TFile | null): void {
        const currentFilePath = this.file?.path ?? null;
        const nextFilePath = nextFile?.path ?? null;
        if (currentFilePath !== nextFilePath) {
            this.savePinnedSidebarStateForFilePath(currentFilePath);
            this.clearNoteSidebarSearchDebounceTimer();
            this.clearIndexSidebarSearchDebounceTimer();
            this.noteSidebarSearchRequestVersion += 1;
            this.indexSidebarSearchRequestVersion += 1;
            this.noteSidebarSearchQuery = "";
            this.noteSidebarSearchInputValue = "";
            this.indexSidebarSearchQuery = "";
            this.indexSidebarSearchInputValue = "";
        }
        this.file = nextFile;
        if (currentFilePath !== nextFilePath) {
            this.restorePinnedSidebarStateForFilePath(nextFilePath);
        }
    }

    private syncPinnedSidebarThreadIds<T extends Pick<CommentThread, "id">>(threads: readonly T[]): void {
        const pinnedThreads = filterThreadsByPinnedSidebarThreadIds(threads, this.pinnedSidebarThreadIds);
        if (this.pinnedSidebarThreadIds.size > 0) {
            this.pinnedSidebarThreadIds = new Set(pinnedThreads.map((thread) => thread.id));
            this.savePinnedSidebarStateForFilePath(this.file?.path ?? null);
        }
    }

    private isPinnedSidebarThread(threadId: string): boolean {
        return this.pinnedSidebarThreadIds.has(threadId);
    }

    private getPinnedSidebarFilterThreadIds(): ReadonlySet<string> {
        return this.showPinnedSidebarThreadsOnly
            ? this.pinnedSidebarThreadIds
            : EMPTY_PINNED_SIDEBAR_THREAD_IDS;
    }

    private async togglePinnedSidebarThread(threadId: string): Promise<void> {
        if (this.pinnedSidebarThreadIds.has(threadId)) {
            this.pinnedSidebarThreadIds.delete(threadId);
        } else {
            this.pinnedSidebarThreadIds.add(threadId);
        }
        this.savePinnedSidebarStateForFilePath(this.file?.path ?? null);
        await this.renderComments({
            skipDataRefresh: true,
        });
    }

    private getCurrentLocalNoteSidebarFilePath(): string | null {
        const currentFilePath = this.file?.path ?? null;
        if (!currentFilePath || this.plugin.isAllCommentsNotePath(currentFilePath)) {
            return null;
        }

        return currentFilePath;
    }

    private async rerenderLocalNoteSidebarIfStillShowing(filePath: string | null): Promise<void> {
        if (!filePath || this.file?.path !== filePath) {
            return;
        }

        await this.renderComments({
            skipDataRefresh: true,
        });
    }

    private async setSidebarCommentBookmarkState(commentId: string, isBookmark: boolean): Promise<void> {
        const currentFilePath = this.getCurrentLocalNoteSidebarFilePath();
        const updated = await this.plugin.setCommentBookmarkState(
            commentId,
            isBookmark,
            currentFilePath
                ? {
                    deferAggregateRefresh: true,
                    skipPersistedViewRefresh: true,
                    refreshEditorDecorations: false,
                    refreshMarkdownPreviews: false,
                }
                : undefined,
        );
        if (!updated) {
            return;
        }

        await this.rerenderLocalNoteSidebarIfStillShowing(currentFilePath);
    }

    private async setSidebarCommentResolvedState(commentId: string, resolved: boolean): Promise<void> {
        const currentFilePath = this.getCurrentLocalNoteSidebarFilePath();
        const updated = resolved
            ? await this.plugin.resolveComment(
                commentId,
                currentFilePath
                    ? {
                        deferAggregateRefresh: true,
                        skipPersistedViewRefresh: true,
                    }
                    : undefined,
            )
            : await this.plugin.unresolveComment(
                commentId,
                currentFilePath
                    ? {
                        deferAggregateRefresh: true,
                        skipPersistedViewRefresh: true,
                    }
                    : undefined,
            );
        if (!updated) {
            return;
        }

        await this.rerenderLocalNoteSidebarIfStillShowing(currentFilePath);
    }

    private async deleteSidebarComment(commentId: string): Promise<boolean> {
        const currentFilePath = this.getCurrentLocalNoteSidebarFilePath();
        let exitedDeletedMode = false;
        if (currentFilePath && this.plugin.shouldShowDeletedComments()) {
            exitedDeletedMode = await this.plugin.setShowDeletedComments(false, {
                skipCommentViewRefresh: true,
            });
        } else if (!currentFilePath && this.plugin.shouldShowDeletedComments()) {
            await this.plugin.setShowDeletedComments(false);
        }

        const deleted = await this.plugin.deleteComment(
            commentId,
            currentFilePath
                ? {
                    deferAggregateRefresh: true,
                    skipPersistedViewRefresh: true,
                }
                : undefined,
        );
        if (!deleted) {
            if (exitedDeletedMode) {
                await this.rerenderLocalNoteSidebarIfStillShowing(currentFilePath);
            }
            return false;
        }

        await this.rerenderLocalNoteSidebarIfStillShowing(currentFilePath);
        return true;
    }

    private async moveSidebarCommentThreadToFile(threadId: string, targetFilePath: string): Promise<boolean> {
        const currentFilePath = this.getCurrentLocalNoteSidebarFilePath();
        const moved = await this.plugin.moveCommentThreadToFile(
            threadId,
            targetFilePath,
            currentFilePath
                ? {
                    deferAggregateRefresh: true,
                    skipPersistedViewRefresh: true,
                }
                : undefined,
        );
        if (!moved) {
            return false;
        }

        await this.rerenderLocalNoteSidebarIfStillShowing(currentFilePath);
        return true;
    }

    private async moveSidebarCommentEntryToThread(entryId: string, targetThreadId: string): Promise<boolean> {
        const currentFilePath = this.getCurrentLocalNoteSidebarFilePath();
        const moved = await this.plugin.moveCommentEntryToThread(
            entryId,
            targetThreadId,
            currentFilePath
                ? {
                    deferAggregateRefresh: true,
                    skipPersistedViewRefresh: true,
                    refreshEditorDecorations: false,
                    refreshMarkdownPreviews: false,
                }
                : undefined,
        );
        if (!moved) {
            return false;
        }

        await this.plugin.setShowNestedCommentsForThread(targetThreadId, true, currentFilePath
            ? {
                skipCommentViewRefresh: true,
            }
            : undefined);
        if (currentFilePath && this.file?.path === currentFilePath) {
            this.highlightComment(entryId, {
                skipDataRefresh: true,
            });
            return true;
        }

        this.highlightComment(entryId);
        return true;
    }

    private async togglePinnedSidebarMode(): Promise<void> {
        this.showPinnedSidebarThreadsOnly = !this.showPinnedSidebarThreadsOnly;
        this.savePinnedSidebarStateForFilePath(this.file?.path ?? null);
        await this.renderComments({
            skipDataRefresh: true,
        });
    }

    private clearNoteSidebarSearchDebounceTimer(): void {
        if (this.noteSidebarSearchDebounceTimer === null) {
            return;
        }

        window.clearTimeout(this.noteSidebarSearchDebounceTimer);
        this.noteSidebarSearchDebounceTimer = null;
    }

    private clearIndexSidebarSearchDebounceTimer(): void {
        if (this.indexSidebarSearchDebounceTimer === null) {
            return;
        }

        window.clearTimeout(this.indexSidebarSearchDebounceTimer);
        this.indexSidebarSearchDebounceTimer = null;
    }

    private scheduleNoteSidebarSearchQuery(
        query: string,
        options: {
            selectionStart?: number | null;
            selectionEnd?: number | null;
        } = {},
    ): void {
        this.noteSidebarSearchInputValue = query;
        const requestVersion = ++this.noteSidebarSearchRequestVersion;
        this.clearNoteSidebarSearchDebounceTimer();
        if (this.noteSidebarSearchQuery === query) {
            return;
        }

        this.noteSidebarSearchDebounceTimer = window.setTimeout(() => {
            this.noteSidebarSearchDebounceTimer = null;
            void this.applyNoteSidebarSearchQuery(query, requestVersion, options);
        }, SideNote2View.NOTE_SIDEBAR_SEARCH_DEBOUNCE_MS);
    }

    private async applyNoteSidebarSearchQuery(
        query: string,
        requestVersion: number,
        options: {
            selectionStart?: number | null;
            selectionEnd?: number | null;
        } = {},
    ): Promise<void> {
        if (this.noteSidebarSearchQuery === query) {
            return;
        }

        this.noteSidebarSearchInputValue = query;
        const activeElement = document.activeElement;
        const shouldRestoreFocus = activeElement instanceof HTMLInputElement
            && activeElement.matches(".sidenote2-note-search-input")
            && this.containerEl.contains(activeElement);
        if (query.trim() && this.noteSidebarMode !== "list") {
            this.noteSidebarMode = "list";
            void this.plugin.logEvent("info", "note", "note.mode.changed", {
                mode: "list",
                source: "search",
            });
        }

        this.noteSidebarSearchQuery = query;
        const currentFilePath = this.file?.path ?? null;
        await this.renderComments({
            skipDataRefresh: true,
        });
        if (requestVersion !== this.noteSidebarSearchRequestVersion) {
            return;
        }

        if (
            !currentFilePath
            || this.file?.path !== currentFilePath
            || this.plugin.isAllCommentsNotePath(currentFilePath)
            || !shouldRestoreFocus
        ) {
            return;
        }

        const inputEl = this.containerEl.querySelector(".sidenote2-note-search-input");
        if (!(inputEl instanceof HTMLInputElement)) {
            return;
        }

        const maxSelection = inputEl.value.length;
        const selectionStart = Math.max(0, Math.min(options.selectionStart ?? maxSelection, maxSelection));
        const selectionEnd = Math.max(0, Math.min(options.selectionEnd ?? selectionStart, maxSelection));
        this.interactionController.claimSidebarInteractionOwnership(inputEl);
        inputEl.setSelectionRange(selectionStart, selectionEnd);
    }

    private scheduleIndexSidebarSearchQuery(
        query: string,
        options: {
            selectionStart?: number | null;
            selectionEnd?: number | null;
        } = {},
    ): void {
        this.indexSidebarSearchInputValue = query;
        const requestVersion = ++this.indexSidebarSearchRequestVersion;
        this.clearIndexSidebarSearchDebounceTimer();
        if (this.indexSidebarSearchQuery === query) {
            return;
        }

        this.indexSidebarSearchDebounceTimer = window.setTimeout(() => {
            this.indexSidebarSearchDebounceTimer = null;
            void this.applyIndexSidebarSearchQuery(query, requestVersion, options);
        }, SideNote2View.NOTE_SIDEBAR_SEARCH_DEBOUNCE_MS);
    }

    private async applyIndexSidebarSearchQuery(
        query: string,
        requestVersion: number,
        options: {
            selectionStart?: number | null;
            selectionEnd?: number | null;
        } = {},
    ): Promise<void> {
        if (this.indexSidebarSearchQuery === query) {
            return;
        }

        this.indexSidebarSearchInputValue = query;
        const activeElement = document.activeElement;
        const shouldRestoreFocus = activeElement instanceof HTMLInputElement
            && activeElement.matches(".sidenote2-note-search-input")
            && this.containerEl.contains(activeElement);
        if (query.trim() && this.indexSidebarMode !== "list") {
            this.indexSidebarMode = "list";
            void this.plugin.logEvent("info", "index", "index.mode.changed", {
                mode: "list",
                source: "search",
            });
        }

        this.indexSidebarSearchQuery = query;
        const currentFilePath = this.file?.path ?? null;
        await this.renderComments({
            skipDataRefresh: true,
        });
        if (requestVersion !== this.indexSidebarSearchRequestVersion) {
            return;
        }

        if (
            !currentFilePath
            || this.file?.path !== currentFilePath
            || !this.plugin.isAllCommentsNotePath(currentFilePath)
            || !shouldRestoreFocus
        ) {
            return;
        }

        const inputEl = this.containerEl.querySelector(".sidenote2-note-search-input");
        if (!(inputEl instanceof HTMLInputElement)) {
            return;
        }

        const maxSelection = inputEl.value.length;
        const selectionStart = Math.max(0, Math.min(options.selectionStart ?? maxSelection, maxSelection));
        const selectionEnd = Math.max(0, Math.min(options.selectionEnd ?? selectionStart, maxSelection));
        this.interactionController.claimSidebarInteractionOwnership(inputEl);
        inputEl.setSelectionRange(selectionStart, selectionEnd);
    }

    constructor(leaf: WorkspaceLeaf, plugin: SideNote2, file: TFile | null = null) {
        super(leaf);
        this.plugin = plugin;
        this.file = file;
        this.interactionController = new SidebarInteractionController({
            app: this.app,
            leaf: this.leaf,
            containerEl: this.containerEl,
            getCurrentFile: () => this.file,
            getDraftForView: (filePath) => this.plugin.getDraftForView(filePath),
            renderComments: () => this.renderComments(),
            saveDraft: (commentId) => this.plugin.saveDraft(commentId),
            cancelDraft: (commentId) => {
                void this.plugin.cancelDraft(commentId);
            },
            clearRevealedCommentSelection: () => {
                this.plugin.clearRevealedCommentSelection();
            },
            revealComment: (comment) => this.plugin.revealComment(comment),
            openCommentById: (filePath, commentId) => this.plugin.openCommentById(filePath, commentId),
            getPreferredFileLeaf: () => this.plugin.getPreferredFileLeaf(),
            openLinkText: (href, sourcePath) => this.app.workspace.openLinkText(href, sourcePath, false),
            shouldShowDeletedComments: () => this.plugin.shouldShowDeletedComments(),
            setShowDeletedComments: async (showDeleted) => {
                await this.plugin.setShowDeletedComments(showDeleted);
            },
            log: (level, area, event, payload) => this.plugin.logEvent(level, area, event, payload),
        });
        this.draftEditorController = new SidebarDraftEditorController({
            getAllIndexedComments: () => this.plugin.getAllIndexedComments(),
            updateDraftCommentText: (commentId, commentText) => {
                this.plugin.updateDraftCommentText(commentId, commentText);
            },
            renderComments: () => this.renderComments(),
            scheduleDraftFocus: (commentId) => this.interactionController.scheduleDraftFocus(commentId),
            openLinkSuggestModal: (options) => {
                new SideNoteLinkSuggestModal(this.app, options).open();
            },
            openTagSuggestModal: (options) => {
                new SideNoteTagSuggestModal(this.app, options).open();
            },
        });
    }

    getViewType() {
        return "sidenote2-view";
    }

    getDisplayText() {
        return "Side notes";
    }

    getIcon() {
        return SIDE_NOTE2_ICON_ID;
    }

    async onOpen() {
        await Promise.resolve();
        if (!this.file) {
            this.file = this.plugin.getSidebarTargetFile();
        }
        this.unsubscribeFromAgentStreamUpdates = this.plugin.subscribeToAgentStreamUpdates((update) => {
            this.handleAgentStreamUpdate(update);
        });
        await this.renderComments();
        document.addEventListener("keydown", this.interactionController.documentKeydownHandler, true);
        document.addEventListener("mousedown", this.interactionController.documentMouseDownHandler, true);
        document.addEventListener("copy", this.interactionController.documentCopyHandler, true);
        document.addEventListener("selectionchange", this.interactionController.documentSelectionChangeHandler);
        this.containerEl.addEventListener("click", this.interactionController.sidebarClickHandler);
    }

    async onClose() {
        this.unsubscribeFromAgentStreamUpdates?.();
        this.unsubscribeFromAgentStreamUpdates = null;
        this.clearNoteSidebarSearchDebounceTimer();
        this.clearIndexSidebarSearchDebounceTimer();
        this.noteSidebarShell = null;
        this.resetStreamedReplyControllers();
        document.removeEventListener("keydown", this.interactionController.documentKeydownHandler, true);
        document.removeEventListener("mousedown", this.interactionController.documentMouseDownHandler, true);
        document.removeEventListener("copy", this.interactionController.documentCopyHandler, true);
        document.removeEventListener("selectionchange", this.interactionController.documentSelectionChangeHandler);
        this.containerEl.removeEventListener("click", this.interactionController.sidebarClickHandler);
        await Promise.resolve();
    }

    async setState(state: CustomViewState, result: ViewStateResult): Promise<void> {
        let shouldRender = false;
        const nextPinnedSidebarStateByFilePath = resolvePinnedSidebarStateByFilePathFromState(state);
        if (nextPinnedSidebarStateByFilePath !== undefined) {
            this.pinnedSidebarStateByFilePath = nextPinnedSidebarStateByFilePath;
            if (this.file) {
                this.restorePinnedSidebarStateForFilePath(this.file.path);
                shouldRender = true;
            }
        }

        const nextMode = parseSidebarPrimaryMode(state.indexSidebarMode);
        if (nextMode && nextMode !== this.indexSidebarMode) {
            this.indexSidebarMode = nextMode;
            void this.plugin.logEvent("info", "index", "index.mode.changed", {
                mode: nextMode,
                source: "view-state",
            });
            shouldRender = true;
        }

        const nextNoteMode = parseSidebarPrimaryMode(state.noteSidebarMode);
        if (nextNoteMode && nextNoteMode !== this.noteSidebarMode) {
            this.noteSidebarMode = nextNoteMode;
            void this.plugin.logEvent("info", "note", "note.mode.changed", {
                mode: nextNoteMode,
                source: "view-state",
            });
            shouldRender = true;
        }

        const nextRootPath = resolveIndexFileFilterRootPathFromState(state);
        if (nextRootPath !== undefined && nextRootPath !== this.selectedIndexFileFilterRootPath) {
            this.selectedIndexFileFilterRootPath = nextRootPath;
            void this.plugin.logEvent("info", "index", "index.filter.changed", {
                rootFilePath: nextRootPath,
                source: "view-state",
            });
            shouldRender = true;
        }

        if (state.filePath) {
            const file = this.app.vault.getAbstractFileByPath(state.filePath);
            const normalizedFile = file instanceof TFile
                ? normalizeSidebarViewFile(file, (candidate): candidate is TFile => this.plugin.isSidebarSupportedFile(candidate))
                : null;
            if (normalizedFile) {
                this.setCurrentFile(normalizedFile);
                shouldRender = true;
            } else if (this.file !== null) {
                this.setCurrentFile(null);
                shouldRender = true;
            }
        } else if (state.filePath === null && this.file) {
            this.setCurrentFile(null);
            shouldRender = true;
        }

        if (shouldRender) {
            await this.renderComments();
        }
        await super.setState(state, result);
    }

    public async updateActiveFile(file: TFile | null) {
        this.setCurrentFile(
            normalizeSidebarViewFile(file, (candidate): candidate is TFile => this.plugin.isSidebarSupportedFile(candidate)),
        );
        await this.renderComments();
    }

    public getCurrentFile(): TFile | null {
        return this.file;
    }

    public highlightComment(commentId: string, options: { skipDataRefresh?: boolean } = {}) {
        this.ensureListModeForCommentFocus();
        this.interactionController.highlightComment(commentId, options);
        const currentFilePath = this.file?.path ?? null;
        if (currentFilePath && this.plugin.isAllCommentsNotePath(currentFilePath)) {
            void this.plugin.syncIndexCommentHighlightPair(commentId, currentFilePath);
        }
    }

    public async highlightAndFocusDraft(commentId: string) {
        this.ensureListModeForCommentFocus();
        await this.interactionController.highlightAndFocusDraft(commentId);
    }

    public focusDraft(commentId: string): void {
        this.ensureListModeForCommentFocus();
        this.interactionController.focusDraft(commentId);
    }

    public clearActiveState(): void {
        this.interactionController.clearActiveState();
    }

    public async renderComments(options: {
        skipDataRefresh?: boolean;
    } = {}) {
        const renderVersion = ++this.renderVersion;
        const normalizedFile = normalizeSidebarViewFile(
            this.file,
            (candidate): candidate is TFile => this.plugin.isSidebarSupportedFile(candidate),
        );
        if (normalizedFile !== this.file) {
            this.setCurrentFile(normalizedFile);
        }
        const file = normalizedFile;
        const isAllCommentsView = !!file && this.plugin.isAllCommentsNotePath(file.path);
        this.clearReorderDragState();
        if (file && !isAllCommentsView) {
            this.indexFileFilterGraph = null;
            if (!options.skipDataRefresh) {
                await this.plugin.loadCommentsForFile(file);
            }
            if (renderVersion !== this.renderVersion || this.file?.path !== file.path) {
                return;
            }

            await this.renderPageSidebar(file, renderVersion);
            return;
        }

        this.noteSidebarShell = null;
        this.resetStreamedReplyControllers();
        this.containerEl.empty();
        this.syncViewContainerClasses();
        if (file) {
            this.indexFileFilterGraph = null;
            if (isAllCommentsView) {
                await this.plugin.ensureIndexedCommentsLoaded();
            } else {
                await this.plugin.loadCommentsForFile(file);
            }
            if (renderVersion !== this.renderVersion || this.file?.path !== file.path) {
                return;
            }

            this.containerEl.empty();
            this.syncViewContainerClasses();
            const showDeleted = this.plugin.shouldShowDeletedComments();
            const hasExistingSourceFile = (filePath: string): boolean => {
                const sourceFile = this.app.vault.getAbstractFileByPath(filePath);
                return sourceFile instanceof TFile;
            };
            const persistedThreads = isAllCommentsView
                ? filterIndexThreadsByExistingSourceFiles(
                    this.plugin.getAllIndexedThreads(),
                    hasExistingSourceFile,
                )
                : this.plugin.getThreadsForFile(file.path, { includeDeleted: showDeleted });
            const pageThreadsWithDeleted = isAllCommentsView
                ? []
                : this.plugin.getThreadsForFile(file.path, { includeDeleted: true });
            const deletedCommentCount = isAllCommentsView
                ? 0
                : countDeletedComments(pageThreadsWithDeleted);
            const showResolved = this.plugin.shouldShowResolvedComments();
            const allAgentRuns = this.plugin.getAgentRuns();
            const visiblePersistedThreads = persistedThreads.filter((thread) =>
                isAllCommentsView
                    ? matchesResolvedVisibility(thread.resolved, showResolved)
                    : matchesPageSidebarVisibility(thread, {
                        showResolved,
                        showDeleted,
                    }));
            const indexFileFilterGraph = isAllCommentsView
                ? buildIndexFileFilterGraph(persistedThreads, {
                    allCommentsNotePath: this.plugin.getAllCommentsNotePath(),
                    resolveWikiLinkPath: (linkPath, sourceFilePath) => {
                        const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFilePath);
                        return linkedFile instanceof TFile ? linkedFile.path : null;
                    },
                    showResolved,
                })
                : null;
            this.indexFileFilterGraph = indexFileFilterGraph;

            let selectedIndexFileFilterRootPath = isAllCommentsView
                ? this.selectedIndexFileFilterRootPath
                : null;
            if (
                selectedIndexFileFilterRootPath
                && (!indexFileFilterGraph || !indexFileFilterGraph.fileCommentCounts.has(selectedIndexFileFilterRootPath))
            ) {
                this.selectedIndexFileFilterRootPath = null;
                selectedIndexFileFilterRootPath = null;
            }

            const filteredIndexFilePaths = isAllCommentsView
                ? deriveIndexSidebarScopedFilePaths(
                    indexFileFilterGraph,
                    selectedIndexFileFilterRootPath,
                )
                : [];
            const indexFileFilterOptions = isAllCommentsView && indexFileFilterGraph
                ? buildIndexFileFilterOptionsFromCounts(indexFileFilterGraph.fileCommentCounts)
                : [];
            this.syncPinnedSidebarThreadIds(persistedThreads);
            const pinnedSidebarThreadIds = isAllCommentsView ? EMPTY_PINNED_SIDEBAR_THREAD_IDS : this.pinnedSidebarThreadIds;
            const showPinnedThreadsOnly = !isAllCommentsView && this.showPinnedSidebarThreadsOnly;
            const {
                scopedVisibleThreads,
                scopedAllThreads,
            } = isAllCommentsView
                ? scopeIndexThreadsByFilePaths(visiblePersistedThreads, persistedThreads, filteredIndexFilePaths)
                : {
                    scopedVisibleThreads: visiblePersistedThreads,
                    scopedAllThreads: persistedThreads,
                };
            const pinnedScopedVisibleThreads = filterThreadsByPinnedSidebarViewState(
                scopedVisibleThreads,
                pinnedSidebarThreadIds,
                showPinnedThreadsOnly,
            );
            const pinnedScopedAllThreads = filterThreadsByPinnedSidebarViewState(
                scopedAllThreads,
                pinnedSidebarThreadIds,
                showPinnedThreadsOnly,
            );
            const searchMatchedVisibleThreads = rankThreadsBySidebarSearchQuery(
                pinnedScopedVisibleThreads,
                this.indexSidebarSearchQuery,
            );
            const searchMatchedAllThreads = rankThreadsBySidebarSearchQuery(
                pinnedScopedAllThreads,
                this.indexSidebarSearchQuery,
            );
            const draftComment = this.plugin.getDraftForView(file.path);
            const visibleDraftComment = draftComment
                && matchesResolvedVisibility(draftComment.resolved, showResolved)
                && matchesPinnedSidebarDraftVisibility(
                    draftComment,
                    showPinnedThreadsOnly ? pinnedSidebarThreadIds : EMPTY_PINNED_SIDEBAR_THREAD_IDS,
                )
                && (!filteredIndexFilePaths.length || filteredIndexFilePaths.includes(draftComment.filePath))
                ? draftComment
                : null;
            const activeDraftHostThreadId = (visibleDraftComment?.mode === "edit" || visibleDraftComment?.mode === "append")
                ? visibleDraftComment.threadId ?? null
                : null;
            const searchScopedVisibleThreads = searchMatchedVisibleThreads.slice();
            if (
                activeDraftHostThreadId
                && !searchScopedVisibleThreads.some((thread) => thread.id === activeDraftHostThreadId)
            ) {
                const activeDraftHostThread = pinnedScopedVisibleThreads.find((thread) => thread.id === activeDraftHostThreadId);
                if (activeDraftHostThread) {
                    searchScopedVisibleThreads.push(activeDraftHostThread);
                }
            }
            const totalScopedCount = searchMatchedAllThreads.length;
            const resolvedCount = searchMatchedAllThreads.filter((thread) => thread.resolved).length;
            const hasResolvedComments = resolvedCount > 0;
            const hasNestedComments = searchScopedVisibleThreads.some((thread) => thread.entries.length > 1)
                || visibleDraftComment?.mode === "append";
            const nestedEditDraftThreadId = getNestedThreadIdForEditDraft(
                searchScopedVisibleThreads,
                visibleDraftComment,
            );
            const replacedThreadId = nestedEditDraftThreadId
                ? null
                : getReplacedThreadIdForEditDraft(
                searchScopedVisibleThreads,
                visibleDraftComment,
            );
            const nestedAppendDraftThreadId = getNestedThreadIdForAppendDraft(
                searchScopedVisibleThreads,
                visibleDraftComment,
            );
            const topLevelDraftComment = shouldRenderTopLevelDraftComment({
                draft: visibleDraftComment,
                nestedAppendDraftThreadId,
                nestedEditDraftThreadId,
                isAgentIndexMode: false,
                agentThreadIds: new Set<string>(),
            });
            const renderableItems = isAllCommentsView
                ? sortSidebarRenderableItems(
                    searchScopedVisibleThreads
                        .filter((thread) => thread.id !== replacedThreadId)
                        .map((thread) => ({ kind: "thread", thread } as SidebarRenderableItem))
                        .concat(topLevelDraftComment ? [{ kind: "draft", draft: topLevelDraftComment }] : []),
                )
                : buildStoredOrderSidebarItems(
                    pinnedScopedVisibleThreads,
                    topLevelDraftComment,
                    replacedThreadId,
                );
            const limitedComments = isAllCommentsView
                && this.indexSidebarMode === "list"
                && shouldLimitIndexSidebarList(selectedIndexFileFilterRootPath, this.indexSidebarSearchQuery)
                ? limitIndexSidebarListItems(renderableItems)
                : {
                    visibleItems: renderableItems.slice(),
                    hiddenCount: 0,
                };
            const renderedItems = limitedComments.visibleItems;
            const commentsContainer = this.containerEl.createDiv("sidenote2-comments-container");
            const supportThreadCount = isAllCommentsView
                ? persistedThreads.length
                : this.plugin.getThreadsForFile(file.path).length;

            this.renderSidebarToolbar(commentsContainer, {
                isAllCommentsView,
                resolvedCount,
                hasResolvedComments,
                hasDeletedComments: !isAllCommentsView && pageThreadsWithDeleted.some((thread) => hasDeletedComments(thread)),
                deletedCommentCount,
                showDeletedComments: showDeleted,
                hasNestedComments,
                isAgentMode: false,
                agentOutcomeCounts: {
                    succeeded: 0,
                    failed: 0,
                },
                noteSidebarContentFilter: "all",
                noteSidebarMode: this.noteSidebarMode,
                bookmarkThreadCount: 0,
                addPageCommentAction: !isAllCommentsView
                    ? {
                        icon: "plus",
                        ariaLabel: "Add page note",
                        onClick: () => {
                            void this.plugin.startPageCommentDraft(file);
                        },
                    }
                    : null,
                indexFileFilterOptions,
                selectedIndexFileFilterRootPath,
                filteredIndexFilePaths,
            });

            if (isAllCommentsView && selectedIndexFileFilterRootPath && filteredIndexFilePaths.length) {
                this.renderActiveFileFilters(
                    commentsContainer,
                    selectedIndexFileFilterRootPath,
                    filteredIndexFilePaths,
                    indexFileFilterOptions,
                );
            }

            if (isAllCommentsView && this.indexSidebarMode === "thought-trail") {
                const trailComments = pinnedScopedVisibleThreads;
                await this.renderThoughtTrail(commentsContainer, trailComments, file, {
                    surface: "index",
                    hasRootScope: filteredIndexFilePaths.length > 0,
                    rootFilePath: selectedIndexFileFilterRootPath,
                });
                if (this.plugin.isLocalRuntime()) {
                    this.renderSupportButton({
                        filePath: file.path,
                        isAllCommentsView,
                        threadCount: supportThreadCount,
                    });
                }
                return;
            }

            const commentsBody = this.renderCommentsList(commentsContainer);
            this.setupPageThreadReorderInteractions(commentsBody, file.path);
            const renderPromises = renderedItems.map(async (item) => {
                if (item.kind === "draft") {
                    this.renderDraftComment(commentsBody, item.draft);
                    return;
                }

                const threadAgentRuns = getAgentRunsForCommentThread(allAgentRuns, item.thread);
                await this.renderPersistedComment(
                    commentsBody,
                    item.thread,
                    false,
                    threadAgentRuns[0] ?? null,
                    this.plugin.getActiveAgentStreamForThread(item.thread.id),
                    threadAgentRuns,
                    nestedEditDraftThreadId === item.thread.id && visibleDraftComment?.mode === "edit"
                        ? visibleDraftComment
                        : null,
                    nestedAppendDraftThreadId === item.thread.id && visibleDraftComment?.mode === "append"
                        ? visibleDraftComment
                        : null,
                );
            });
            await Promise.all(renderPromises);
            this.refreshSidebarSearchHighlights(
                commentsBody,
                isAllCommentsView ? this.indexSidebarSearchQuery : this.noteSidebarSearchQuery,
            );
            this.syncVisibleStreamedReplyControllers();

            if (limitedComments.hiddenCount > 0) {
                const limitNotice = commentsContainer.createDiv("sidenote2-list-limit-notice");
                        limitNotice.createEl("p", {
                            text: `${INDEX_SIDEBAR_LIST_LIMIT} shown, ${limitedComments.hiddenCount} hidden.`,
                        });
                        limitNotice.createEl("p", {
                            text: "Use files to filter the index to see more.",
                        });
            }

            if (renderedItems.length === 0) {
                if (isAllCommentsView) {
                    this.renderIndexSidebarEmptyState(commentsBody, {
                        renderedItemCount: renderedItems.length,
                        showResolved,
                        totalScopedCount,
                        resolvedCount,
                        filteredIndexFilePaths,
                        searchQuery: this.indexSidebarSearchQuery,
                    });
                } else if (showResolved && totalScopedCount > 0) {
                    const emptyStateEl = commentsBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
                    emptyStateEl.createEl("p", { text: "No resolved comments for this file." });
                    emptyStateEl.createEl("p", { text: "Turn off resolved to return to active comments." });
                } else if (hasResolvedComments && !showResolved) {
                    const emptyStateEl = commentsBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
                    emptyStateEl.createEl("p", { text: "No active comments for this file." });
                    emptyStateEl.createEl("p", { text: "Turn on resolved to review archived comments only." });
                }
            }
        } else {
            this.resetStreamedReplyControllers();
            const emptyStateEl = this.containerEl.createDiv("sidenote2-empty-state");
            emptyStateEl.createEl("p", { text: "No file selected." });
            emptyStateEl.createEl("p", { text: "Open a file to see its comments." });
        }

        if (this.plugin.isLocalRuntime()) {
            this.renderSupportButton({
                filePath: file?.path ?? null,
                isAllCommentsView,
                threadCount: file
                    ? (isAllCommentsView ? this.plugin.getAllIndexedThreads().length : this.plugin.getThreadsForFile(file.path).length)
                    : 0,
            });
        }
    }

    private async renderPageSidebar(file: TFile, renderVersion: number): Promise<void> {
        const shell = this.ensureNoteSidebarShell(file.path);
        const showDeleted = this.plugin.shouldShowDeletedComments();
        const draftComment = this.plugin.getDraftForView(file.path);
        if (draftComment && this.noteSidebarMode === "thought-trail") {
            this.noteSidebarMode = "list";
            void this.plugin.logEvent("info", "note", "note.mode.changed", {
                mode: "list",
                source: "draft-visible",
            });
        }
        this.noteSidebarContentFilter = unlockSidebarContentFilterForDraft(
            this.noteSidebarContentFilter,
            draftComment,
        );
        this.normalizeNoteSidebarContentFilter();
        if (this.noteSidebarMode === "thought-trail") {
            await this.renderNoteThoughtTrailSidebar(shell, file, renderVersion, {
                showDeleted,
            });
            return;
        }
        const persistedThreads = this.plugin.getThreadsForFile(file.path, { includeDeleted: showDeleted });
        const pageThreadsWithDeleted = this.plugin.getThreadsForFile(file.path, { includeDeleted: true });
        const deletedCommentCount = countDeletedComments(pageThreadsWithDeleted);
        const showResolved = this.plugin.shouldShowResolvedComments();
        const bookmarkThreadCount = countBookmarkThreads(persistedThreads);
        const hasResolvedThreadsInFile = persistedThreads.some((thread) => thread.resolved);
        this.syncPinnedSidebarThreadIds(persistedThreads);
        const contentFilteredThreads = this.filterNoteSidebarThreadsByContentFilter(file.path, persistedThreads);
        const pinnedContentFilteredThreads = filterThreadsByPinnedSidebarViewState(
            contentFilteredThreads,
            this.pinnedSidebarThreadIds,
            this.showPinnedSidebarThreadsOnly,
        );
        const searchMatchedThreads = rankThreadsBySidebarSearchQuery(
            pinnedContentFilteredThreads,
            this.noteSidebarSearchQuery,
        );
        const allAgentRuns = this.plugin.getAgentRuns();
        const visibleDraftComment = draftComment
            && matchesResolvedVisibility(draftComment.resolved, showResolved)
            && matchesPinnedSidebarDraftVisibility(draftComment, this.getPinnedSidebarFilterThreadIds())
            ? draftComment
            : null;
        const activeDraftHostThreadId = (visibleDraftComment?.mode === "edit" || visibleDraftComment?.mode === "append")
            ? visibleDraftComment.threadId ?? null
            : null;
        const searchScopedThreads = searchMatchedThreads.slice();
        if (activeDraftHostThreadId && !searchScopedThreads.some((thread) => thread.id === activeDraftHostThreadId)) {
            const activeDraftHostThread = pinnedContentFilteredThreads.find((thread) => thread.id === activeDraftHostThreadId);
            if (activeDraftHostThread) {
                searchScopedThreads.push(activeDraftHostThread);
            }
        }
        const visiblePersistedThreads = searchScopedThreads.filter((thread) =>
            matchesPageSidebarVisibility(thread, {
                showResolved,
                showDeleted,
            }));
        const totalScopedCount = searchMatchedThreads.length;
        const resolvedCount = searchMatchedThreads.filter((thread) => thread.resolved).length;
        const hasResolvedComments = resolvedCount > 0;
        const hasNestedComments = searchScopedThreads.some((thread) => thread.entries.length > 1)
            || visibleDraftComment?.mode === "append";
        const nestedEditDraftThreadId = getNestedThreadIdForEditDraft(
            visiblePersistedThreads,
            visibleDraftComment,
        );
        const replacedThreadId = nestedEditDraftThreadId
            ? null
            : getReplacedThreadIdForEditDraft(
            visiblePersistedThreads,
            visibleDraftComment,
        );
        const nestedAppendDraftThreadId = getNestedThreadIdForAppendDraft(
            visiblePersistedThreads,
            visibleDraftComment,
        );
        const topLevelDraftComment = this.noteSidebarContentFilter === "all"
            && !!visibleDraftComment
            ? shouldRenderTopLevelDraftComment({
            draft: visibleDraftComment,
            nestedAppendDraftThreadId,
            nestedEditDraftThreadId,
            isAgentIndexMode: false,
            agentThreadIds: new Set<string>(),
        })
            : null;
        const renderableItems = buildStoredOrderSidebarItems(
            visiblePersistedThreads,
            topLevelDraftComment,
            replacedThreadId,
        );

        shell.toolbarSlotEl.empty();
        this.renderSidebarToolbar(shell.toolbarSlotEl, {
            isAllCommentsView: false,
            resolvedCount,
            hasResolvedComments: hasResolvedThreadsInFile,
            hasDeletedComments: pageThreadsWithDeleted.some((thread) => hasDeletedComments(thread)),
            deletedCommentCount,
            showDeletedComments: showDeleted,
            hasNestedComments,
            isAgentMode: false,
            agentOutcomeCounts: {
                succeeded: 0,
                failed: 0,
            },
            noteSidebarContentFilter: this.noteSidebarContentFilter,
            noteSidebarMode: this.noteSidebarMode,
            bookmarkThreadCount,
            addPageCommentAction: {
                icon: "plus",
                ariaLabel: "Add page note",
                onClick: () => {
                    void this.plugin.startPageCommentDraft(file);
                },
            },
            indexFileFilterOptions: [],
            selectedIndexFileFilterRootPath: null,
            filteredIndexFilePaths: [],
        });

        const visiblePageThreadCount = renderableItems.filter((item) =>
            item.kind === "thread"
            && item.thread.anchorKind === "page"
            && !item.thread.deletedAt
        ).length;
        const renderDescriptors = this.buildNoteSidebarRenderDescriptors(renderableItems, {
            allAgentRuns,
            enablePageThreadReorder: visiblePageThreadCount > 1,
            nestedEditDraftThreadId,
            nestedAppendDraftThreadId,
            visibleDraftComment,
        });
        await this.reconcileNoteSidebarItems(shell.commentsBodyEl, renderDescriptors);
        this.refreshSidebarSearchHighlights(shell.commentsBodyEl, this.noteSidebarSearchQuery);
        this.renderPageSidebarEmptyState(shell.commentsBodyEl, {
            renderedItemCount: renderableItems.length,
            showResolved,
            totalScopedCount,
            hasResolvedComments,
            contentFilter: this.noteSidebarContentFilter,
            showPinnedThreadsOnly: this.showPinnedSidebarThreadsOnly,
            searchQuery: this.noteSidebarSearchQuery,
        });
        this.syncVisibleStreamedReplyControllers();

        shell.supportSlotEl.empty();
        if (this.plugin.isLocalRuntime()) {
            this.renderSupportButtonIn(shell.supportSlotEl, {
                filePath: file.path,
                isAllCommentsView: false,
                threadCount: this.plugin.getThreadsForFile(file.path).length,
            });
        }
    }

    private async renderNoteThoughtTrailSidebar(
        shell: NoteSidebarShell,
        file: TFile,
        renderVersion: number,
        options: {
            showDeleted: boolean;
        },
    ): Promise<void> {
        this.normalizeNoteSidebarContentFilter();
        const persistedThreads = this.plugin.getThreadsForFile(file.path, { includeDeleted: options.showDeleted });
        const pageThreadsWithDeleted = this.plugin.getThreadsForFile(file.path, { includeDeleted: true });
        const deletedCommentCount = countDeletedComments(pageThreadsWithDeleted);
        const showResolved = this.plugin.shouldShowResolvedComments();
        const bookmarkThreadCount = countBookmarkThreads(persistedThreads);
        const hasResolvedThreadsInFile = persistedThreads.some((thread) => thread.resolved);

        await this.plugin.ensureIndexedCommentsLoaded();
        if (renderVersion !== this.renderVersion || this.file?.path !== file.path) {
            return;
        }

        const hasExistingSourceFile = (filePath: string): boolean => {
            const sourceFile = this.app.vault.getAbstractFileByPath(filePath);
            return sourceFile instanceof TFile;
        };
        const visibleTrailThreads = filterIndexThreadsByExistingSourceFiles(
            this.plugin.getAllIndexedThreads(),
            hasExistingSourceFile,
        ).filter((thread) => matchesResolvedVisibility(thread.resolved, showResolved));
        const { scopedFilePaths, scopedThreads } = buildRootedThoughtTrailScope(visibleTrailThreads, {
            rootFilePath: file.path,
            allCommentsNotePath: this.plugin.getAllCommentsNotePath(),
            resolveWikiLinkPath: (linkPath, sourceFilePath) => {
                const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFilePath);
                return linkedFile instanceof TFile ? linkedFile.path : null;
            },
        });

        shell.toolbarSlotEl.empty();
        this.renderSidebarToolbar(shell.toolbarSlotEl, {
            isAllCommentsView: false,
            resolvedCount: persistedThreads.filter((thread) => thread.resolved).length,
            hasResolvedComments: hasResolvedThreadsInFile,
            hasDeletedComments: pageThreadsWithDeleted.some((thread) => hasDeletedComments(thread)),
            deletedCommentCount,
            showDeletedComments: options.showDeleted,
            hasNestedComments: false,
            isAgentMode: false,
            agentOutcomeCounts: {
                succeeded: 0,
                failed: 0,
            },
            noteSidebarContentFilter: this.noteSidebarContentFilter,
            noteSidebarMode: this.noteSidebarMode,
            bookmarkThreadCount,
            addPageCommentAction: {
                icon: "plus",
                ariaLabel: "Add page note",
                onClick: () => {
                    void this.plugin.startPageCommentDraft(file);
                },
            },
            indexFileFilterOptions: [],
            selectedIndexFileFilterRootPath: null,
            filteredIndexFilePaths: [],
        });

        shell.commentsBodyEl.empty();
        this.resetStreamedReplyControllers();
        await this.renderThoughtTrail(shell.commentsBodyEl, scopedThreads, file, {
            surface: "note",
            hasRootScope: scopedFilePaths.length > 0,
            rootFilePath: file.path,
        });

        shell.supportSlotEl.empty();
        if (this.plugin.isLocalRuntime()) {
            this.renderSupportButtonIn(shell.supportSlotEl, {
                filePath: file.path,
                isAllCommentsView: false,
                threadCount: this.plugin.getThreadsForFile(file.path).length,
            });
        }
    }

    private ensureNoteSidebarShell(filePath: string): NoteSidebarShell {
        if (
            this.noteSidebarShell?.filePath === filePath
            && this.noteSidebarShell.commentsContainerEl.isConnected
            && this.noteSidebarShell.supportSlotEl.isConnected
        ) {
            this.syncViewContainerClasses();
            return this.noteSidebarShell;
        }

        this.noteSidebarShell = null;
        this.resetStreamedReplyControllers();
        this.containerEl.empty();
        this.syncViewContainerClasses();

        const commentsContainerEl = this.containerEl.createDiv("sidenote2-comments-container is-note-sidebar");
        const toolbarSlotEl = commentsContainerEl.createDiv("sidenote2-note-sidebar-toolbar-slot");
        const commentsBodyEl = this.renderCommentsList(commentsContainerEl);
        this.setupPageThreadReorderInteractions(commentsBodyEl, filePath);
        const supportSlotEl = this.containerEl.createDiv("sidenote2-support-button-slot");

        this.noteSidebarShell = {
            filePath,
            commentsContainerEl,
            toolbarSlotEl,
            commentsBodyEl,
            supportSlotEl,
        };
        return this.noteSidebarShell;
    }

    private buildNoteSidebarRenderDescriptors(
        renderableItems: SidebarRenderableItem[],
        options: {
            allAgentRuns: AgentRunRecord[];
            enablePageThreadReorder: boolean;
            nestedEditDraftThreadId: string | null;
            nestedAppendDraftThreadId: string | null;
            visibleDraftComment: DraftComment | null;
        },
    ): NoteSidebarRenderDescriptor[] {
        return renderableItems.map((item) => {
            if (item.kind === "draft") {
                return {
                    key: `draft:${item.draft.id}`,
                    signature: buildPageSidebarDraftRenderSignature(
                        item.draft,
                        this.interactionController.getActiveCommentId(),
                    ),
                    threadId: null,
                    render: () => {
                        const stagingEl = document.createElement("div");
                        this.renderDraftComment(stagingEl, item.draft);
                        const nextNode = stagingEl.firstElementChild;
                        if (!(nextNode instanceof HTMLElement)) {
                            throw new Error("Failed to render sidebar draft card.");
                        }
                        return Promise.resolve(nextNode);
                    },
                };
            }

            const appendDraftComment = options.nestedAppendDraftThreadId === item.thread.id && options.visibleDraftComment?.mode === "append"
                ? options.visibleDraftComment
                : null;
            const editDraftComment = options.nestedEditDraftThreadId === item.thread.id && options.visibleDraftComment?.mode === "edit"
                ? options.visibleDraftComment
                : null;
            const threadAgentRuns = getAgentRunsForCommentThread(options.allAgentRuns, item.thread);
            const showNestedComments = this.plugin.shouldShowNestedCommentsForThread(item.thread.id);
            return {
                key: `thread:${item.thread.id}`,
                signature: buildPageSidebarThreadRenderSignature({
                    thread: item.thread,
                    activeCommentId: this.interactionController.getActiveCommentId(),
                    isPinned: this.isPinnedSidebarThread(item.thread.id),
                    showNestedComments,
                    showNestedCommentsByDefault: this.plugin.shouldShowNestedComments(),
                    enablePageThreadReorder: options.enablePageThreadReorder,
                    editDraftComment,
                    appendDraftComment,
                    threadAgentRuns,
                }),
                threadId: item.thread.id,
                render: async () => {
                    const stagingEl = document.createElement("div");
                    await this.renderPersistedComment(
                        stagingEl,
                        item.thread,
                        options.enablePageThreadReorder,
                        threadAgentRuns[0] ?? null,
                        this.plugin.getActiveAgentStreamForThread(item.thread.id),
                        threadAgentRuns,
                        editDraftComment,
                        appendDraftComment,
                    );
                    const nextNode = stagingEl.firstElementChild;
                    if (!(nextNode instanceof HTMLElement)) {
                        throw new Error("Failed to render sidebar thread card.");
                    }
                    return nextNode;
                },
            };
        });
    }

    private async reconcileNoteSidebarItems(
        commentsBody: HTMLDivElement,
        descriptors: readonly NoteSidebarRenderDescriptor[],
    ): Promise<void> {
        const existingByKey = new Map<string, HTMLElement>();
        for (const child of Array.from(commentsBody.children)) {
            if (!(child instanceof HTMLElement)) {
                continue;
            }

            const key = child.dataset.sidenote2RenderKey;
            if (key) {
                existingByKey.set(key, child);
                continue;
            }

            if (child.classList.contains("sidenote2-empty-state")) {
                child.remove();
            }
        }

        const desiredNodes: HTMLElement[] = [];
        for (const descriptor of descriptors) {
            const existing = existingByKey.get(descriptor.key) ?? null;
            existingByKey.delete(descriptor.key);
            if (existing && existing.dataset.sidenote2RenderSignature === descriptor.signature) {
                desiredNodes.push(existing);
                continue;
            }

            if (descriptor.threadId) {
                this.removeStreamedReplyController(descriptor.threadId);
            }

            const nextNode = await descriptor.render();
            nextNode.dataset.sidenote2RenderKey = descriptor.key;
            nextNode.dataset.sidenote2RenderSignature = descriptor.signature;
            desiredNodes.push(nextNode);
        }

        for (const [key, element] of existingByKey) {
            if (key.startsWith("thread:")) {
                this.removeStreamedReplyController(key.slice("thread:".length));
            }
            element.remove();
        }

        desiredNodes.forEach((node, index) => {
            const currentNode = commentsBody.children.item(index);
            if (currentNode === node) {
                return;
            }

            commentsBody.insertBefore(node, currentNode ?? null);
        });

        const desiredNodeSet = new Set(desiredNodes);
        for (const child of Array.from(commentsBody.children)) {
            if (child instanceof HTMLElement && !desiredNodeSet.has(child)) {
                child.remove();
            }
        }
    }

    private renderPageSidebarEmptyState(
        commentsBody: HTMLDivElement,
        options: {
            renderedItemCount: number;
            showResolved: boolean;
            totalScopedCount: number;
            hasResolvedComments: boolean;
            contentFilter: SidebarContentFilter;
            showPinnedThreadsOnly: boolean;
            searchQuery: string;
        },
    ): void {
        for (const child of Array.from(commentsBody.children)) {
            if (child instanceof HTMLDivElement && child.classList.contains("sidenote2-empty-state")) {
                child.remove();
            }
        }

        if (options.renderedItemCount !== 0) {
            return;
        }

        const filterLabel = options.showPinnedThreadsOnly
            ? options.contentFilter === "all"
                ? "pin filter"
                : `pin + ${this.getNoteSidebarContentFilterLabel(options.contentFilter)}`
            : this.getNoteSidebarContentFilterLabel(options.contentFilter);
        const pluralFilterLabel = options.showPinnedThreadsOnly
            ? options.contentFilter === "all"
                ? "pinned comments"
                : `pinned ${this.getNoteSidebarContentFilterPluralLabel(options.contentFilter)}`
            : this.getNoteSidebarContentFilterPluralLabel(options.contentFilter);
        const trimmedSearchQuery = options.searchQuery.trim();
        const hasSearchQuery = trimmedSearchQuery.length > 0;
        const searchSubjectLabel = options.showPinnedThreadsOnly
            ? options.contentFilter === "all"
                ? "pinned side notes"
                : pluralFilterLabel
            : options.contentFilter === "all"
                ? "side notes"
                : pluralFilterLabel;

        if (options.showResolved && options.totalScopedCount > 0) {
            const emptyStateEl = commentsBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? `No resolved ${searchSubjectLabel} match "${trimmedSearchQuery}" in this file.`
                    : options.showPinnedThreadsOnly
                        ? `No resolved ${pluralFilterLabel} for this file.`
                        : options.contentFilter === "all"
                        ? "No resolved comments for this file."
                        : `No resolved ${pluralFilterLabel} for this file.`,
            });
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? "Turn off resolved or clear search to broaden the results."
                    : options.showPinnedThreadsOnly
                        ? `Turn off ${filterLabel} to return to the broader side note list.`
                        : options.contentFilter === "all"
                        ? "Turn off resolved to return to active comments."
                        : `Turn off resolved to return to active ${pluralFilterLabel}.`,
            });
            return;
        }

        if (!options.showResolved && options.hasResolvedComments) {
            const emptyStateEl = commentsBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? `No active ${searchSubjectLabel} match "${trimmedSearchQuery}" in this file.`
                    : options.showPinnedThreadsOnly
                        ? `No active ${pluralFilterLabel} for this file.`
                        : options.contentFilter === "all"
                        ? "No active comments for this file."
                        : `No active ${pluralFilterLabel} for this file.`,
            });
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? "Turn on resolved or clear search to broaden the results."
                    : options.showPinnedThreadsOnly
                        ? "Turn on resolved to review archived pinned comments only."
                        : options.contentFilter === "all"
                        ? "Turn on resolved to review archived comments only."
                        : `Turn on resolved to review archived ${pluralFilterLabel} only.`,
            });
            return;
        }

        const emptyStateEl = commentsBody.createDiv("sidenote2-empty-state");
        emptyStateEl.createEl("p", {
            text: hasSearchQuery
                ? `No ${searchSubjectLabel} match "${trimmedSearchQuery}" in this file.`
                : options.showPinnedThreadsOnly
                    ? `No ${pluralFilterLabel} for this file yet.`
                    : options.contentFilter === "all"
                    ? "No comments for this file yet."
                    : `No ${pluralFilterLabel} for this file yet.`,
        });
        emptyStateEl.createEl("p", {
            text: hasSearchQuery
                ? "Clear search or try different words."
                : options.showPinnedThreadsOnly
                    ? "Pin one or more side notes, or turn off the pin filter."
                    : options.contentFilter === "all"
                    ? "Use the add button to create a page side note."
                    : `Turn off ${filterLabel} to return to all side notes.`,
        });
    }

    private renderIndexSidebarEmptyState(
        commentsBody: HTMLDivElement,
        options: {
            renderedItemCount: number;
            showResolved: boolean;
            totalScopedCount: number;
            resolvedCount: number;
            filteredIndexFilePaths: readonly string[];
            searchQuery: string;
        },
    ): void {
        for (const child of Array.from(commentsBody.children)) {
            if (child instanceof HTMLDivElement && child.classList.contains("sidenote2-empty-state")) {
                child.remove();
            }
        }

        if (options.renderedItemCount !== 0) {
            return;
        }

        const trimmedSearchQuery = options.searchQuery.trim();
        const hasSearchQuery = trimmedSearchQuery.length > 0;
        const hasFileFilter = options.filteredIndexFilePaths.length > 0;
        const scopeLabel = hasFileFilter ? "the selected file filter" : "the current index view";
        const emptyStateEl = commentsBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");

        if (shouldShowResolvedIndexEmptyState(options.showResolved, options.totalScopedCount, options.renderedItemCount)) {
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? `No resolved side notes match "${trimmedSearchQuery}" in ${scopeLabel}.`
                    : hasFileFilter
                        ? "No resolved side notes match the selected file filter."
                        : "No resolved side notes match the current index view.",
            });
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? hasFileFilter
                        ? "Turn off resolved, clear search, or choose a different root file."
                        : "Turn off resolved or clear search to broaden the index results."
                    : hasFileFilter
                        ? "Turn off resolved or choose a different root file."
                        : "Turn off resolved to return to active side notes.",
            });
            return;
        }

        if (shouldShowActiveIndexEmptyState(options.showResolved, options.resolvedCount, options.renderedItemCount)) {
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? `No active side notes match "${trimmedSearchQuery}" in ${scopeLabel}.`
                    : hasFileFilter
                        ? "No active side notes match the selected file filter."
                        : "No active side notes match the current index view.",
            });
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? hasFileFilter
                        ? "Turn on resolved, clear search, or choose a different root file."
                        : "Turn on resolved or clear search to broaden the index results."
                    : hasFileFilter
                        ? "Turn on resolved or choose a different root file."
                        : "Turn on resolved to review archived side notes only.",
            });
            return;
        }

        if (hasSearchQuery) {
            emptyStateEl.createEl("p", {
                text: `No side notes match "${trimmedSearchQuery}" in ${scopeLabel}.`,
            });
            emptyStateEl.createEl("p", {
                text: hasFileFilter
                    ? "Clear search or choose a different root file."
                    : "Clear search or try different words.",
            });
            return;
        }

        if (hasFileFilter) {
            emptyStateEl.createEl("p", { text: "No side notes match the selected file filter." });
            emptyStateEl.createEl("p", { text: "Use files to choose a different root file." });
            return;
        }

        emptyStateEl.createEl("p", { text: "No side notes in the index yet." });
        emptyStateEl.createEl("p", { text: "Add side notes in your notes to populate the index." });
    }

    private getNoteSidebarContentFilterLabel(filter: SidebarContentFilter): string {
        switch (filter) {
            case "bookmarks":
                return "bookmark filter";
            case "agents":
                return "agent filter";
            case "all":
            default:
                return "all side notes";
        }
    }

    private getNoteSidebarContentFilterPluralLabel(filter: SidebarContentFilter): string {
        switch (filter) {
            case "bookmarks":
                return "bookmark comments";
            case "agents":
                return "agent comments";
            case "all":
            default:
                return "comments";
        }
    }

    private handleAgentStreamUpdate(update: AgentStreamUpdate): void {
        if (!update.stream) {
            this.removeStreamedReplyController(update.threadId);
            return;
        }

        const threadEl = this.containerEl.querySelector(`.sidenote2-thread-stack[data-thread-id="${update.threadId}"]`);
        if (!(threadEl instanceof HTMLDivElement)) {
            return;
        }

        this.getOrCreateStreamedReplyController(update.threadId).sync(this.containerEl, update.stream);
    }

    private syncVisibleStreamedReplyControllers(): void {
        const visibleThreadIds = new Set<string>();
        const threadEls = Array.from(this.containerEl.querySelectorAll(".sidenote2-thread-stack[data-thread-id]"));
        for (const threadEl of threadEls) {
            if (!(threadEl instanceof HTMLDivElement)) {
                continue;
            }
            const threadId = threadEl.getAttribute("data-thread-id");
            if (!threadId) {
                continue;
            }

            visibleThreadIds.add(threadId);
            const stream = this.plugin.getActiveAgentStreamForThread(threadId);
            if (!stream) {
                this.removeStreamedReplyController(threadId);
                continue;
            }
            this.getOrCreateStreamedReplyController(threadId).sync(this.containerEl, stream);
        }

        for (const [threadId] of this.streamedReplyControllers) {
            if (!visibleThreadIds.has(threadId)) {
                this.removeStreamedReplyController(threadId);
            }
        }
    }

    private getOrCreateStreamedReplyController(threadId: string): StreamedAgentReplyController {
        let controller = this.streamedReplyControllers.get(threadId);
        if (!controller) {
            controller = new StreamedAgentReplyController(threadId, {
                onCancelRun: (runId) => {
                    void this.plugin.cancelAgentRun(runId);
                },
            });
            this.streamedReplyControllers.set(threadId, controller);
        }

        return controller;
    }

    private removeStreamedReplyController(threadId: string): void {
        const controller = this.streamedReplyControllers.get(threadId);
        if (!controller) {
            return;
        }

        controller.clear();
        this.streamedReplyControllers.delete(threadId);
    }

    private normalizeNoteSidebarContentFilter(): void {
        if (this.noteSidebarContentFilter === "agents") {
            this.noteSidebarContentFilter = "all";
        }
    }

    private filterNoteSidebarThreadsByContentFilter(
        _filePath: string,
        threads: readonly CommentThread[],
    ): CommentThread[] {
        return filterThreadsBySidebarContentFilter(threads, this.noteSidebarContentFilter);
    }

    private async toggleDeletedSidebarMode(options: {
        showDeleted: boolean;
        showResolved: boolean;
        contentFilter: SidebarContentFilter;
    }): Promise<void> {
        const nextState = toggleDeletedSidebarViewState({
            showDeleted: options.showDeleted,
            showResolved: options.showResolved,
            contentFilter: options.contentFilter,
            showPinnedThreadsOnly: this.showPinnedSidebarThreadsOnly,
            pinnedThreadIds: this.pinnedSidebarThreadIds,
            searchQuery: this.noteSidebarSearchQuery,
            searchInputValue: this.noteSidebarSearchInputValue,
        });
        this.noteSidebarContentFilter = nextState.contentFilter;
        this.showPinnedSidebarThreadsOnly = nextState.showPinnedThreadsOnly;
        this.pinnedSidebarThreadIds = nextState.pinnedThreadIds;
        this.savePinnedSidebarStateForFilePath(this.file?.path ?? null);
        this.clearNoteSidebarSearchDebounceTimer();
        this.noteSidebarSearchQuery = nextState.searchQuery;
        this.noteSidebarSearchInputValue = nextState.searchInputValue;
        if (nextState.showResolved !== options.showResolved) {
            await this.plugin.setShowResolvedComments(nextState.showResolved);
        }
        if (nextState.showDeleted !== options.showDeleted) {
            await this.plugin.setShowDeletedComments(nextState.showDeleted);
        }
    }

    private resetStreamedReplyControllers(): void {
        for (const controller of this.streamedReplyControllers.values()) {
            controller.clear();
        }
        this.streamedReplyControllers.clear();
    }

    private renderSidebarToolbar(
        container: HTMLElement,
        options: {
            isAllCommentsView: boolean;
            resolvedCount: number;
            hasResolvedComments: boolean;
            hasDeletedComments: boolean;
            deletedCommentCount: number;
            showDeletedComments: boolean;
            hasNestedComments: boolean;
            isAgentMode: boolean;
            agentOutcomeCounts: {
                succeeded: number;
                failed: number;
            };
            noteSidebarContentFilter: SidebarContentFilter;
            noteSidebarMode: SidebarPrimaryMode;
            bookmarkThreadCount: number;
            addPageCommentAction: {
                icon: string;
                ariaLabel: string;
                onClick: () => void;
            } | null;
            indexFileFilterOptions: IndexFileFilterOption[];
            selectedIndexFileFilterRootPath: string | null;
            filteredIndexFilePaths: string[];
        },
    ) {
        const showResolved = this.plugin.shouldShowResolvedComments();
        const showNestedComments = this.plugin.shouldShowNestedComments();
        const showDeletedComments = options.showDeletedComments;
        const showPinnedThreadsOnly = this.showPinnedSidebarThreadsOnly;
        const hasPinnedThreads = this.pinnedSidebarThreadIds.size > 0;
        const contentFilter = options.noteSidebarContentFilter;
        const activePrimaryMode = options.isAllCommentsView
            ? this.indexSidebarMode
            : options.noteSidebarMode;
        const showListOnlyToolbarChips = options.isAllCommentsView
            ? shouldShowIndexListToolbarChips(options.isAllCommentsView, this.indexSidebarMode)
            : activePrimaryMode === "list";
        const shouldShowIndexSearchInput = options.isAllCommentsView && activePrimaryMode === "list";
        const shouldShowNoteSearchInput = !options.isAllCommentsView && activePrimaryMode === "list";
        const shouldShowAddPageCommentAction = !!options.addPageCommentAction
            && (options.isAllCommentsView || activePrimaryMode === "list");
        const shouldShowResolvedChip = showListOnlyToolbarChips
            && !options.isAgentMode
            && shouldShowResolvedToolbarChip(options.hasResolvedComments, showResolved);
        const shouldShowContentFilterIcons = !options.isAllCommentsView;
        const shouldShowNestedChip = showListOnlyToolbarChips && shouldShowNestedToolbarChip({
            hasNestedComments: options.hasNestedComments,
            isAllCommentsView: options.isAllCommentsView,
            selectedIndexFileFilterRootPath: options.selectedIndexFileFilterRootPath,
            filteredIndexFileCount: options.filteredIndexFilePaths.length,
        });
        const isDeletedToolbarMode = !options.isAllCommentsView
            && showListOnlyToolbarChips
            && showDeletedComments;
        const shouldRenderToolbar = options.isAllCommentsView
            || shouldShowResolvedChip
            || shouldShowContentFilterIcons
            || shouldShowNestedChip
            || shouldShowAddPageCommentAction;
        if (!shouldRenderToolbar) {
            return;
        }

        const toolbarEl = container.createDiv("sidenote2-sidebar-toolbar");
        toolbarEl.classList.toggle("is-index-toolbar", options.isAllCommentsView);
        toolbarEl.classList.toggle("is-note-toolbar", !options.isAllCommentsView);
        toolbarEl.classList.toggle("is-deleted-toolbar-mode", isDeletedToolbarMode);
        let indexFilterGroup: HTMLDivElement | null = null;
        let indexActionGroup: HTMLDivElement | null = null;
        let indexChipRow: HTMLDivElement | null = null;
        let noteFilterGroup: HTMLDivElement | null = null;
        let noteActionGroup: HTMLDivElement | null = null;
        if (options.isAllCommentsView) {
            const modeRow = toolbarEl.createDiv("sidenote2-sidebar-toolbar-row");
            modeRow.addClass("is-index-primary-row");
            this.renderIndexModeControl(modeRow);

            indexChipRow = toolbarEl.createDiv("sidenote2-sidebar-toolbar-row");
            indexChipRow.addClass("is-index-secondary-row");
            if (shouldShowIndexSearchInput) {
                indexFilterGroup = indexChipRow.createDiv("sidenote2-sidebar-toolbar-group is-filter-group");
                indexActionGroup = indexChipRow.createDiv("sidenote2-sidebar-toolbar-group is-action-group");
                this.renderIndexSearchInput(indexFilterGroup);
            } else {
                indexActionGroup = indexChipRow.createDiv("sidenote2-sidebar-toolbar-group");
            }
            this.renderToolbarIconButton(indexActionGroup, {
                icon: "list-filter",
                active: !!options.selectedIndexFileFilterRootPath,
                ariaLabel: options.indexFileFilterOptions.length
                    ? "Filter index by files"
                    : "No files with side notes yet",
                disabled: !options.indexFileFilterOptions.length,
                onClick: () => {
                    this.openIndexFileFilterModal(options.indexFileFilterOptions);
                },
            });
        } else {
            const modeRow = toolbarEl.createDiv("sidenote2-sidebar-toolbar-row");
            modeRow.addClass("is-note-primary-row");
            this.renderNoteModeControl(modeRow);

            if (shouldShowNoteSearchInput || showListOnlyToolbarChips || shouldShowAddPageCommentAction) {
                const actionsRow = toolbarEl.createDiv("sidenote2-sidebar-toolbar-row");
                actionsRow.addClass("is-note-secondary-row");
                noteFilterGroup = actionsRow.createDiv("sidenote2-sidebar-toolbar-group is-filter-group");
                noteActionGroup = actionsRow.createDiv("sidenote2-sidebar-toolbar-group is-action-group");
            }
        }

        if (!showListOnlyToolbarChips && options.isAllCommentsView) {
            return;
        }

        const filterGroup = options.isAllCommentsView
            ? (indexActionGroup ?? (indexChipRow ?? toolbarEl).createDiv("sidenote2-sidebar-toolbar-group"))
            : noteFilterGroup;
        const actionGroup = noteActionGroup ?? filterGroup;
        if (!filterGroup || !actionGroup) {
            return;
        }

        if (shouldShowNoteSearchInput) {
            this.renderNoteSearchInput(filterGroup);
        }
        if (isDeletedToolbarMode) {
            if (options.deletedCommentCount > 0) {
                this.renderToolbarChip(actionGroup, {
                    label: "Permanently delete notes",
                    active: false,
                    ariaLabel: `Permanently delete ${options.deletedCommentCount} deleted side note${options.deletedCommentCount === 1 ? "" : "s"} from this note`,
                    count: String(options.deletedCommentCount),
                    icon: "trash",
                    onClick: () => {
                        void this.clearDeletedCommentsForCurrentFile();
                    },
                });
            }
            return;
        }
        if (!options.isAllCommentsView && showListOnlyToolbarChips) {
            this.renderToolbarIconButton(actionGroup, {
                icon: "pin",
                active: showPinnedThreadsOnly,
                ariaLabel: showPinnedThreadsOnly ? "Show all side notes" : "Show pinned side notes",
                disabled: !hasPinnedThreads && !showPinnedThreadsOnly,
                onClick: () => {
                    void this.togglePinnedSidebarMode();
                },
            });
        }
        if (shouldShowContentFilterIcons && showListOnlyToolbarChips) {
            this.renderToolbarIconButton(actionGroup, {
                icon: "bookmark",
                active: contentFilter === "bookmarks",
                ariaLabel: contentFilter === "bookmarks"
                    ? "Show all comments"
                    : "Show bookmark comments",
                disabled: options.bookmarkThreadCount === 0 && contentFilter !== "bookmarks",
                onClick: () => {
                    const nextState = toggleSidebarContentFilterState(
                        contentFilter,
                        "bookmarks",
                        this.pinnedSidebarThreadIds,
                    );
                    this.noteSidebarContentFilter = nextState.filter;
                    this.pinnedSidebarThreadIds = nextState.pinnedThreadIds;
                    void this.renderComments();
                },
            });
        }
        if (shouldShowResolvedChip) {
            this.renderToolbarIconButton(actionGroup, {
                icon: "check",
                active: showResolved,
                ariaLabel: showResolved ? "Show active comments" : "Show resolved comments only",
                onClick: () => {
                    void this.plugin.setShowResolvedComments(!showResolved);
                },
            });
        }

        if (shouldShowNestedChip) {
            this.renderToolbarIconButton(actionGroup, {
                icon: showNestedComments ? "chevrons-up" : "chevrons-down",
                ariaLabel: showNestedComments ? "Hide nested comments" : "Show nested comments",
                active: showNestedComments,
                activeVisual: false,
                onClick: () => {
                    void this.plugin.setShowNestedComments(!showNestedComments);
                },
            });
        }

        if (!options.isAllCommentsView && showListOnlyToolbarChips) {
            this.renderToolbarIconButton(actionGroup, {
                icon: "trash-2",
                ariaLabel: showDeletedComments ? "Hide deleted notes" : "Show deleted notes",
                active: showDeletedComments,
                disabled: !options.hasDeletedComments && !showDeletedComments,
                onClick: () => {
                    void this.toggleDeletedSidebarMode({
                        showDeleted: showDeletedComments,
                        showResolved,
                        contentFilter,
                    });
                },
            });

            if (showDeletedComments && options.deletedCommentCount > 0) {
                this.renderToolbarChip(actionGroup, {
                    label: "Empty trash",
                    active: false,
                    ariaLabel: `Permanently delete ${options.deletedCommentCount} deleted side note${options.deletedCommentCount === 1 ? "" : "s"} from this note`,
                    count: String(options.deletedCommentCount),
                    icon: "trash",
                    onClick: () => {
                        void this.clearDeletedCommentsForCurrentFile();
                    },
                });
            }
        }

        if (shouldShowAddPageCommentAction && options.addPageCommentAction) {
            this.renderToolbarIconButton(actionGroup, {
                icon: options.addPageCommentAction.icon,
                ariaLabel: options.addPageCommentAction.ariaLabel,
                onClick: options.addPageCommentAction.onClick,
            });
        }
    }

    private renderToolbarChip(
        container: HTMLElement,
        options: {
            label: string;
            active: boolean;
            pressed?: boolean;
            ariaLabel: string;
            onClick: () => void;
            count?: string;
            showIndicator?: boolean;
            disabled?: boolean;
            icon?: string;
        },
    ): void {
        const button = container.createEl("button", {
            cls: `sidenote2-filter-chip${options.active ? " is-active" : ""}`,
        });
        button.setAttribute("type", "button");
        button.setAttribute("aria-pressed", (options.pressed ?? options.active) ? "true" : "false");
        button.setAttribute("aria-label", options.ariaLabel);
        button.disabled = options.disabled ?? false;

        if (options.showIndicator) {
            button.createSpan({
                cls: "sidenote2-filter-chip-indicator",
            });
        }

        if (options.icon) {
            const iconEl = button.createSpan({
                cls: "sidenote2-filter-chip-icon",
            });
            setIcon(iconEl, options.icon);
        }

        button.createSpan({
            text: options.label,
            cls: "sidenote2-filter-chip-label",
        });

        if (options.count !== undefined) {
            button.createSpan({
                text: options.count,
                cls: "sidenote2-filter-chip-count",
            });
        }

        button.onclick = async () => {
            if (!(await this.saveVisibleDraftIfPresent())) {
                return;
            }
            options.onClick();
        };
    }

    private renderToolbarIconButton(
        container: HTMLElement,
        options: {
            icon: string;
            ariaLabel: string;
            active?: boolean;
            activeVisual?: boolean;
            disabled?: boolean;
            onClick: () => void;
        },
    ): void {
        const showActiveVisual = options.activeVisual ?? options.active ?? false;
        const button = container.createEl("button", {
            cls: `clickable-icon sidenote2-comment-section-add-button sidenote2-toolbar-icon-button${showActiveVisual ? " is-active" : ""}`,
        });
        button.setAttribute("type", "button");
        button.setAttribute("aria-pressed", options.active ? "true" : "false");
        button.setAttribute("aria-label", options.ariaLabel);
        button.disabled = options.disabled ?? false;
        setIcon(button, options.icon);
        button.onclick = async () => {
            if (!(await this.saveVisibleDraftIfPresent())) {
                return;
            }
            options.onClick();
        };
    }

    private refreshSidebarSearchHighlights(container: HTMLElement, query: string): void {
        clearSidebarSearchHighlights(container);

        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            return;
        }

        const selectors = [
            ".sidenote2-comment-meta-preview",
            ".sidenote2-comment-content",
            ".sidenote2-comment-reference-section-list",
        ];
        highlightSidebarSearchMatches(container, trimmedQuery, {
            allowedSelectors: selectors,
        });
    }

    private renderSidebarSearchInput(
        container: HTMLElement,
        options: {
            value: string;
            ariaLabel: string;
            onClear: () => void;
            onInput: (value: string, selection: { selectionStart: number | null; selectionEnd: number | null }) => void;
        },
    ): void {
        const searchGroup = container.createDiv("sidenote2-sidebar-toolbar-group is-search-group");
        const fieldEl = searchGroup.createDiv("sidenote2-note-search-field");
        const iconEl = fieldEl.createSpan({
            cls: "sidenote2-note-search-icon",
        });
        setIcon(iconEl, "search");
        const inputEl = fieldEl.createEl("input", {
            cls: "sidenote2-note-search-input",
        });
        inputEl.type = "search";
        inputEl.value = options.value;
        inputEl.spellcheck = false;
        inputEl.setAttribute("aria-label", options.ariaLabel);
        inputEl.addEventListener("focus", () => {
            this.interactionController.claimSidebarInteractionOwnership(inputEl);
        });
        inputEl.addEventListener("keydown", (event) => {
            if (event.key !== "Escape" || !inputEl.value) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            options.onClear();
        });
        inputEl.addEventListener("input", () => {
            options.onInput(inputEl.value, {
                selectionStart: inputEl.selectionStart,
                selectionEnd: inputEl.selectionEnd,
            });
        });
    }

    private renderNoteSearchInput(container: HTMLElement): void {
        this.renderSidebarSearchInput(container, {
            value: this.noteSidebarSearchInputValue,
            ariaLabel: "Search side notes in this file",
            onClear: () => {
                this.clearNoteSidebarSearchDebounceTimer();
                const requestVersion = ++this.noteSidebarSearchRequestVersion;
                this.noteSidebarSearchInputValue = "";
                void this.applyNoteSidebarSearchQuery("", requestVersion, {
                    selectionStart: 0,
                    selectionEnd: 0,
                });
            },
            onInput: (value, selection) => {
                this.scheduleNoteSidebarSearchQuery(value, selection);
            },
        });
    }

    private renderIndexSearchInput(container: HTMLElement): void {
        this.renderSidebarSearchInput(container, {
            value: this.indexSidebarSearchInputValue,
            ariaLabel: "Search side notes in the index",
            onClear: () => {
                this.clearIndexSidebarSearchDebounceTimer();
                const requestVersion = ++this.indexSidebarSearchRequestVersion;
                this.indexSidebarSearchInputValue = "";
                void this.applyIndexSidebarSearchQuery("", requestVersion, {
                    selectionStart: 0,
                    selectionEnd: 0,
                });
            },
            onInput: (value, selection) => {
                this.scheduleIndexSidebarSearchQuery(value, selection);
            },
        });
    }

    private renderIndexModeControl(container: HTMLElement): void {
        this.renderSidebarModeControl(container, {
            mode: this.indexSidebarMode,
            onChange: (mode) => {
                if (this.indexSidebarMode === mode) {
                    return;
                }

                this.indexSidebarMode = mode;
                if (mode !== "list") {
                    this.showPinnedSidebarThreadsOnly = false;
                    this.savePinnedSidebarStateForFilePath(this.file?.path ?? null);
                }
                void this.plugin.logEvent("info", "index", "index.mode.changed", {
                    mode,
                    source: "toolbar",
                });
                void this.renderComments();
            },
        });
    }

    private renderNoteModeControl(container: HTMLElement): void {
        this.renderSidebarModeControl(container, {
            mode: this.noteSidebarMode,
            onChange: (mode) => {
                if (this.noteSidebarMode === mode) {
                    return;
                }

                this.noteSidebarMode = mode;
                if (mode !== "list") {
                    this.showPinnedSidebarThreadsOnly = false;
                    this.savePinnedSidebarStateForFilePath(this.file?.path ?? null);
                }
                void this.plugin.logEvent("info", "note", "note.mode.changed", {
                    mode,
                    source: "toolbar",
                });
                void this.renderComments();
            },
        });
    }

    private renderSidebarModeControl(
        container: HTMLElement,
        options: {
            mode: SidebarPrimaryMode;
            onChange: (mode: SidebarPrimaryMode) => void;
        },
    ): void {
        const modeGroup = container.createDiv("sidenote2-sidebar-toolbar-group is-mode-group");
        const tabList = modeGroup.createDiv(`sidenote2-tablist is-${options.mode}`);
        tabList.setAttribute("role", "tablist");
        this.renderTabButton(tabList, {
            label: "List",
            active: options.mode === "list",
            onClick: () => {
                options.onChange("list");
            },
        });
        this.renderTabButton(tabList, {
            label: "Thought Trail",
            active: options.mode === "thought-trail",
            onClick: () => {
                options.onChange("thought-trail");
            },
        });
    }

    private renderTabButton(
        container: HTMLElement,
        options: {
            label: string;
            active: boolean;
            onClick: () => void;
        },
    ): void {
        const button = container.createEl("button", {
            cls: `sidenote2-tab-button${options.active ? " sidenote2-tab-button--active" : ""}`,
            text: options.label,
        });
        button.setAttribute("type", "button");
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", options.active ? "true" : "false");
        button.tabIndex = options.active ? 0 : -1;
        button.onclick = async () => {
            if (!(await this.saveVisibleDraftIfPresent())) {
                return;
            }
            options.onClick();
        };
    }

    private renderActiveFileFilters(
        container: HTMLElement,
        rootFilePath: string,
        filteredIndexFilePaths: string[],
        indexFileFilterOptions: IndexFileFilterOption[],
    ): void {
        const filterBar = container.createDiv("sidenote2-active-file-filters");
        const rootChip = filterBar.createDiv("sidenote2-active-file-filter");
        rootChip.addClass("is-root");

        rootChip.createSpan({
            text: getIndexFileFilterLabel(rootFilePath, filteredIndexFilePaths),
            cls: "sidenote2-active-file-filter-label",
        });

        const clearButton = rootChip.createEl("button", {
            cls: "sidenote2-active-file-filter-clear clickable-icon",
        });
        clearButton.setAttribute("type", "button");
        clearButton.setAttribute("aria-label", `Clear file filter for ${rootFilePath}`);
        setIcon(clearButton, "x");
        clearButton.onclick = async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!(await this.saveVisibleDraftIfPresent())) {
                return;
            }
            void this.setIndexFileFilterRootPath(null);
        };

        const linkedFileCount = Math.max(0, filteredIndexFilePaths.length - 1);
        const summaryEl = filterBar.createDiv("sidenote2-active-file-filter-summary");
        summaryEl.setText(
            linkedFileCount > 0
                ? `+${linkedFileCount} linked file${linkedFileCount === 1 ? "" : "s"}`
                : "1 file",
        );
    }

    private openIndexFileFilterModal(indexFileFilterOptions: IndexFileFilterOption[]): void {
        new SideNoteFileFilterModal(this.app, {
            availableOptions: indexFileFilterOptions,
            selectedRootFilePath: this.selectedIndexFileFilterRootPath,
            selectedFilePaths: deriveIndexSidebarScopedFilePaths(
                this.indexFileFilterGraph,
                this.selectedIndexFileFilterRootPath,
            ),
            onChooseRoot: async (rootFilePath) => {
                await this.setIndexFileFilterRootPath(rootFilePath);
            },
        }).open();
    }

    public async setIndexFileFilterRootPath(filePath: string | null): Promise<void> {
        const normalizedRootPath = normalizeIndexFileFilterRootPath(filePath);
        if (this.selectedIndexFileFilterRootPath === normalizedRootPath) {
            return;
        }

        this.selectedIndexFileFilterRootPath = normalizedRootPath;
        void this.plugin.logEvent("info", "index", "index.filter.changed", {
            rootFilePath: normalizedRootPath,
            source: "sidebar",
        });
        this.interactionController.clearActiveState();
        await this.renderComments();
    }

    private ensureListModeForCommentFocus(): void {
        if (!this.file) {
            return;
        }

        if (this.plugin.isAllCommentsNotePath(this.file.path)) {
            if (this.indexSidebarMode === "list") {
                return;
            }

            this.indexSidebarMode = "list";
            void this.plugin.logEvent("info", "index", "index.mode.changed", {
                mode: "list",
                source: "comment-focus",
            });
            return;
        }

        if (this.noteSidebarMode === "list") {
            return;
        }

        this.noteSidebarMode = "list";
        void this.plugin.logEvent("info", "note", "note.mode.changed", {
            mode: "list",
            source: "comment-focus",
        });
    }

    private renderSupportButton(options: {
        filePath: string | null;
        isAllCommentsView: boolean;
        threadCount: number;
    }): void {
        const slot = this.containerEl.createDiv("sidenote2-support-button-slot");
        this.renderSupportButtonIn(slot, options);
    }

    private renderSupportButtonIn(
        container: HTMLElement,
        options: {
            filePath: string | null;
            isAllCommentsView: boolean;
            threadCount: number;
        },
    ): void {
        container.empty();
        const button = container.createEl("button", {
            cls: "clickable-icon sidenote2-support-button",
        });
        button.setAttribute("type", "button");
        button.setAttribute("aria-label", "Open log inspector");
        setIcon(button, "life-buoy");
        button.onclick = () => {
            void this.plugin.openSupportLogInspectorModal({
                filePath: options.filePath,
                surface: options.isAllCommentsView ? "index" : "note",
                threadCount: options.threadCount,
            });
        };
    }

    private renderCommentsList(container: HTMLElement): HTMLDivElement {
        return container.createDiv("sidenote2-comments-list");
    }

    private openMoveCommentThreadModal(threadId: string, sourceFilePath: string): void {
        const openTargets = this.getOpenMarkdownFileInsertTargets();
        const openTargetsByPath = new Map(openTargets.map((target) => [target.file.path, target]));
        const availableFiles = this.app.vault
            .getMarkdownFiles()
            .filter((file) =>
                file.path !== sourceFilePath
                && file.path !== this.plugin.getAllCommentsNotePath()
            )
            .map((file) => {
                const openTarget = openTargetsByPath.get(file.path);
                return {
                    fileName: file.basename,
                    filePath: file.path,
                    active: openTarget?.active ?? false,
                    recent: openTarget?.recent ?? false,
                };
            })
            .sort((left, right) => {
                if (left.active !== right.active) {
                    return left.active ? -1 : 1;
                }
                if (left.recent !== right.recent) {
                    return left.recent ? -1 : 1;
                }

                return left.filePath.localeCompare(right.filePath);
            });

        new SideNoteOpenFileSuggestModal(this.app, {
            availableFiles,
            detailLabel: "",
            emptyStateText: "No markdown files are available to move into.",
            onChooseFile: async (suggestion) => {
                await this.moveSidebarCommentThreadToFile(threadId, suggestion.filePath);
            },
            onCloseModal: () => {},
            placeholder: "Find a file to move into",
            title: "Move to another file",
        }).open();
    }

    private getOpenMarkdownFileInsertTargets(): OpenMarkdownFileInsertTarget[] {
        const workspace = this.app.workspace;
        const activeLeaf = workspace.getActiveViewOfType(MarkdownView)?.leaf ?? null;
        const recentLeaf = workspace.getMostRecentLeaf(workspace.rootSplit);
        const targetsByPath = new Map<string, OpenMarkdownFileInsertTarget>();

        workspace.iterateAllLeaves((leaf) => {
            if (!(leaf.view instanceof MarkdownView)) {
                return;
            }

            const file = leaf.view.file;
            if (!(file instanceof TFile) || file.extension !== "md") {
                return;
            }

            const target: OpenMarkdownFileInsertTarget = {
                file,
                leaf,
                view: leaf.view,
                active: leaf === activeLeaf,
                recent: leaf === recentLeaf,
                editable: leaf.view.getMode() !== "preview",
            };
            const current = targetsByPath.get(file.path);
            if (!current) {
                targetsByPath.set(file.path, target);
                return;
            }

            const preferredTarget = shouldReplaceOpenMarkdownFileInsertTarget(current, target)
                ? target
                : current;
            targetsByPath.set(file.path, {
                ...preferredTarget,
                active: current.active || target.active,
                recent: current.recent || target.recent,
                editable: current.editable || target.editable,
            });
        });

        return Array.from(targetsByPath.values()).sort(compareOpenMarkdownFileInsertTargets);
    }

    private async insertCommentMarkdownIntoOpenFile(
        target: OpenMarkdownFileInsertTarget,
        markdown: string,
    ): Promise<boolean> {
        const normalizedMarkdown = markdown.trim();
        if (!normalizedMarkdown) {
            new Notice("Unable to add that content.");
            return false;
        }

        this.app.workspace.setActiveLeaf(target.leaf, { focus: true });

        const editableView = await ensureEditableMarkdownLeafForInsert(target.leaf);
        if (!editableView) {
            new Notice("Unable to open that file for editing.");
            return false;
        }

        const editor = editableView.editor;
        const insertionText = buildAppendToFileEndText(editor.getValue(), normalizedMarkdown);
        if (!insertionText) {
            new Notice("Unable to add that content.");
            return false;
        }

        const lastLine = editor.lastLine();
        const endPosition = {
            line: lastLine,
            ch: editor.getLine(lastLine).length,
        };
        editor.replaceRange(insertionText, endPosition);
        const nextEndPosition = {
            line: editor.lastLine(),
            ch: editor.getLine(editor.lastLine()).length,
        };
        editor.setSelection(nextEndPosition, nextEndPosition);
        editableView.editor.focus();
        new Notice("Added to file.");
        return true;
    }

    private async insertCommentMarkdownIntoFile(markdown: string): Promise<boolean> {
        const availableTargets = this.getOpenMarkdownFileInsertTargets();
        if (!availableTargets.length) {
            new Notice("Open a markdown file first.");
            return false;
        }

        return new Promise<boolean>((resolve) => {
            let selectionStarted = false;
            let settled = false;
            const settle = (value: boolean) => {
                if (settled) {
                    return;
                }

                settled = true;
                resolve(value);
            };

            new SideNoteOpenFileSuggestModal(this.app, {
                availableFiles: availableTargets.map((target) => ({
                    fileName: target.file.basename,
                    filePath: target.file.path,
                    active: target.active,
                    recent: target.recent,
                })),
                onChooseFile: async (suggestion) => {
                    selectionStarted = true;
                    const latestTarget = this.getOpenMarkdownFileInsertTargets()
                        .find((target) => target.file.path === suggestion.filePath);
                    if (!latestTarget) {
                        new Notice("That file is no longer open.");
                        settle(false);
                        return;
                    }

                    try {
                        settle(await this.insertCommentMarkdownIntoOpenFile(latestTarget, markdown));
                    } catch (error) {
                        console.error("Failed to add comment markdown to file", error);
                        new Notice("Unable to add to that file.");
                        settle(false);
                    }
                },
                onCloseModal: () => {
                    if (!selectionStarted) {
                        settle(false);
                    }
                },
            }).open();
        });
    }

    private async renderPersistedComment(
        commentsContainer: HTMLDivElement,
        thread: CommentThread,
        enablePageThreadReorder: boolean,
        agentRun: ReturnType<SideNote2["getLatestAgentRunForThread"]>,
        agentStream: ReturnType<SideNote2["getActiveAgentStreamForThread"]>,
        threadAgentRuns: AgentRunRecord[],
        editDraftComment: DraftComment | null = null,
        appendDraftComment: DraftComment | null = null,
    ) {
        const currentFilePath = this.file?.path ?? null;
        const isIndexView = !!currentFilePath && this.plugin.isAllCommentsNotePath(currentFilePath);

        await renderPersistedCommentCard(commentsContainer, thread, {
            activeCommentId: this.interactionController.getActiveCommentId(),
            currentFilePath,
            currentUserLabel: "You",
            showSourceRedirectAction: isIndexView,
            showBookmarkAndPinControls: !isIndexView,
            showDeletedComments: this.plugin.shouldShowDeletedComments(),
            enablePageThreadReorder,
            enableChildEntryMove: true,
            enableSoftDeleteActions: !isIndexView,
            showNestedComments: this.plugin.shouldShowNestedCommentsForThread(thread.id),
            showNestedCommentsByDefault: this.plugin.shouldShowNestedComments(),
            getKnownCommentById: (commentId) => this.plugin.getCommentById(commentId),
            editDraftComment,
            appendDraftComment,
            agentRun,
            agentStream,
            threadAgentRuns,
            getEventTargetElement: (target) => this.interactionController.getEventTargetElement(target),
            isSelectionInsideSidebarContent: (selection) => this.interactionController.isSelectionInsideSidebarContent(selection),
            claimSidebarInteractionOwnership: (focusTarget) => this.interactionController.claimSidebarInteractionOwnership(focusTarget),
            insertCommentMarkdownIntoFile: (markdown) => this.insertCommentMarkdownIntoFile(markdown),
            renderMarkdown: async (markdown, container, sourcePath) => {
                await MarkdownRenderer.render(this.app, markdown, container, sourcePath, this);
            },
            openSidebarInternalLink: (href, sourcePath, focusTarget) =>
                this.interactionController.openSidebarInternalLink(href, sourcePath, focusTarget),
            openCommentFromCard: async (persistedComment) => {
                if (isIndexView && currentFilePath) {
                    this.interactionController.setActiveComment(persistedComment.id);
                    await this.plugin.revealIndexCommentFromSidebar(persistedComment.id, currentFilePath);
                    return;
                }

                await this.interactionController.openCommentInEditor(persistedComment);
            },
            openCommentInEditor: (persistedComment) => this.interactionController.openCommentInEditor(persistedComment),
            shareComment: async (persistedComment) => {
                const commentUrl = buildCommentLocationUrl(this.app.vault.getName(), persistedComment);
                const copied = await copyTextToClipboard(commentUrl);
                new Notice(copied ? "Copied side note link." : "Failed to copy side note link.");
            },
            saveVisibleDraftIfPresent: () => this.saveVisibleDraftIfPresent(),
            setShowNestedCommentsForThread: (threadId, showNestedComments) => {
                void this.plugin.setShowNestedCommentsForThread(threadId, showNestedComments);
            },
            resolveComment: (commentId) => this.setSidebarCommentResolvedState(commentId, true),
            unresolveComment: (commentId) => this.setSidebarCommentResolvedState(commentId, false),
            moveCommentThread: (threadId, sourceFilePath) => {
                this.openMoveCommentThreadModal(threadId, sourceFilePath);
            },
            restoreComment: async (commentId) => {
                const thread = this.plugin.getThreadById(commentId);
                const restored = await this.plugin.restoreComment(commentId);
                if (!restored) {
                    return;
                }

                if (thread && thread.id !== commentId) {
                    await this.plugin.setShowNestedCommentsForThread(thread.id, true);
                }
                if (this.plugin.shouldShowDeletedComments()) {
                    await this.plugin.setShowDeletedComments(false);
                }
                this.highlightComment(commentId);
            },
            startEditDraft: (commentId, hostFilePath) => {
                void this.plugin.startEditDraft(commentId, hostFilePath);
            },
            setCommentBookmarkState: (commentId, isBookmark) => this.setSidebarCommentBookmarkState(commentId, isBookmark),
            isPinnedThread: (threadId) => this.isPinnedSidebarThread(threadId),
            togglePinnedThread: (threadId) => this.togglePinnedSidebarThread(threadId),
            startAppendEntryDraft: (commentId, hostFilePath) => {
                void this.plugin.startAppendEntryDraft(commentId, hostFilePath);
            },
            retryAgentRun: (runId) => this.plugin.retryAgentRun(runId),
            retryAgentPromptForComment: (commentId, filePath) => this.plugin.retryAgentPromptForComment(commentId, filePath),
            reanchorCommentThreadToCurrentSelection: (commentId) => {
                void this.plugin.reanchorCommentThreadToCurrentSelection(commentId);
            },
            deleteCommentWithConfirm: (commentId) => this.deleteCommentWithConfirm(commentId),
            renderAppendDraft: (container, comment) => {
                this.renderDraftComment(container, comment);
            },
            renderInlineEditDraft: (container, comment) => {
                this.renderInlineEditDraft(container, comment);
            },
            setIcon: (element, icon) => {
                setIcon(element, icon);
            },
        });
    }

    private setupPageThreadReorderInteractions(commentsBody: HTMLDivElement, filePath: string): void {
        commentsBody.addEventListener("dragstart", (event: DragEvent) => {
            const dragState = this.getSidebarDragStateFromEventTarget(event.target, filePath);
            if (!dragState) {
                return;
            }

            this.clearReorderDragState();
            this.reorderDragState = dragState;
            this.reorderDragSourceEl = this.getCommentItemFromEventTarget(event.target);
            this.reorderDragSourceEl?.addClass("is-drag-source");
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                    "text/plain",
                    dragState.kind === "thread"
                        ? dragState.threadId
                        : dragState.entryId,
                );
            }
        });

        commentsBody.addEventListener("dragover", (event: DragEvent) => {
            const threadDropTarget = this.resolvePageThreadDropTarget(event);
            const entryDropTarget = this.resolveChildEntryMoveDropTarget(event);
            if (!threadDropTarget && !entryDropTarget) {
                this.clearReorderDropIndicator();
                return;
            }

            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "move";
            }
            if (threadDropTarget) {
                this.setReorderDropIndicator(threadDropTarget.element, threadDropTarget.placement);
                return;
            }
            if (entryDropTarget) {
                this.setReorderDropIndicator(entryDropTarget.element, "after");
            }
        });

        commentsBody.addEventListener("drop", (event: DragEvent) => {
            const dragState = this.reorderDragState;
            const threadDropTarget = this.resolvePageThreadDropTarget(event);
            const entryDropTarget = this.resolveChildEntryMoveDropTarget(event);
            this.clearReorderDropIndicator();
            if (!dragState || (!threadDropTarget && !entryDropTarget)) {
                return;
            }

            event.preventDefault();
            this.clearReorderDragState();
            if (dragState.kind === "thread" && threadDropTarget) {
                void this.plugin.reorderThreadsForFile(
                    dragState.filePath,
                    dragState.threadId,
                    threadDropTarget.targetId,
                    threadDropTarget.placement,
                );
                return;
            }
            if (dragState.kind === "thread-entry" && entryDropTarget) {
                void this.moveSidebarCommentEntryToThread(dragState.entryId, entryDropTarget.targetThreadId);
            }
        });

        commentsBody.addEventListener("dragend", () => {
            this.clearReorderDragState();
        });
    }

    private getCommentItemFromEventTarget(target: EventTarget | null): HTMLElement | null {
        return target instanceof Element
            ? target.closest(".sidenote2-comment-item")
            : null;
    }

    private getSidebarDragStateFromEventTarget(
        target: EventTarget | null,
        filePath: string,
    ): SidebarReorderDragState | null {
        if (!(target instanceof Element)) {
            return null;
        }

        const handleEl = target.closest("[data-sidenote2-drag-kind]");
        if (!(handleEl instanceof HTMLElement)) {
            return null;
        }

        const dragKind = handleEl.getAttribute("data-sidenote2-drag-kind");
        if (dragKind === "thread") {
            const threadId = handleEl.getAttribute("data-sidenote2-thread-id");
            if (!threadId) {
                return null;
            }

            return {
                kind: "thread",
                filePath,
                threadId,
            };
        }

        if (dragKind !== "thread-entry") {
            return null;
        }

        const sourceThreadId = handleEl.getAttribute("data-sidenote2-thread-id");
        const entryId = handleEl.getAttribute("data-sidenote2-entry-id");
        if (!sourceThreadId || !entryId) {
            return null;
        }
        const sourceThread = this.plugin.getThreadById(sourceThreadId);
        if (!sourceThread) {
            return null;
        }

        return {
            kind: "thread-entry",
            entryId,
            filePath: sourceThread.filePath,
            sourceThreadId,
        };
    }

    private resolvePageThreadDropTarget(event: DragEvent): {
        element: HTMLElement;
        targetId: string;
        placement: ReorderPlacement;
    } | null {
        const dragState = this.reorderDragState;
        if (!dragState || dragState.kind !== "thread" || !(event.target instanceof Element)) {
            return null;
        }

        const threadStackEl = event.target.closest(".sidenote2-thread-stack[data-sidenote2-page-thread='true']");
        if (!(threadStackEl instanceof HTMLElement)) {
            return null;
        }

        const targetThreadId = threadStackEl.getAttribute("data-thread-id");
        const targetCommentEl = threadStackEl.firstElementChild;
        if (!targetThreadId || targetThreadId === dragState.threadId) {
            return null;
        }
        if (!(targetCommentEl instanceof HTMLElement)) {
            return null;
        }

        return {
            element: targetCommentEl,
            targetId: targetThreadId,
            placement: this.resolveReorderPlacement(threadStackEl, event.clientY),
        };
    }

    private resolveChildEntryMoveDropTarget(event: DragEvent): {
        element: HTMLElement;
        targetThreadId: string;
    } | null {
        const dragState = this.reorderDragState;
        if (!dragState || dragState.kind !== "thread-entry" || !(event.target instanceof Element)) {
            return null;
        }

        const threadStackEl = event.target.closest(".sidenote2-thread-stack");
        if (!(threadStackEl instanceof HTMLElement)) {
            return null;
        }

        const targetThreadId = threadStackEl.getAttribute("data-thread-id");
        const targetCommentEl = threadStackEl.firstElementChild;
        if (!targetThreadId || targetThreadId === dragState.sourceThreadId) {
            return null;
        }
        const targetThread = this.plugin.getThreadById(targetThreadId);
        if (
            !targetThread
            || targetThread.deletedAt
            || targetThread.resolved
            || targetThread.filePath !== dragState.filePath
        ) {
            return null;
        }
        if (!(targetCommentEl instanceof HTMLElement)) {
            return null;
        }

        return {
            element: targetCommentEl,
            targetThreadId,
        };
    }

    private resolveReorderPlacement(element: HTMLElement, clientY: number): ReorderPlacement {
        const rect = element.getBoundingClientRect();
        return clientY < rect.top + rect.height / 2 ? "before" : "after";
    }

    private setReorderDropIndicator(element: HTMLElement, placement: ReorderPlacement): void {
        if (this.reorderDropIndicatorEl === element && this.reorderDropIndicatorPlacement === placement) {
            return;
        }

        this.clearReorderDropIndicator();
        this.reorderDropIndicatorEl = element;
        this.reorderDropIndicatorPlacement = placement;
        element.addClass(placement === "before" ? "is-drop-before" : "is-drop-after");
    }

    private clearReorderDropIndicator(): void {
        if (!this.reorderDropIndicatorEl) {
            this.reorderDropIndicatorPlacement = null;
            return;
        }

        this.reorderDropIndicatorEl.removeClass("is-drop-before", "is-drop-after");
        this.reorderDropIndicatorEl = null;
        this.reorderDropIndicatorPlacement = null;
    }

    private clearReorderDragState(): void {
        this.clearReorderDropIndicator();
        this.reorderDragSourceEl?.removeClass("is-drag-source");
        this.reorderDragSourceEl = null;
        this.reorderDragState = null;
    }

    private renderDraftComment(commentsContainer: HTMLDivElement, comment: DraftComment) {
        renderDraftCommentCard(commentsContainer, comment, {
            activeCommentId: this.interactionController.getActiveCommentId(),
            shouldPinFocusedDraftToTop: this.isNonDesktopClient(),
            isSavingDraft: (commentId) => this.plugin.isSavingDraft(commentId),
            updateDraftCommentText: (commentId, commentText) => {
                this.plugin.updateDraftCommentText(commentId, commentText);
            },
            updateDraftCommentBookmarkState: (commentId, isBookmark) => {
                this.plugin.updateDraftCommentBookmarkState(commentId, isBookmark);
            },
            setIcon: (element, icon) => {
                setIcon(element, icon);
            },
            claimSidebarInteractionOwnership: (focusTarget) => this.interactionController.claimSidebarInteractionOwnership(focusTarget),
            saveDraft: async (commentId, options) => {
                await this.saveDraftAndClearActiveState(commentId, comment.filePath, options);
            },
            cancelDraft: (commentId) => {
                void this.plugin.cancelDraft(commentId);
            },
        }, this.draftEditorController);
    }

    private renderInlineEditDraft(commentsContainer: HTMLDivElement, comment: DraftComment) {
        renderInlineEditDraftContent(commentsContainer, comment, {
            activeCommentId: this.interactionController.getActiveCommentId(),
            shouldPinFocusedDraftToTop: this.isNonDesktopClient(),
            isSavingDraft: (commentId) => this.plugin.isSavingDraft(commentId),
            updateDraftCommentText: (commentId, commentText) => {
                this.plugin.updateDraftCommentText(commentId, commentText);
            },
            updateDraftCommentBookmarkState: (commentId, isBookmark) => {
                this.plugin.updateDraftCommentBookmarkState(commentId, isBookmark);
            },
            setIcon: (element, icon) => {
                setIcon(element, icon);
            },
            claimSidebarInteractionOwnership: (focusTarget) => this.interactionController.claimSidebarInteractionOwnership(focusTarget),
            saveDraft: async (commentId, options) => {
                await this.saveDraftAndClearActiveState(commentId, comment.filePath, options);
            },
            cancelDraft: (commentId) => {
                void this.plugin.cancelDraft(commentId);
            },
        }, this.draftEditorController);
    }

    private async saveDraftAndClearActiveState(
        commentId: string,
        draftFilePath: string,
        options?: {
            skipPreSaveRefresh?: boolean;
            skipAnchorRevalidation?: boolean;
            deferAggregateRefresh?: boolean;
            skipPersistedViewRefresh?: boolean;
        },
    ): Promise<void> {
        const currentViewPath = this.file?.path ?? null;
        await this.plugin.saveDraft(commentId, options);

        const remainingDraft = (currentViewPath
            ? this.plugin.getDraftForView(currentViewPath)
            : null)
            ?? this.plugin.getDraftForFile(draftFilePath);
        if (remainingDraft?.id === commentId) {
            return;
        }

        this.interactionController.clearActiveState();
    }

    private async saveVisibleDraftIfPresent(): Promise<boolean> {
        const currentViewPath = this.file?.path ?? null;
        if (!currentViewPath) {
            return true;
        }

        const draft = this.plugin.getDraftForView(currentViewPath);
        if (!draft) {
            return true;
        }

        await this.plugin.saveDraft(draft.id);
        const remainingDraft = this.plugin.getDraftForView(currentViewPath);
        return remainingDraft?.id !== draft.id;
    }

    private async renderThoughtTrail(
        commentsContainer: HTMLDivElement,
        comments: Array<Comment | CommentThread>,
        file: TFile,
        options: {
            surface: "index" | "note";
            hasRootScope: boolean;
            rootFilePath: string | null;
        },
    ): Promise<void> {
        const thoughtTrailEl = commentsContainer.createDiv("sidenote2-thought-trail");
        if (!options.hasRootScope || !options.rootFilePath) {
            const emptyStateEl = thoughtTrailEl.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
            if (options.surface === "note") {
                emptyStateEl.createEl("p", { text: "No thought trail is available for this file yet." });
                emptyStateEl.createEl("p", { text: "Add side notes in this note to create a rooted trail." });
            } else {
                emptyStateEl.createEl("p", { text: "Use files to choose a file and see its connected files." });
            }
            return;
        }

        const rootFilePath = options.rootFilePath;
        const relatedFileLines = buildThoughtTrailLines(this.app.vault.getName(), comments, {
            allCommentsNotePath: this.plugin.getAllCommentsNotePath(),
            resolveWikiLinkPath: (linkPath, sourceFilePath) => {
                const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFilePath);
                return linkedFile instanceof TFile ? linkedFile.path : null;
            },
        });
        await this.renderThoughtTrailSection(thoughtTrailEl, {
            emptyStateText: options.surface === "note"
                ? [
                    "No related files for this file yet.",
                    "Add wiki links in side notes for this file.",
                ]
                : [
                    "No related files for the selected file.",
                    "Add links in those notes or choose a different file.",
                ],
            sourcePath: rootFilePath || file.path,
            thoughtTrailLines: relatedFileLines,
            title: "Related Files",
        });
    }

    private async renderThoughtTrailSection(
        container: HTMLDivElement,
        options: {
            emptyStateText: string[];
            sourcePath: string;
            thoughtTrailLines: string[];
            title: string;
        },
    ): Promise<void> {
        const sectionEl = container.createDiv("sidenote2-thought-trail-section");
        sectionEl.createEl("h4", {
            cls: "sidenote2-thought-trail-section-title",
            text: options.title,
        });
        if (!options.thoughtTrailLines.length) {
            const emptyStateEl = sectionEl.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
            options.emptyStateText.forEach((text) => {
                emptyStateEl.createEl("p", { text });
            });
            return;
        }

        const graphEl = sectionEl.createDiv("sidenote2-thought-trail-section-graph");
        await this.renderThoughtTrailMermaid(graphEl, options.thoughtTrailLines, options.sourcePath);
        this.bindThoughtTrailNodeLinks(graphEl, options.thoughtTrailLines);
    }

    private async renderThoughtTrailMermaid(
        container: HTMLElement,
        thoughtTrailLines: string[],
        sourcePath: string,
    ): Promise<void> {
        const fallbackToMarkdownRenderer = async (): Promise<void> => {
            await MarkdownRenderer.render(
                this.app,
                thoughtTrailLines.join("\n"),
                container,
                sourcePath,
                this,
            );

            const fallbackMermaidEl = container.querySelector(".mermaid");
            if (fallbackMermaidEl instanceof HTMLElement) {
                fallbackMermaidEl.setAttribute("data-sidenote2-thought-trail-renderer", "markdown");
            }
        };

        await loadMermaid().catch(() => undefined);
        const mermaidRuntime = (globalThis as typeof globalThis & { mermaid?: unknown }).mermaid;
        if (!isMermaidRuntimeLike(mermaidRuntime)) {
            await fallbackToMarkdownRenderer();
            return;
        }

        const previousConfig = this.cloneMermaidConfig(
            mermaidRuntime.getConfig?.() ?? mermaidRuntime.mermaidAPI?.getConfig?.() ?? null,
        );

        try {
            mermaidRuntime.initialize({
                startOnLoad: false,
                ...getThoughtTrailMermaidRenderConfig(),
            });

            const renderId = `sidenote2-thought-trail-${this.renderVersion}-${Date.now()}`;
            const renderResult = await mermaidRuntime.render(
                renderId,
                extractThoughtTrailMermaidSource(thoughtTrailLines),
            );
            const svg = typeof renderResult === "string" ? renderResult : renderResult?.svg;
            if (!svg) {
                await fallbackToMarkdownRenderer();
                return;
            }

            const mermaidEl = container.createDiv("mermaid");
            mermaidEl.setAttribute("data-sidenote2-thought-trail-renderer", "direct");
            const renderedSvg = parseTrustedMermaidSvg(svg);
            if (!renderedSvg) {
                mermaidEl.remove();
                await fallbackToMarkdownRenderer();
                return;
            }

            mermaidEl.replaceChildren(renderedSvg);
            const bindFunctions = typeof renderResult === "object" && renderResult !== null
                ? renderResult.bindFunctions
                : undefined;
            if (typeof bindFunctions === "function") {
                bindFunctions(mermaidEl);
            }
        } catch {
            container.querySelectorAll(".mermaid").forEach((element) => element.remove());
            await fallbackToMarkdownRenderer();
        } finally {
            if (previousConfig) {
                mermaidRuntime.initialize(previousConfig);
            }
        }
    }

    private cloneMermaidConfig<T>(config: T): T {
        if (config == null) {
            return config;
        }

        return JSON.parse(JSON.stringify(config)) as T;
    }

    private bindThoughtTrailNodeLinks(container: HTMLElement, thoughtTrailLines: string[]): void {
        const clickTargets = extractThoughtTrailClickTargets(thoughtTrailLines);
        if (!clickTargets.size) {
            return;
        }

        const mermaidEl = container.querySelector(".mermaid");
        if (!mermaidEl) {
            return;
        }

        mermaidEl.querySelectorAll(".node, [data-id]").forEach((element) => {
            if (!(element instanceof Element)) {
                return;
            }

            const nodeId = resolveThoughtTrailNodeId(
                element.getAttribute("data-id"),
                element.getAttribute("id"),
            );
            if (!nodeId || !clickTargets.has(nodeId)) {
                return;
            }

            element.setAttribute("data-sidenote2-thought-trail-node-link", "true");
        });

        mermaidEl.addEventListener("click", (event: Event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const nodeEl = target.closest(".node, [data-id]");
            if (!(nodeEl instanceof Element)) {
                return;
            }

            const nodeId = resolveThoughtTrailNodeId(
                nodeEl.getAttribute("data-id"),
                nodeEl.getAttribute("id"),
            );
            if (!nodeId) {
                return;
            }

            const targetUrl = clickTargets.get(nodeId);
            if (!targetUrl) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            void this.openThoughtTrailTarget(targetUrl);
        });
    }

    private async openThoughtTrailTarget(targetUrl: string): Promise<void> {
        const filePath = parseThoughtTrailOpenFilePath(targetUrl);
        if (!filePath) {
            return;
        }

        const targetFile = this.app.vault.getAbstractFileByPath(filePath);
        if (!(targetFile instanceof TFile)) {
            return;
        }

        const targetLeaf = this.plugin.getPreferredFileLeaf(filePath) ?? this.app.workspace.getLeaf(false);
        if (!targetLeaf) {
            return;
        }

        await targetLeaf.openFile(targetFile);
        this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
    }

    getState(): CustomViewState {
        this.savePinnedSidebarStateForFilePath(this.file?.path ?? null);
        return {
            filePath: this.file ? this.file.path : null,
            indexSidebarMode: this.indexSidebarMode,
            noteSidebarMode: this.noteSidebarMode,
            indexFileFilterRootPath: this.selectedIndexFileFilterRootPath,
            pinnedSidebarStateByFilePath: {
                ...this.pinnedSidebarStateByFilePath,
            },
        };
    }

    onunload() {
        document.removeEventListener("keydown", this.interactionController.documentKeydownHandler, true);
        document.removeEventListener("copy", this.interactionController.documentCopyHandler, true);
        document.removeEventListener("selectionchange", this.interactionController.documentSelectionChangeHandler);
        this.containerEl.removeEventListener("click", this.interactionController.sidebarClickHandler);
        this.interactionController.clearPendingFocus();
    }

    private async deleteCommentWithConfirm(commentId: string): Promise<boolean> {
        return this.deleteSidebarComment(commentId);
    }

    private async clearDeletedCommentsForCurrentFile(): Promise<void> {
        const filePath = this.file?.path ?? null;
        if (!filePath || this.plugin.isAllCommentsNotePath(filePath)) {
            return;
        }
        const changed = await this.plugin.clearDeletedCommentsForFile(filePath);
        if (!changed) {
            return;
        }

        if (this.plugin.shouldShowDeletedComments()) {
            await this.plugin.setShowDeletedComments(false);
        }
    }
}
