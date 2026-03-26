import type { Comment } from "../commentManager";

interface ManagedCommentPersistDecisionOptions {
    isEditorFocused: boolean;
    fileContent: string;
    rewrittenContent: string;
}

export function shouldDeferManagedCommentPersist(options: ManagedCommentPersistDecisionOptions): boolean {
    return options.isEditorFocused && options.fileContent !== options.rewrittenContent;
}

export function chooseCommentStateForOpenEditor(
    inMemoryComments: Comment[],
    parsedComments: Comment[],
): Comment[] {
    return inMemoryComments.length > 0 || parsedComments.length === 0
        ? inMemoryComments
        : parsedComments;
}
