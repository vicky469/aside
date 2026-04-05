import { ItemView, MarkdownRenderer, TFile, WorkspaceLeaf, setIcon, type ViewStateResult } from "obsidian";
import type { Comment } from "../../commentManager";
import {
    buildIndexFileFilterGraph,
    getIndexFileFilterConnectedComponent,
    type IndexFileFilterGraph,
} from "../../core/derived/indexFileFilterGraph";
import {
    buildThoughtTrailLines,
} from "../../core/derived/thoughtTrail";
import type { DraftComment } from "../../domain/drafts";
import type SideNote2 from "../../main";
import ConfirmDeleteModal from "../modals/ConfirmDeleteModal";
import SideNoteFileFilterModal from "../modals/SideNoteFileFilterModal";
import SideNoteLinkSuggestModal from "../modals/SideNoteLinkSuggestModal";
import SideNoteTagSuggestModal from "../modals/SideNoteTagSuggestModal";
import { SIDE_NOTE2_ICON_ID } from "../sideNote2Icon";
import { SidebarDraftEditorController, getSidebarComments } from "./sidebarDraftEditor";
import { renderDraftCommentCard } from "./sidebarDraftComment";
import {
    buildIndexFileFilterOptionsFromCounts,
    filterCommentsByFilePaths,
    getIndexFileFilterLabel,
    type IndexFileFilterOption,
} from "./indexFileFilter";
import { INDEX_SIDEBAR_LIST_LIMIT, limitIndexSidebarListItems } from "./indexSidebarListLimit";
import { filterCommentsByResolvedVisibility } from "../../core/rules/resolvedCommentVisibility";
import { SidebarInteractionController } from "./sidebarInteractionController";
import { renderPersistedCommentCard } from "./sidebarPersistedComment";
import { extractThoughtTrailClickTargets, parseThoughtTrailOpenFilePath, resolveThoughtTrailNodeId } from "./thoughtTrailNodeLinks";
import { getSidebarPersistedCommentPrimaryAction } from "./indexReverseHighlightMode";
import {
    normalizeIndexFileFilterRootPath,
    resolveIndexFileFilterRootPathFromState,
    type CustomViewState,
    type IndexSidebarMode,
} from "./viewState";

function isDraftComment(comment: Comment | DraftComment): comment is DraftComment {
    return "mode" in comment;
}

function parseIndexSidebarMode(value: unknown): IndexSidebarMode | null {
    return value === "list" || value === "thought-trail"
        ? value
        : null;
}

export default class SideNote2View extends ItemView {
    private file: TFile | null = null;
    private plugin: SideNote2;
    private renderVersion = 0;
    private readonly draftEditorController: SidebarDraftEditorController;
    private readonly interactionController: SidebarInteractionController;
    private indexSidebarMode: IndexSidebarMode = "list";
    private selectedIndexFileFilterRootPath: string | null = null;
    private indexFileFilterGraph: IndexFileFilterGraph | null = null;

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
            const showResolved = this.plugin.shouldShowResolvedComments();
            const visiblePersistedComments = filterCommentsByResolvedVisibility(persistedComments, showResolved);
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

            const filteredIndexFilePaths = isAllCommentsView && indexFileFilterGraph
                ? getIndexFileFilterConnectedComponent(indexFileFilterGraph, selectedIndexFileFilterRootPath)
                : [];
            const indexFileFilterOptions = isAllCommentsView && indexFileFilterGraph
                ? buildIndexFileFilterOptionsFromCounts(indexFileFilterGraph.fileCommentCounts)
                : [];
            const scopedVisibleComments = isAllCommentsView
                ? filterCommentsByFilePaths(visiblePersistedComments, filteredIndexFilePaths)
                : visiblePersistedComments;
            const resolvedScopedComments = isAllCommentsView
                ? filterCommentsByFilePaths(persistedComments, filteredIndexFilePaths)
                : persistedComments;
            const draftComment = this.plugin.getDraftForView(file.path);
            const totalScopedCount = scopedVisibleComments.length;
            const resolvedCount = resolvedScopedComments.filter((comment) => comment.resolved).length;
            const hasResolvedComments = resolvedCount > 0;
            const commentsForFile = getSidebarComments(
                persistedComments,
                draftComment,
                showResolved,
                filteredIndexFilePaths,
            );
            const limitedComments = isAllCommentsView && this.indexSidebarMode === "list"
                ? limitIndexSidebarListItems(commentsForFile)
                : {
                    visibleItems: commentsForFile.slice(),
                    hiddenCount: 0,
                };
            const renderedComments = limitedComments.visibleItems;
            const commentsContainer = this.containerEl.createDiv("sidenote2-comments-container");

