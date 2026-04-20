import type { CommentThread } from "../../commentManager";
import { parseAgentDirectives } from "../../core/text/agentDirectives";
import type { DraftComment } from "../../domain/drafts";

export type SidebarContentFilter = "all" | "bookmarks" | "agents";

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
