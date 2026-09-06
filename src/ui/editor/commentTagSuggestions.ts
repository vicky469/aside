import { isTagCharacter, normalizeTagText } from "../../core/text/commentTags";
import {
    canonicalizeTagSearchText,
    rankExistingTags,
    type ExistingTagUsage,
} from "../../core/text/tagSearch";
import type { VaultTagUsage } from "../../core/vault/vaultCapabilityIndex";

export type SideNoteTagSuggestion =
    | { type: "existing"; tag: string }
    | { type: "create"; tag: string };

export interface BuildTagSuggestionsOptions {
    query: string;
    vaultTags: readonly VaultTagUsage[];
    extraTags?: readonly string[];
    limit?: number;
}

function normalizeQuery(value: string): string {
    return value.trim().replace(/^#+/u, "");
}

export function buildTagSuggestions(
    options: BuildTagSuggestionsOptions,
): SideNoteTagSuggestion[] {
    const normalizedQuery = normalizeQuery(options.query);
    const tags: ExistingTagUsage[] = [
        ...options.vaultTags,
        ...(options.extraTags ?? []).map((tag) => ({ tag, usageCount: 1 })),
    ];
    const existing = rankExistingTags({
        query: normalizedQuery,
        tags,
        limit: options.limit,
        includeAllWhenEmpty: true,
    }).map<SideNoteTagSuggestion>((entry) => ({
        type: "existing",
        tag: entry.tag,
    }));
    const queryKey = canonicalizeTagSearchText(normalizedQuery);
    const canCreate = normalizedQuery.length > 0
        && Array.from(normalizedQuery).every(isTagCharacter)
        && !tags.some((tag) => canonicalizeTagSearchText(tag.tag) === queryKey);

    return canCreate
        ? [{ type: "create", tag: normalizeTagText(normalizedQuery) }, ...existing]
        : existing;
}

export function getTagSuggestionPresentation(
    suggestion: SideNoteTagSuggestion,
): { title: string; note?: string } {
    return suggestion.type === "create"
        ? {
            title: `Create tag: ${suggestion.tag}`,
            note: "Insert this new tag into the comment.",
        }
        : { title: suggestion.tag };
}
