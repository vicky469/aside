import { App, SuggestModal } from "obsidian";
import { rankOpenFileSuggestions, type SearchableOpenFileSuggestion } from "./openFileSuggestSearch";

export interface SideNoteOpenFileSuggestion extends SearchableOpenFileSuggestion {
    active: boolean;
    recent: boolean;
}

interface SideNoteOpenFileSuggestModalOptions {
    availableFiles: SideNoteOpenFileSuggestion[];
    detailLabel?: string;
    emptyStateText?: string;
    onChooseFile: (suggestion: SideNoteOpenFileSuggestion) => void | Promise<void>;
    onCloseModal?: () => void;
    placeholder?: string;
    title?: string;
}

function formatSuggestionNote(suggestion: SideNoteOpenFileSuggestion, detailLabel: string): string {
    const details = [suggestion.filePath];
    if (detailLabel.trim().length > 0) {
        details.push(detailLabel);
    }
    if (suggestion.active) {
        details.push("active");
    }

    return details.join(" · ");
}

export default class SideNoteOpenFileSuggestModal extends SuggestModal<SideNoteOpenFileSuggestion> {
    private readonly availableFiles: SideNoteOpenFileSuggestion[];
    private readonly detailLabel: string;
    private readonly emptyStateTextOverride: string;
    private readonly onChooseFile: (suggestion: SideNoteOpenFileSuggestion) => void | Promise<void>;
    private readonly onCloseModal?: () => void;
    private readonly placeholder: string;
    private readonly title: string;

    constructor(app: App, options: SideNoteOpenFileSuggestModalOptions) {
        super(app);
        this.availableFiles = options.availableFiles;
        this.detailLabel = options.detailLabel ?? "append to end";
        this.emptyStateTextOverride = options.emptyStateText ?? "Open a markdown file first.";
        this.onChooseFile = options.onChooseFile;
        this.onCloseModal = options.onCloseModal;
        this.placeholder = options.placeholder ?? "Search open files";
        this.title = options.title ?? "Choose open file";

        this.limit = 40;
        this.setPlaceholder(this.placeholder);
        this.emptyStateText = this.availableFiles.length
            ? "No open files match that query."
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

    getSuggestions(query: string): SideNoteOpenFileSuggestion[] {
        this.emptyStateText = this.availableFiles.length
            ? "No open files match that query."
            : this.emptyStateTextOverride;
        return rankOpenFileSuggestions(this.availableFiles, query).slice(0, this.limit);
    }

    renderSuggestion(suggestion: SideNoteOpenFileSuggestion, el: HTMLElement): void {
        const titleEl = el.createDiv();
        const noteEl = el.createDiv({ cls: "sidenote2-link-suggest-note" });

        titleEl.setText(suggestion.fileName);
        noteEl.setText(formatSuggestionNote(suggestion, this.detailLabel));
    }

    onChooseSuggestion(suggestion: SideNoteOpenFileSuggestion): void {
        void this.onChooseFile(suggestion);
    }
}
