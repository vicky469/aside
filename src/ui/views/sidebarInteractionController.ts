import type { App, TFile, WorkspaceLeaf } from "obsidian";
import type { Comment } from "../../commentManager";
import {
    isLocalSideNoteReferenceTarget,
    parseSideNoteReferenceUrl,
} from "../../core/text/commentReferences";
import type { DraftComment } from "../../domain/drafts";
import { copyTextToClipboard } from "../copyTextToClipboard";
import { decideEditDismissal } from "./editDismissal";
import { getSelectedSidebarClipboardText } from "./sidebarClipboardSelection";

function isModShortcut(event: KeyboardEvent, code: string, key?: string): boolean {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return false;
    }

    if (event.code === code) {
        return true;
    }

    return !!key && event.key.toLowerCase() === key.toLowerCase();
}

function isDraftTextareaElement(element: Element | null): element is HTMLTextAreaElement {
    return !!element
        && typeof (element as HTMLTextAreaElement).value === "string"
        && typeof (element as HTMLTextAreaElement).selectionStart === "number"
        && typeof (element as HTMLTextAreaElement).selectionEnd === "number"
        && typeof (element as HTMLElement).matches === "function"
        && typeof (element as HTMLElement).closest === "function"
        && typeof (element as HTMLTextAreaElement).setSelectionRange === "function"
        && typeof (element as HTMLTextAreaElement).dispatchEvent === "function";
}

function isFocusableTextareaElement(element: Element | null): element is HTMLTextAreaElement {
    return !!element
        && typeof (element as HTMLTextAreaElement).value === "string"
        && typeof (element as HTMLTextAreaElement).focus === "function"
        && typeof (element as HTMLTextAreaElement).setSelectionRange === "function";
}

export interface SidebarInteractionHost {
    app: App;
    leaf: WorkspaceLeaf;
    containerEl: HTMLElement;
    getCurrentFile(): TFile | null;
    getDraftForView(filePath: string): DraftComment | null;
    renderComments(options?: { skipDataRefresh?: boolean }): Promise<void>;
    saveDraft(commentId: string): Promise<void> | void;
    cancelDraft(commentId: string): void;
    clearRevealedCommentSelection(): void;
    revealComment(comment: Comment): Promise<void>;
    openCommentById?(filePath: string | null, commentId: string): Promise<void>;
    getPreferredFileLeaf(): WorkspaceLeaf | null;
    openLinkText(href: string, sourcePath: string): Promise<void>;
    shouldShowDeletedComments?(): boolean;
    setShowDeletedComments?(showDeleted: boolean): Promise<void> | void;
    log?(level: "info" | "warn" | "error", area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
}

export class SidebarInteractionController {
    private activeCommentId: string | null = null;
    private pendingDraftFocusFrame: number | null = null;
    private pendingRevealedCommentClearFrame: number | null = null;

    constructor(private readonly host: SidebarInteractionHost) {}

    public readonly documentSelectionChangeHandler = () => {
        if (this.isSelectionInsideSidebarContent()) {
            this.claimSidebarInteractionOwnership();
        }
    };

    public readonly documentKeydownHandler = (event: KeyboardEvent) => {
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
        if (!isDraftTextareaElement(activeElement)) {
            return;
        }

        if (!activeElement.matches(".aside-inline-textarea") || !this.host.containerEl.contains(activeElement)) {
            return;
        }

        const draftEl = activeElement.closest("[data-draft-id]");
        if (!draftEl?.getAttribute("data-draft-id")) {
            return;
        }
    };

