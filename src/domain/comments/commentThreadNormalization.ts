import {
    normalizeDeletedAt,
} from "../../core/rules/deletedCommentVisibility";
import type { CommentThread, CommentThreadEntry } from "./commentThread";

export function cloneCommentThreadEntry(entry: CommentThreadEntry): CommentThreadEntry {
    const deletedAt = normalizeDeletedAt(entry.deletedAt);
    return {
        id: entry.id,
        body: entry.body,
        timestamp: entry.timestamp,
        ...(deletedAt !== undefined ? { deletedAt } : {}),
    };
}

export function cloneCommentThread(thread: CommentThread): CommentThread {
    return {
        ...thread,
        entries: thread.entries.map((entry) => cloneCommentThreadEntry(entry)),
    };
}

export function cloneCommentThreads(threads: CommentThread[]): CommentThread[] {
    return threads.map((thread) => cloneCommentThread(thread));
}

export function getLatestThreadEntry(thread: CommentThread): CommentThreadEntry {
    return thread.entries[thread.entries.length - 1] ?? {
        id: thread.id,
        body: "",
        timestamp: thread.updatedAt || thread.createdAt,
    };
}

export function getFirstThreadEntry(thread: CommentThread): CommentThreadEntry {
    return thread.entries[0] ?? {
        id: thread.id,
        body: "",
        timestamp: thread.createdAt || thread.updatedAt,
    };
}

export function normalizeCommentThread(thread: CommentThread): CommentThread {
    const entries = thread.entries.length > 0
        ? thread.entries.map((entry) => cloneCommentThreadEntry(entry))
        : [{
            id: thread.id,
            body: "",
            timestamp: thread.updatedAt || thread.createdAt,
        }];
    const firstEntry = entries[0];
    const latestEntry = entries[entries.length - 1];

    return {
        ...thread,
        anchorKind: thread.anchorKind === "page" ? "page" : "selection",
        orphaned: thread.anchorKind === "page" ? false : thread.orphaned === true,
        isPinned: thread.isPinned === true,
        resolved: thread.resolved === true,
        deletedAt: normalizeDeletedAt(thread.deletedAt),
        entries,
        createdAt: thread.createdAt || firstEntry.timestamp,
        updatedAt: thread.updatedAt || latestEntry.timestamp,
    };
}
