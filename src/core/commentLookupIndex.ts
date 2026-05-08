import type { CommentThread, CommentThreadEntry } from "../commentManager";

export interface CommentEntryLookup {
    thread: CommentThread;
    entry: CommentThreadEntry;
}

export interface CommentLookupIndexes {
    threadsByFilePath: Map<string, CommentThread[]>;
    threadByThreadId: Map<string, CommentThread>;
    threadByEntryId: Map<string, CommentThread>;
    entryById: Map<string, CommentEntryLookup>;
}

export function buildCommentLookupIndexes(threads: readonly CommentThread[]): CommentLookupIndexes {
    const threadsByFilePath = new Map<string, CommentThread[]>();
    const threadByThreadId = new Map<string, CommentThread>();
    const threadByEntryId = new Map<string, CommentThread>();
    const entryById = new Map<string, CommentEntryLookup>();

    for (const thread of threads) {
        const fileThreads = threadsByFilePath.get(thread.filePath);
        if (fileThreads) {
            fileThreads.push(thread);
        } else {
            threadsByFilePath.set(thread.filePath, [thread]);
        }

        threadByThreadId.set(thread.id, thread);
        for (const entry of thread.entries) {
            threadByEntryId.set(entry.id, thread);
            entryById.set(entry.id, { thread, entry });
        }
    }

    return {
        threadsByFilePath,
        threadByThreadId,
        threadByEntryId,
        entryById,
    };
}
