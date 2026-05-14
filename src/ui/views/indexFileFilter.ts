import type { Comment } from "../../commentManager";
import {
    getIndexFileFilterConnectedComponent,
    type IndexFileFilterGraph,
} from "../../core/derived/indexFileFilterGraph";

export interface IndexFileFilterOption {
    filePath: string;
    commentCount: number;
}

export function getNormalizedFilterPath(filePath: string): string {
    return filePath.replace(/\\/g, "/").trim();
}

export function getIndexFileFilterFileName(filePath: string): string {
    const normalized = getNormalizedFilterPath(filePath);
    const basename = normalized.split("/").pop() ?? normalized;
    return basename.replace(/\.md$/i, "");
}

export function getIndexFileFilterLabel(filePath: string, siblingFilePaths: readonly string[]): string {
    const fileName = getIndexFileFilterFileName(filePath);
    const hasDuplicateName = siblingFilePaths.some((path) => (
        path !== filePath && getIndexFileFilterFileName(path) === fileName
    ));
    return hasDuplicateName ? getNormalizedFilterPath(filePath) : fileName;
}

export function normalizeIndexFileFilterPaths(filePaths: Iterable<string> | null | undefined): string[] {
    const uniquePaths = new Set<string>();
    for (const filePath of filePaths ?? []) {
        const normalized = getNormalizedFilterPath(filePath);
        if (!normalized) {
            continue;
        }

        uniquePaths.add(normalized);
    }

    return Array.from(uniquePaths).sort((left, right) => left.localeCompare(right));
}

export function isIndexFileFilterPathSelected(
    filePath: string,
    selectedRootPath: string | null | undefined,
): boolean {
    const normalizedFilePath = getNormalizedFilterPath(filePath);
    const normalizedSelectedRootPath = getNormalizedFilterPath(selectedRootPath ?? "");
    return !!normalizedFilePath && normalizedFilePath === normalizedSelectedRootPath;
}

export function resolveAutoIndexFileFilterRootPath(options: {
    currentRootPath: string | null | undefined;
    firstIndexFilePath: string | null | undefined;
    autoSelectSuppressed: boolean;
}): string | null {
    const currentRootPath = getNormalizedFilterPath(options.currentRootPath ?? "");
    if (currentRootPath) {
        return currentRootPath;
    }

    if (options.autoSelectSuppressed) {
        return null;
    }

    const firstIndexFilePath = getNormalizedFilterPath(options.firstIndexFilePath ?? "");
    return firstIndexFilePath || null;
}

export function filterCommentsByFilePaths<T extends { filePath: string }>(
    comments: T[],
    selectedFilePaths: readonly string[],
): T[] {
    if (!selectedFilePaths.length) {
        return comments.slice();
    }

    const selectedSet = new Set(selectedFilePaths.map((filePath) => getNormalizedFilterPath(filePath)));
    return comments.filter((comment) => selectedSet.has(getNormalizedFilterPath(comment.filePath)));
}

export function deriveIndexSidebarScopedFilePaths(
    graph: IndexFileFilterGraph | null,
    rootFilePath: string | null | undefined,
): string[] {
    if (!graph || !rootFilePath) {
        return [];
    }

    const normalizedRootPath = getNormalizedFilterPath(rootFilePath);
    if (!normalizedRootPath || !graph.fileCommentCounts.has(normalizedRootPath)) {
        return [];
    }

    return getIndexFileFilterConnectedComponent(graph, normalizedRootPath);
}

export function shouldLimitIndexSidebarList(
    rootFilePath: string | null | undefined,
    searchQuery = "",
): boolean {
    return !rootFilePath && !searchQuery.trim();
}

export function buildIndexFileFilterOptions(comments: Comment[]): IndexFileFilterOption[] {
    const commentCounts = new Map<string, number>();
    for (const comment of comments) {
        const filePath = getNormalizedFilterPath(comment.filePath);
        commentCounts.set(filePath, (commentCounts.get(filePath) ?? 0) + 1);
    }

    return buildIndexFileFilterOptionsFromCounts(commentCounts);
}

export function buildIndexFileFilterOptionsFromCounts(
    commentCounts: ReadonlyMap<string, number>,
): IndexFileFilterOption[] {
    return Array.from(commentCounts.entries())
        .map(([filePath, commentCount]) => ({
            filePath,
            commentCount,
        }))
        .sort((left, right) => {
            const nameComparison = getIndexFileFilterFileName(left.filePath)
                .localeCompare(getIndexFileFilterFileName(right.filePath));
            if (nameComparison !== 0) {
                return nameComparison;
            }

            return left.filePath.localeCompare(right.filePath);
        });
}

function getMatchScore(query: string, filePath: string): number {
    if (!query) {
        return 0;
    }

    const normalizedPath = getNormalizedFilterPath(filePath).toLowerCase();
    const fileName = getIndexFileFilterFileName(filePath).toLowerCase();

    if (fileName === query || normalizedPath === query || normalizedPath === `${query}.md`) {
        return 0;
    }
    if (fileName.startsWith(query)) {
        return 1;
    }
    if (normalizedPath.startsWith(query)) {
        return 2;
    }
    if (fileName.includes(query)) {
        return 3;
    }
    if (normalizedPath.includes(query)) {
        return 4;
    }

    return Number.POSITIVE_INFINITY;
}

export function getIndexFileFilterSuggestions(
    options: IndexFileFilterOption[],
    query: string,
    selectedFilePaths: readonly string[] = [],
    limit = 40,
): IndexFileFilterOption[] {
    const normalizedQuery = query.trim().toLowerCase();
    const selectedSet = new Set(selectedFilePaths.map((filePath) => getNormalizedFilterPath(filePath)));

    return options
        .map((option) => ({
            option,
            isSelected: selectedSet.has(getNormalizedFilterPath(option.filePath)),
            score: getMatchScore(normalizedQuery, option.filePath),
        }))
        .filter((candidate) => !normalizedQuery || candidate.score !== Number.POSITIVE_INFINITY)
        .sort((left, right) => {
            if (left.isSelected !== right.isSelected) {
                return left.isSelected ? -1 : 1;
            }
            if (left.score !== right.score) {
                return left.score - right.score;
            }
            if (left.option.commentCount !== right.option.commentCount) {
                return right.option.commentCount - left.option.commentCount;
            }

            const nameComparison = getIndexFileFilterFileName(left.option.filePath)
                .localeCompare(getIndexFileFilterFileName(right.option.filePath));
            if (nameComparison !== 0) {
                return nameComparison;
            }

            return left.option.filePath.localeCompare(right.option.filePath);
        })
        .slice(0, limit)
        .map(({ option }) => option);
}
