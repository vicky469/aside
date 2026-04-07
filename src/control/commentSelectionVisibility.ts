import type { Comment, CommentThread } from "../commentManager";

export function getResolvedVisibilityForCommentSelection(
    comment: Pick<Comment, "resolved"> | null,
    showResolvedComments: boolean,
): boolean | null {
    if (!comment) {
        return null;
    }

    const nextShowResolved = comment.resolved === true;
    return nextShowResolved === showResolvedComments
        ? null
        : nextShowResolved;
}

export function shouldEnableResolvedVisibilityForComment(
    comment: Pick<Comment, "resolved"> | null,
    showResolvedComments: boolean,
): boolean {
    return getResolvedVisibilityForCommentSelection(comment, showResolvedComments) === true;
}

export function shouldExpandChildCommentsForSelection(
    thread: Pick<CommentThread, "entries"> | null,
    commentId: string,
): boolean {
    return !!thread
        && thread.entries.length > 1
        && thread.entries.slice(1).some((entry) => entry.id === commentId);
}
