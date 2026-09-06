import type { TFile } from "obsidian";
import {
    rankExistingTags,
    type ExistingTagUsage,
} from "../../core/text/tagSearch";

export interface IndexTagSearchMatch {
    tag: string;
    tagKey: string;
    fileCount: number;
}

export interface IndexTagSearchFileMatch {
    tag: string;
    tagKey: string;
}

export interface IndexTagSearchFile {
    file: TFile;
    filePath: string;
    label: string;
    matchedTags: IndexTagSearchFileMatch[];
    bestTagRank: number;
}

export interface IndexTagSearchResult {
    query: string;
    tags: IndexTagSearchMatch[];
    files: IndexTagSearchFile[];
}

export interface IndexTagSearchWindow {
    files: IndexTagSearchFile[];
    visibleCount: number;
    totalCount: number;
    hasMore: boolean;
}

function normalizeFilePath(filePath: string): string {
    return filePath.trim().replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
}

function compareFilesByLabelAndPath(left: IndexTagSearchFile, right: IndexTagSearchFile): number {
    return left.label.localeCompare(right.label)
        || left.filePath.localeCompare(right.filePath);
}

export function buildIndexTagSearchResult(options: {
    query: string;
    tags: readonly ExistingTagUsage[];
    getFilesForTag(tag: string): readonly TFile[];
}): IndexTagSearchResult {
    const query = options.query.trim();
    const rankedTags = rankExistingTags({
        query,
        tags: options.tags,
    });
    const filesByPath = new Map<string, IndexTagSearchFile>();
    const tags: IndexTagSearchMatch[] = [];

    for (const [tagRank, rankedTag] of rankedTags.entries()) {
        const membershipByPath = new Map<string, TFile>();
        for (const file of options.getFilesForTag(rankedTag.tag)) {
            const filePath = normalizeFilePath(file.path);
            if (filePath) {
                membershipByPath.set(filePath, file);
            }
        }

        tags.push({
            tag: rankedTag.tag,
            tagKey: rankedTag.tagKey,
            fileCount: membershipByPath.size,
        });

        for (const [filePath, file] of membershipByPath) {
            const matchedTag = {
                tag: rankedTag.tag,
                tagKey: rankedTag.tagKey,
            };
            const existing = filesByPath.get(filePath);
            if (existing) {
                existing.matchedTags.push(matchedTag);
                continue;
            }

            filesByPath.set(filePath, {
                file,
                filePath,
                label: file.basename || file.name || filePath,
                matchedTags: [matchedTag],
                bestTagRank: tagRank,
            });
        }
    }

    const files = Array.from(filesByPath.values()).sort((left, right) => (
        left.bestTagRank - right.bestTagRank
        || compareFilesByLabelAndPath(left, right)
    ));
    return { query, tags, files };
}

export function selectIndexTagSearchFiles(
    result: IndexTagSearchResult,
    selectedTagKey: string | null,
): IndexTagSearchFile[] {
    const hasSelectedTag = selectedTagKey !== null
        && result.tags.some((tag) => tag.tagKey === selectedTagKey);
    if (!hasSelectedTag) {
        return result.files.slice();
    }

    return result.files
        .filter((file) => file.matchedTags.some((tag) => tag.tagKey === selectedTagKey))
        .sort(compareFilesByLabelAndPath);
}

export function buildIndexTagSearchWindow(
    result: IndexTagSearchResult,
    selectedTagKey: string | null,
    visibleLimit: number,
): IndexTagSearchWindow {
    const matchingFiles = selectIndexTagSearchFiles(result, selectedTagKey);
    const boundedLimit = Math.max(0, visibleLimit);
    const files = matchingFiles.slice(0, boundedLimit);
    return {
        files,
        visibleCount: files.length,
        totalCount: matchingFiles.length,
        hasMore: files.length < matchingFiles.length,
    };
}