            this.renderSidebarToolbar(commentsContainer, {
                isAllCommentsView,
                resolvedCount,
                hasResolvedComments,
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

            const commentsBody = this.renderCommentsList(
                commentsContainer,
                !isAllCommentsView
                    ? {
                        icon: "plus",
                        ariaLabel: "Add page side note",
                        title: "Add page side note",
                        onClick: () => {
                            void this.plugin.startPageCommentDraft(file);
                        },
                    }
                    : undefined,
            );
            const renderPromises = renderedComments.map(async (comment) => {
                if (isDraftComment(comment)) {
                    this.renderDraftComment(commentsBody, comment);
                    return;
                }

                await this.renderPersistedComment(commentsBody, comment);
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

            if (renderedComments.length === 0) {
                if (isAllCommentsView) {
                    const emptyStateEl = commentsBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
                    if (showResolved && totalScopedCount > 0) {
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
            indexFileFilterOptions: IndexFileFilterOption[];
            selectedIndexFileFilterRootPath: string | null;
            filteredIndexFilePaths: string[];
        },
    ) {
        const showResolved = this.plugin.shouldShowResolvedComments();
        if (!options.isAllCommentsView && !options.hasResolvedComments && !showResolved) {
            return;
        }

        const toolbarEl = container.createDiv("sidenote2-sidebar-toolbar");
        toolbarEl.classList.toggle("is-index-toolbar", options.isAllCommentsView);
        if (options.isAllCommentsView) {
            this.renderIndexModeControl(toolbarEl);

            const filterGroup = toolbarEl.createDiv("sidenote2-sidebar-toolbar-group");
            this.renderToolbarChip(filterGroup, {
                label: "Files",
                icon: "list-filter",
                active: !!options.selectedIndexFileFilterRootPath,
                ariaLabel: options.indexFileFilterOptions.length
                    ? "Filter index by files"
                    : "No files with side notes yet",
                title: options.indexFileFilterOptions.length
                    ? undefined
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

        if (!options.hasResolvedComments) {
            return;
        }

        const filterGroup = toolbarEl.createDiv("sidenote2-sidebar-toolbar-group");
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

    private renderToolbarChip(
        container: HTMLElement,
        options: {
            label: string;
            active: boolean;
            ariaLabel: string;
            title?: string;
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
        button.setAttribute("aria-pressed", options.active ? "true" : "false");
        button.setAttribute("aria-label", options.ariaLabel);
        if (options.title) {
            button.setAttribute("title", options.title);
        }
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

    private renderIndexModeControl(container: HTMLElement): void {
        const modeGroup = container.createDiv("sidenote2-sidebar-toolbar-group");
        const segmentedControl = modeGroup.createDiv("sidenote2-segmented-control");
        this.renderSegmentedControlButton(segmentedControl, {
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
        this.renderSegmentedControlButton(segmentedControl, {
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

    private renderSegmentedControlButton(
        container: HTMLElement,
        options: {
            label: string;
            active: boolean;
            ariaLabel: string;
            onClick: () => void;
        },
    ): void {
        const button = container.createEl("button", {
            cls: `sidenote2-segmented-control-button${options.active ? " is-active" : ""}`,
            text: options.label,
        });
        button.setAttribute("type", "button");
        button.setAttribute("aria-pressed", options.active ? "true" : "false");
        button.setAttribute("aria-label", options.ariaLabel);
        button.onclick = options.onClick;
    }

    private renderActiveFileFilters(
        container: HTMLElement,
        rootFilePath: string,
        filteredIndexFilePaths: string[],
        indexFileFilterOptions: IndexFileFilterOption[],
    ): void {
        const optionByPath = new Map(indexFileFilterOptions.map((option) => [option.filePath, option]));
        const filterBar = container.createDiv("sidenote2-active-file-filters");
        const rootOption = optionByPath.get(rootFilePath);
        const rootChip = filterBar.createDiv("sidenote2-active-file-filter");
        rootChip.addClass("is-root");

        rootChip.createSpan({
            text: getIndexFileFilterLabel(rootFilePath, filteredIndexFilePaths),
            cls: "sidenote2-active-file-filter-label",
        });

        if (rootOption) {
            rootChip.createSpan({
                text: String(rootOption.commentCount),
                cls: "sidenote2-active-file-filter-count",
            });
        }

        const clearButton = rootChip.createEl("button", {
            cls: "sidenote2-active-file-filter-clear clickable-icon",
        });
        clearButton.setAttribute("type", "button");
        clearButton.setAttribute("aria-label", `Clear file filter for ${rootFilePath}`);
        clearButton.setAttribute("title", "Clear file filter");
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
            selectedFilePaths: this.indexFileFilterGraph
                ? getIndexFileFilterConnectedComponent(this.indexFileFilterGraph, this.selectedIndexFileFilterRootPath)
                : [],
            onChooseRoot: async (rootFilePath) => {
                await this.setIndexFileFilterRootPath(rootFilePath);
            },
        }).open();
    }

    private async setIndexFileFilterRootPath(filePath: string | null): Promise<void> {
        const normalizedRootPath = normalizeIndexFileFilterRootPath(filePath);
        if (this.selectedIndexFileFilterRootPath === normalizedRootPath) {
            return;
        }

        this.selectedIndexFileFilterRootPath = normalizedRootPath;
        await this.renderComments();
    }

    private ensureListModeForIndexCommentFocus(): void {
        if (this.file && this.plugin.isAllCommentsNotePath(this.file.path) && this.indexSidebarMode !== "list") {
            this.indexSidebarMode = "list";
        }
    }

    private renderCommentsList(
        container: HTMLElement,
        action?: {
            icon: string;
            ariaLabel: string;
            title: string;
            onClick: () => void;
        },
    ): HTMLDivElement {
        if (action) {
            const actionsRow = container.createDiv("sidenote2-comments-list-actions");
            const actionButton = actionsRow.createEl("button", {
                cls: "sidenote2-comment-section-add-button",
            });
            actionButton.setAttribute("type", "button");
            actionButton.setAttribute("aria-label", action.ariaLabel);
            actionButton.setAttribute("title", action.title);
            setIcon(actionButton, action.icon);
            actionButton.onclick = (event) => {
                event.stopPropagation();
                action.onClick();
            };
        }

        return container.createDiv("sidenote2-comments-list");
    }

    private async renderPersistedComment(commentsContainer: HTMLDivElement, comment: Comment) {
        const currentFilePath = this.file?.path ?? null;
        const isIndexView = !!currentFilePath && this.plugin.isAllCommentsNotePath(currentFilePath);
        const primaryAction = getSidebarPersistedCommentPrimaryAction(
            currentFilePath,
            (path) => this.plugin.isAllCommentsNotePath(path),
        );

        await renderPersistedCommentCard(commentsContainer, comment, {
            activeCommentId: this.interactionController.getActiveCommentId(),
            currentFilePath,
            showSourceRedirectAction: isIndexView,
            getEventTargetElement: (target) => this.interactionController.getEventTargetElement(target),
            isSelectionInsideSidebarContent: (selection) => this.interactionController.isSelectionInsideSidebarContent(selection),
            claimSidebarInteractionOwnership: (focusTarget) => this.interactionController.claimSidebarInteractionOwnership(focusTarget),
            renderMarkdown: async (markdown, container, sourcePath) => {
                await MarkdownRenderer.renderMarkdown(markdown, container, sourcePath, this.plugin);
            },
            openSidebarInternalLink: (href, sourcePath, focusTarget) =>
                this.interactionController.openSidebarInternalLink(href, sourcePath, focusTarget),
            activateComment: async (persistedComment) => {
                if (primaryAction === "index-highlight" && currentFilePath) {
                    this.interactionController.setActiveComment(persistedComment.id);
                    await this.plugin.syncIndexCommentHighlightPair(persistedComment.id, currentFilePath);
                    return;
                }

                await this.interactionController.openCommentInEditor(persistedComment);
            },
            openCommentInEditor: (persistedComment) => this.interactionController.openCommentInEditor(persistedComment),
            resolveComment: (commentId) => {
                void this.plugin.resolveComment(commentId);
            },
            unresolveComment: (commentId) => {
                void this.plugin.unresolveComment(commentId);
            },
            startEditDraft: (commentId, hostFilePath) => {
                void this.plugin.startEditDraft(commentId, hostFilePath);
            },
            deleteCommentWithConfirm: (commentId) => {
                void this.deleteCommentWithConfirm(commentId);
            },
            setIcon: (element, icon) => {
                setIcon(element, icon);
            },
        });
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
            emptyStateEl.createEl("p", { text: "Use Files to choose a file and see its connected thought trail." });
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

        thoughtTrailEl.createEl("p", {
            cls: "sidenote2-thought-trail-caption",
            text: "Click a file node to open it. Edge labels show the linking side note.",
        });

        await MarkdownRenderer.renderMarkdown(
            thoughtTrailLines.join("\n"),
            thoughtTrailEl,
            file.path,
            this.plugin,
        );

        this.bindThoughtTrailNodeLinks(thoughtTrailEl, thoughtTrailLines);
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
