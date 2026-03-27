import { ItemView, MarkdownRenderer, MarkdownView, TFile, WorkspaceLeaf, setIcon, type ViewStateResult } from "obsidian";
import type { Comment } from "../../commentManager";
import { isAllCommentsNotePath } from "../../core/allCommentsNote";
import { isOrphanedComment, isPageComment } from "../../core/commentAnchors";
import { extractTagsFromText } from "../../core/commentTags";
import type { DraftComment } from "../../domain/drafts";
import type SideNote2 from "../../main";
import { copyTextToClipboard } from "../copyTextToClipboard";
import type { TextEditResult } from "../editor/commentEditorFormatting";
import { findOpenWikiLinkQuery, replaceOpenWikiLinkQuery } from "../editor/commentEditorLinks";
import { findOpenTagQuery, replaceOpenTagQuery } from "../editor/commentEditorTags";
import ConfirmDeleteModal from "../modals/ConfirmDeleteModal";
import SideNoteLinkSuggestModal from "../modals/SideNoteLinkSuggestModal";
import SideNoteTagSuggestModal from "../modals/SideNoteTagSuggestModal";
import { SIDE_NOTE2_ICON_ID } from "../sideNote2Icon";
import { decideEditDismissal } from "./editDismissal";
import { shouldActivateSidebarComment } from "./commentPointerAction";
import { buildSidebarSections, formatSidebarCommentMeta, type SidebarSectionKey } from "./sidebarCommentSections";
import { getSelectedSidebarClipboardText } from "./sidebarClipboardSelection";
import type { CustomViewState } from "./viewState";

function isDraftComment(comment: Comment | DraftComment): comment is DraftComment {
    return "mode" in comment;
}

function isModShortcut(event: KeyboardEvent, code: string, key?: string): boolean {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return false;
    }

    if (event.code === code) {
        return true;
    }

    return !!key && event.key.toLowerCase() === key.toLowerCase();
}

function getSidebarComments(
    persistedComments: Comment[],
    draftComment: DraftComment | null,
    showResolved: boolean,
): Array<Comment | DraftComment> {
    const commentsWithoutDraft = draftComment
        ? persistedComments.filter((comment) => comment.id !== draftComment.id)
        : persistedComments.slice();
    const visibleComments = showResolved
        ? commentsWithoutDraft
        : commentsWithoutDraft.filter((comment) => !comment.resolved);
    const mergedComments = draftComment
        ? visibleComments.concat(draftComment)
        : visibleComments;

    return mergedComments
        .slice()
        .sort((left, right) => {
            if (left.filePath !== right.filePath) {
                return left.filePath.localeCompare(right.filePath);
            }
            if (left.startLine !== right.startLine) {
                return left.startLine - right.startLine;
            }
            if (left.startChar !== right.startChar) {
                return left.startChar - right.startChar;
            }
            return left.timestamp - right.timestamp;
        }) as Array<Comment | DraftComment>;
}

export default class SideNote2View extends ItemView {
    private file: TFile | null = null;
    private plugin: SideNote2;
    private activeCommentId: string | null = null;
    private renderVersion = 0;
    private pendingDraftFocusFrame: number | null = null;
    private activeInlineSuggest: "link" | "tag" | null = null;
    private readonly sectionExpandedState: Record<SidebarSectionKey, boolean> = {
        page: true,
        anchored: true,
    };
    private readonly documentSelectionChangeHandler = () => {
        if (this.isSelectionInsideSidebarContent()) {
            this.claimSidebarInteractionOwnership();
        }
    };
    private shouldSaveDraftFromEnter(event: KeyboardEvent): boolean {
        return event.key === "Enter" && !event.shiftKey && !event.altKey && !event.isComposing;
    }
    private readonly documentKeydownHandler = (event: KeyboardEvent) => {
        const consumeShortcut = () => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        };

