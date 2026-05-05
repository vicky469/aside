import type { CommentThread } from "../../commentManager";
import { filterCommentsByFilePaths } from "./indexFileFilter";
import type { IndexSidebarMode } from "./viewState";

export function scopeIndexThreadsByFilePaths(
    visibleThreads: CommentThread[],
    allThreads: CommentThread[],
    selectedFilePaths: readonly string[],
): {
    scopedVisibleThreads: CommentThread[];
    scopedAllThreads: CommentThread[];
} {
    return {
        scopedVisibleThreads: filterCommentsByFilePaths(visibleThreads, selectedFilePaths),
        scopedAllThreads: filterCommentsByFilePaths(allThreads, selectedFilePaths),
    };
}

export function filterIndexThreadsByExistingSourceFiles(
    threads: CommentThread[],
    hasSourceFile: (filePath: string) => boolean,
): CommentThread[] {
    return threads.filter((thread) => hasSourceFile(thread.filePath));
}

export function shouldShowResolvedToolbarChip(hasResolvedComments: boolean, showResolved: boolean): boolean {
    return hasResolvedComments || showResolved;
}

export function shouldShowNestedToolbarChip(options: {
    hasNestedComments: boolean;
    isAllCommentsView: boolean;
    selectedIndexFileFilterRootPath: string | null;
    filteredIndexFileCount: number;
}): boolean {
    return options.hasNestedComments;
}

export function shouldShowIndexListToolbarChips(
    isAllCommentsView: boolean,
    indexSidebarMode: IndexSidebarMode,
): boolean {
    return !isAllCommentsView || indexSidebarMode === "list" || indexSidebarMode === "tags";
}

export function resolveIndexModeWithTagAvailability(
    indexSidebarMode: IndexSidebarMode,
    isTagsEnabled: boolean,
): IndexSidebarMode {
    return indexSidebarMode === "tags" && !isTagsEnabled
        ? "list"
        : indexSidebarMode;
}

export function shouldShowResolvedIndexEmptyState(
    showResolved: boolean,
    totalScopedCount: number,
    renderedItemCount: number,
): boolean {
    return showResolved && totalScopedCount > 0 && renderedItemCount === 0;
}

export function shouldShowActiveIndexEmptyState(
    showResolved: boolean,
    resolvedCount: number,
    renderedItemCount: number,
): boolean {
    return !showResolved && resolvedCount > 0 && renderedItemCount === 0;
}

export function shouldShowGenericIndexEmptyState(options: {
    hasFileFilter: boolean;
    hasSearchQuery: boolean;
    renderedItemCount: number;
}): boolean {
    if (options.renderedItemCount !== 0) {
        return false;
    }

    return options.hasSearchQuery || !options.hasFileFilter;
}
