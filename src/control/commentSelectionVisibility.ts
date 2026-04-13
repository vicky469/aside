import type { Comment } from "../commentManager";

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
