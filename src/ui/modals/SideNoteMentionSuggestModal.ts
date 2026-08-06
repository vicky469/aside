import { App, SuggestModal } from "obsidian";
import type { SideNoteMentionSuggestion } from "../editor/commentMentionSuggestions";

export interface SideNoteMentionSuggestModalOptions {
    initialQuery: string;
    getSuggestions(query: string): SideNoteMentionSuggestion[];
    onChooseMention(mention: string): void | Promise<void>;
    onCloseModal(): void;
}

export default class SideNoteMentionSuggestModal extends SuggestModal<SideNoteMentionSuggestion> {
    constructor(
        app: App,
        private readonly options: SideNoteMentionSuggestModalOptions,
    ) {
        super(app);
        this.limit = 40;
        this.setPlaceholder("Mention an agent, todo, or vault script (start with /)");
        this.emptyStateText = "No matching mention.";
    }

    onOpen(): void {
        void super.onOpen();
        this.setTitle("Insert mention");
        this.inputEl.value = this.options.initialQuery;
        this.inputEl.dispatchEvent(new Event("input"));
        this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
    }

    onClose(): void {
        super.onClose();
        this.options.onCloseModal();
    }

    getSuggestions(query: string): SideNoteMentionSuggestion[] {
        return this.options.getSuggestions(query);
    }

    renderSuggestion(suggestion: SideNoteMentionSuggestion, el: HTMLElement): void {
        el.createDiv({ text: suggestion.mention });
        el.createDiv({
            cls: "aside-mention-suggest-note",
            text: suggestion.kind === "script" ? suggestion.scriptPath : suggestion.label,
        });
    }

    onChooseSuggestion(suggestion: SideNoteMentionSuggestion): void {
        void this.options.onChooseMention(suggestion.mention);
    }
}
