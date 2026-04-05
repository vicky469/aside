import type { App, TFile, WorkspaceLeaf } from "obsidian";
import type { Comment } from "../../commentManager";
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

export interface SidebarInteractionHost {
    app: App;
    leaf: WorkspaceLeaf;
    containerEl: HTMLElement;
    getCurrentFile(): TFile | null;
    getDraftForView(filePath: string): DraftComment | null;
    renderComments(): Promise<void>;
    saveDraft(commentId: string): void;
    cancelDraft(commentId: string): void;
    clearRevealedCommentSelection(): void;
    revealComment(comment: Comment): Promise<void>;
    getPreferredFileLeaf(): WorkspaceLeaf | null;
    openLinkText(href: string, sourcePath: string): Promise<void>;
}

export class SidebarInteractionController {
    private activeCommentId: string | null = null;
    private pendingDraftFocusFrame: number | null = null;

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

        if (!activeElement.matches(".sidenote2-inline-textarea") || !this.host.containerEl.contains(activeElement)) {
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
        const file = this.host.getCurrentFile();
        if (!file) {
            return;
        }

        const target = event.target as Node | null;
        const clickedComment = target instanceof HTMLElement
            ? target.closest(".sidenote2-comment-item")
            : null;
        const clickedSectionChrome = target instanceof HTMLElement
            ? target.closest(".sidenote2-comments-list-actions, .sidenote2-sidebar-toolbar, .sidenote2-active-file-filters")
            : null;

        const draft = this.host.getDraftForView(file.path);
        if (draft && draft.mode === "edit") {
            const draftEl = this.host.containerEl.querySelector(`[data-draft-id="${draft.id}"]`);
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

            this.host.cancelDraft(draft.id);
            return;
        }

        if (!clickedComment && !clickedSectionChrome) {
            this.clearActiveState();
            this.host.clearRevealedCommentSelection();
        }
    };

    public getActiveCommentId(): string | null {
        return this.activeCommentId;
    }

    public highlightComment(commentId: string): void {
        this.activeCommentId = commentId;
        void this.host.renderComments().then(() => {
            const commentEl = this.host.containerEl.querySelector(`[data-comment-id="${commentId}"], [data-draft-id="${commentId}"]`);
            if (commentEl) {
                commentEl.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        });
    }

    public async highlightAndFocusDraft(commentId: string): Promise<void> {
        this.activeCommentId = commentId;

        const draftEl = this.host.containerEl.querySelector(`[data-draft-id="${commentId}"]`);
        const persistedEl = this.host.containerEl.querySelector(`[data-comment-id="${commentId}"]`);

        if (draftEl || !persistedEl) {
            await this.host.renderComments();
        } else {
            this.host.containerEl.querySelectorAll(".sidenote2-comment-item.active").forEach((el) => {
                el.removeClass("active");
            });
            persistedEl.addClass("active");
        }

        const commentEl = draftEl || this.host.containerEl.querySelector(`[data-comment-id="${commentId}"], [data-draft-id="${commentId}"]`);
        if (commentEl) {
            commentEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        this.scheduleDraftFocus(commentId);
    }

    public async focusDraft(commentId: string): Promise<void> {
        const commentEl = this.host.containerEl.querySelector(`[data-draft-id="${commentId}"]`);
        if (commentEl) {
            commentEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        this.scheduleDraftFocus(commentId);
    }

    public clearActiveState(): void {
        this.activeCommentId = null;
        this.host.containerEl.querySelectorAll(".sidenote2-comment-item.active").forEach((el) => {
            el.removeClass("active");
        });
    }

    public claimSidebarInteractionOwnership(focusTarget?: HTMLElement | null): void {
        if (this.host.app.workspace.activeLeaf !== this.host.leaf) {
            this.host.app.workspace.setActiveLeaf(this.host.leaf, { focus: false });
        }

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
        const targetLeaf = this.host.getPreferredFileLeaf();
        if (targetLeaf) {
            this.host.app.workspace.setActiveLeaf(targetLeaf, { focus: false });
        }

        await this.host.openLinkText(href, sourcePath);
        this.claimSidebarInteractionOwnership(focusTarget);
    }

    public async openCommentInEditor(comment: Comment): Promise<void> {
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

        const tryFocus = (remainingAttempts: number) => {
            const textarea = this.host.containerEl.querySelector(
                `[data-draft-id="${commentId}"] textarea`
            ) as HTMLTextAreaElement | null;

            if (textarea) {
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

        this.pendingDraftFocusFrame = window.requestAnimationFrame(() => {
            tryFocus(attempts);
        });
    }

    private setActiveComment(commentId: string): void {
        this.activeCommentId = commentId;
        this.host.containerEl.querySelectorAll(".sidenote2-comment-item.active").forEach((el) => {
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
        const owner = element?.closest(".sidenote2-comment-content");
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
