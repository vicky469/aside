import type { CommentThread } from "../../commentManager";
import { parseAgentDirectives } from "../../core/text/agentDirectives";
import type { DraftComment } from "../../domain/drafts";

export type SidebarContentFilter = "all" | "bookmarks" | "agents";

function normalizeSidebarSearchText(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function matchesNormalizedSidebarSearchValue(value: string | null | undefined, normalizedQuery: string): boolean {
    if (!normalizedQuery) {
        return true;
    }

    if (!value) {
        return false;
    }

    return normalizeSidebarSearchText(value).includes(normalizedQuery);
}

export function isBookmarkThread(thread: Pick<CommentThread, "isBookmark">): boolean {
    return thread.isBookmark === true;
}

export function isAgentThread(thread: Pick<CommentThread, "entries">): boolean {
    return thread.entries.some((entry) => parseAgentDirectives(entry.body).matchedTargets.length > 0);
}

export function matchesSidebarContentFilter(
    thread: Pick<CommentThread, "entries" | "isBookmark">,
    filter: SidebarContentFilter,
): boolean {
    switch (filter) {
        case "bookmarks":
            return isBookmarkThread(thread);
        case "agents":
            return isAgentThread(thread);
        case "all":
        default:
            return true;
    }
}

export function filterThreadsBySidebarContentFilter<T extends Pick<CommentThread, "entries" | "isBookmark">>(
    threads: readonly T[],
    filter: SidebarContentFilter,
): T[] {
    return threads.filter((thread) => matchesSidebarContentFilter(thread, filter));
}

export function filterThreadsByPinnedSidebarThreadIds<T extends Pick<CommentThread, "id">>(
    threads: readonly T[],
    pinnedThreadIds: ReadonlySet<string>,
): T[] {
    if (pinnedThreadIds.size === 0) {
        return threads.slice();
    }

    return threads.filter((thread) => pinnedThreadIds.has(thread.id));
}

export function filterThreadsByPinnedSidebarViewState<T extends Pick<CommentThread, "id">>(
    threads: readonly T[],
    pinnedThreadIds: ReadonlySet<string>,
    showPinnedThreadsOnly: boolean,
): T[] {
    if (!showPinnedThreadsOnly) {
        return threads.slice();
    }

    if (pinnedThreadIds.size === 0) {
        return [];
    }

    return filterThreadsByPinnedSidebarThreadIds(threads, pinnedThreadIds);
}

export function toggleSidebarContentFilterState(
    currentFilter: SidebarContentFilter,
    requestedFilter: SidebarContentFilter,
    pinnedThreadIds: ReadonlySet<string> = new Set(),
): {
    filter: SidebarContentFilter;
    pinnedThreadIds: Set<string>;
} {
    const nextFilter = currentFilter === requestedFilter ? "all" : requestedFilter;
    return {
        filter: nextFilter,
        pinnedThreadIds: new Set(pinnedThreadIds),
    };
}

export function toggleDeletedSidebarViewState(options: {
    showDeleted: boolean;
    showResolved: boolean;
    contentFilter: SidebarContentFilter;
    showPinnedThreadsOnly: boolean;
    pinnedThreadIds: ReadonlySet<string>;
    searchQuery: string;
    searchInputValue: string;
}): {
    showDeleted: boolean;
    showResolved: boolean;
    contentFilter: SidebarContentFilter;
    showPinnedThreadsOnly: boolean;
    pinnedThreadIds: Set<string>;
    searchQuery: string;
    searchInputValue: string;
} {
    if (options.showDeleted) {
        return {
            showDeleted: false,
            showResolved: options.showResolved,
            contentFilter: options.contentFilter,
            showPinnedThreadsOnly: options.showPinnedThreadsOnly,
            pinnedThreadIds: new Set(options.pinnedThreadIds),
            searchQuery: options.searchQuery,
            searchInputValue: options.searchInputValue,
        };
    }

    return {
        showDeleted: true,
        showResolved: false,
        contentFilter: "all",
        showPinnedThreadsOnly: false,
        pinnedThreadIds: new Set(options.pinnedThreadIds),
        searchQuery: "",
        searchInputValue: "",
    };
}

export function matchesSidebarThreadSearchQuery<T extends Pick<CommentThread, "selectedText" | "entries">>(
    thread: T,
    query: string,
): boolean {
    const normalizedQuery = normalizeSidebarSearchText(query);
    if (!normalizedQuery) {
        return true;
    }

    return matchesNormalizedSidebarSearchValue(thread.selectedText, normalizedQuery)
        || thread.entries.some((entry) => matchesNormalizedSidebarSearchValue(entry.body, normalizedQuery));
}

export function filterThreadsBySidebarSearchQuery<T extends Pick<CommentThread, "selectedText" | "entries">>(
    threads: readonly T[],
    query: string,
): T[] {
    return threads.filter((thread) => matchesSidebarThreadSearchQuery(thread, query));
}

export function matchesSidebarDraftSearchQuery(
    draft: Pick<DraftComment, "selectedText" | "comment">,
    query: string,
): boolean {
    const normalizedQuery = normalizeSidebarSearchText(query);
    if (!normalizedQuery) {
        return true;
    }

    return matchesNormalizedSidebarSearchValue(draft.selectedText, normalizedQuery)
        || matchesNormalizedSidebarSearchValue(draft.comment, normalizedQuery);
}

export function countBookmarkThreads<T extends Pick<CommentThread, "isBookmark">>(threads: readonly T[]): number {
    return threads.filter((thread) => isBookmarkThread(thread)).length;
}

export function countAgentThreads<T extends Pick<CommentThread, "entries">>(threads: readonly T[]): number {
    return threads.filter((thread) => isAgentThread(thread)).length;
}

export function unlockSidebarContentFilterForDraft(
    filter: SidebarContentFilter,
    draft: Pick<DraftComment, "mode"> | null,
): SidebarContentFilter {
    return draft?.mode === "new" ? "all" : filter;
}
