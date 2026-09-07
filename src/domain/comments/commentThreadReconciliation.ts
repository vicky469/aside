import type { CommentThread } from "./commentThread";
import {
    cloneCommentThread,
    cloneCommentThreadEntry,
} from "./commentThreadNormalization";

export interface CommentThreadReconciliationResult {
    threads: CommentThread[];
    removedRootThreadIds: string[];
}

export function reconcileAnchoredNestedThreadDuplicates(
    sourceThreads: readonly CommentThread[],
): CommentThreadReconciliationResult {
    const threads = sourceThreads.map((thread) => cloneCommentThread(thread));
    const removedRootThreadIds: string[] = [];
    const removedRootThreadIdSet = new Set<string>();

    for (const sourceThread of threads) {
        const targetThread = threads.find((candidate) => (
            candidate.id !== sourceThread.id
            && candidate.entries.some((entry) => entry.id === sourceThread.id && !!entry.anchor)
        ));
        if (!targetThread) {
            continue;
        }

        const nestedEntryIndex = targetThread.entries.findIndex((entry) => (
            entry.id === sourceThread.id && !!entry.anchor
        ));
        const existingEntryIds = new Set(targetThread.entries.map((entry) => entry.id));
        const missingEntries = sourceThread.entries
            .filter((entry) => !existingEntryIds.has(entry.id))
            .map((entry) => cloneCommentThreadEntry(entry));
        if (missingEntries.length > 0) {
            targetThread.entries.splice(nestedEntryIndex + 1, 0, ...missingEntries);
        }
        targetThread.updatedAt = Math.max(targetThread.updatedAt, sourceThread.updatedAt);
        removedRootThreadIdSet.add(sourceThread.id);
        removedRootThreadIds.push(sourceThread.id);
    }

    return {
        threads: threads.filter((thread) => !removedRootThreadIdSet.has(thread.id)),
        removedRootThreadIds,
    };
}
