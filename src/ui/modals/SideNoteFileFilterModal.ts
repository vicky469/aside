import { App, SuggestModal, setIcon } from "obsidian";
import {
    getIndexFileFilterFileName,
    getIndexFileFilterSuggestions,
    normalizeIndexFileFilterPaths,
    getIndexFileFilterLabel,
    type IndexFileFilterOption,
} from "../views/indexFileFilter";
import { normalizeIndexFileFilterRootPath } from "../views/viewState";

interface SideNoteFileFilterModalOptions {
    availableOptions: IndexFileFilterOption[];
    selectedRootFilePath: string | null;
    selectedFilePaths: string[];
    onChooseRoot: (selectedRootFilePath: string | null) => void | Promise<void>;
    onCloseModal?: () => void;
}

function formatCommentCount(commentCount: number): string {
    return commentCount === 1 ? "1 side note" : `${commentCount} side notes`;
}

export default class SideNoteFileFilterModal extends SuggestModal<IndexFileFilterOption> {
    private readonly availableOptions: IndexFileFilterOption[];
    private readonly selectedRootFilePath: string | null;
    private selectedFilePaths: string[];
    private readonly onChooseRoot: (selectedRootFilePath: string | null) => void | Promise<void>;
    private readonly onCloseModal?: () => void;
    private summaryEl: HTMLElement | null = null;
    private applyingSelection = false;

    constructor(app: App, options: SideNoteFileFilterModalOptions) {
        super(app);
        this.availableOptions = options.availableOptions;
        this.selectedRootFilePath = normalizeIndexFileFilterRootPath(options.selectedRootFilePath);
        this.selectedFilePaths = normalizeIndexFileFilterPaths(options.selectedFilePaths);
        this.onChooseRoot = options.onChooseRoot;
        this.onCloseModal = options.onCloseModal;

        this.limit = 40;
        this.setPlaceholder("Search files");
        this.emptyStateText = this.availableOptions.length
            ? "Search to choose a file."
            : "No files with side notes yet.";
        this.setInstructions([
            { command: "↑↓", purpose: "move" },
            { command: "Enter", purpose: "select" },
            { command: "Esc", purpose: "close" },
        ]);
    }

    onOpen(): void {
        super.onOpen();
        this.setTitle("Choose file");
        this.renderSelectionSummary();
    }

    onClose(): void {
        super.onClose();
        this.summaryEl = null;
        this.onCloseModal?.();
    }

    getSuggestions(query: string): IndexFileFilterOption[] {
        if (!query.trim()) {
            this.emptyStateText = this.availableOptions.length
                ? "Search to choose a file."
                : "No files with side notes yet.";
            return [];
        }

        this.emptyStateText = this.availableOptions.length
            ? "No matching files with side notes."
            : "No files with side notes yet.";
        return getIndexFileFilterSuggestions(
            this.availableOptions,
            query,
            this.selectedRootFilePath ? [this.selectedRootFilePath] : [],
            this.limit,
        );
    }

    renderSuggestion(option: IndexFileFilterOption, el: HTMLElement): void {
        const isSelected = option.filePath === this.selectedRootFilePath;
        el.addClass("sidenote2-file-filter-suggestion");
        if (isSelected) {
            el.addClass("is-selected");
        }

        const contentEl = el.createDiv("sidenote2-file-filter-suggestion-main");
        contentEl.createDiv({
            text: getIndexFileFilterFileName(option.filePath),
            cls: "sidenote2-file-filter-suggestion-title",
        });
        contentEl.createDiv({
            text: `${option.filePath} · ${formatCommentCount(option.commentCount)}`,
            cls: "sidenote2-file-filter-note",
        });

        const statusEl = el.createSpan("sidenote2-file-filter-suggestion-status");
        if (isSelected) {
            setIcon(statusEl, "check");
        }
    }

    onChooseSuggestion(suggestion: IndexFileFilterOption): void {
        void this.chooseRoot(suggestion.filePath);
    }

    private renderSelectionSummary(): void {
        this.summaryEl?.remove();
        const anchorEl = this.inputEl.parentElement ?? this.inputEl;

        if (!this.selectedRootFilePath || !this.selectedFilePaths.length) {
            this.summaryEl = null;
            return;
        }

        this.summaryEl = this.contentEl.createDiv("sidenote2-file-filter-selection-summary");
        anchorEl.insertAdjacentElement("afterend", this.summaryEl);
        this.summaryEl.createEl("p", {
            text: `${this.selectedFilePaths.length} file${this.selectedFilePaths.length === 1 ? "" : "s"} selected`,
            cls: "sidenote2-file-filter-selection-note",
        });

        const chipsEl = this.summaryEl.createDiv("sidenote2-file-filter-selection-chips");
        for (const filePath of this.selectedFilePaths) {
            const chipEl = chipsEl.createSpan("sidenote2-file-filter-selection-chip");
            if (filePath === this.selectedRootFilePath) {
                chipEl.addClass("is-root");
            }
            chipEl.setText(getIndexFileFilterLabel(filePath, this.selectedFilePaths));
        }
    }

    private async chooseRoot(filePath: string | null): Promise<void> {
        if (this.applyingSelection) {
            return;
        }

        this.applyingSelection = true;
        try {
            await this.onChooseRoot(filePath);
            this.close();
        } finally {
            this.applyingSelection = false;
        }
    }
}
