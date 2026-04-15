import type { Comment, CommentThread } from "../../commentManager";
import { threadToComment } from "../../commentManager";

interface ManagedCommentPersistDecisionOptions {
    isEditorFocused: boolean;
    fileContent: string;
    rewrittenContent: string;
}

interface LoadedCommentManager {
    replaceThreadsForFile(filePath: string, nextThreads: CommentThread[]): void;
    updateCommentCoordinatesForFile(fileContent: string, filePath: string): void | Promise<void>;
    getThreadsForFile(filePath: string): CommentThread[];
}

interface LoadedCommentIndex {
    updateFile(filePath: string, items: Array<Comment | CommentThread>): void;
}

export interface SyncedThreadState {
    threads: CommentThread[];
    comments: Comment[];
}

export function shouldDeferManagedCommentPersist(options: ManagedCommentPersistDecisionOptions): boolean {
    return options.isEditorFocused && options.fileContent !== options.rewrittenContent;
}

export async function syncLoadedCommentsForCurrentNote(
    filePath: string,
    mainContent: string,
    parsedThreads: CommentThread[],
    commentManager: LoadedCommentManager,
    aggregateCommentIndex: LoadedCommentIndex,
): Promise<SyncedThreadState> {
    commentManager.replaceThreadsForFile(
        filePath,
        parsedThreads.map((thread) => ({
            ...thread,
            entries: thread.entries.map((entry) => ({ ...entry })),
        })),
    );

    await commentManager.updateCommentCoordinatesForFile(mainContent, filePath);

    const syncedThreads = commentManager
        .getThreadsForFile(filePath)
        .map((thread) => ({
            ...thread,
            entries: thread.entries.map((entry) => ({ ...entry })),
        }));
    const syncedComments = syncedThreads.map((thread) => threadToComment(thread));

    aggregateCommentIndex.updateFile(filePath, syncedThreads);

    return {
        threads: syncedThreads,
        comments: syncedComments,
    };
}

export function chooseCommentStateForOpenEditor(
    inMemoryComments: Comment[],
    parsedComments: Comment[],
): Comment[] {
    return inMemoryComments.length > 0 || parsedComments.length === 0
        ? inMemoryComments
        : parsedComments;
}
