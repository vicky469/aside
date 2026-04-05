import { ItemView, MarkdownRenderer, TFile, WorkspaceLeaf, setIcon, type ViewStateResult } from "obsidian";
import type { Comment } from "../../commentManager";
import { buildThoughtTrailLines } from "../../core/derived/thoughtTrail";
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
    buildIndexFileFilterOptions,
    filterCommentsByFilePaths,
    getIndexFileFilterLabel,
    normalizeIndexFileFilterPaths,
    type IndexFileFilterOption,
} from "./indexFileFilter";
import { INDEX_SIDEBAR_LIST_LIMIT, limitIndexSidebarListItems } from "./indexSidebarListLimit";
import { filterCommentsByResolvedVisibility } from "../../core/rules/resolvedCommentVisibility";
import { SidebarInteractionController } from "./sidebarInteractionController";
import { renderPersistedCommentCard } from "./sidebarPersistedComment";
import { extractThoughtTrailClickTargets, parseThoughtTrailOpenFilePath, resolveThoughtTrailNodeId } from "./thoughtTrailNodeLinks";
import type { CustomViewState, IndexSidebarMode } from "./viewState";

function isDraftComment(comment: Comment | DraftComment): comment is DraftComment {
    return "mode" in comment;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((value, index) => value === right[index]);
}

function parseIndexSidebarMode(value: unknown): IndexSidebarMode | null {
    return value === "list" || value === "thought-trail"
        ? value
        : null;
}

function parseIndexFileFilterPaths(value: unknown): string[] | null {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
        return null;
    }

    return normalizeIndexFileFilterPaths(value);
}

export default class SideNote2View extends ItemView {
    private file: TFile | null = null;
    private plugin: SideNote2;
    private renderVersion = 0;
    private readonly draftEditorController: SidebarDraftEditorController;
    private readonly interactionController: SidebarInteractionController;
    private indexSidebarMode: IndexSidebarMode = "list";
    private filteredIndexFilePaths: string[] = [];

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

