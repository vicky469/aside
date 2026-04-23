import { App, SuggestModal } from "obsidian";

export interface SideNoteOpenFileSuggestion {
    fileName: string;
    filePath: string;
    active: boolean;
    recent: boolean;
}

interface SideNoteOpenFileSuggestModalOptions {
    availableFiles: SideNoteOpenFileSuggestion[];
    onChooseFile: (suggestion: SideNoteOpenFileSuggestion) => void | Promise<void>;
    onCloseModal?: () => void;
}

function matchesOpenFileQuery(suggestion: SideNoteOpenFileSuggestion, query: string): boolean {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return true;
    }

    return suggestion.fileName.toLowerCase().includes(normalizedQuery)
        || suggestion.filePath.toLowerCase().includes(normalizedQuery);
}

function formatSuggestionNote(suggestion: SideNoteOpenFileSuggestion): string {
    const details = [
        suggestion.filePath,
        "append to end",
    ];
    if (suggestion.active) {
        details.push("active");
    }

    return details.join(" · ");
}

export default class SideNoteOpenFileSuggestModal extends SuggestModal<SideNoteOpenFileSuggestion> {
    private readonly availableFiles: SideNoteOpenFileSuggestion[];
    private readonly onChooseFile: (suggestion: SideNoteOpenFileSuggestion) => void | Promise<void>;
    private readonly onCloseModal?: () => void;

    constructor(app: App, options: SideNoteOpenFileSuggestModalOptions) {
        super(app);
        this.availableFiles = options.availableFiles;
        this.onChooseFile = options.onChooseFile;
        this.onCloseModal = options.onCloseModal;

        this.limit = 40;
        this.setPlaceholder("Search open files");
        this.emptyStateText = this.availableFiles.length
            ? "No open files match that query."
            : "Open a markdown file first.";
        this.setInstructions([
            { command: "↑↓", purpose: "move" },
            { command: "Enter", purpose: "choose" },
            { command: "Esc", purpose: "cancel" },
        ]);
    }

    onOpen(): void {
        void super.onOpen();
        this.setTitle("Choose open file");
    }

    onClose(): void {
        super.onClose();
        this.onCloseModal?.();
    }

    getSuggestions(query: string): SideNoteOpenFileSuggestion[] {
        this.emptyStateText = this.availableFiles.length
            ? "No open files match that query."
            : "Open a markdown file first.";
        return this.availableFiles
            .filter((suggestion) => matchesOpenFileQuery(suggestion, query))
            .slice(0, this.limit);
    }

    renderSuggestion(suggestion: SideNoteOpenFileSuggestion, el: HTMLElement): void {
        const titleEl = el.createDiv();
        const noteEl = el.createDiv({ cls: "sidenote2-link-suggest-note" });

        titleEl.setText(suggestion.fileName);
        noteEl.setText(formatSuggestionNote(suggestion));
    }

    onChooseSuggestion(suggestion: SideNoteOpenFileSuggestion): void {
        void this.onChooseFile(suggestion);
    }
}
