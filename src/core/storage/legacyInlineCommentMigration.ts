import type { CommentThread, CommentThreadEntry } from "../../commentManager";
import { normalizeDeletedAt } from "../rules/deletedCommentVisibility";

function cloneThreadEntry(entry: CommentThreadEntry): CommentThreadEntry {
    const deletedAt = normalizeDeletedAt(entry.deletedAt);
    return {
        id: entry.id,
        body: entry.body,
        timestamp: entry.timestamp,
        ...(deletedAt !== undefined ? { deletedAt } : {}),
    };
}

function cloneThread(thread: CommentThread): CommentThread {
    const deletedAt = normalizeDeletedAt(thread.deletedAt);
    return {
        ...thread,
        deletedAt,
        entries: thread.entries.map((entry) => cloneThreadEntry(entry)),
    };
}

function areThreadEntriesEqual(left: CommentThreadEntry, right: CommentThreadEntry): boolean {
    return left.id === right.id
        && left.body === right.body
        && left.timestamp === right.timestamp
        && normalizeDeletedAt(left.deletedAt) === normalizeDeletedAt(right.deletedAt);
}

export function getLegacyInlineConflictEntryId(entryId: string): string {
    return `legacy-inline-conflict-${entryId}`;
}

function createLegacyInlineConflictEntry(entry: CommentThreadEntry): CommentThreadEntry {
    return {
        id: getLegacyInlineConflictEntryId(entry.id),
        body: [
            "Legacy inline Aside block recovery.",
            "",
            "This version was preserved while cleaning up an old source-markdown Aside block:",
            "",
            entry.body,
        ].join("\n"),
        timestamp: entry.timestamp,
    };
}

export function mergeLegacyInlineThreads(
    canonicalThreads: CommentThread[],
    inlineThreads: CommentThread[],
): { threads: CommentThread[]; changed: boolean } {
    const mergedThreads = canonicalThreads.map((thread) => cloneThread(thread));
    const threadIndexesById = new Map(mergedThreads.map((thread, index) => [thread.id, index]));
    let changed = false;

    for (const inlineThread of inlineThreads) {
        const existingIndex = threadIndexesById.get(inlineThread.id);
        if (existingIndex === undefined) {
            threadIndexesById.set(inlineThread.id, mergedThreads.length);
            mergedThreads.push(cloneThread(inlineThread));
            changed = true;
            continue;
        }

        const existingThread = mergedThreads[existingIndex];
        const nextEntries = existingThread.entries.map((entry) => cloneThreadEntry(entry));
        const entriesById = new Map(nextEntries.map((entry) => [entry.id, entry]));
        let threadChanged = false;
        for (const inlineEntry of inlineThread.entries) {
            const existingEntry = entriesById.get(inlineEntry.id);
            if (!existingEntry) {
                nextEntries.push(cloneThreadEntry(inlineEntry));
                threadChanged = true;
                continue;
            }

            if (
                !areThreadEntriesEqual(existingEntry, inlineEntry)
                && !nextEntries.some((entry) => entry.id === getLegacyInlineConflictEntryId(inlineEntry.id))
            ) {
                nextEntries.push(createLegacyInlineConflictEntry(inlineEntry));
                threadChanged = true;
            }
        }

        if (!threadChanged) {
            continue;
        }

        mergedThreads[existingIndex] = {
            ...existingThread,
            entries: nextEntries,
            updatedAt: Math.max(
                existingThread.updatedAt,
                inlineThread.updatedAt,
                ...nextEntries.map((entry) => entry.timestamp),
            ),
        };
        changed = true;
    }

    return {
        threads: mergedThreads,
        changed,
    };
}