        if (Object.prototype.hasOwnProperty.call(state, "indexFileFilterPaths")) {
            const nextFileFilterPaths = parseIndexFileFilterPaths(state.indexFileFilterPaths) ?? [];
            if (!arraysEqual(this.filteredIndexFilePaths, nextFileFilterPaths)) {
                this.filteredIndexFilePaths = nextFileFilterPaths;
                shouldRender = true;
            }
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
            const indexFileFilterOptions = isAllCommentsView
                ? buildIndexFileFilterOptions(persistedComments)
                : [];
            const availableIndexFilePaths = new Set(indexFileFilterOptions.map((option) => option.filePath));
            const filteredIndexFilePaths = isAllCommentsView
                ? normalizeIndexFileFilterPaths(
                    this.filteredIndexFilePaths.filter((filePath) => availableIndexFilePaths.has(filePath)),
                )
                : [];
            if (isAllCommentsView && !arraysEqual(this.filteredIndexFilePaths, filteredIndexFilePaths)) {
                this.filteredIndexFilePaths = filteredIndexFilePaths;
            }

            const scopedPersistedComments = isAllCommentsView
                ? filterCommentsByFilePaths(persistedComments, filteredIndexFilePaths)
                : persistedComments;
            const draftComment = this.plugin.getDraftForView(file.path);
            const totalScopedCount = scopedPersistedComments.length;
            const resolvedCount = scopedPersistedComments.filter((comment) => comment.resolved).length;
            const hasResolvedComments = resolvedCount > 0;
            const showResolved = this.plugin.shouldShowResolvedComments();
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
                filteredIndexFilePaths,
            });

            if (isAllCommentsView && filteredIndexFilePaths.length) {
                this.renderActiveFileFilters(commentsContainer, filteredIndexFilePaths, indexFileFilterOptions);
            }

            if (isAllCommentsView && this.indexSidebarMode === "thought-trail") {
                const trailComments = filterCommentsByResolvedVisibility(scopedPersistedComments, showResolved);
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
                        emptyStateEl.createEl("p", { text: "Add more files to the filter or clear it to widen the index view." });
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
            const modeGroup = toolbarEl.createDiv("sidenote2-sidebar-toolbar-group");
            this.renderToolbarChip(modeGroup, {
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
            this.renderToolbarChip(modeGroup, {
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

            const filterGroup = toolbarEl.createDiv("sidenote2-sidebar-toolbar-group");
            this.renderToolbarChip(filterGroup, {
                label: "Files",
                active: options.filteredIndexFilePaths.length > 0,
                ariaLabel: options.indexFileFilterOptions.length
                    ? "Filter index by files"
                    : "No files with side notes yet",
                title: options.indexFileFilterOptions.length
                    ? undefined
                    : "No files with side notes yet",
                count: options.filteredIndexFilePaths.length
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

    private renderActiveFileFilters(
        container: HTMLElement,
        filteredIndexFilePaths: string[],
        indexFileFilterOptions: IndexFileFilterOption[],
    ): void {
        const optionByPath = new Map(indexFileFilterOptions.map((option) => [option.filePath, option]));
        const filterBar = container.createDiv("sidenote2-active-file-filters");

        for (const filePath of filteredIndexFilePaths) {
            const option = optionByPath.get(filePath);
            const button = filterBar.createEl("button", {
                cls: "sidenote2-active-file-filter",
            });
            button.setAttribute("type", "button");
            button.setAttribute("aria-label", `Remove ${filePath} from the file filter`);
            button.setAttribute("title", `Remove ${filePath} from the file filter`);

            button.createSpan({
                text: getIndexFileFilterLabel(filePath, filteredIndexFilePaths),
                cls: "sidenote2-active-file-filter-label",
            });

            if (option) {
                button.createSpan({
                    text: String(option.commentCount),
                    cls: "sidenote2-active-file-filter-count",
                });
            }

            const removeIcon = button.createSpan("sidenote2-active-file-filter-remove");
            setIcon(removeIcon, "x");

            button.onclick = () => {
                void this.removeIndexFileFilterPath(filePath);
            };
        }

        const clearButton = filterBar.createEl("button", {
            text: "Clear",
            cls: "sidenote2-active-file-filter-clear",
        });
        clearButton.setAttribute("type", "button");
        clearButton.setAttribute("aria-label", "Clear file filters");
        clearButton.setAttribute("title", "Clear file filters");
        clearButton.onclick = () => {
            void this.setIndexFileFilterPaths([]);
        };
    }

    private openIndexFileFilterModal(indexFileFilterOptions: IndexFileFilterOption[]): void {
        new SideNoteFileFilterModal(this.app, {
            availableOptions: indexFileFilterOptions,
            selectedFilePaths: this.filteredIndexFilePaths,
            onChangeSelection: async (filePaths) => {
                await this.setIndexFileFilterPaths(filePaths);
            },
        }).open();
    }

    private async removeIndexFileFilterPath(filePath: string): Promise<void> {
        await this.setIndexFileFilterPaths(
            this.filteredIndexFilePaths.filter((path) => path !== filePath),
        );
    }

    private async setIndexFileFilterPaths(filePaths: readonly string[]): Promise<void> {
        const normalizedPaths = normalizeIndexFileFilterPaths(filePaths);
        if (arraysEqual(this.filteredIndexFilePaths, normalizedPaths)) {
            return;
        }

        this.filteredIndexFilePaths = normalizedPaths;
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
            // TODO: This is temporary. In index mode, restore reverse navigation here so
            // clicking the card body scrolls/highlights the matching ref in index.md.
            activateComment: (persistedComment) => this.interactionController.openCommentInEditor(persistedComment),
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
        const thoughtTrailLines = buildThoughtTrailLines(this.app.vault.getName(), comments, {
            allCommentsNotePath: this.plugin.getAllCommentsNotePath(),
            resolveWikiLinkPath: (linkPath, sourceFilePath) => {
                const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFilePath);
                return linkedFile instanceof TFile ? linkedFile.path : null;
            },
        });

        if (!thoughtTrailLines.length) {
            const emptyStateEl = thoughtTrailEl.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
            if (options.hasFileFilter) {
                emptyStateEl.createEl("p", { text: "No thought trail matches the selected file filter." });
                emptyStateEl.createEl("p", { text: "Add wiki links in those notes or widen the file filter." });
            } else {
                emptyStateEl.createEl("p", { text: "No thought trail yet." });
                emptyStateEl.createEl("p", { text: "Add wiki links inside side notes to connect files into a trail." });
            }
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
            indexFileFilterPaths: this.filteredIndexFilePaths.slice(),
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
