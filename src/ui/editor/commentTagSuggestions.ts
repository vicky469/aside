import { isTagCharacter, normalizeTagText } from "../../core/text/commentTags";
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

interface TagRecord {
    tag: string;
    canonical: string;
    segments: string[];
    usageCount: number;
}

interface MatchScore {
    tier: number;
    distance: number;
    lengthDelta: number;
}

function normalizeQuery(value: string): string {
    return value.trim().replace(/^#+/u, "");
}

function canonicalize(value: string): string {
    return normalizeQuery(value).toLowerCase().replace(/-/gu, "");
}

function fuzzyThreshold(length: number): number {
    if (length < 4) {
        return -1;
    }
    return length < 8 ? 1 : 2;
}

function boundedDamerauLevenshtein(left: string, right: string, limit: number): number {
    if (Math.abs(left.length - right.length) > limit) {
        return limit + 1;
    }

    const rows = Array.from({ length: left.length + 1 }, () => (
        Array<number>(right.length + 1).fill(0)
    ));
    for (let index = 0; index <= left.length; index += 1) {
        rows[index][0] = index;
    }
    for (let index = 0; index <= right.length; index += 1) {
        rows[0][index] = index;
    }

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            const substitution = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
            rows[leftIndex][rightIndex] = Math.min(
                rows[leftIndex - 1][rightIndex] + 1,
                rows[leftIndex][rightIndex - 1] + 1,
                rows[leftIndex - 1][rightIndex - 1] + substitution,
            );

            if (
                leftIndex > 1
                && rightIndex > 1
                && left[leftIndex - 1] === right[rightIndex - 2]
                && left[leftIndex - 2] === right[rightIndex - 1]
            ) {
                rows[leftIndex][rightIndex] = Math.min(
                    rows[leftIndex][rightIndex],
                    rows[leftIndex - 2][rightIndex - 2] + 1,
                );
            }
        }
    }

    return rows[left.length][right.length];
}

function scoreTag(query: string, tag: TagRecord): MatchScore | null {
    if (!query || tag.canonical === query) {
        return { tier: 0, distance: 0, lengthDelta: 0 };
    }

    if (tag.canonical.startsWith(query)) {
        return {
            tier: 1,
            distance: 0,
            lengthDelta: tag.canonical.length - query.length,
        };
    }

    const segmentPrefix = tag.segments.find((segment) => segment.startsWith(query));
    if (segmentPrefix) {
        return {
            tier: 2,
            distance: 0,
            lengthDelta: segmentPrefix.length - query.length,
        };
    }

    const substring = [tag.canonical, ...tag.segments]
        .filter((target) => target.includes(query))
        .sort((left, right) => left.length - right.length)[0];
    if (substring) {
        return {
            tier: 3,
            distance: 0,
            lengthDelta: substring.length - query.length,
        };
    }

    const threshold = fuzzyThreshold(query.length);
    if (threshold < 0) {
        return null;
    }

    const best = [tag.canonical, ...tag.segments]
        .map((target) => ({
            target,
            distance: boundedDamerauLevenshtein(query, target, threshold),
        }))
        .filter((match) => match.distance <= threshold)
        .sort((left, right) => (
            left.distance - right.distance
            || Math.abs(left.target.length - query.length)
                - Math.abs(right.target.length - query.length)
        ))[0];

    return best
        ? {
            tier: 4,
            distance: best.distance,
            lengthDelta: Math.abs(best.target.length - query.length),
        }
        : null;
}

function collectTagRecords(options: BuildTagSuggestionsOptions): Map<string, TagRecord> {
    const records = new Map<string, TagRecord>();
    const add = (rawTag: string, usageCount: number): void => {
        const tag = normalizeTagText(rawTag);
        const canonical = canonicalize(tag);
        if (!tag || !canonical) {
            return;
        }

        const existing = records.get(canonical);
        if (existing) {
            existing.usageCount += usageCount;
            return;
        }

        records.set(canonical, {
            tag,
            canonical,
            segments: canonical.split("/").filter(Boolean),
            usageCount,
        });
    };

    for (const tag of options.vaultTags) {
        add(tag.tag, tag.usageCount);
    }
    for (const tag of options.extraTags ?? []) {
        add(tag, 1);
    }

    return records;
}

export function buildTagSuggestions(
    options: BuildTagSuggestionsOptions,
): SideNoteTagSuggestion[] {
    const normalizedQuery = normalizeQuery(options.query);
    const query = canonicalize(normalizedQuery);
    const records = collectTagRecords(options);
    const existing = Array.from(records.values())
        .map((tag) => ({ tag, score: scoreTag(query, tag) }))
        .filter((entry): entry is { tag: TagRecord; score: MatchScore } => entry.score !== null)
        .sort((left, right) => (
            left.score.tier - right.score.tier
            || left.score.distance - right.score.distance
            || left.score.lengthDelta - right.score.lengthDelta
            || right.tag.usageCount - left.tag.usageCount
            || left.tag.tag.localeCompare(right.tag.tag)
        ))
        .slice(0, options.limit ?? 40)
        .map<SideNoteTagSuggestion>((entry) => ({
            type: "existing",
            tag: entry.tag.tag,
        }));
    const canCreate = normalizedQuery.length > 0
        && Array.from(normalizedQuery).every(isTagCharacter)
        && !records.has(query);

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