        const selectedSidebarText = this.getSelectedSidebarText();
        if (selectedSidebarText && isModShortcut(event, "KeyC", "c")) {
            this.claimSidebarInteractionOwnership();
            consumeShortcut();
            void copyTextToClipboard(selectedSidebarText);
            return;
        }

        const activeElement = document.activeElement;
        if (!(activeElement instanceof HTMLTextAreaElement)) {
            return;
        }

        if (!activeElement.matches(".sidenote2-inline-textarea") || !this.containerEl.contains(activeElement)) {
            return;
        }

        const draftEl = activeElement.closest("[data-draft-id]");
        const draftId = draftEl?.getAttribute("data-draft-id");
        if (!draftId) {
            return;
        }

        if (this.shouldSaveDraftFromEnter(event)) {
            consumeShortcut();
            void this.plugin.saveDraft(draftId);
        }
    };
    private readonly documentCopyHandler = (event: ClipboardEvent) => {
        const selectedText = this.getSelectedSidebarText();
        if (!selectedText) {
            return;
        }

        this.claimSidebarInteractionOwnership();
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (event.clipboardData) {
            event.clipboardData.setData("text/plain", selectedText);
            return;
        }

        void copyTextToClipboard(selectedText);
    };
    private readonly sidebarClickHandler = (event: MouseEvent) => {
        const file = this.file;
        if (!file) {
            return;
        }

        const target = event.target as Node | null;
        const clickedComment = target instanceof HTMLElement
            ? target.closest(".sidenote2-comment-item")
            : null;
        const clickedSectionChrome = target instanceof HTMLElement
            ? target.closest(".sidenote2-comment-section-header, .sidenote2-sidebar-toolbar")
            : null;

        const draft = this.plugin.getDraftForFile(file.path);
        if (draft && draft.mode === "edit") {
            const draftEl = this.containerEl.querySelector(`[data-draft-id="${draft.id}"]`);
            if (!draftEl) {
                return;
            }

            const decision = decideEditDismissal(
                !!(target && draftEl.contains(target)),
                !!clickedComment,
            );
            if (!decision.shouldCancelDraft) {
                return;
            }

            if (decision.shouldClearActiveState) {
                this.clearActiveState();
            }

            void this.plugin.cancelDraft(draft.id);
            return;
        }

        if (!clickedComment && !clickedSectionChrome) {
            this.clearActiveState();
            this.plugin.clearRevealedCommentSelection();
        }
    };

    constructor(leaf: WorkspaceLeaf, plugin: SideNote2, file: TFile | null = null) {
        super(leaf);
        this.plugin = plugin;
        this.file = file;
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
        document.addEventListener("keydown", this.documentKeydownHandler, true);
        document.addEventListener("copy", this.documentCopyHandler, true);
        document.addEventListener("selectionchange", this.documentSelectionChangeHandler);
        this.containerEl.addEventListener("click", this.sidebarClickHandler);
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
        this.activeCommentId = commentId;
        void this.renderComments().then(() => {
            const commentEl = this.containerEl.querySelector(`[data-comment-id="${commentId}"], [data-draft-id="${commentId}"]`);
            if (commentEl) {
                commentEl.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        });
    }

    public async highlightAndFocusDraft(commentId: string) {
        this.activeCommentId = commentId;

        const draftEl = this.containerEl.querySelector(`[data-draft-id="${commentId}"]`);
        const persistedEl = this.containerEl.querySelector(`[data-comment-id="${commentId}"]`);

        if (draftEl || !persistedEl) {
            await this.renderComments();
        } else {
            this.containerEl.querySelectorAll(".sidenote2-comment-item.active").forEach((el) => {
                el.removeClass("active");
            });
            persistedEl.addClass("active");
        }

        const commentEl = draftEl || this.containerEl.querySelector(`[data-comment-id="${commentId}"], [data-draft-id="${commentId}"]`);
        if (commentEl) {
            commentEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        this.scheduleDraftFocus(commentId);
    }

    public async focusDraft(commentId: string) {
        const commentEl = this.containerEl.querySelector(`[data-draft-id="${commentId}"]`);
        if (commentEl) {
            commentEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        this.scheduleDraftFocus(commentId);
    }

    public clearActiveState(): void {
        this.activeCommentId = null;
        this.containerEl.querySelectorAll(".sidenote2-comment-item.active").forEach((el) => {
            el.removeClass("active");
        });
    }

    private setActiveComment(commentId: string): void {
        this.activeCommentId = commentId;
        this.containerEl.querySelectorAll(".sidenote2-comment-item.active").forEach((el) => {
            if (
                el.getAttribute("data-comment-id") !== commentId &&
                el.getAttribute("data-draft-id") !== commentId
            ) {
                el.removeClass("active");
            }
        });

        const commentEl = this.containerEl.querySelector(`[data-comment-id="${commentId}"], [data-draft-id="${commentId}"]`);
        if (commentEl) {
            commentEl.addClass("active");
        }
    }

    private claimSidebarInteractionOwnership(focusTarget?: HTMLElement | null): void {
        if (this.app.workspace.activeLeaf !== this.leaf) {
            this.app.workspace.setActiveLeaf(this.leaf, { focus: false });
        }

        if (focusTarget?.isConnected && document.activeElement !== focusTarget) {
            focusTarget.focus({ preventScroll: true });
        }
    }

    private getEventTargetElement(target: EventTarget | null): HTMLElement | null {
        if (target instanceof HTMLElement) {
            return target;
        }

        return target instanceof Node ? target.parentElement : null;
    }

    private getSidebarOwner(node: Node | null): HTMLElement | null {
        if (!node) {
            return null;
        }

        const element = node instanceof HTMLElement ? node : node.parentElement;
        const owner = element?.closest(".sidenote2-comment-content");
        return owner instanceof HTMLElement && this.containerEl.contains(owner) ? owner : null;
    }

    private isSelectionInsideSidebarContent(selection: Selection | null = window.getSelection()): boolean {
        if (!selection) {
            return false;
        }

        return !!this.getSidebarOwner(selection.anchorNode) || !!this.getSidebarOwner(selection.focusNode);
    }

    private getPreferredMarkdownLeaf(filePath: string): WorkspaceLeaf | null {
        let matchedLeaf: WorkspaceLeaf | null = null;
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (matchedLeaf) {
                return;
            }

            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === filePath) {
                matchedLeaf = leaf;
            }
        });
        if (matchedLeaf) {
            return matchedLeaf;
        }

        const recentLeaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
        if (recentLeaf?.view instanceof MarkdownView) {
            return recentLeaf;
        }

        this.app.workspace.iterateAllLeaves((leaf) => {
            if (!matchedLeaf && leaf.view instanceof MarkdownView) {
                matchedLeaf = leaf;
            }
        });

        return matchedLeaf;
    }

    private async openSidebarInternalLink(
        href: string,
        sourcePath: string,
        focusTarget: HTMLElement,
    ): Promise<void> {
        const targetLeaf = this.getPreferredMarkdownLeaf(sourcePath);
        if (targetLeaf) {
            this.app.workspace.setActiveLeaf(targetLeaf, { focus: false });
        }

        await this.app.workspace.openLinkText(
            href,
            sourcePath,
            targetLeaf ? false : "tab",
        );

        this.claimSidebarInteractionOwnership(focusTarget);
    }

    private scheduleDraftFocus(commentId: string, attempts = 6): void {
        if (this.pendingDraftFocusFrame !== null) {
            window.cancelAnimationFrame(this.pendingDraftFocusFrame);
            this.pendingDraftFocusFrame = null;
        }

        const tryFocus = (remainingAttempts: number) => {
            const textarea = this.containerEl.querySelector(
                `[data-draft-id="${commentId}"] textarea`
            ) as HTMLTextAreaElement | null;

            if (textarea) {
                textarea.focus();
                const end = textarea.value.length;
                textarea.setSelectionRange(end, end);
                this.pendingDraftFocusFrame = null;
                return;
            }

            if (remainingAttempts <= 0) {
                this.pendingDraftFocusFrame = null;
                return;
            }

            this.pendingDraftFocusFrame = window.requestAnimationFrame(() => {
                tryFocus(remainingAttempts - 1);
            });
        };

        this.pendingDraftFocusFrame = window.requestAnimationFrame(() => {
            tryFocus(attempts);
        });
    }

    private applyDraftEditorEdit(
        commentId: string,
        textarea: HTMLTextAreaElement,
        edit: TextEditResult,
    ): void {
        textarea.value = edit.value;
        textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
        this.plugin.updateDraftCommentText(commentId, edit.value);
    }

    private openDraftLinkSuggest(
        comment: DraftComment,
        textarea: HTMLTextAreaElement,
    ): boolean {
        if (this.activeInlineSuggest) {
            return false;
        }

        const linkQuery = findOpenWikiLinkQuery(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
        );
        if (!linkQuery) {
            return false;
        }

        const initialValue = textarea.value;
        const initialCursor = linkQuery.end;
        let inserted = false;
        this.activeInlineSuggest = "link";

        new SideNoteLinkSuggestModal(this.app, {
            initialQuery: linkQuery.query,
            sourcePath: comment.filePath,
            onChooseLink: async (linkText) => {
                inserted = true;
                const edit = replaceOpenWikiLinkQuery(initialValue, linkQuery, linkText);
                if (textarea.isConnected) {
                    this.applyDraftEditorEdit(comment.id, textarea, edit);
                    textarea.focus();
                    return;
                }

                this.plugin.updateDraftCommentText(comment.id, edit.value);
                await this.renderComments();
                this.scheduleDraftFocus(comment.id);
            },
            onCloseModal: () => {
                this.activeInlineSuggest = null;
                if (inserted || !textarea.isConnected) {
                    return;
                }

                window.requestAnimationFrame(() => {
                    textarea.focus();
                    textarea.setSelectionRange(initialCursor, initialCursor);
                });
            },
        }).open();

        return true;
    }

    private openDraftTagSuggest(
        comment: DraftComment,
        textarea: HTMLTextAreaElement,
    ): boolean {
        if (this.activeInlineSuggest || findOpenWikiLinkQuery(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
        )) {
            return false;
        }

        const tagQuery = findOpenTagQuery(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
        );
        if (!tagQuery) {
            return false;
        }

        const initialValue = textarea.value;
        const initialCursor = tagQuery.end;
        let inserted = false;
        this.activeInlineSuggest = "tag";

        new SideNoteTagSuggestModal(this.app, {
            extraTags: [
                ...this.plugin.getAllIndexedComments().flatMap((storedComment) => extractTagsFromText(storedComment.comment ?? "")),
                ...extractTagsFromText(textarea.value),
            ],
            initialQuery: tagQuery.query,
            onChooseTag: async (tagText) => {
                inserted = true;
                const edit = replaceOpenTagQuery(initialValue, tagQuery, tagText);
                if (textarea.isConnected) {
                    this.applyDraftEditorEdit(comment.id, textarea, edit);
                    textarea.focus();
                    return;
                }

                this.plugin.updateDraftCommentText(comment.id, edit.value);
                await this.renderComments();
                this.scheduleDraftFocus(comment.id);
            },
            onCloseModal: () => {
                this.activeInlineSuggest = null;
                if (inserted || !textarea.isConnected) {
                    return;
                }

                window.requestAnimationFrame(() => {
                    textarea.focus();
                    textarea.setSelectionRange(initialCursor, initialCursor);
                });
            },
        }).open();

        return true;
    }

    public async renderComments() {
        const renderVersion = ++this.renderVersion;
        const file = this.file;
        const isAllCommentsView = !!file && isAllCommentsNotePath(file.path);

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
            const draftComment = isAllCommentsView
                ? null
                : this.plugin.getDraftForFile(file.path);
            const resolvedCount = persistedComments.filter((comment) => comment.resolved).length;
            const hasResolvedComments = resolvedCount > 0;
            const showResolved = this.plugin.shouldShowResolvedComments();
            const commentsForFile = getSidebarComments(persistedComments, draftComment, showResolved);
            const commentsContainer = this.containerEl.createDiv("sidenote2-comments-container");

            this.renderSidebarToolbar(commentsContainer, resolvedCount, hasResolvedComments);

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
                    const emptyStateEl = anchoredSectionBody.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
                    if (isAllCommentsView) {
                        emptyStateEl.createEl("p", { text: "No side notes in the index yet." });
                        emptyStateEl.createEl("p", { text: "Add side notes in markdown files to populate SideNote2 index." });
                    } else if (hasResolvedComments && !showResolved) {
                        emptyStateEl.createEl("p", { text: "No active comments for this file." });
                        emptyStateEl.createEl("p", { text: "Turn on Show resolved to review archived comments." });
                    } else {
                        emptyStateEl.createEl("p", { text: "No comments for this file yet." });
                        emptyStateEl.createEl("p", { text: "Select text and use the add comment command to start a side comment in the sidebar." });
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
        resolvedCount: number,
        hasResolvedComments: boolean,
    ) {
        if (!hasResolvedComments) {
            return;
        }

        const toolbarEl = container.createDiv("sidenote2-sidebar-toolbar");
        const showResolved = this.plugin.shouldShowResolvedComments();
        const toggleButton = toolbarEl.createEl("button", {
            cls: `sidenote2-filter-chip${showResolved ? " is-active" : ""}`,
        });
        toggleButton.setAttribute("type", "button");
        toggleButton.setAttribute("aria-pressed", showResolved ? "true" : "false");
        toggleButton.setAttribute(
            "aria-label",
            showResolved ? "Hide resolved comments" : "Show resolved comments"
        );
        toggleButton.setAttribute(
            "title",
            showResolved ? "Hide resolved comments" : "Show resolved comments"
        );

        toggleButton.createSpan({
            cls: "sidenote2-filter-chip-indicator",
        });

        toggleButton.createSpan({
            text: "Resolved",
            cls: "sidenote2-filter-chip-label",
        });

        toggleButton.createSpan({
            text: String(resolvedCount),
            cls: "sidenote2-filter-chip-count",
        });

        toggleButton.onclick = () => {
            this.plugin.setShowResolvedComments(!showResolved);
        };
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
        const commentEl = commentsContainer.createDiv("sidenote2-comment-item");
        commentEl.setAttribute("data-comment-id", comment.id);
        commentEl.setAttribute("data-start-line", String(comment.startLine));

        if (isPageComment(comment)) {
            commentEl.addClass("page-note");
        }
        if (isOrphanedComment(comment)) {
            commentEl.addClass("orphaned");
        }
        if (comment.resolved) {
            commentEl.addClass("resolved");
        }
        if (this.activeCommentId === comment.id) {
            commentEl.addClass("active");
        }

        const headerEl = commentEl.createDiv("sidenote2-comment-header");
        headerEl.createEl("small", {
            text: formatSidebarCommentMeta(comment),
            cls: "sidenote2-timestamp",
        });

        const actionsEl = headerEl.createDiv("sidenote2-comment-actions");

        commentEl.addEventListener("click", async (event: MouseEvent) => {
            const target = this.getEventTargetElement(event.target);
            const selection = window.getSelection();
            if (!shouldActivateSidebarComment({
                clickedInteractiveElement: !!target?.closest("button, a"),
                clickedInsideCommentContent: !!target?.closest(".sidenote2-comment-content"),
                selection,
                selectionInsideSidebarCommentContent: this.isSelectionInsideSidebarContent(selection),
            })) {
                return;
            }

            void this.openCommentInEditor(comment);
        });

        const contentWrapper = commentEl.createDiv({ cls: "sidenote2-comment-content" });
        contentWrapper.tabIndex = -1;
        await MarkdownRenderer.renderMarkdown(
            comment.comment || "",
            contentWrapper,
            comment.filePath,
            this.plugin
        );

        const focusContentWrapper = () => {
            this.claimSidebarInteractionOwnership(contentWrapper);
        };
        const stopContentPointerPropagation = (event: MouseEvent) => {
            focusContentWrapper();
            event.stopPropagation();
        };

        contentWrapper.addEventListener("mousedown", stopContentPointerPropagation);
        contentWrapper.addEventListener("mouseup", stopContentPointerPropagation);
        contentWrapper.addEventListener("dblclick", stopContentPointerPropagation);
        contentWrapper.addEventListener("click", (event: MouseEvent) => {
            const target = this.getEventTargetElement(event.target);
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
                    void this.openSidebarInternalLink(href, comment.filePath, contentWrapper);
                }
            }
        });

        const resolveButton = actionsEl.createEl("button", {
            cls: "sidenote2-comment-action-button sidenote2-comment-action-resolve",
        });
        resolveButton.setAttribute("type", "button");
        resolveButton.setAttribute(
            "aria-label",
            comment.resolved ? "Reopen side note" : "Resolve side note",
        );
        resolveButton.setAttribute(
            "title",
            comment.resolved ? "Reopen side note" : "Resolve side note",
        );
        setIcon(resolveButton, comment.resolved ? "rotate-ccw" : "check");
        resolveButton.onclick = (event) => {
            event.stopPropagation();
            if (comment.resolved) {
                void this.plugin.unresolveComment(comment.id);
            } else {
                void this.plugin.resolveComment(comment.id);
            }
        };

        const editButton = actionsEl.createEl("button", {
            cls: "sidenote2-comment-action-button sidenote2-comment-action-edit",
        });
        editButton.setAttribute("type", "button");
        editButton.setAttribute("aria-label", "Edit side note");
        editButton.setAttribute("title", "Edit side note");
        setIcon(editButton, "pencil");
        editButton.onclick = (event) => {
            event.stopPropagation();
            void this.plugin.startEditDraft(comment.id);
        };

        const deleteButton = actionsEl.createEl("button", {
            cls: "sidenote2-comment-action-button sidenote2-comment-action-delete",
        });
        deleteButton.setAttribute("type", "button");
        deleteButton.setAttribute("aria-label", "Delete side note");
        deleteButton.setAttribute("title", "Delete side note");
        setIcon(deleteButton, "trash-2");
        deleteButton.onclick = (event) => {
            event.stopPropagation();
            void this.deleteCommentWithConfirm(comment.id);
        };
    }

    private renderDraftComment(commentsContainer: HTMLDivElement, comment: DraftComment) {
        const commentEl = commentsContainer.createDiv("sidenote2-comment-item sidenote2-comment-draft");
        commentEl.setAttribute("data-draft-id", comment.id);
        commentEl.setAttribute("data-start-line", String(comment.startLine));

        if (isPageComment(comment)) {
            commentEl.addClass("page-note");
        }
        if (isOrphanedComment(comment)) {
            commentEl.addClass("orphaned");
        }
        if (comment.resolved) {
            commentEl.addClass("resolved");
        }
        if (this.activeCommentId === comment.id) {
            commentEl.addClass("active");
        }

        const headerEl = commentEl.createDiv("sidenote2-comment-header");
        headerEl.createEl("small", {
            text: formatSidebarCommentMeta(comment),
            cls: "sidenote2-timestamp",
        });

        const editorWrap = commentEl.createDiv("sidenote2-inline-editor");
        const textarea = editorWrap.createEl("textarea", {
            cls: "sidenote2-inline-textarea",
        });
        textarea.value = comment.comment;
        textarea.setAttribute("placeholder", "Write a side note. Type [[ for links or # for tags.");

        const actionRow = editorWrap.createDiv("sidenote2-inline-editor-actions");
        const cancelButton = actionRow.createEl("button", {
            text: "Cancel",
            cls: "sidenote2-inline-cancel-button",
        });
        const saveButton = actionRow.createEl("button", {
            text: comment.mode === "new" ? "Add" : "Save",
            cls: "mod-cta sidenote2-inline-save-button",
        });
        saveButton.setAttribute("title", "Save (Enter; Shift+Enter for newline)");

        const saving = this.plugin.isSavingDraft(comment.id);
        textarea.disabled = saving;
        cancelButton.disabled = saving;
        saveButton.disabled = saving;

        const stopPropagation = (event: Event) => {
            event.stopPropagation();
        };

        textarea.addEventListener("click", stopPropagation);
        textarea.addEventListener("input", (event) => {
            const target = event.target as HTMLTextAreaElement;
            this.plugin.updateDraftCommentText(comment.id, target.value);

            if (!(event instanceof InputEvent) || event.inputType !== "insertText" || !event.data) {
                return;
            }

            if (
                event.data === "["
                && target.selectionStart >= 2
                && target.value.slice(target.selectionStart - 2, target.selectionStart) === "[["
            ) {
                this.openDraftLinkSuggest(comment, target);
                return;
            }

            if (findOpenWikiLinkQuery(target.value, target.selectionStart, target.selectionEnd)) {
                return;
            }

            const tagQuery = findOpenTagQuery(
                target.value,
                target.selectionStart,
                target.selectionEnd,
            );
            if (!tagQuery) {
                return;
            }

            if (event.data === "#") {
                this.openDraftTagSuggest(comment, target);
                return;
            }
        });
        textarea.addEventListener("keydown", (event: KeyboardEvent) => {
            const consumeShortcut = () => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
            };

            if (this.shouldSaveDraftFromEnter(event)) {
                consumeShortcut();
                void this.plugin.saveDraft(comment.id);
                return;
            }

            event.stopPropagation();

            if (event.key === "Tab" && !event.shiftKey) {
                if (this.openDraftLinkSuggest(comment, textarea) || this.openDraftTagSuggest(comment, textarea)) {
                    consumeShortcut();
                    return;
                }
            }
            if (event.key === "Escape") {
                event.preventDefault();
                void this.plugin.cancelDraft(comment.id);
            }
        }, { capture: true });

        cancelButton.onclick = (event) => {
            stopPropagation(event);
            void this.plugin.cancelDraft(comment.id);
        };
        saveButton.onclick = (event) => {
            stopPropagation(event);
            void this.plugin.saveDraft(comment.id);
        };
    }

    private getSelectedSidebarText(): string | null {
        const selection = window.getSelection();
        if (!selection) {
            return null;
        }

        return getSelectedSidebarClipboardText({
            isCollapsed: selection.isCollapsed,
            selectedText: selection.toString(),
            anchorInsideSidebar: !!this.getSidebarOwner(selection.anchorNode),
            focusInsideSidebar: !!this.getSidebarOwner(selection.focusNode),
        });
    }

    private async openCommentInEditor(comment: Comment) {
        this.setActiveComment(comment.id);
        await this.plugin.revealComment(comment);
    }

    getState(): CustomViewState {
        return {
            filePath: this.file ? this.file.path : null,
        };
    }

    onunload() {
        document.removeEventListener("keydown", this.documentKeydownHandler, true);
        document.removeEventListener("copy", this.documentCopyHandler, true);
        document.removeEventListener("selectionchange", this.documentSelectionChangeHandler);
        this.containerEl.removeEventListener("click", this.sidebarClickHandler);
        if (this.pendingDraftFocusFrame !== null) {
            window.cancelAnimationFrame(this.pendingDraftFocusFrame);
            this.pendingDraftFocusFrame = null;
        }
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
