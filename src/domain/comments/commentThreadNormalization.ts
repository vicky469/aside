import {
    normalizeDeletedAt,
} from "../../core/rules/deletedCommentVisibility";
import type { CommentThread, CommentThreadEntry, CommentThreadEntryAnchor } from "./commentThread";

export function cloneCommentThreadEntryAnchor(anchor: CommentThreadEntryAnchor): CommentThreadEntryAnchor {
    return {
        filePath: anchor.filePath,
        startLine: anchor.startLine,
        startChar: anchor.startChar,
        endLine: anchor.endLine,
        endChar: anchor.endChar,
        selectedText: anchor.selectedText,
        selectedTextHash: anchor.selectedTextHash,
        anchorKind: "selection",
        ...(anchor.orphaned === true ? { orphaned: true } : {}),
    };
}

export function cloneCommentThreadEntry(entry: CommentThreadEntry): CommentThreadEntry {
    const deletedAt = normalizeDeletedAt(entry.deletedAt);
    return {
        id: entry.id,
        body: entry.body,
        timestamp: entry.timestamp,
        ...(deletedAt !== undefined ? { deletedAt } : {}),
        ...(entry.anchor ? { anchor: cloneCommentThreadEntryAnchor(entry.anchor) } : {}),
    };
}

function hasVisibleEntryBody(entry: CommentThreadEntry): boolean {
    return entry.body.trim().length > 0;
}

function mergeDeletedAt(
    currentDeletedAt: number | undefined,
    nextDeletedAt: number | undefined,
): number | undefined {
    if (currentDeletedAt === undefined) {
        return nextDeletedAt;
    }
    if (nextDeletedAt === undefined) {
        return currentDeletedAt;
    }
    return Math.max(currentDeletedAt, nextDeletedAt);
}

function mergeDuplicateCommentThreadEntry(
    current: CommentThreadEntry,
    next: CommentThreadEntry,
): CommentThreadEntry {
    const currentDeletedAt = normalizeDeletedAt(current.deletedAt);
    const nextDeletedAt = normalizeDeletedAt(next.deletedAt);
    const deletedAt = mergeDeletedAt(currentDeletedAt, nextDeletedAt);
    const useNextBody = hasVisibleEntryBody(next)
        && (!hasVisibleEntryBody(current) || next.timestamp >= current.timestamp);
    const anchor = next.anchor && (!current.anchor || next.timestamp >= current.timestamp)
        ? cloneCommentThreadEntryAnchor(next.anchor)
        : current.anchor
            ? cloneCommentThreadEntryAnchor(current.anchor)
            : undefined;

    return {
        id: current.id,
        body: useNextBody ? next.body : current.body,
        timestamp: Math.max(current.timestamp, next.timestamp),
        ...(deletedAt !== undefined ? { deletedAt } : {}),
        ...(anchor ? { anchor } : {}),
    };
}

function deduplicateCommentThreadEntries(entries: CommentThreadEntry[]): CommentThreadEntry[] {
    const deduplicatedEntries: CommentThreadEntry[] = [];
    const entryIndexById = new Map<string, number>();
    for (const entry of entries) {
        const existingIndex = entryIndexById.get(entry.id);
        if (existingIndex === undefined) {
            entryIndexById.set(entry.id, deduplicatedEntries.length);
            deduplicatedEntries.push(entry);
            continue;
        }

        deduplicatedEntries[existingIndex] = mergeDuplicateCommentThreadEntry(
            deduplicatedEntries[existingIndex],
            entry,
        );
    }

    return deduplicatedEntries;
}

type CommentThreadFieldWithoutEntries = Exclude<keyof CommentThread, "entries">;

function cloneCommentThreadWithEntries(
    thread: CommentThread,
    entries: CommentThreadEntry[],
): CommentThread {
    const fields = {
        id: thread.id,
        filePath: thread.filePath,
        startLine: thread.startLine,
        startChar: thread.startChar,
        endLine: thread.endLine,
        endChar: thread.endChar,
        selectedText: thread.selectedText,
        selectedTextHash: thread.selectedTextHash,
        anchorKind: thread.anchorKind,
        orphaned: thread.orphaned,
        isPinned: thread.isPinned,
        deletedAt: thread.deletedAt,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
    } satisfies Record<CommentThreadFieldWithoutEntries, unknown>;

    return {
        id: fields.id,
        filePath: fields.filePath,
        startLine: fields.startLine,
        startChar: fields.startChar,
        endLine: fields.endLine,
        endChar: fields.endChar,
        selectedText: fields.selectedText,
        selectedTextHash: fields.selectedTextHash,
        ...(fields.anchorKind !== undefined ? { anchorKind: fields.anchorKind } : {}),
        ...(fields.orphaned !== undefined ? { orphaned: fields.orphaned } : {}),
        ...(fields.isPinned !== undefined ? { isPinned: fields.isPinned } : {}),
        ...(fields.deletedAt !== undefined ? { deletedAt: fields.deletedAt } : {}),
        entries,
        createdAt: fields.createdAt,
        updatedAt: fields.updatedAt,
    };
}

export function cloneCommentThread(thread: CommentThread): CommentThread {
    return cloneCommentThreadWithEntries(
        thread,
        thread.entries.map((entry) => cloneCommentThreadEntry(entry)),
    );
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
    const entries = deduplicateCommentThreadEntries(thread.entries.length > 0
        ? thread.entries.map((entry) => cloneCommentThreadEntry(entry))
        : [{
            id: thread.id,
            body: "",
            timestamp: thread.updatedAt || thread.createdAt,
        }]);
    const firstEntry = entries[0];
    const latestEntry = entries[entries.length - 1];

    const clonedThread = cloneCommentThreadWithEntries(thread, entries);

    return {
        ...clonedThread,
        anchorKind: thread.anchorKind === "page" ? "page" : "selection",
        orphaned: thread.anchorKind === "page" ? false : thread.orphaned === true,
        isPinned: thread.isPinned === true,
        deletedAt: normalizeDeletedAt(thread.deletedAt),
        createdAt: thread.createdAt || firstEntry.timestamp,
        updatedAt: thread.updatedAt || latestEntry.timestamp,
    };
}
