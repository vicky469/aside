import {
    ItemView,
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
    countAgentThreads,
    countBookmarkThreads,
    filterThreadsBySidebarContentFilter,
    unlockSidebarContentFilterForDraft,
    type SidebarContentFilter,
} from "./sidebarContentFilter";
import { renderPersistedCommentCard } from "./sidebarPersistedComment";
import {
    buildStoredOrderSidebarItems,
    getNestedThreadIdForEditDraft,
    getNestedThreadIdForAppendDraft,
    getReplacedThreadIdForEditDraft,
    shouldRenderTopLevelDraftComment,
    sortSidebarRenderableItems,
    type SidebarRenderableItem,
} from "./sidebarRenderOrder";
import { extractThoughtTrailClickTargets, parseThoughtTrailOpenFilePath, resolveThoughtTrailNodeId } from "./thoughtTrailNodeLinks";
import { parseTrustedMermaidSvg } from "./thoughtTrailSvg";
import { buildRootedThoughtTrailScope } from "./sidebarThoughtTrailScope";
import {
    filterIndexThreadsByExistingSourceFiles,
    scopeIndexThreadsByFilePaths,
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
    type CustomViewState,
    type IndexSidebarMode,
    type SidebarPrimaryMode,
} from "./viewState";
import { normalizeSidebarViewFile } from "./sidebarViewFileState";

function matchesResolvedVisibility(resolved: boolean | undefined, showResolved: boolean): boolean {
    return showResolved ? resolved === true : resolved !== true;
}

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

