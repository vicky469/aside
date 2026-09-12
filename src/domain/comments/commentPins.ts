import type { CommentThread, CommentThreadEntry } from "./commentThread";

export function getPinnedCommentThreadIds(threads: readonly Pick<CommentThread, "id" | "isPinned" | "entries">[]): Set<string> {
    return new Set(threads.filter((thread) => thread.isPinned === true
        || thread.entries.slice(1).some((entry) => entry.isPinned === true && !entry.deletedAt))
        .map((thread) => thread.id));
}

export function getPinnedEntriesWithParentContext(
    entries: readonly CommentThreadEntry[],
    preserveEntryIds: ReadonlySet<string> = new Set(),
): CommentThreadEntry[] {
    return entries.filter((entry, index) => index === 0 || entry.isPinned === true || preserveEntryIds.has(entry.id));
}
