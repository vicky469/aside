import { normalizeTagText } from "./commentTags";

export interface ExistingTagUsage {
    tag: string;
    usageCount: number;
}

export interface RankedExistingTag extends ExistingTagUsage {
    tagKey: string;
}

export interface RankExistingTagsOptions {
    query: string;
    tags: readonly ExistingTagUsage[];
    limit?: number;
    includeAllWhenEmpty?: boolean;
}

interface TagRecord extends RankedExistingTag {
    searchKey: string;
    segments: string[];
}

interface MatchScore {
    tier: number;
    distance: number;
    lengthDelta: number;
}

function normalizeQuery(value: string): string {
    return value.trim().replace(/^#+/u, "");
}

function normalizeTagIdentityKey(value: string): string {
    return normalizeQuery(normalizeTagText(value)).toLowerCase();
}

export function canonicalizeTagSearchText(value: string): string {
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
    if (!query || tag.searchKey === query) {
        return { tier: 0, distance: 0, lengthDelta: 0 };
    }

    if (tag.searchKey.startsWith(query)) {
        return {
            tier: 1,
            distance: 0,
            lengthDelta: tag.searchKey.length - query.length,
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

    const substring = [tag.searchKey, ...tag.segments]
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

    const best = [tag.searchKey, ...tag.segments]
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

function collectTagRecords(tags: readonly ExistingTagUsage[]): Map<string, TagRecord> {
    const records = new Map<string, TagRecord>();
    for (const candidate of tags) {
        const tag = normalizeTagText(candidate.tag);
        const tagKey = normalizeTagIdentityKey(tag);
        const searchKey = canonicalizeTagSearchText(tag);
        if (!tag || !tagKey || !searchKey) {
            continue;
        }

        const existing = records.get(tagKey);
        if (existing) {
            existing.usageCount += candidate.usageCount;
            continue;
        }

        records.set(tagKey, {
            tag,
            tagKey,
            searchKey,
            segments: searchKey.split("/").filter(Boolean),
            usageCount: candidate.usageCount,
        });
    }
    return records;
}

export function rankExistingTags(options: RankExistingTagsOptions): RankedExistingTag[] {
    const query = canonicalizeTagSearchText(options.query);
    if (!query && !options.includeAllWhenEmpty) {
        return [];
    }

    const limit = Math.max(0, options.limit ?? 40);
    return Array.from(collectTagRecords(options.tags).values())
        .map((tag) => ({ tag, score: scoreTag(query, tag) }))
        .filter((entry): entry is { tag: TagRecord; score: MatchScore } => entry.score !== null)
        .sort((left, right) => (
            left.score.tier - right.score.tier
            || left.score.distance - right.score.distance
            || left.score.lengthDelta - right.score.lengthDelta
            || right.tag.usageCount - left.tag.usageCount
            || left.tag.tag.localeCompare(right.tag.tag)
        ))
        .slice(0, limit)
        .map(({ tag }) => ({
            tag: tag.tag,
            tagKey: tag.tagKey,
            usageCount: tag.usageCount,
        }));
}