type SidebarReorderDragState = {
    filePath: string;
    threadId: string;
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

function isMermaidRuntimeLike(value: unknown): value is MermaidRuntimeLike {
    if (!value || typeof value !== "object") {
        return false;
    }

    const candidate = value as Partial<MermaidRuntimeLike>;
    return typeof candidate.initialize === "function"
        && typeof candidate.render === "function";
}

export default class SideNote2View extends ItemView {
    private file: TFile | null = null;
    private plugin: SideNote2;
    private renderVersion = 0;
    private readonly draftEditorController: SidebarDraftEditorController;
    private readonly interactionController: SidebarInteractionController;
    private indexSidebarMode: IndexSidebarMode = "list";
    private noteSidebarMode: SidebarPrimaryMode = "list";
    private noteSidebarContentFilter: SidebarContentFilter = "all";
    private selectedIndexFileFilterRootPath: string | null = null;
    private indexFileFilterGraph: IndexFileFilterGraph | null = null;
    private reorderDragState: SidebarReorderDragState | null = null;
    private reorderDragSourceEl: HTMLElement | null = null;
    private reorderDropIndicatorEl: HTMLElement | null = null;
    private reorderDropIndicatorPlacement: ReorderPlacement | null = null;
    private noteSidebarShell: NoteSidebarShell | null = null;
    private readonly streamedReplyControllers = new Map<string, StreamedAgentReplyController>();
    private unsubscribeFromAgentStreamUpdates: (() => void) | null = null;

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
            getPreferredFileLeaf: () => this.plugin.getPreferredFileLeaf(),
            openLinkText: (href, sourcePath) => this.app.workspace.openLinkText(href, sourcePath, false),
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
        document.addEventListener("copy", this.interactionController.documentCopyHandler, true);
        document.addEventListener("selectionchange", this.interactionController.documentSelectionChangeHandler);
        this.containerEl.addEventListener("click", this.interactionController.sidebarClickHandler);
    }

    async onClose() {
        this.unsubscribeFromAgentStreamUpdates?.();
        this.unsubscribeFromAgentStreamUpdates = null;
        this.noteSidebarShell = null;
        this.resetStreamedReplyControllers();
        document.removeEventListener("keydown", this.interactionController.documentKeydownHandler, true);
        document.removeEventListener("copy", this.interactionController.documentCopyHandler, true);
        document.removeEventListener("selectionchange", this.interactionController.documentSelectionChangeHandler);
        this.containerEl.removeEventListener("click", this.interactionController.sidebarClickHandler);
        await Promise.resolve();
    }

    async setState(state: CustomViewState, result: ViewStateResult): Promise<void> {
        let shouldRender = false;
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
                this.file = normalizedFile;
                shouldRender = true;
            } else if (this.file !== null) {
                this.file = null;
                shouldRender = true;
            }
        } else if (state.filePath === null && this.file) {
            this.file = null;
            shouldRender = true;
        }

        if (shouldRender) {
            await this.renderComments();
        }
        await super.setState(state, result);
    }

    public async updateActiveFile(file: TFile | null) {
        this.file = normalizeSidebarViewFile(file, (candidate): candidate is TFile => this.plugin.isSidebarSupportedFile(candidate));
        await this.renderComments();
    }

    public highlightComment(commentId: string) {
        this.ensureListModeForCommentFocus();
        this.interactionController.highlightComment(commentId);
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

    public async renderComments() {
        const renderVersion = ++this.renderVersion;
        const normalizedFile = normalizeSidebarViewFile(
            this.file,
            (candidate): candidate is TFile => this.plugin.isSidebarSupportedFile(candidate),
        );
        if (normalizedFile !== this.file) {
            this.file = normalizedFile;
        }
        const file = normalizedFile;
        const isAllCommentsView = !!file && this.plugin.isAllCommentsNotePath(file.path);
        this.clearReorderDragState();
        if (file && !isAllCommentsView) {
            this.indexFileFilterGraph = null;
            await this.plugin.loadCommentsForFile(file);
            if (renderVersion !== this.renderVersion || this.file?.path !== file.path) {
                return;
            }

            await this.renderPageSidebar(file, renderVersion);
            return;
        }

        this.noteSidebarShell = null;
        this.resetStreamedReplyControllers();
        this.containerEl.empty();
        this.containerEl.addClass("sidenote2-view-container");
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
            this.containerEl.addClass("sidenote2-view-container");
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
            const {
                scopedVisibleThreads,
                scopedAllThreads,
            } = isAllCommentsView
                ? scopeIndexThreadsByFilePaths(visiblePersistedThreads, persistedThreads, filteredIndexFilePaths)
                : {
                    scopedVisibleThreads: visiblePersistedThreads,
                    scopedAllThreads: persistedThreads,
                };
            const draftComment = this.plugin.getDraftForView(file.path);
            const visibleDraftComment = draftComment
                && matchesResolvedVisibility(draftComment.resolved, showResolved)
                && (!filteredIndexFilePaths.length || filteredIndexFilePaths.includes(draftComment.filePath))
                ? draftComment
                : null;
            const totalScopedCount = scopedAllThreads.length;
            const resolvedCount = scopedAllThreads.filter((thread) => thread.resolved).length;
            const hasResolvedComments = resolvedCount > 0;
            const hasNestedComments = scopedAllThreads.some((thread) => thread.entries.length > 1)
                || visibleDraftComment?.mode === "append";
            const nestedEditDraftThreadId = getNestedThreadIdForEditDraft(
                scopedVisibleThreads,
                visibleDraftComment,
            );
            const replacedThreadId = nestedEditDraftThreadId
                ? null
                : getReplacedThreadIdForEditDraft(
                scopedVisibleThreads,
                visibleDraftComment,
            );
            const nestedAppendDraftThreadId = getNestedThreadIdForAppendDraft(
                scopedVisibleThreads,
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
                    scopedVisibleThreads
                        .filter((thread) => thread.id !== replacedThreadId)
                        .map((thread) => ({ kind: "thread", thread } as SidebarRenderableItem))
                        .concat(topLevelDraftComment ? [{ kind: "draft", draft: topLevelDraftComment }] : []),
                )
                : buildStoredOrderSidebarItems(
                    scopedVisibleThreads,
                    topLevelDraftComment,
                    replacedThreadId,
                );
            const limitedComments = isAllCommentsView
                && this.indexSidebarMode === "list"
                && shouldLimitIndexSidebarList(selectedIndexFileFilterRootPath)
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
                agentThreadCount: 0,
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
                const trailComments = scopedVisibleThreads;
                await this.renderThoughtTrail(commentsContainer, trailComments, file, {
                    surface: "index",
                    hasRootScope: filteredIndexFilePaths.length > 0,
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
                    const emptyStateEl = commentsBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
                    if (shouldShowResolvedIndexEmptyState(showResolved, totalScopedCount, renderedItems.length)) {
                        emptyStateEl.createEl("p", { text: "No resolved side notes match the current index view." });
                        emptyStateEl.createEl("p", { text: "Turn off resolved to return to active side notes." });
                    } else if (filteredIndexFilePaths.length) {
                        emptyStateEl.createEl("p", { text: "No side notes match the selected file filter." });
                        emptyStateEl.createEl("p", { text: "Use files to choose a different root file." });
                    } else {
                        emptyStateEl.createEl("p", { text: "No side notes in the index yet." });
                        emptyStateEl.createEl("p", { text: "Add side notes in your notes to populate the index." });
                    }
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
        const agentThreadCount = countAgentThreads(persistedThreads);
        const hasResolvedThreadsInFile = persistedThreads.some((thread) => thread.resolved);
        const contentFilteredThreads = filterThreadsBySidebarContentFilter(
            persistedThreads,
            this.noteSidebarContentFilter,
        );
        const allAgentRuns = this.plugin.getAgentRuns();
        const visiblePersistedThreads = contentFilteredThreads.filter((thread) =>
            matchesPageSidebarVisibility(thread, {
                showResolved,
                showDeleted,
            }));
        const visibleDraftComment = draftComment
            && matchesResolvedVisibility(draftComment.resolved, showResolved)
            ? draftComment
            : null;
        const totalScopedCount = contentFilteredThreads.length;
        const resolvedCount = contentFilteredThreads.filter((thread) => thread.resolved).length;
        const hasResolvedComments = resolvedCount > 0;
        const hasNestedComments = contentFilteredThreads.some((thread) => thread.entries.length > 1)
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
            agentThreadCount,
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
        this.renderPageSidebarEmptyState(shell.commentsBodyEl, {
            renderedItemCount: renderableItems.length,
            showResolved,
            totalScopedCount,
            hasResolvedComments,
            contentFilter: this.noteSidebarContentFilter,
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
        const persistedThreads = this.plugin.getThreadsForFile(file.path, { includeDeleted: options.showDeleted });
        const pageThreadsWithDeleted = this.plugin.getThreadsForFile(file.path, { includeDeleted: true });
        const deletedCommentCount = countDeletedComments(pageThreadsWithDeleted);
        const showResolved = this.plugin.shouldShowResolvedComments();
        const bookmarkThreadCount = countBookmarkThreads(persistedThreads);
        const agentThreadCount = countAgentThreads(persistedThreads);
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
            agentThreadCount,
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
            this.containerEl.addClass("sidenote2-view-container");
            return this.noteSidebarShell;
        }

        this.noteSidebarShell = null;
        this.resetStreamedReplyControllers();
        this.containerEl.empty();
        this.containerEl.addClass("sidenote2-view-container");

        const commentsContainerEl = this.containerEl.createDiv("sidenote2-comments-container");
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
                    showNestedComments,
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

        const filterLabel = this.getNoteSidebarContentFilterLabel(options.contentFilter);
        const pluralFilterLabel = this.getNoteSidebarContentFilterPluralLabel(options.contentFilter);

        if (options.showResolved && options.totalScopedCount > 0) {
            const emptyStateEl = commentsBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
            emptyStateEl.createEl("p", {
                text: options.contentFilter === "all"
                    ? "No resolved comments for this file."
                    : `No resolved ${pluralFilterLabel} for this file.`,
            });
            emptyStateEl.createEl("p", {
                text: options.contentFilter === "all"
                    ? "Turn off resolved to return to active comments."
                    : `Turn off resolved to return to active ${pluralFilterLabel}.`,
            });
            return;
        }

        if (!options.showResolved && options.hasResolvedComments) {
            const emptyStateEl = commentsBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
            emptyStateEl.createEl("p", {
                text: options.contentFilter === "all"
                    ? "No active comments for this file."
                    : `No active ${pluralFilterLabel} for this file.`,
            });
            emptyStateEl.createEl("p", {
                text: options.contentFilter === "all"
                    ? "Turn on resolved to review archived comments only."
                    : `Turn on resolved to review archived ${pluralFilterLabel} only.`,
            });
            return;
        }

        const emptyStateEl = commentsBody.createDiv("sidenote2-empty-state");
        emptyStateEl.createEl("p", {
            text: options.contentFilter === "all"
                ? "No comments for this file yet."
                : `No ${pluralFilterLabel} for this file yet.`,
        });
        emptyStateEl.createEl("p", {
            text: options.contentFilter === "all"
                ? "Use the add button to create a page side note."
                : `Turn off ${filterLabel} to return to all side notes.`,
        });
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
            agentThreadCount: number;
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
        const contentFilter = options.noteSidebarContentFilter;
        const activePrimaryMode = options.isAllCommentsView
            ? this.indexSidebarMode
            : options.noteSidebarMode;
        const showListOnlyToolbarChips = options.isAllCommentsView
            ? shouldShowIndexListToolbarChips(options.isAllCommentsView, this.indexSidebarMode)
            : activePrimaryMode === "list";
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
        const shouldRenderToolbar = options.isAllCommentsView
            || shouldShowResolvedChip
            || shouldShowContentFilterIcons
            || shouldShowNestedChip
            || !!options.addPageCommentAction;
        if (!shouldRenderToolbar) {
            return;
        }

        const toolbarEl = container.createDiv("sidenote2-sidebar-toolbar");
        toolbarEl.classList.toggle("is-index-toolbar", options.isAllCommentsView);
        toolbarEl.classList.toggle("is-note-toolbar", !options.isAllCommentsView);
        let indexChipGroup: HTMLDivElement | null = null;
        let indexChipRow: HTMLDivElement | null = null;
        let noteFilterGroup: HTMLDivElement | null = null;
        let noteActionGroup: HTMLDivElement | null = null;
        if (options.isAllCommentsView) {
            const modeRow = toolbarEl.createDiv("sidenote2-sidebar-toolbar-row");
            modeRow.addClass("is-index-primary-row");
            this.renderIndexModeControl(modeRow);

            indexChipRow = toolbarEl.createDiv("sidenote2-sidebar-toolbar-row");
            indexChipRow.addClass("is-index-secondary-row");
            indexChipGroup = indexChipRow.createDiv("sidenote2-sidebar-toolbar-group");
            this.renderToolbarIconButton(indexChipGroup, {
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

            const actionsRow = toolbarEl.createDiv("sidenote2-sidebar-toolbar-row");
            actionsRow.addClass("is-note-secondary-row");
            noteFilterGroup = actionsRow.createDiv("sidenote2-sidebar-toolbar-group is-filter-group");
            noteActionGroup = actionsRow.createDiv("sidenote2-sidebar-toolbar-group is-action-group");
        }

        if (!showListOnlyToolbarChips && options.isAllCommentsView) {
            return;
        }

        const filterGroup = indexChipGroup ?? noteFilterGroup ?? (indexChipRow ?? toolbarEl).createDiv("sidenote2-sidebar-toolbar-group");
        const actionGroup = noteActionGroup ?? filterGroup;
        if (shouldShowContentFilterIcons && showListOnlyToolbarChips) {
            this.renderToolbarIconButton(filterGroup, {
                icon: "bookmark",
                active: contentFilter === "bookmarks",
                ariaLabel: contentFilter === "bookmarks"
                    ? "Show all comments"
                    : "Show bookmark comments",
                disabled: options.bookmarkThreadCount === 0 && contentFilter !== "bookmarks",
                onClick: () => {
                    this.noteSidebarContentFilter = contentFilter === "bookmarks" ? "all" : "bookmarks";
                    void this.renderComments();
                },
            });
            this.renderToolbarIconButton(actionGroup, {
                icon: "bot",
                active: contentFilter === "agents",
                ariaLabel: contentFilter === "agents"
                    ? "Show all comments"
                    : "Show agent comments",
                disabled: options.agentThreadCount === 0 && contentFilter !== "agents",
                onClick: () => {
                    this.noteSidebarContentFilter = contentFilter === "agents" ? "all" : "agents";
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
                    void this.plugin.setShowDeletedComments(!showDeletedComments);
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

        if (options.addPageCommentAction) {
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
            disabled?: boolean;
            onClick: () => void;
        },
    ): void {
        const button = container.createEl("button", {
            cls: `clickable-icon sidenote2-comment-section-add-button sidenote2-toolbar-icon-button${options.active ? " is-active" : ""}`,
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

    private renderIndexModeControl(container: HTMLElement): void {
        this.renderSidebarModeControl(container, {
            mode: this.indexSidebarMode,
            ariaLabel: "Index view mode",
            listAriaLabel: "Show index list",
            thoughtTrailAriaLabel: "Show thought trail",
            onChange: (mode) => {
                if (this.indexSidebarMode === mode) {
                    return;
                }

                this.indexSidebarMode = mode;
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
            ariaLabel: "Note view mode",
            listAriaLabel: "Show note list",
            thoughtTrailAriaLabel: "Show note thought trail",
            onChange: (mode) => {
                if (this.noteSidebarMode === mode) {
                    return;
                }

                this.noteSidebarMode = mode;
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
            ariaLabel: string;
            listAriaLabel: string;
            thoughtTrailAriaLabel: string;
            onChange: (mode: SidebarPrimaryMode) => void;
        },
    ): void {
        const modeGroup = container.createDiv("sidenote2-sidebar-toolbar-group");
        const tabList = modeGroup.createDiv(`sidenote2-tablist is-${options.mode}`);
        tabList.setAttribute("role", "tablist");
        tabList.setAttribute("aria-label", options.ariaLabel);
        this.renderTabButton(tabList, {
            label: "List",
            active: options.mode === "list",
            ariaLabel: options.listAriaLabel,
            onClick: () => {
                options.onChange("list");
            },
        });
        this.renderTabButton(tabList, {
            label: "Thought Trail",
            active: options.mode === "thought-trail",
            ariaLabel: options.thoughtTrailAriaLabel,
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
            ariaLabel: string;
            onClick: () => void;
        },
    ): void {
        const button = container.createEl("button", {
            cls: `sidenote2-tab-button${options.active ? " is-active" : ""}`,
            text: options.label,
        });
        button.setAttribute("type", "button");
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", options.active ? "true" : "false");
        button.setAttribute("aria-label", options.ariaLabel);
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
            showDeletedComments: this.plugin.shouldShowDeletedComments(),
            enablePageThreadReorder,
            enableSoftDeleteActions: !isIndexView,
            showNestedComments: this.plugin.shouldShowNestedCommentsForThread(thread.id),
            editDraftComment,
            appendDraftComment,
            agentRun,
            agentStream,
            threadAgentRuns,
            getEventTargetElement: (target) => this.interactionController.getEventTargetElement(target),
            isSelectionInsideSidebarContent: (selection) => this.interactionController.isSelectionInsideSidebarContent(selection),
            claimSidebarInteractionOwnership: (focusTarget) => this.interactionController.claimSidebarInteractionOwnership(focusTarget),
            renderMarkdown: async (markdown, container, sourcePath) => {
                await MarkdownRenderer.render(this.app, markdown, container, sourcePath, this);
            },
            openSidebarInternalLink: (href, sourcePath, focusTarget) =>
                this.interactionController.openSidebarInternalLink(href, sourcePath, focusTarget),
            activateComment: (persistedComment) => {
                this.interactionController.setActiveComment(persistedComment.id);
                return Promise.resolve();
            },
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
            resolveComment: (commentId) => {
                void this.plugin.resolveComment(commentId);
            },
            unresolveComment: (commentId) => {
                void this.plugin.unresolveComment(commentId);
            },
            restoreComment: async (commentId) => {
                await this.plugin.restoreComment(commentId);
                if (this.plugin.shouldShowDeletedComments()) {
                    await this.plugin.setShowDeletedComments(false);
                }
            },
            startEditDraft: (commentId, hostFilePath) => {
                void this.plugin.startEditDraft(commentId, hostFilePath);
            },
            startAppendEntryDraft: (commentId, hostFilePath) => {
                void this.plugin.startAppendEntryDraft(commentId, hostFilePath);
            },
            retryAgentRun: (runId) => {
                void this.plugin.retryAgentRun(runId);
            },
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
            const dragState = this.getPageThreadDragStateFromEventTarget(event.target, filePath);
            if (!dragState) {
                return;
            }

            this.clearReorderDragState();
            this.reorderDragState = dragState;
            this.reorderDragSourceEl = this.getCommentItemFromEventTarget(event.target);
            this.reorderDragSourceEl?.addClass("is-drag-source");
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", dragState.threadId);
            }
        });

        commentsBody.addEventListener("dragover", (event: DragEvent) => {
            const dropTarget = this.resolvePageThreadDropTarget(event);
            if (!dropTarget) {
                this.clearReorderDropIndicator();
                return;
            }

            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "move";
            }
            this.setReorderDropIndicator(dropTarget.element, dropTarget.placement);
        });

        commentsBody.addEventListener("drop", (event: DragEvent) => {
            const dragState = this.reorderDragState;
            const dropTarget = this.resolvePageThreadDropTarget(event);
            this.clearReorderDropIndicator();
            if (!dragState || !dropTarget) {
                return;
            }

            event.preventDefault();
            this.clearReorderDragState();
            void this.plugin.reorderThreadsForFile(
                dragState.filePath,
                dragState.threadId,
                dropTarget.targetId,
                dropTarget.placement,
            );
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

    private getPageThreadDragStateFromEventTarget(
        target: EventTarget | null,
        filePath: string,
    ): SidebarReorderDragState | null {
        if (!(target instanceof Element)) {
            return null;
        }

        const handleEl = target.closest("[data-sidenote2-drag-kind='thread']");
        if (!(handleEl instanceof HTMLElement)) {
            return null;
        }

        const threadId = handleEl.getAttribute("data-sidenote2-thread-id");
        if (!threadId) {
            return null;
        }

        return {
            filePath,
            threadId,
        };
    }

    private resolvePageThreadDropTarget(event: DragEvent): {
        element: HTMLElement;
        targetId: string;
        placement: ReorderPlacement;
    } | null {
        const dragState = this.reorderDragState;
        if (!dragState || !(event.target instanceof Element)) {
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
        },
    ): Promise<void> {
        const thoughtTrailEl = commentsContainer.createDiv("sidenote2-thought-trail");
        if (!options.hasRootScope) {
            const emptyStateEl = thoughtTrailEl.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
            if (options.surface === "note") {
                emptyStateEl.createEl("p", { text: "No thought trail is available for this file yet." });
                emptyStateEl.createEl("p", { text: "Add side notes in this note to create a rooted trail." });
            } else {
                emptyStateEl.createEl("p", { text: "Use files to choose a file and see its connected files." });
            }
            return;
        }

        const thoughtTrailLines = buildThoughtTrailLines(this.app.vault.getName(), comments, {
            allCommentsNotePath: this.plugin.getAllCommentsNotePath(),
            resolveWikiLinkPath: (linkPath, sourceFilePath) => {
                const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFilePath);
                return linkedFile instanceof TFile ? linkedFile.path : null;
            },
        });

        if (!thoughtTrailLines.length) {
            const emptyStateEl = thoughtTrailEl.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
            if (options.surface === "note") {
                emptyStateEl.createEl("p", { text: "No thought trail for this file yet." });
                emptyStateEl.createEl("p", { text: "Add wiki links in side notes for this file or switch back to the list." });
            } else {
                emptyStateEl.createEl("p", { text: "No thought trail matches the selected file filter." });
                emptyStateEl.createEl("p", { text: "Add wiki links in those notes or choose a different file." });
            }
            return;
        }

        await this.renderThoughtTrailMermaid(thoughtTrailEl, thoughtTrailLines, file.path);

        this.bindThoughtTrailNodeLinks(thoughtTrailEl, thoughtTrailLines);
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
        return {
            filePath: this.file ? this.file.path : null,
            indexSidebarMode: this.indexSidebarMode,
            noteSidebarMode: this.noteSidebarMode,
            indexFileFilterRootPath: this.selectedIndexFileFilterRootPath,
        };
    }

    onunload() {
        document.removeEventListener("keydown", this.interactionController.documentKeydownHandler, true);
        document.removeEventListener("copy", this.interactionController.documentCopyHandler, true);
        document.removeEventListener("selectionchange", this.interactionController.documentSelectionChangeHandler);
        this.containerEl.removeEventListener("click", this.interactionController.sidebarClickHandler);
        this.interactionController.clearPendingFocus();
    }

    private async deleteCommentWithConfirm(commentId: string) {
        if (this.plugin.shouldShowDeletedComments()) {
            await this.plugin.setShowDeletedComments(false);
        }
        await this.plugin.deleteComment(commentId);
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
