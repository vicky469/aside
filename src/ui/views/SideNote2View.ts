import { ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf, setIcon, type ViewStateResult } from "obsidian";
import type { Comment } from "../../commentManager";
import { extractTagsFromText } from "../../core/commentTags";
import type { DraftComment } from "../../domain/drafts";
import { sortCommentsByPosition } from "../../core/noteCommentStorage";
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
import type { CustomViewState } from "./viewState";

function formatCommentTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
    });
}

function formatCommentMeta(comment: Comment): string {
    const segments = [formatCommentTimestamp(comment.timestamp)];
    if (comment.resolved) {
        segments.push("resolved");
    }
    return segments.join(" · ");
}

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

    return sortCommentsByPosition(mergedComments) as Array<Comment | DraftComment>;
}

export default class SideNote2View extends ItemView {
    private file: TFile | null = null;
    private plugin: SideNote2;
    private activeCommentId: string | null = null;
    private renderVersion = 0;
    private pendingDraftFocusFrame: number | null = null;
    private activeInlineSuggest: "link" | "tag" | null = null;
    private readonly documentKeydownHandler = (event: KeyboardEvent) => {
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

        const consumeShortcut = () => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        };

        if (isModShortcut(event, "Enter")) {
            consumeShortcut();
            void this.plugin.saveDraft(draftId);
        }
    };
    private readonly sidebarClickHandler = (event: MouseEvent) => {
        const file = this.file;
        if (!file) {
            return;
        }

        const draft = this.plugin.getDraftForFile(file.path);
        if (!draft || draft.mode !== "edit") {
            return;
        }

        const draftEl = this.containerEl.querySelector(`[data-draft-id="${draft.id}"]`);
        if (!draftEl) {
            return;
        }

        const target = event.target as Node | null;
        const clickedComment = target instanceof HTMLElement
            ? target.closest(".sidenote2-comment-item")
            : null;
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
            this.file = this.plugin.getPinnedMarkdownFile();
        }
        await this.renderComments();
        document.addEventListener("keydown", this.documentKeydownHandler, true);
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

        this.containerEl.empty();
        this.containerEl.addClass("sidenote2-view-container");
        if (file) {
            await this.plugin.loadCommentsForFile(file);
            if (renderVersion !== this.renderVersion || this.file?.path !== file.path) {
                return;
            }

            this.containerEl.empty();
            this.containerEl.addClass("sidenote2-view-container");
            const persistedComments = this.plugin.commentManager.getCommentsForFile(file.path);
            const draftComment = this.plugin.getDraftForFile(file.path);
            const resolvedCount = persistedComments.filter((comment) => comment.resolved).length;
            const hasResolvedComments = resolvedCount > 0;
            const showResolved = this.plugin.shouldShowResolvedComments();
            const commentsForFile = getSidebarComments(persistedComments, draftComment, showResolved);
            const commentsContainer = this.containerEl.createDiv("sidenote2-comments-container");

            if (hasResolvedComments) {
                this.renderSidebarToolbar(commentsContainer, resolvedCount);
            }

            if (commentsForFile.length > 0) {
                const renderPromises = commentsForFile.map(async (comment) => {
                    if (isDraftComment(comment)) {
                        this.renderDraftComment(commentsContainer, comment);
                        return;
                    }

                    await this.renderPersistedComment(commentsContainer, comment);
                });
                await Promise.all(renderPromises);
            } else {
                const emptyStateEl = commentsContainer.createDiv("sidenote2-empty-state");
                if (hasResolvedComments && !showResolved) {
                    emptyStateEl.createEl("p", { text: "No active comments for this file." });
                    emptyStateEl.createEl("p", { text: "Turn on Show resolved to review archived comments." });
                    return;
                }
                emptyStateEl.createEl("p", { text: "No comments for this file yet." });
                emptyStateEl.createEl("p", { text: "Select text and use the add comment command to start a side comment in the sidebar." });
            }
        } else {
            const emptyStateEl = this.containerEl.createDiv("sidenote2-empty-state");
            emptyStateEl.createEl("p", { text: "No file selected." });
            emptyStateEl.createEl("p", { text: "Open a file to see its comments." });
        }
    }

    private renderSidebarToolbar(container: HTMLElement, resolvedCount: number) {
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

    private async renderPersistedComment(commentsContainer: HTMLDivElement, comment: Comment) {
        const commentEl = commentsContainer.createDiv("sidenote2-comment-item");
        commentEl.setAttribute("data-comment-id", comment.id);
        commentEl.setAttribute("data-start-line", String(comment.startLine));

        if (comment.resolved) {
            commentEl.addClass("resolved");
        }
        if (this.activeCommentId === comment.id) {
            commentEl.addClass("active");
        }

        const headerEl = commentEl.createDiv("sidenote2-comment-header");
        headerEl.createEl("small", {
            text: formatCommentMeta(comment),
            cls: "sidenote2-timestamp",
        });

        const actionsEl = headerEl.createDiv("sidenote2-comment-actions");

        commentEl.onclick = async () => {
            await this.openCommentInEditor(comment);
        };
        commentEl.addEventListener("dblclick", async (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest("button, a")) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            await this.plugin.startEditDraft(comment.id);
        });

        const contentWrapper = commentEl.createDiv({ cls: "sidenote2-comment-content" });
        await MarkdownRenderer.renderMarkdown(
            comment.comment || "",
            contentWrapper,
            comment.filePath,
            this.plugin
        );

        contentWrapper.addEventListener("click", (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            const link = target?.closest("a.internal-link") as HTMLElement | null;
            if (!link) return;

            event.preventDefault();
            event.stopPropagation();

            const href = link.getAttribute("href") || link.getAttribute("data-href") || link.innerText;
            if (href) {
                this.app.workspace.openLinkText(href, comment.filePath, false);
            }
        });

        const menuButton = actionsEl.createEl("button", {
            cls: "sidenote2-menu-button",
        });
        setIcon(menuButton, "more-horizontal");
        menuButton.setAttribute("aria-label", "Comment actions");
        menuButton.setAttribute("aria-expanded", "false");
        const menuContainer = actionsEl.createDiv("sidenote2-action-menu");
        menuContainer.setAttribute("role", "menu");

        const createMenuOption = (
            label: string,
            icon: string,
            extraClass: string,
            onClick: (event: MouseEvent) => void
        ) => {
            const option = menuContainer.createEl("button", {
                cls: `sidenote2-menu-option ${extraClass}`,
            });
            option.setAttribute("type", "button");
            option.setAttribute("role", "menuitem");
            option.setAttribute("data-shortcut-key", label.charAt(0).toLowerCase());

            const iconEl = option.createSpan("sidenote2-menu-option-icon");
            setIcon(iconEl, icon);
            const labelEl = option.createSpan("sidenote2-menu-option-label");
            labelEl.createSpan({
                text: label.charAt(0),
                cls: "sidenote2-menu-option-shortcut",
            });
            labelEl.appendText(label.slice(1));
            option.onclick = onClick;
            return option;
        };

        createMenuOption("Edit", "pencil", "sidenote2-menu-edit", (e) => {
            e.stopPropagation();
            menuContainer.classList.remove("visible");
            void this.plugin.startEditDraft(comment.id);
        });

        createMenuOption("Copy", "copy", "sidenote2-menu-copy", (e) => {
            e.stopPropagation();
            menuContainer.classList.remove("visible");
            void this.copyCommentBody(comment);
        });

        createMenuOption(
            comment.resolved ? "Reopen" : "Resolve",
            comment.resolved ? "rotate-ccw" : "check",
            "sidenote2-menu-option-accent sidenote2-menu-resolve",
            (e) => {
                e.stopPropagation();
                menuContainer.classList.remove("visible");
                if (comment.resolved) {
                    void this.plugin.unresolveComment(comment.id);
                } else {
                    void this.plugin.resolveComment(comment.id);
                }
            }
        );

        createMenuOption("Delete", "trash-2", "sidenote2-menu-option-danger sidenote2-menu-delete", (e) => {
            e.stopPropagation();
            menuContainer.classList.remove("visible");
            void this.deleteCommentFromMenu(comment.id);
        });

        const handleMenuKeydown = (event: KeyboardEvent) => {
            if (!menuContainer.classList.contains("visible")) {
                return;
            }
            if (event.metaKey || event.ctrlKey || event.altKey) {
                return;
            }

            if (event.key === "Escape") {
                event.preventDefault();
                menuContainer.classList.remove("visible");
                menuButton.setAttribute("aria-expanded", "false");
                document.removeEventListener("click", closeMenu);
                document.removeEventListener("keydown", handleMenuKeydown);
                return;
            }

            const shortcutKey = event.key.toLowerCase();
            const shortcutOption = menuContainer.querySelector(
                `[data-shortcut-key="${shortcutKey}"]`
            ) as HTMLButtonElement | null;
            if (!shortcutOption) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            shortcutOption.click();
        };

        const closeMenu = (event?: MouseEvent) => {
            if (event) {
                const target = event.target as Node | null;
                if (target && (menuContainer.contains(target) || menuButton.contains(target))) {
                    return;
                }
            }
            menuContainer.classList.remove("visible");
            menuButton.setAttribute("aria-expanded", "false");
            document.removeEventListener("click", closeMenu);
            document.removeEventListener("keydown", handleMenuKeydown);
        };

        menuButton.onclick = (e) => {
            e.stopPropagation();
            const nextVisible = !menuContainer.classList.contains("visible");
            commentsContainer.querySelectorAll(".sidenote2-action-menu.visible").forEach((menuEl) => {
                menuEl.classList.remove("visible");
            });
            menuContainer.classList.toggle("visible", nextVisible);
            menuButton.setAttribute("aria-expanded", nextVisible ? "true" : "false");
            document.removeEventListener("click", closeMenu);
            document.removeEventListener("keydown", handleMenuKeydown);
            if (nextVisible) {
                window.setTimeout(() => {
                    document.addEventListener("click", closeMenu);
                    document.addEventListener("keydown", handleMenuKeydown);
                }, 0);
            }
        };
    }

    private renderDraftComment(commentsContainer: HTMLDivElement, comment: DraftComment) {
        const commentEl = commentsContainer.createDiv("sidenote2-comment-item sidenote2-comment-draft");
        commentEl.setAttribute("data-draft-id", comment.id);
        commentEl.setAttribute("data-start-line", String(comment.startLine));

        if (comment.resolved) {
            commentEl.addClass("resolved");
        }
        if (this.activeCommentId === comment.id) {
            commentEl.addClass("active");
        }

        const headerEl = commentEl.createDiv("sidenote2-comment-header");
        headerEl.createEl("small", {
            text: formatCommentMeta(comment),
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
        saveButton.setAttribute("title", "Save (Cmd/Ctrl+Enter)");

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

            if (isModShortcut(event, "Enter")) {
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

    private async openCommentInEditor(comment: Comment) {
        await this.plugin.revealComment(comment);
    }

    private async copyCommentBody(comment: Comment) {
        const copied = await copyTextToClipboard(comment.comment ?? "");
        new Notice(copied ? "Side note copied." : "Unable to copy side note.");
    }

    getState(): CustomViewState {
        return {
            filePath: this.file ? this.file.path : null,
        };
    }

    onunload() {
        document.removeEventListener("keydown", this.documentKeydownHandler, true);
        this.containerEl.removeEventListener("click", this.sidebarClickHandler);
        if (this.pendingDraftFocusFrame !== null) {
            window.cancelAnimationFrame(this.pendingDraftFocusFrame);
            this.pendingDraftFocusFrame = null;
        }
    }

    private async deleteCommentFromMenu(commentId: string) {
        if (await this.plugin.shouldConfirmDelete()) {
            new ConfirmDeleteModal(this.app, () => {
                void this.plugin.deleteComment(commentId);
            }).open();
            return;
        }

        await this.plugin.deleteComment(commentId);
    }
}
