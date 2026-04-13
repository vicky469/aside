import { ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf, loadMermaid, setIcon, type ViewStateResult } from "obsidian";
import type { Comment, CommentThread, ReorderPlacement } from "../../commentManager";
import { buildCommentLocationUrl } from "../../core/derived/allCommentsNote";
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
import ConfirmDeleteModal from "../modals/ConfirmDeleteModal";
import SideNoteFileFilterModal from "../modals/SideNoteFileFilterModal";
import SideNoteLinkSuggestModal from "../modals/SideNoteLinkSuggestModal";
import SideNoteTagSuggestModal from "../modals/SideNoteTagSuggestModal";
import { SIDE_NOTE2_ICON_ID } from "../sideNote2Icon";
import { copyTextToClipboard } from "../copyTextToClipboard";
import { SidebarDraftEditorController } from "./sidebarDraftEditor";
import { renderDraftCommentCard } from "./sidebarDraftComment";
import {
    buildIndexFileFilterOptionsFromCounts,
    deriveIndexSidebarScopedFilePaths,
    filterCommentsByFilePaths,
    getIndexFileFilterLabel,
    shouldLimitIndexSidebarList,
    type IndexFileFilterOption,
} from "./indexFileFilter";
import { INDEX_SIDEBAR_LIST_LIMIT, limitIndexSidebarListItems } from "./indexSidebarListLimit";
import { filterCommentsByResolvedVisibility } from "../../core/rules/resolvedCommentVisibility";
import { SidebarInteractionController } from "./sidebarInteractionController";
import { renderPersistedCommentCard } from "./sidebarPersistedComment";
import {
    buildStoredOrderSidebarItems,
    getNestedThreadIdForAppendDraft,
    getReplacedThreadIdForEditDraft,
    sortSidebarRenderableItems,
    type SidebarRenderableItem,
} from "./sidebarRenderOrder";
import { extractThoughtTrailClickTargets, parseThoughtTrailOpenFilePath, resolveThoughtTrailNodeId } from "./thoughtTrailNodeLinks";
import {
    scopeIndexThreadsByFilePaths,
    shouldShowIndexListToolbarChips,
    shouldShowNestedToolbarChip,
    shouldShowResolvedIndexEmptyState,
    shouldShowResolvedToolbarChip,
} from "./indexSidebarState";
import {
    normalizeIndexFileFilterRootPath,
    resolveIndexFileFilterRootPathFromState,
    type CustomViewState,
    type IndexSidebarMode,
} from "./viewState";

function matchesResolvedVisibility(resolved: boolean | undefined, showResolved: boolean): boolean {
    return showResolved ? resolved === true : resolved !== true;
}

function parseIndexSidebarMode(value: unknown): IndexSidebarMode | null {
    return value === "list" || value === "thought-trail"
        ? value
        : null;
}

type SidebarReorderDragState =
    | {
        kind: "thread";
        filePath: string;
        threadId: string;
    }
    | {
        kind: "entry";
        filePath: string;
        threadId: string;
        entryId: string;
    };

