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

export function filterThreadsByStableSidebarContentFilter<
    T extends Pick<CommentThread, "entries" | "id" | "isBookmark">,
>(
    threads: readonly T[],
    filter: SidebarContentFilter,
    retainedBookmarkThreadIds: ReadonlySet<string> = new Set(),
): {
    retainedBookmarkThreadIds: Set<string>;
    threads: T[];
} {
    if (filter !== "bookmarks") {
        return {
            retainedBookmarkThreadIds: new Set(),
            threads: filterThreadsBySidebarContentFilter(threads, filter),
        };
    }

    const filteredThreads = threads.filter((thread) =>
        isBookmarkThread(thread) || retainedBookmarkThreadIds.has(thread.id)
    );
    return {
        retainedBookmarkThreadIds: new Set(filteredThreads.map((thread) => thread.id)),
        threads: filteredThreads,
    };
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
