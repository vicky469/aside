import type { TFile } from "obsidian";
import {
    buildAllCommentsNoteFileEntries,
    type AllCommentsNoteSource,
} from "../../core/derived/allCommentsNote";
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

export function buildIndexNoteTagSearchResult(options: {
    query: string;
    comments: readonly AllCommentsNoteSource[];
    allCommentsNotePath: string;
    getFile(filePath: string): TFile | null;
    getSourceFileTags(file: TFile): readonly string[];
}): IndexTagSearchResult {
    if (!options.query.trim()) return { query: "", tags: [], files: [] };
    const entries = buildAllCommentsNoteFileEntries(options.comments, {
        allCommentsNotePath: options.allCommentsNotePath,
        hasSourceFile: (path) => options.getFile(path) !== null,
        getSourceFileTags: (path) => {
            const file = options.getFile(path);
            return file ? options.getSourceFileTags(file) : [];
        },
    });
    const tagsByKey = new Map<string, { tag: string; files: TFile[] }>();
    for (const entry of entries) {
        const file = options.getFile(entry.filePath);
        if (!file) continue;
        for (const tag of entry.tags) {
            const key = tag.toLowerCase();
            const membership = tagsByKey.get(key) ?? { tag, files: [] };
            membership.files.push(file);
            tagsByKey.set(key, membership);
        }
    }
    return buildIndexTagSearchResult({
        query: options.query,
        tags: Array.from(tagsByKey.values(), ({ tag, files }) => ({ tag, usageCount: files.length })),
        getFilesForTag: (tag) => tagsByKey.get(tag.toLowerCase())?.files ?? [],
    });
}

export function buildIndexTagSearchResult(options: {
    query: string;
    tags: readonly ExistingTagUsage[];
    getFilesForTag(tag: string): readonly TFile[];
    isExcludedFilePath?(filePath: string): boolean;
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
            if (filePath && !options.isExcludedFilePath?.(filePath)) {
                membershipByPath.set(filePath, file);
            }
        }

        if (!membershipByPath.size) continue;

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
