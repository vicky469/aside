import type { CommentThread } from "../../commentManager";
import { filterCommentsByFilePaths } from "./indexFileFilter";

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

export function shouldShowResolvedToolbarChip(hasResolvedComments: boolean, showResolved: boolean): boolean {
    return hasResolvedComments || showResolved;
}

export function shouldShowResolvedIndexEmptyState(
    showResolved: boolean,
    totalScopedCount: number,
    renderedItemCount: number,
): boolean {
    return showResolved && totalScopedCount > 0 && renderedItemCount === 0;
}
