import {
    type App,
    Notice,
    SuggestModal,
} from "obsidian";
import {
    createSideNoteLinkNote,
    getSideNoteLinkSuggestions,
    type SideNoteLinkSuggestion,
} from "../editor/commentLinkSuggestions";

interface SideNoteLinkSuggestModalOptions {
    initialQuery: string;
    sourcePath: string;
    onChooseLink: (linkText: string) => void | Promise<void>;
    onCloseModal: () => void;
}

export default class SideNoteLinkSuggestModal extends SuggestModal<SideNoteLinkSuggestion> {
    private readonly initialQuery: string;
    private readonly sourcePath: string;
    private readonly onChooseLink: (linkText: string) => void | Promise<void>;
    private readonly onCloseModal: () => void;

    constructor(app: App, options: SideNoteLinkSuggestModalOptions) {
        super(app);
        this.initialQuery = options.initialQuery;
        this.sourcePath = options.sourcePath;
        this.onChooseLink = options.onChooseLink;
        this.onCloseModal = options.onCloseModal;

        this.setPlaceholder("Link or create a note");
        this.emptyStateText = "Type a note name to create a new markdown file.";
        this.setInstructions([
            { command: "↑↓", purpose: "move" },
            { command: "Enter", purpose: "choose" },
            { command: "Esc", purpose: "cancel" },
        ]);
    }

    onOpen(): void {
        void super.onOpen();
        this.setTitle("Insert note link");
        this.inputEl.value = this.initialQuery;
        this.inputEl.dispatchEvent(new Event("input"));
        const caret = this.inputEl.value.length;
        this.inputEl.setSelectionRange(caret, caret);
    }

    onClose(): void {
        super.onClose();
        this.onCloseModal();
    }

    getSuggestions(query: string): SideNoteLinkSuggestion[] {
        return getSideNoteLinkSuggestions(this.app, query, this.sourcePath, 40);
    }

    renderSuggestion(suggestion: SideNoteLinkSuggestion, el: HTMLElement): void {
        const titleEl = el.createDiv();
        const noteEl = el.createDiv({ cls: "aside-link-suggest-note" });

        if (suggestion.type === "create") {
            titleEl.setText(`Create note: ${suggestion.displayName}`);
            noteEl.setText(suggestion.notePath);
            return;
        }

        titleEl.setText(suggestion.file.basename);
        noteEl.setText(suggestion.file.path);
    }

    onChooseSuggestion(suggestion: SideNoteLinkSuggestion): void {
        void (async () => {
            if (suggestion.type === "existing") {
                await this.onChooseLink(`[[${suggestion.linkText}]]`);
                return;
            }

            try {
                const file = await createSideNoteLinkNote(this.app, suggestion.notePath);
                const linkText = this.app.metadataCache.fileToLinktext(file, this.sourcePath, true);
                await this.onChooseLink(`[[${linkText}]]`);
                new Notice(`Created ${file.basename}`);
            } catch (error) {
                console.error("Failed to create linked note", error);
                new Notice("Failed to create note.");
            }
        })();
    }
}