    public readonly documentCopyHandler = (event: ClipboardEvent) => {
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

    public readonly sidebarClickHandler = (event: MouseEvent) => {
        void this.handleSidebarClick(event);
    };

    public readonly documentMouseDownHandler = (event: MouseEvent) => {
        if (event.button !== 0) {
            return;
        }

        const target = event.target as Node | null;
        if (!target || this.host.containerEl.contains(target) || this.isDraftDismissalExemptTarget(target)) {
            return;
        }

        void this.handleDraftDismissal(target, {
            clickedComment: false,
            clickedSectionChrome: false,
            deferRevealedCommentSelectionClear: true,
        });
    };

    private async handleSidebarClick(event: MouseEvent): Promise<void> {
        this.cancelPendingRevealedCommentSelectionClear();
        const target = event.target as Node | null;
        const clickedComment = target instanceof HTMLElement
            ? target.closest(".aside-comment-item")
            : null;
        const clickedSectionChrome = target instanceof HTMLElement
            ? target.closest(".aside-comments-list-actions, .aside-sidebar-toolbar, .aside-active-file-filters")
            : null;
        await this.handleDraftDismissal(target, {
            clickedComment: !!clickedComment,
            clickedSectionChrome: !!clickedSectionChrome,
        });
    }

    private isDraftDismissalExemptTarget(target: Node | null): boolean {
        const targetEl = this.getEventTargetElement(target);
        if (!targetEl) {
            return false;
        }

        return !!targetEl.closest(".suggestion-container, .modal-container, .prompt, .menu");
    }

    private async handleDraftDismissal(
        target: Node | null,
        options: {
            clickedComment: boolean;
            clickedSectionChrome: boolean;
            deferRevealedCommentSelectionClear?: boolean;
        },
    ): Promise<void> {
        const file = this.host.getCurrentFile();
        if (!file) {
            return;
        }

        const draft = this.host.getDraftForView(file.path);
        if (draft) {
            const draftEl = this.host.containerEl.querySelector(`[data-draft-id="${draft.id}"]`);
            if (!draftEl) {
                return;
            }

            const decision = decideEditDismissal(
                !!(target && draftEl.contains(target)),
                options.clickedComment,
                options.clickedSectionChrome,
            );
            if (!decision.shouldSaveDraft) {
                return;
            }

            await this.host.saveDraft(draft.id);

            const remainingDraft = this.host.getDraftForView(file.path);
            if (remainingDraft?.id === draft.id) {
                return;
            }

            if (decision.shouldClearActiveState) {
                this.clearActiveState();
            }

            if (decision.shouldClearRevealedCommentSelection) {
                this.clearRevealedCommentSelection({
                    defer: options.deferRevealedCommentSelectionClear,
                });
            }
            return;
        }

        if (!options.clickedComment && !options.clickedSectionChrome) {
            this.clearActiveState();
            this.clearRevealedCommentSelection({
                defer: options.deferRevealedCommentSelectionClear,
            });
        }
    }

    private clearRevealedCommentSelection(options: {
        defer?: boolean;
    } = {}): void {
        if (options.defer) {
            this.scheduleRevealedCommentSelectionClear();
            return;
        }

        this.cancelPendingRevealedCommentSelectionClear();
        this.host.clearRevealedCommentSelection();
    }

    private scheduleRevealedCommentSelectionClear(): void {
        const win = globalThis.window;
        if (!win || typeof win.requestAnimationFrame !== "function") {
            this.cancelPendingRevealedCommentSelectionClear();
            this.host.clearRevealedCommentSelection();
            return;
        }

        this.cancelPendingRevealedCommentSelectionClear();
        this.pendingRevealedCommentClearFrame = win.requestAnimationFrame(() => {
            this.pendingRevealedCommentClearFrame = null;
            this.host.clearRevealedCommentSelection();
        });
    }

    public cancelPendingRevealedCommentSelectionClear(): void {
        if (this.pendingRevealedCommentClearFrame === null) {
            return;
        }

        const win = globalThis.window;
        if (win && typeof win.cancelAnimationFrame === "function") {
            win.cancelAnimationFrame(this.pendingRevealedCommentClearFrame);
        }
        this.pendingRevealedCommentClearFrame = null;
    }

    public getActiveCommentId(): string | null {
        return this.activeCommentId;
    }

    public highlightComment(commentId: string, options: { skipDataRefresh?: boolean } = {}): void {
        this.activeCommentId = commentId;
        void this.host.renderComments(options).then(() => {
            const commentEl = this.host.containerEl.querySelector(`[data-comment-id="${commentId}"], [data-draft-id="${commentId}"]`);
            if (commentEl) {
                commentEl.scrollIntoView({ behavior: "smooth", block: "center" });
                void this.host.log?.("info", "sidebar", "sidebar.draft.scrollIntoView", {
                    commentId,
                });
            }
        });
    }

    public async highlightAndFocusDraft(commentId: string): Promise<void> {
        void this.host.log?.("info", "sidebar", "sidebar.focus.requested", {
            commentId,
        });

        const currentFile = this.host.getCurrentFile();
        const visibleDraft = currentFile ? this.host.getDraftForView(currentFile.path) : null;
        if (visibleDraft?.id === commentId) {
            this.clearActiveState();
            const existingTextarea = this.host.containerEl.querySelector(`[data-draft-id="${commentId}"] textarea`);
            if (!existingTextarea) {
                await this.host.renderComments({
                    skipDataRefresh: true,
                });
            }

            const draftEl = this.host.containerEl.querySelector(`[data-draft-id="${commentId}"]`);
            if (draftEl) {
                draftEl.scrollIntoView({ behavior: "auto", block: "nearest" });
                void this.host.log?.("info", "sidebar", "sidebar.draft.scrollIntoView", {
                    commentId,
                });
            }
            this.scheduleDraftFocus(commentId);
            return;
        }

        this.activeCommentId = commentId;
        const draftEl = this.host.containerEl.querySelector(`[data-draft-id="${commentId}"]`);
        const persistedEl = this.host.containerEl.querySelector(`[data-comment-id="${commentId}"]`);
        let commentEl: Element | null = null;

        if (draftEl || !persistedEl) {
            await this.host.renderComments({
                skipDataRefresh: true,
            });
            commentEl = this.host.containerEl.querySelector(`[data-comment-id="${commentId}"], [data-draft-id="${commentId}"]`);
        } else {
            this.host.containerEl.querySelectorAll(".aside-comment-item.active").forEach((el) => {
                el.removeClass("active");
            });
            persistedEl.addClass("active");
            commentEl = persistedEl;
        }

        if (commentEl) {
            commentEl.scrollIntoView({ behavior: "smooth", block: "center" });
            void this.host.log?.("info", "sidebar", "sidebar.draft.scrollIntoView", {
                commentId,
            });
        }
        this.scheduleDraftFocus(commentId);
    }

    public focusDraft(commentId: string): void {
        const commentEl = this.host.containerEl.querySelector(`[data-draft-id="${commentId}"]`);
        if (commentEl) {
            commentEl.scrollIntoView({ behavior: "smooth", block: "center" });
            void this.host.log?.("info", "sidebar", "sidebar.draft.scrollIntoView", {
                commentId,
            });
        }
        void this.host.log?.("info", "sidebar", "sidebar.focus.requested", {
            commentId,
        });
        this.scheduleDraftFocus(commentId);
    }

    public clearActiveState(): void {
        this.activeCommentId = null;
        this.host.containerEl.querySelectorAll(".aside-comment-item.active").forEach((el) => {
            el.removeClass("active");
        });
    }

    public claimSidebarInteractionOwnership(focusTarget?: HTMLElement | null): void {
        this.host.app.workspace.setActiveLeaf(this.host.leaf, { focus: false });

        if (focusTarget?.isConnected && document.activeElement !== focusTarget) {
            focusTarget.focus({ preventScroll: true });
        }
    }

    public getEventTargetElement(target: EventTarget | null): HTMLElement | null {
        if (target instanceof HTMLElement) {
            return target;
        }

        return target instanceof Node ? target.parentElement : null;
    }

    public isSelectionInsideSidebarContent(selection: Selection | null = window.getSelection()): boolean {
        if (!selection) {
            return false;
        }

        return !!this.getSidebarOwner(selection.anchorNode) || !!this.getSidebarOwner(selection.focusNode);
    }

    public async openSidebarInternalLink(
        href: string,
        sourcePath: string,
        focusTarget: HTMLElement,
    ): Promise<void> {
        this.cancelPendingRevealedCommentSelectionClear();
        const sideNoteTarget = parseSideNoteReferenceUrl(href);
        const localVaultName = this.host.app.vault?.getName?.() ?? null;
        if (
            sideNoteTarget
            && this.host.openCommentById
            && isLocalSideNoteReferenceTarget(sideNoteTarget, localVaultName)
        ) {
            await this.host.openCommentById(sideNoteTarget.filePath, sideNoteTarget.commentId);
            this.claimSidebarInteractionOwnership(focusTarget);
            return;
        }

        const targetLeaf = this.host.getPreferredFileLeaf();
        if (targetLeaf) {
            this.host.app.workspace.setActiveLeaf(targetLeaf, { focus: false });
        }

        await this.host.openLinkText(href, sourcePath);
        this.claimSidebarInteractionOwnership(focusTarget);
    }

    public async openCommentInEditor(comment: Comment): Promise<void> {
        this.cancelPendingRevealedCommentSelectionClear();
        this.setActiveComment(comment.id);
        await this.host.revealComment(comment);
    }

    public clearPendingFocus(): void {
        if (this.pendingDraftFocusFrame !== null) {
            window.cancelAnimationFrame(this.pendingDraftFocusFrame);
            this.pendingDraftFocusFrame = null;
        }
    }

    public scheduleDraftFocus(commentId: string, attempts = 6): void {
        this.clearPendingFocus();

        const tryFocus = (remainingAttempts: number): void => {
            const textarea = this.host.containerEl.querySelector(
                `[data-draft-id="${commentId}"] textarea`
            );

            if (isFocusableTextareaElement(textarea)) {
                this.claimSidebarInteractionOwnership(textarea);
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

        tryFocus(attempts);
    }

    public setActiveComment(commentId: string): void {
        this.activeCommentId = commentId;
        this.host.containerEl.querySelectorAll(".aside-comment-item.active").forEach((el) => {
            if (
                el.getAttribute("data-comment-id") !== commentId &&
                el.getAttribute("data-draft-id") !== commentId
            ) {
                el.removeClass("active");
            }
        });

        const commentEl = this.host.containerEl.querySelector(`[data-comment-id="${commentId}"], [data-draft-id="${commentId}"]`);
        if (commentEl) {
            commentEl.addClass("active");
        }
    }

    private getSidebarOwner(node: Node | null): HTMLElement | null {
        if (!node) {
            return null;
        }

        const element = node instanceof HTMLElement ? node : node.parentElement;
        const owner = element?.closest(".aside-comment-content");
        return owner instanceof HTMLElement && this.host.containerEl.contains(owner) ? owner : null;
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
}
