import { ItemView, MarkdownRenderer, TFile, WorkspaceLeaf, normalizePath, setIcon, type Hotkey, type ViewStateResult } from "obsidian";
import type { Comment } from "../../commentManager";
import { buildThoughtTrailLines } from "../../core/derived/thoughtTrail";
import type { DraftComment } from "../../domain/drafts";
import type SideNote2 from "../../main";
import ConfirmDeleteModal from "../modals/ConfirmDeleteModal";
import SideNoteLinkSuggestModal from "../modals/SideNoteLinkSuggestModal";
import SideNoteTagSuggestModal from "../modals/SideNoteTagSuggestModal";
import { SIDE_NOTE2_ICON_ID } from "../sideNote2Icon";
import { buildSidebarSections, type SidebarSectionKey } from "./sidebarCommentSections";
import {
    DEFAULT_HIGHLIGHT_HOTKEY,
    SidebarDraftEditorController,
    getSidebarComments,
    resolveHighlightHotkeysFromConfig,
} from "./sidebarDraftEditor";
import { renderDraftCommentCard } from "./sidebarDraftComment";
import { SidebarInteractionController } from "./sidebarInteractionController";
import { renderPersistedCommentCard } from "./sidebarPersistedComment";
import { extractThoughtTrailClickTargets, parseThoughtTrailOpenFilePath, resolveThoughtTrailNodeId } from "./thoughtTrailNodeLinks";
import type { CustomViewState } from "./viewState";

function isDraftComment(comment: Comment | DraftComment): comment is DraftComment {
    return "mode" in comment;
}

type IndexSidebarMode = "list" | "thought-trail";

async function loadConfiguredHighlightHotkeys(view: ItemView): Promise<Hotkey[]> {
    const hotkeysPath = normalizePath(`${view.app.vault.configDir}/hotkeys.json`);

    try {
        if (!(await view.app.vault.adapter.exists(hotkeysPath))) {
            return [DEFAULT_HIGHLIGHT_HOTKEY];
        }

        const rawConfig = await view.app.vault.adapter.read(hotkeysPath);
        const parsed = JSON.parse(rawConfig) as Record<string, unknown>;
        return resolveHighlightHotkeysFromConfig(parsed["editor:toggle-highlight"]);
    } catch (error) {
        console.warn("Failed to load configured highlight hotkeys for SideNote2 draft editor", error);
        return [DEFAULT_HIGHLIGHT_HOTKEY];
    }
}

