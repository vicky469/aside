import { App, SuggestModal } from "obsidian";
import type { CommentThread } from "../../commentManager";
import { rankThreadsBySidebarSearchQuery } from "../views/sidebarContentFilter";

interface SideNoteThreadSuggestModalOptions {
    availableThreads: CommentThread[];
    emptyStateText?: string;
    onChooseThread: (thread: CommentThread) => void | Promise<void>;
    onCloseModal?: () => void;
    placeholder?: string;
    title?: string;
}

function normalizeSuggestionText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function truncateSuggestionText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function getFallbackThreadLabel(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
    return fileName.replace(/\.md$/i, "") || "Page note";
}

function getThreadLabel(thread: Pick<CommentThread, "anchorKind" | "filePath" | "isBookmark" | "selectedText">): string {
    if (typeof thread.selectedText === "string" && (thread.isBookmark === true || thread.anchorKind === "selection")) {
        const normalized = normalizeSuggestionText(thread.selectedText);
        if (normalized.length > 0) {
            return truncateSuggestionText(normalized, 100);
        }
    }

    return getFallbackThreadLabel(thread.filePath);
}

function getThreadBodyPreview(thread: Pick<CommentThread, "entries">): string {
    const normalized = normalizeSuggestionText(thread.entries[0]?.body ?? "");
    if (normalized.length === 0) {
        return "Page note";
    }

    return truncateSuggestionText(normalized, 140);
}

export default class SideNoteThreadSuggestModal extends SuggestModal<CommentThread> {
    private readonly availableThreads: CommentThread[];
    private readonly emptyStateTextOverride: string;
    private readonly onChooseThread: (thread: CommentThread) => void | Promise<void>;
    private readonly onCloseModal?: () => void;
    private readonly placeholder: string;
    private readonly title: string;

    constructor(app: App, options: SideNoteThreadSuggestModalOptions) {
        super(app);
        this.availableThreads = options.availableThreads;
        this.emptyStateTextOverride = options.emptyStateText ?? "No parent side notes are available in this file.";
        this.onChooseThread = options.onChooseThread;
        this.onCloseModal = options.onCloseModal;
        this.placeholder = options.placeholder ?? "Find a parent side note";
        this.title = options.title ?? "Move nested side note";

        this.limit = 40;
        this.setPlaceholder(this.placeholder);
        this.emptyStateText = this.availableThreads.length
            ? "No parent side notes match that query."
            : this.emptyStateTextOverride;
        this.setInstructions([
            { command: "↑↓", purpose: "move" },
            { command: "Enter", purpose: "choose" },
            { command: "Esc", purpose: "cancel" },
        ]);
    }

    onOpen(): void {
        void super.onOpen();
        this.setTitle(this.title);
    }

    onClose(): void {
        super.onClose();
        this.onCloseModal?.();
    }

    getSuggestions(query: string): CommentThread[] {
        this.emptyStateText = this.availableThreads.length
            ? "No parent side notes match that query."
            : this.emptyStateTextOverride;
        return rankThreadsBySidebarSearchQuery(this.availableThreads, query).slice(0, this.limit);
    }

    renderSuggestion(thread: CommentThread, el: HTMLElement): void {
        const titleEl = el.createDiv();
        const noteEl = el.createDiv({ cls: "sidenote2-link-suggest-note" });

        titleEl.setText(getThreadLabel(thread));
        noteEl.setText(getThreadBodyPreview(thread));
    }

    onChooseSuggestion(thread: CommentThread): void {
        void this.onChooseThread(thread);
    }
}
