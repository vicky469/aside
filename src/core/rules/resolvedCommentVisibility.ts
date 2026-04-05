export interface ResolvedCommentLike {
    resolved?: boolean;
}

export function matchesResolvedCommentVisibility(
    comment: ResolvedCommentLike,
    showResolved: boolean,
): boolean {
    return showResolved
        ? comment.resolved === true
        : comment.resolved !== true;
}

export function filterCommentsByResolvedVisibility<T extends ResolvedCommentLike>(
    comments: readonly T[],
    showResolved: boolean,
): T[] {
    return comments.filter((comment) => matchesResolvedCommentVisibility(comment, showResolved));
}
