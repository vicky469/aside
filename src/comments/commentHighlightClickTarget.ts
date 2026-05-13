type ClosestCommentTarget = {
    closest?: (selector: string) => {
        getAttribute?: (name: string) => string | null;
    } | null;
};

export function findClickedHighlightCommentId(target: unknown): string | null {
    if (!target || typeof target !== "object") {
        return null;
    }

    const closestTarget = target as ClosestCommentTarget;
    if (typeof closestTarget.closest !== "function") {
        return null;
    }

    const highlightEl = closestTarget.closest(".aside-highlight");
    if (!highlightEl || typeof highlightEl.getAttribute !== "function") {
        return null;
    }

    const commentId = highlightEl.getAttribute("data-comment-id")?.trim();
    return commentId || null;
}
