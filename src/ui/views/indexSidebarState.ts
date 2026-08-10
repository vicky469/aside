import type { CommentThread } from "../../commentManager";
import { filterCommentsByFilePaths, getNormalizedFilterPath } from "./indexFileFilter";
import { isSidebarListLikeMode } from "./sidebarModeTabs";
import type { IndexSidebarMode } from "./viewState";

export const GENERIC_INDEX_EMPTY_STATE_TEXTS = [
    "Click a file in the index to see its side notes.",
] as const;

export interface IndexSidebarSearchState {
    searchInputValue: string;
    searchQuery: string;
}

export const INDEX_SIDEBAR_UNSCOPED_SEARCH_PLACEHOLDER = "Select a file to search side notes";
export const INDEX_SIDEBAR_SCOPED_SEARCH_PLACEHOLDER = "Search side notes in selected file";

export interface IndexSidebarSearchAvailability {
    disabled: boolean;
    placeholder: string;
}

export function shouldShowIndexSidebarSearch(mode: IndexSidebarMode): boolean {
    return mode === "list";
}

export function resolveIndexSidebarSearchAvailability(
    mode: IndexSidebarMode,
    rootFilePath: string | null | undefined,
): IndexSidebarSearchAvailability {
    const enabled = mode === "list" && !!getNormalizedFilterPath(rootFilePath ?? "");
    return {
        disabled: !enabled,
        placeholder: enabled
            ? INDEX_SIDEBAR_SCOPED_SEARCH_PLACEHOLDER
            : INDEX_SIDEBAR_UNSCOPED_SEARCH_PLACEHOLDER,
    };
}

export function shouldUseEmptyIndexDefaultCache(storedThreadCount: number): boolean {
    return storedThreadCount === 0;
}

export function resolveIndexSidebarSearchStateForMode(
    state: IndexSidebarSearchState,
    mode: IndexSidebarMode,
): IndexSidebarSearchState {
    return shouldShowIndexSidebarSearch(mode)
        ? { ...state }
        : { searchInputValue: "", searchQuery: "" };
}

export function resolveIndexSidebarSearchStateForFileScope(
    state: IndexSidebarSearchState,
    rootFilePath: string | null | undefined,
): IndexSidebarSearchState {
    return getNormalizedFilterPath(rootFilePath ?? "")
        ? { ...state }
        : { searchInputValue: "", searchQuery: "" };
}

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

export function deriveIndexSidebarListFilePaths(rootFilePath: string | null | undefined): string[] {
    const normalizedRootPath = getNormalizedFilterPath(rootFilePath ?? "");
    return normalizedRootPath ? [normalizedRootPath] : [];
}

export function filterIndexThreadsByExistingSourceFiles(
    threads: CommentThread[],
    hasSourceFile: (filePath: string) => boolean,
): CommentThread[] {
    return threads.filter((thread) => hasSourceFile(thread.filePath));
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
    return !isAllCommentsView || isSidebarListLikeMode(indexSidebarMode);
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