export default class SideNote2View extends ItemView {
    private file: TFile | null = null;
    private plugin: SideNote2;
    private renderVersion = 0;
    private readonly draftEditorController: SidebarDraftEditorController;
    private readonly interactionController: SidebarInteractionController;
    private indexSidebarMode: IndexSidebarMode = "list";
    private readonly sectionExpandedState: Record<SidebarSectionKey, boolean> = {
        page: true,
        anchored: true,
    };

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
        }, () => loadConfiguredHighlightHotkeys(this));
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
        await this.draftEditorController.refreshFormattingHotkeys();
        await this.renderComments();
        document.addEventListener("keydown", this.interactionController.documentKeydownHandler, true);
        document.addEventListener("copy", this.interactionController.documentCopyHandler, true);
        document.addEventListener("selectionchange", this.interactionController.documentSelectionChangeHandler);
        this.containerEl.addEventListener("click", this.interactionController.sidebarClickHandler);
    }

    async setState(state: CustomViewState, result: ViewStateResult): Promise<void> {
        if (state.filePath) {
            const file = this.app.vault.getAbstractFileByPath(state.filePath);
            if (file instanceof TFile) {
                this.file = file;
                await this.renderComments();
            }
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
            const draftComment = this.plugin.getDraftForView(file.path);
            const resolvedCount = persistedComments.filter((comment) => comment.resolved).length;
            const hasResolvedComments = resolvedCount > 0;
            const showResolved = this.plugin.shouldShowResolvedComments();
            const commentsForFile = getSidebarComments(persistedComments, draftComment, showResolved);
            const commentsContainer = this.containerEl.createDiv("sidenote2-comments-container");

            this.renderSidebarToolbar(commentsContainer, {
                isAllCommentsView,
                resolvedCount,
                hasResolvedComments,
            });

            if (isAllCommentsView && this.indexSidebarMode === "thought-trail") {
                const trailComments = showResolved
                    ? persistedComments
                    : persistedComments.filter((comment) => !comment.resolved);
                await this.renderThoughtTrail(commentsContainer, trailComments, file);
                return;
            }

            const sections = buildSidebarSections(commentsForFile);
            for (const section of sections) {
                const sectionBody = this.renderCommentSection(
                    commentsContainer,
                    section.key,
                    section.title,
                    section.key === "page" && !isAllCommentsView
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
                const renderPromises = section.comments.map(async (comment) => {
                    if (isDraftComment(comment)) {
                        this.renderDraftComment(sectionBody, comment);
                        return;
                    }

                    await this.renderPersistedComment(sectionBody, comment);
                });
                await Promise.all(renderPromises);
            }

            if (commentsForFile.length === 0) {
                const anchoredSectionBody = commentsContainer.querySelector(
                    '[data-section-key="anchored"] .sidenote2-comment-section-body',
                );
                if (anchoredSectionBody instanceof HTMLDivElement) {
                    if (isAllCommentsView) {
                        const emptyStateEl = anchoredSectionBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
                        emptyStateEl.createEl("p", { text: "No side notes in the index yet." });
                        emptyStateEl.createEl("p", { text: "Add side notes in markdown files to populate SideNote2 index." });
                    } else if (hasResolvedComments && !showResolved) {
                        const emptyStateEl = anchoredSectionBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
                        emptyStateEl.createEl("p", { text: "No active comments for this file." });
                        emptyStateEl.createEl("p", { text: "Turn on Show resolved to review archived comments." });
                    }
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
        },
    ) {
        if (!options.isAllCommentsView && !options.hasResolvedComments) {
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
                title: "Show index list",
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
                title: "Show thought trail",
                onClick: () => {
                    if (this.indexSidebarMode === "thought-trail") {
                        return;
                    }

                    this.indexSidebarMode = "thought-trail";
                    void this.renderComments();
                },
            });
        }

        if (!options.hasResolvedComments) {
            return;
        }

        const filterGroup = toolbarEl.createDiv("sidenote2-sidebar-toolbar-group");
        const showResolved = this.plugin.shouldShowResolvedComments();
        this.renderToolbarChip(filterGroup, {
            label: "Resolved",
            active: showResolved,
            ariaLabel: showResolved ? "Hide resolved comments" : "Show resolved comments",
            title: showResolved ? "Hide resolved comments" : "Show resolved comments",
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
            title: string;
            onClick: () => void;
            count?: string;
            showIndicator?: boolean;
        },
    ): void {
        const button = container.createEl("button", {
            cls: `sidenote2-filter-chip${options.active ? " is-active" : ""}`,
        });
        button.setAttribute("type", "button");
        button.setAttribute("aria-pressed", options.active ? "true" : "false");
        button.setAttribute("aria-label", options.ariaLabel);
        button.setAttribute("title", options.title);

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

    private ensureListModeForIndexCommentFocus(): void {
        if (this.file && this.plugin.isAllCommentsNotePath(this.file.path) && this.indexSidebarMode !== "list") {
            this.indexSidebarMode = "list";
        }
    }

    private renderCommentSection(
        container: HTMLElement,
        key: SidebarSectionKey,
        title: string,
        action?: {
            icon: string;
            ariaLabel: string;
            title: string;
            onClick: () => void;
        },
    ): HTMLDivElement {
        const sectionEl = container.createDiv("sidenote2-comment-section");
        sectionEl.setAttribute("data-section-key", key);
        const sectionHeader = sectionEl.createDiv("sidenote2-comment-section-header");

        const toggleButton = sectionHeader.createEl("button", {
            cls: "sidenote2-comment-section-toggle",
        });
        toggleButton.setAttribute("type", "button");

        const toggleIconEl = toggleButton.createSpan("sidenote2-comment-section-toggle-icon");
        toggleButton.createSpan({
            text: title,
            cls: "sidenote2-comment-section-title",
        });

        const sectionBody = sectionEl.createDiv("sidenote2-comment-section-body");
        const syncExpandedState = () => {
            const expanded = this.sectionExpandedState[key];
            toggleButton.setAttribute("aria-expanded", expanded ? "true" : "false");
            toggleButton.setAttribute(
                "title",
                `${expanded ? "Collapse" : "Expand"} ${title.toLowerCase()}`,
            );
            setIcon(toggleIconEl, expanded ? "chevron-down" : "chevron-right");
            sectionEl.classList.toggle("is-collapsed", !expanded);
        };

        toggleButton.onclick = (event) => {
            event.stopPropagation();
            this.sectionExpandedState[key] = !this.sectionExpandedState[key];
            syncExpandedState();
        };

        if (action) {
            const actionButton = sectionHeader.createEl("button", {
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

        syncExpandedState();
        return sectionBody;
    }

    private async renderPersistedComment(commentsContainer: HTMLDivElement, comment: Comment) {
        await renderPersistedCommentCard(commentsContainer, comment, {
            activeCommentId: this.interactionController.getActiveCommentId(),
            currentFilePath: this.file?.path ?? null,
            getEventTargetElement: (target) => this.interactionController.getEventTargetElement(target),
            isSelectionInsideSidebarContent: (selection) => this.interactionController.isSelectionInsideSidebarContent(selection),
            claimSidebarInteractionOwnership: (focusTarget) => this.interactionController.claimSidebarInteractionOwnership(focusTarget),
            renderMarkdown: async (markdown, container, sourcePath) => {
                await MarkdownRenderer.renderMarkdown(markdown, container, sourcePath, this.plugin);
            },
            openSidebarInternalLink: (href, sourcePath, focusTarget) =>
                this.interactionController.openSidebarInternalLink(href, sourcePath, focusTarget),
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

    private async renderThoughtTrail(commentsContainer: HTMLDivElement, comments: Comment[], file: TFile): Promise<void> {
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
            emptyStateEl.createEl("p", { text: "No thought trail yet." });
            emptyStateEl.createEl("p", { text: "Add wiki links inside side notes to connect files into a trail." });
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
