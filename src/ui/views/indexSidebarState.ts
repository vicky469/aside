import type { CommentThread } from "../../commentManager";
import { filterCommentsByFilePaths, getNormalizedFilterPath } from "./indexFileFilter";
import { isSidebarListLikeMode } from "./sidebarModeTabs";
import type { IndexSidebarMode } from "./viewState";

export const GENERIC_INDEX_EMPTY_STATE_TEXTS = [
    "Click a file in the index to see its side notes.",
] as const;

const GLOBAL_INDEX_TODO_EMPTY_STATE_TEXTS = [
    "No todo side notes yet.",
    "Add @todo to any side note or reply to show it here.",
] as const;

const FILE_INDEX_TODO_EMPTY_STATE_TEXTS = [
    "No todo side notes in this file yet.",
    "Add @todo to any side note or reply to show it here.",
] as const;

const FILE_INDEX_AGENT_EMPTY_STATE_TEXTS = [
    "No agent side notes in this file yet.",
    "Add an agent mention to any side note or reply to show it here.",
] as const;

export interface IndexSidebarSearchState {
    searchInputValue: string;
    searchQuery: string;
}

export const INDEX_SIDEBAR_SCOPED_SEARCH_PLACEHOLDER = "Search side notes in selected file";

export type IndexSidebarModeScope =
    | { kind: "unavailable"; rootFilePath: null }
    | { kind: "global-todo"; rootFilePath: null }
    | { kind: "file"; rootFilePath: string };

export function resolveIndexSidebarModeScope(
    mode: IndexSidebarMode,
    rootFilePath: string | null | undefined,
): IndexSidebarModeScope {
    const normalizedRootPath = getNormalizedFilterPath(rootFilePath ?? "");
    if (normalizedRootPath) {
        return { kind: "file", rootFilePath: normalizedRootPath };
    }

    return mode === "todo"
        ? { kind: "global-todo", rootFilePath: null }
        : { kind: "unavailable", rootFilePath: null };
}

export function resolveIndexSidebarEmptyStateTexts(options: {
    mode: IndexSidebarMode;
    scopeKind: IndexSidebarModeScope["kind"];
}): readonly string[] | null {
    if (options.scopeKind === "unavailable") {
        return GENERIC_INDEX_EMPTY_STATE_TEXTS;
    }
    if (options.scopeKind === "global-todo") {
        return options.mode === "todo" ? GLOBAL_INDEX_TODO_EMPTY_STATE_TEXTS : null;
    }
    if (options.mode === "todo") {
        return FILE_INDEX_TODO_EMPTY_STATE_TEXTS;
    }
    if (options.mode === "agent") {
        return FILE_INDEX_AGENT_EMPTY_STATE_TEXTS;
    }
    return null;
}

export function shouldShowIndexSidebarSearch(mode: IndexSidebarMode): boolean {
    return mode === "list";
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

export function scopeIndexThreadsByMode(
    visibleThreads: CommentThread[],
    allThreads: CommentThread[],
    scope: IndexSidebarModeScope,
): {
    scopedVisibleThreads: CommentThread[];
    scopedAllThreads: CommentThread[];
} {
    if (scope.kind === "unavailable") {
        return {
            scopedVisibleThreads: [],
            scopedAllThreads: [],
        };
    }

    if (scope.kind === "global-todo") {
        return {
            scopedVisibleThreads: visibleThreads.slice(),
            scopedAllThreads: allThreads.slice(),
        };
    }

    return scopeIndexThreadsByFilePaths(
        visibleThreads,
        allThreads,
        [scope.rootFilePath],
    );
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
