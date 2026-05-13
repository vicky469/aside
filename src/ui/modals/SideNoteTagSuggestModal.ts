import { App, SuggestModal, getAllTags } from "obsidian";
import { isTagCharacter, normalizeTagText } from "../../core/text/commentTags";

interface ExistingTagSuggestion {
    type: "existing";
    tag: string;
    usageCount: number;
}

interface CreateTagSuggestion {
    type: "create";
    tag: string;
}

type SideNoteTagSuggestion = ExistingTagSuggestion | CreateTagSuggestion;

interface SideNoteTagSuggestModalOptions {
    extraTags?: string[];
    initialQuery: string;
    onChooseTag: (tagText: string) => void | Promise<void>;
    onCloseModal: () => void;
}

interface VaultTagRecord {
    normalized: string;
    usageCount: number;
    tag: string;
}

function normalizeTagQuery(query: string): string {
    return query.trim().replace(/^#+/, "");
}

function isValidTagQuery(query: string): boolean {
    const normalized = normalizeTagQuery(query);
    return normalized.length > 0 && Array.from(normalized).every(isTagCharacter);
}

function collectVaultTags(app: App, extraTags: string[]): VaultTagRecord[] {
    const tagCounts = new Map<string, VaultTagRecord>();

    for (const file of app.vault.getMarkdownFiles()) {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache) {
            continue;
        }

        const uniqueTags = new Set(
            (getAllTags(cache) ?? [])
                .map(normalizeTagText)
                .filter(Boolean),
        );

        for (const tag of uniqueTags) {
            const normalized = tag.slice(1).toLowerCase();
            const existing = tagCounts.get(normalized);
            if (existing) {
                existing.usageCount += 1;
                continue;
            }

            tagCounts.set(normalized, {
                normalized,
                usageCount: 1,
                tag,
            });
        }
    }

    for (const rawTag of extraTags) {
        const tag = normalizeTagText(rawTag);
        if (!tag) {
            continue;
        }

        const normalized = tag.slice(1).toLowerCase();
        const existing = tagCounts.get(normalized);
        if (existing) {
            existing.usageCount += 1;
            continue;
        }

        tagCounts.set(normalized, {
            normalized,
            usageCount: 1,
            tag,
        });
    }

    return Array.from(tagCounts.values());
}

function getMatchScore(query: string, tag: VaultTagRecord): number {
    if (!query) {
        return 0;
    }

    if (tag.normalized === query) {
        return 0;
    }

    if (tag.normalized.startsWith(query)) {
        return 1;
    }

    if (tag.normalized.split("/").some((segment) => segment.startsWith(query))) {
        return 2;
    }

    if (tag.normalized.includes(query)) {
        return 3;
    }

    return Number.POSITIVE_INFINITY;
}

export default class SideNoteTagSuggestModal extends SuggestModal<SideNoteTagSuggestion> {
    private readonly initialQuery: string;
    private readonly onChooseTag: (tagText: string) => void | Promise<void>;
    private readonly onCloseModal: () => void;
    private readonly vaultTags: VaultTagRecord[];

    constructor(app: App, options: SideNoteTagSuggestModalOptions) {
        super(app);
        this.initialQuery = options.initialQuery;
        this.onChooseTag = options.onChooseTag;
        this.onCloseModal = options.onCloseModal;
        this.vaultTags = collectVaultTags(app, options.extraTags ?? []);

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
        const normalizedQuery = normalizeTagQuery(query).toLowerCase();
        const matchingTags = this.vaultTags
            .map((tag) => ({
                tag,
                score: getMatchScore(normalizedQuery, tag),
            }))
            .filter((candidate) => candidate.score !== Number.POSITIVE_INFINITY)
            .sort((left, right) => {
                if (normalizedQuery && left.score !== right.score) {
                    return left.score - right.score;
                }

                if (left.tag.usageCount !== right.tag.usageCount) {
                    return right.tag.usageCount - left.tag.usageCount;
                }

                return left.tag.tag.localeCompare(right.tag.tag);
            })
            .slice(0, this.limit)
            .map<ExistingTagSuggestion>(({ tag }) => ({
                type: "existing",
                tag: tag.tag,
                usageCount: tag.usageCount,
            }));

        const createSuggestion = this.getCreateSuggestion(normalizedQuery);
        return createSuggestion ? [createSuggestion, ...matchingTags] : matchingTags;
    }

    renderSuggestion(suggestion: SideNoteTagSuggestion, el: HTMLElement): void {
        const titleEl = el.createDiv();
        const detailEl = el.createDiv({ cls: "aside-tag-suggest-note" });

        if (suggestion.type === "create") {
            titleEl.setText(`Create tag: ${suggestion.tag}`);
            detailEl.setText("Insert this new tag into the comment.");
            return;
        }

        titleEl.setText(suggestion.tag);
        detailEl.setText(
            suggestion.usageCount === 1
                ? "Used once"
                : `Used ${suggestion.usageCount} times`,
        );
    }

    onChooseSuggestion(suggestion: SideNoteTagSuggestion): void {
        void this.onChooseTag(suggestion.tag);
    }

    private getCreateSuggestion(normalizedQuery: string): CreateTagSuggestion | null {
        if (!isValidTagQuery(normalizedQuery)) {
            return null;
        }

        if (this.vaultTags.some((tag) => tag.normalized === normalizedQuery)) {
            return null;
        }

        return {
            type: "create",
            tag: normalizeTagText(normalizedQuery),
        };
    }
}
