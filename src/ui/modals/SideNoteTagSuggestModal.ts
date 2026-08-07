import { App, SuggestModal } from "obsidian";
import type { VaultTagUsage } from "../../core/vault/vaultCapabilityIndex";
import {
    buildTagSuggestions,
    getTagSuggestionPresentation,
    type SideNoteTagSuggestion,
} from "../editor/commentTagSuggestions";

interface SideNoteTagSuggestModalOptions {
    extraTags?: string[];
    initialQuery: string;
    vaultTags: readonly VaultTagUsage[];
    onChooseTag: (tagText: string) => void | Promise<void>;
    onCloseModal: () => void;
}

export default class SideNoteTagSuggestModal extends SuggestModal<SideNoteTagSuggestion> {
    private readonly extraTags: readonly string[];
    private readonly initialQuery: string;
    private readonly onChooseTag: (tagText: string) => void | Promise<void>;
    private readonly onCloseModal: () => void;
    private readonly vaultTags: readonly VaultTagUsage[];

    constructor(app: App, options: SideNoteTagSuggestModalOptions) {
        super(app);
        this.extraTags = options.extraTags ?? [];
        this.initialQuery = options.initialQuery;
        this.onChooseTag = options.onChooseTag;
        this.onCloseModal = options.onCloseModal;
        this.vaultTags = options.vaultTags;

        this.limit = 40;
        this.setPlaceholder("Search or create a tag");
        this.emptyStateText = "Type a tag name to create a new tag.";
        this.setInstructions([
            { command: "↑↓", purpose: "move" },
            { command: "Enter", purpose: "choose" },
            { command: "Esc", purpose: "cancel" },
        ]);
    }

    onOpen(): void {
        void super.onOpen();
        this.setTitle("Insert tag");
        this.inputEl.value = this.initialQuery;
        this.inputEl.dispatchEvent(new Event("input"));
        const caret = this.inputEl.value.length;
        this.inputEl.setSelectionRange(caret, caret);
    }

    onClose(): void {
        super.onClose();
        this.onCloseModal();
    }

    getSuggestions(query: string): SideNoteTagSuggestion[] {
        return buildTagSuggestions({
            query,
            vaultTags: this.vaultTags,
            extraTags: this.extraTags,
            limit: this.limit,
        });
    }

    renderSuggestion(suggestion: SideNoteTagSuggestion, el: HTMLElement): void {
        const presentation = getTagSuggestionPresentation(suggestion);
        el.createDiv({ text: presentation.title });
        if (presentation.note) {
            el.createDiv({
                cls: "aside-tag-suggest-note",
                text: presentation.note,
            });
        }
    }

    onChooseSuggestion(suggestion: SideNoteTagSuggestion): void {
        void this.onChooseTag(suggestion.tag);
    }
}
