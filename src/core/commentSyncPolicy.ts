import type { Comment } from "../commentManager";

interface ManagedCommentPersistDecisionOptions {
    isEditorFocused: boolean;
    fileContent: string;
    rewrittenContent: string;
}

interface LoadedCommentManager {
    replaceCommentsForFile(filePath: string, nextComments: Comment[]): void;
    updateCommentCoordinatesForFile(fileContent: string, filePath: string): Promise<void>;
    getCommentsForFile(filePath: string): Comment[];
}

interface LoadedCommentIndex {
    updateFile(filePath: string, comments: Comment[]): void;
}

export function shouldDeferManagedCommentPersist(options: ManagedCommentPersistDecisionOptions): boolean {
    return options.isEditorFocused && options.fileContent !== options.rewrittenContent;
}

export async function syncLoadedCommentsForCurrentNote(
    filePath: string,
    mainContent: string,
    parsedComments: Comment[],
    commentManager: LoadedCommentManager,
    aggregateCommentIndex: LoadedCommentIndex,
): Promise<Comment[]> {
    commentManager.replaceCommentsForFile(
        filePath,
        parsedComments.map((comment) => ({ ...comment })),
    );

    await commentManager.updateCommentCoordinatesForFile(mainContent, filePath);

    const syncedComments = commentManager
        .getCommentsForFile(filePath)
        .map((comment) => ({ ...comment }));

    aggregateCommentIndex.updateFile(
        filePath,
        syncedComments.map((comment) => ({ ...comment })),
    );

    return syncedComments;
}

export function chooseCommentStateForOpenEditor(
    inMemoryComments: Comment[],
    parsedComments: Comment[],
): Comment[] {
    return inMemoryComments.length > 0 || parsedComments.length === 0
        ? inMemoryComments
        : parsedComments;
}