export default class SideNote2View extends ItemView {
    private file: TFile | null = null;
    private plugin: SideNote2;
    private renderVersion = 0;
    private readonly draftEditorController: SidebarDraftEditorController;
    private readonly interactionController: SidebarInteractionController;
    private indexSidebarMode: IndexSidebarMode = "list";
    private selectedIndexFileFilterRootPath: string | null = null;
    private indexFileFilterGraph: IndexFileFilterGraph | null = null;
    private reorderDragState: SidebarReorderDragState | null = null;
    private reorderDragSourceEl: HTMLElement | null = null;
    private reorderDropIndicatorEl: HTMLElement | null = null;
    private reorderDropIndicatorPlacement: ReorderPlacement | null = null;

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
            saveDraft: (commentId) => {
                void this.plugin.saveDraft(commentId);
            },
            cancelDraft: (commentId) => {
                void this.plugin.cancelDraft(commentId);
            },
            clearRevealedCommentSelection: () => {
                this.plugin.clearRevealedCommentSelection();
            },
            revealComment: (comment) => this.plugin.revealComment(comment),
            getPreferredFileLeaf: () => this.plugin.getPreferredFileLeaf(),
            openLinkText: (href, sourcePath) => this.app.workspace.openLinkText(href, sourcePath, false),
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
        return "SideNote2";
    }

    getIcon() {
        return SIDE_NOTE2_ICON_ID;
    }

    async onOpen() {
        await Promise.resolve();
        if (!this.file) {
            this.file = this.plugin.getSidebarTargetFile();
        }
        await this.renderComments();
        document.addEventListener("keydown", this.interactionController.documentKeydownHandler, true);
        document.addEventListener("copy", this.interactionController.documentCopyHandler, true);
        document.addEventListener("selectionchange", this.interactionController.documentSelectionChangeHandler);
        this.containerEl.addEventListener("click", this.interactionController.sidebarClickHandler);
    }

    async setState(state: CustomViewState, result: ViewStateResult): Promise<void> {
        let shouldRender = false;
        const nextMode = parseIndexSidebarMode(state.indexSidebarMode);
        if (nextMode && nextMode !== this.indexSidebarMode) {
            this.indexSidebarMode = nextMode;
            shouldRender = true;
        }

        const nextRootPath = resolveIndexFileFilterRootPathFromState(state);
        if (nextRootPath !== undefined && nextRootPath !== this.selectedIndexFileFilterRootPath) {
            this.selectedIndexFileFilterRootPath = nextRootPath;
            shouldRender = true;
        }

        if (state.filePath) {
            const file = this.app.vault.getAbstractFileByPath(state.filePath);
            if (file instanceof TFile) {
                this.file = file;
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
        this.file = file;
        await this.renderComments();
    }

    public highlightComment(commentId: string) {
        this.ensureListModeForIndexCommentFocus();
        this.interactionController.highlightComment(commentId);
        const currentFilePath = this.file?.path ?? null;
        if (currentFilePath && this.plugin.isAllCommentsNotePath(currentFilePath)) {
            void this.plugin.syncIndexCommentHighlightPair(commentId, currentFilePath);
        }
    }

    public async highlightAndFocusDraft(commentId: string) {
        this.ensureListModeForIndexCommentFocus();
        await this.interactionController.highlightAndFocusDraft(commentId);
    }

    public async focusDraft(commentId: string) {
        await this.interactionController.focusDraft(commentId);
    }

    public clearActiveState(): void {
        this.interactionController.clearActiveState();
    }

    public async renderComments() {
        const renderVersion = ++this.renderVersion;
        const file = this.file;
        const isAllCommentsView = !!file && this.plugin.isAllCommentsNotePath(file.path);
        this.clearReorderDragState();

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
            const persistedComments = isAllCommentsView
                ? this.plugin.getAllIndexedComments()
                : this.plugin.commentManager.getCommentsForFile(file.path);
            const persistedThreads = isAllCommentsView
                ? this.plugin.getAllIndexedThreads()
                : this.plugin.getThreadsForFile(file.path);
            const showResolved = this.plugin.shouldShowResolvedComments();
            const visiblePersistedComments = filterCommentsByResolvedVisibility(persistedComments, showResolved);
            const visiblePersistedThreads = persistedThreads.filter((thread) =>
                matchesResolvedVisibility(thread.resolved, showResolved));
            const indexFileFilterGraph = isAllCommentsView
                ? buildIndexFileFilterGraph(persistedComments, {
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
            const scopedVisibleComments = isAllCommentsView
                ? filterCommentsByFilePaths(visiblePersistedComments, filteredIndexFilePaths)
                : visiblePersistedComments;
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
            const replacedThreadId = getReplacedThreadIdForEditDraft(
                scopedVisibleThreads,
                visibleDraftComment,
            );
            const nestedAppendDraftThreadId = getNestedThreadIdForAppendDraft(
                scopedVisibleThreads,
                visibleDraftComment,
            );
            const topLevelDraftComment = visibleDraftComment
                && (visibleDraftComment.mode !== "append" || !nestedAppendDraftThreadId)
                ? visibleDraftComment
                : null;
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

            this.renderSidebarToolbar(commentsContainer, {
                isAllCommentsView,
                resolvedCount,
                hasResolvedComments,
                hasNestedComments,
                addPageCommentAction: !isAllCommentsView
                    ? {
                        icon: "plus",
                        ariaLabel: "Add page side note",
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
                const trailComments = scopedVisibleComments;
                await this.renderThoughtTrail(commentsContainer, trailComments, file, {
                    hasFileFilter: filteredIndexFilePaths.length > 0,
                });
                return;
            }

            const commentsBody = this.renderCommentsList(commentsContainer);
            this.setupCommentReorderInteractions(commentsBody, {
                enabled: !isAllCommentsView,
                filePath: file.path,
            });
            const canReorderVisibleThreads = !isAllCommentsView
                && renderedItems.filter((item) => item.kind === "thread").length > 1;
            const renderPromises = renderedItems.map(async (item) => {
                if (item.kind === "draft") {
                    this.renderDraftComment(commentsBody, item.draft);
                    return;
                }

                await this.renderPersistedComment(
                    commentsBody,
                    item.thread,
                    canReorderVisibleThreads,
                    nestedAppendDraftThreadId === item.thread.id && visibleDraftComment?.mode === "append"
                        ? visibleDraftComment
                        : null,
                );
            });
            await Promise.all(renderPromises);

            if (limitedComments.hiddenCount > 0) {
                const limitNotice = commentsContainer.createDiv("sidenote2-list-limit-notice");
                limitNotice.createEl("p", {
                    text: `${INDEX_SIDEBAR_LIST_LIMIT} shown, ${limitedComments.hiddenCount} hidden.`,
                });
                limitNotice.createEl("p", {
                    text: "Use Files to filter the index to see more.",
                });
            }

            if (renderedItems.length === 0) {
                if (isAllCommentsView) {
                    const emptyStateEl = commentsBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
                    if (shouldShowResolvedIndexEmptyState(showResolved, totalScopedCount, renderedItems.length)) {
                        emptyStateEl.createEl("p", { text: "No resolved side notes match the current index view." });
                        emptyStateEl.createEl("p", { text: "Turn off Resolved to return to active side notes." });
                    } else if (filteredIndexFilePaths.length) {
                        emptyStateEl.createEl("p", { text: "No side notes match the selected file filter." });
                        emptyStateEl.createEl("p", { text: "Use Files to choose a different root file." });
                    } else {
                        emptyStateEl.createEl("p", { text: "No side notes in the index yet." });
                        emptyStateEl.createEl("p", { text: "Add side notes in markdown files to populate SideNote2 index." });
                    }
                } else if (showResolved && totalScopedCount > 0) {
                    const emptyStateEl = commentsBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
                    emptyStateEl.createEl("p", { text: "No resolved comments for this file." });
                    emptyStateEl.createEl("p", { text: "Turn off Resolved to return to active comments." });
                } else if (hasResolvedComments && !showResolved) {
                    const emptyStateEl = commentsBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
                    emptyStateEl.createEl("p", { text: "No active comments for this file." });
                    emptyStateEl.createEl("p", { text: "Turn on Resolved to review archived comments only." });
                }
            }
        } else {
            const emptyStateEl = this.containerEl.createDiv("sidenote2-empty-state");
            emptyStateEl.createEl("p", { text: "No file selected." });
            emptyStateEl.createEl("p", { text: "Open a file to see its comments." });
        }
    }

    private renderSidebarToolbar(
        container: HTMLElement,
        options: {
            isAllCommentsView: boolean;
            resolvedCount: number;
            hasResolvedComments: boolean;
            hasNestedComments: boolean;
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
        const showListOnlyToolbarChips = shouldShowIndexListToolbarChips(options.isAllCommentsView, this.indexSidebarMode);
        const shouldShowResolvedChip = showListOnlyToolbarChips
            && shouldShowResolvedToolbarChip(options.hasResolvedComments, showResolved);
        const shouldShowNestedChip = showListOnlyToolbarChips && shouldShowNestedToolbarChip({
            hasNestedComments: options.hasNestedComments,
            isAllCommentsView: options.isAllCommentsView,
            selectedIndexFileFilterRootPath: options.selectedIndexFileFilterRootPath,
            filteredIndexFileCount: options.filteredIndexFilePaths.length,
        });
        const shouldRenderToolbar = options.isAllCommentsView
            || shouldShowResolvedChip
            || shouldShowNestedChip
            || !!options.addPageCommentAction;
        if (!shouldRenderToolbar) {
            return;
        }

        const toolbarEl = container.createDiv("sidenote2-sidebar-toolbar");
        toolbarEl.classList.toggle("is-index-toolbar", options.isAllCommentsView);
        let indexChipGroup: HTMLDivElement | null = null;
        let indexChipRow: HTMLDivElement | null = null;
        if (options.isAllCommentsView) {
            const modeRow = toolbarEl.createDiv("sidenote2-sidebar-toolbar-row");
            modeRow.addClass("is-index-primary-row");
            this.renderIndexModeControl(modeRow);

            indexChipRow = toolbarEl.createDiv("sidenote2-sidebar-toolbar-row");
            indexChipRow.addClass("is-index-secondary-row");
            indexChipGroup = indexChipRow.createDiv("sidenote2-sidebar-toolbar-group");
            this.renderToolbarChip(indexChipGroup, {
                label: "Files",
                icon: "list-filter",
                active: !!options.selectedIndexFileFilterRootPath,
                ariaLabel: options.indexFileFilterOptions.length
                    ? "Filter index by files"
                    : "No files with side notes yet",
                count: options.selectedIndexFileFilterRootPath
                    ? String(options.filteredIndexFilePaths.length)
                    : undefined,
                disabled: !options.indexFileFilterOptions.length,
                onClick: () => {
                    this.openIndexFileFilterModal(options.indexFileFilterOptions);
                },
            });
        }

        if (!showListOnlyToolbarChips) {
            return;
        }

        const filterGroup = indexChipGroup ?? (indexChipRow ?? toolbarEl).createDiv("sidenote2-sidebar-toolbar-group");
        if (shouldShowResolvedChip) {
            this.renderToolbarChip(filterGroup, {
                label: "Resolved",
                active: showResolved,
                ariaLabel: showResolved ? "Show active comments" : "Show resolved comments only",
                count: String(options.resolvedCount),
                showIndicator: true,
                onClick: () => {
                    void this.plugin.setShowResolvedComments(!showResolved);
                },
            });
        }

        if (shouldShowNestedChip) {
            this.renderToolbarIconButton(filterGroup, {
                icon: showNestedComments ? "chevrons-up" : "chevrons-down",
                ariaLabel: showNestedComments ? "Hide nested comments" : "Show nested comments",
                active: showNestedComments,
                onClick: () => {
                    void this.plugin.setShowNestedComments(!showNestedComments);
                },
            });
        }

        if (options.addPageCommentAction) {
            this.renderToolbarIconButton(filterGroup, {
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

        button.onclick = options.onClick;
    }

    private renderToolbarIconButton(
        container: HTMLElement,
        options: {
            icon: string;
            ariaLabel: string;
            active?: boolean;
            onClick: () => void;
        },
    ): void {
        const button = container.createEl("button", {
            cls: `clickable-icon sidenote2-comment-section-add-button sidenote2-toolbar-icon-button${options.active ? " is-active" : ""}`,
        });
        button.setAttribute("type", "button");
        button.setAttribute("aria-pressed", options.active ? "true" : "false");
        button.setAttribute("aria-label", options.ariaLabel);
        setIcon(button, options.icon);
        button.onclick = options.onClick;
    }

    private renderIndexModeControl(container: HTMLElement): void {
        const modeGroup = container.createDiv("sidenote2-sidebar-toolbar-group");
        const tabList = modeGroup.createDiv(`sidenote2-tablist is-${this.indexSidebarMode}`);
        tabList.setAttribute("role", "tablist");
        tabList.setAttribute("aria-label", "Index view mode");
        this.renderTabButton(tabList, {
            label: "List",
            active: this.indexSidebarMode === "list",
            ariaLabel: "Show index list",
            onClick: () => {
                if (this.indexSidebarMode === "list") {
                    return;
                }

                this.indexSidebarMode = "list";
                void this.renderComments();
            },
        });
        this.renderTabButton(tabList, {
            label: "Thought Trail",
            active: this.indexSidebarMode === "thought-trail",
            ariaLabel: "Show thought trail",
            onClick: () => {
                if (this.indexSidebarMode === "thought-trail") {
                    return;
                }

                this.indexSidebarMode = "thought-trail";
                void this.renderComments();
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
        button.onclick = options.onClick;
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
        clearButton.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
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
        this.interactionController.clearActiveState();
        await this.renderComments();
    }

    private ensureListModeForIndexCommentFocus(): void {
        if (this.file && this.plugin.isAllCommentsNotePath(this.file.path) && this.indexSidebarMode !== "list") {
            this.indexSidebarMode = "list";
        }
    }

    private renderCommentsList(container: HTMLElement): HTMLDivElement {
        return container.createDiv("sidenote2-comments-list");
    }

    private async renderPersistedComment(
        commentsContainer: HTMLDivElement,
        thread: CommentThread,
        enableThreadReorder: boolean,
        appendDraftComment: DraftComment | null = null,
    ) {
        const currentFilePath = this.file?.path ?? null;
        const isIndexView = !!currentFilePath && this.plugin.isAllCommentsNotePath(currentFilePath);

        await renderPersistedCommentCard(commentsContainer, thread, {
            activeCommentId: this.interactionController.getActiveCommentId(),
            currentFilePath,
            showSourceRedirectAction: isIndexView,
            showNestedComments: this.plugin.shouldShowNestedComments(),
            enableManualReorder: !isIndexView,
            enableThreadReorder,
            appendDraftComment,
            getEventTargetElement: (target) => this.interactionController.getEventTargetElement(target),
            isSelectionInsideSidebarContent: (selection) => this.interactionController.isSelectionInsideSidebarContent(selection),
            claimSidebarInteractionOwnership: (focusTarget) => this.interactionController.claimSidebarInteractionOwnership(focusTarget),
            renderMarkdown: async (markdown, container, sourcePath) => {
                await MarkdownRenderer.renderMarkdown(markdown, container, sourcePath, this.plugin);
            },
            openSidebarInternalLink: (href, sourcePath, focusTarget) =>
                this.interactionController.openSidebarInternalLink(href, sourcePath, focusTarget),
            activateComment: async (persistedComment) => {
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
            resolveComment: (commentId) => {
                void this.plugin.resolveComment(commentId);
            },
            unresolveComment: (commentId) => {
                void this.plugin.unresolveComment(commentId);
            },
            startEditDraft: (commentId, hostFilePath) => {
                void this.plugin.startEditDraft(commentId, hostFilePath);
            },
            startAppendEntryDraft: (commentId, hostFilePath) => {
                void this.plugin.startAppendEntryDraft(commentId, hostFilePath);
            },
            reanchorCommentThreadToCurrentSelection: (commentId) => {
                void this.plugin.reanchorCommentThreadToCurrentSelection(commentId);
            },
            deleteCommentWithConfirm: (commentId) => {
                void this.deleteCommentWithConfirm(commentId);
            },
            renderAppendDraft: (container, comment) => {
                this.renderDraftComment(container, comment);
            },
            setIcon: (element, icon) => {
                setIcon(element, icon);
            },
        });
    }

    private setupCommentReorderInteractions(
        commentsBody: HTMLDivElement,
        options: {
            enabled: boolean;
            filePath: string;
        },
    ): void {
        if (!options.enabled) {
            return;
        }

        commentsBody.addEventListener("dragstart", (event: DragEvent) => {
            const dragState = this.getReorderDragStateFromEventTarget(event.target, options.filePath);
            if (!dragState) {
                return;
            }

            this.clearReorderDragState();
            this.reorderDragState = dragState;
            this.reorderDragSourceEl = this.getCommentItemFromEventTarget(event.target);
            this.reorderDragSourceEl?.addClass("is-drag-source");
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", dragState.kind === "thread" ? dragState.threadId : dragState.entryId);
            }
        });

        commentsBody.addEventListener("dragover", (event: DragEvent) => {
            const dropTarget = this.resolveReorderDropTarget(event);
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
            const dropTarget = this.resolveReorderDropTarget(event);
            this.clearReorderDropIndicator();
            if (!dragState || !dropTarget) {
                return;
            }

            event.preventDefault();
            this.clearReorderDragState();
            if (dragState.kind === "thread") {
                void this.plugin.reorderThreadsForFile(
                    dragState.filePath,
                    dragState.threadId,
                    dropTarget.targetId,
                    dropTarget.placement,
                );
                return;
            }

            void this.plugin.reorderThreadEntries(
                dragState.filePath,
                dragState.threadId,
                dragState.entryId,
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

    private getReorderDragStateFromEventTarget(
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
        const threadId = handleEl.getAttribute("data-sidenote2-thread-id");
        if (dragKind === "thread" && threadId) {
            return {
                kind: "thread",
                filePath,
                threadId,
            };
        }

        const entryId = handleEl.getAttribute("data-sidenote2-entry-id");
        if (dragKind === "entry" && threadId && entryId) {
            return {
                kind: "entry",
                filePath,
                threadId,
                entryId,
            };
        }

        return null;
    }

    private resolveReorderDropTarget(event: DragEvent): {
        element: HTMLElement;
        targetId: string;
        placement: ReorderPlacement;
    } | null {
        const dragState = this.reorderDragState;
        if (!dragState || !(event.target instanceof Element)) {
            return null;
        }

        if (dragState.kind === "thread") {
            const threadStackEl = event.target.closest(".sidenote2-thread-stack");
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

        const targetEntryEl = event.target.closest(".sidenote2-thread-entry-item");
        if (!(targetEntryEl instanceof HTMLElement)) {
            return null;
        }

        const targetEntryId = targetEntryEl.getAttribute("data-comment-id");
        const threadStackEl = targetEntryEl.closest(".sidenote2-thread-stack");
        const targetThreadId = threadStackEl?.getAttribute("data-thread-id");
        if (
            !targetEntryId
            || !targetThreadId
            || targetThreadId !== dragState.threadId
            || targetEntryId === dragState.entryId
        ) {
            return null;
        }

        return {
            element: targetEntryEl,
            targetId: targetEntryId,
            placement: this.resolveReorderPlacement(targetEntryEl, event.clientY),
        };
    }

    private resolveReorderPlacement(element: HTMLElement, clientY: number): ReorderPlacement {
        const rect = element.getBoundingClientRect();
        return clientY < rect.top + rect.height / 2
            ? "before"
            : "after";
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
            saveDraft: (commentId) => {
                void this.plugin.saveDraft(commentId);
            },
            cancelDraft: (commentId) => {
                void this.plugin.cancelDraft(commentId);
            },
        }, this.draftEditorController);
    }

    private async renderThoughtTrail(
        commentsContainer: HTMLDivElement,
        comments: Comment[],
        file: TFile,
        options: {
            hasFileFilter: boolean;
        },
    ): Promise<void> {
        const thoughtTrailEl = commentsContainer.createDiv("sidenote2-thought-trail");
        if (!options.hasFileFilter) {
            const emptyStateEl = thoughtTrailEl.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
            emptyStateEl.createEl("p", { text: "Use Files to choose a file and see its connected files." });
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
            emptyStateEl.createEl("p", { text: "No thought trail matches the selected file filter." });
            emptyStateEl.createEl("p", { text: "Add wiki links in those notes or choose a different file." });
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
            await MarkdownRenderer.renderMarkdown(
                thoughtTrailLines.join("\n"),
                container,
                sourcePath,
                this.plugin,
            );

            const fallbackMermaidEl = container.querySelector(".mermaid");
            if (fallbackMermaidEl instanceof HTMLElement) {
                fallbackMermaidEl.setAttribute("data-sidenote2-thought-trail-renderer", "markdown");
            }
        };

        await loadMermaid().catch(() => undefined);
        const mermaidRuntime = (globalThis as typeof globalThis & { mermaid?: any }).mermaid;
        if (!mermaidRuntime?.render || !mermaidRuntime?.initialize) {
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
            mermaidEl.innerHTML = svg;
            if (typeof renderResult?.bindFunctions === "function") {
                renderResult.bindFunctions(mermaidEl);
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
        if (await this.plugin.shouldConfirmDelete()) {
            new ConfirmDeleteModal(this.app, () => {
                void this.plugin.deleteComment(commentId);
            }).open();
            return;
        }

        await this.plugin.deleteComment(commentId);
    }
}
