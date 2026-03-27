export type CommentAnchorKind = "selection" | "page";
export type CommentAnchorStatus = "anchored" | "orphaned" | "page";

interface AnchorLike {
    anchorKind?: CommentAnchorKind;
    orphaned?: boolean;
    selectedText?: string;
    filePath?: string;
}

export function getCommentAnchorKind(comment: AnchorLike): CommentAnchorKind {
    return comment.anchorKind === "page" ? "page" : "selection";
}

export function getCommentAnchorStatus(comment: AnchorLike): CommentAnchorStatus {
    if (getCommentAnchorKind(comment) === "page") {
        return "page";
    }

    return comment.orphaned === true ? "orphaned" : "anchored";
}

export function isPageComment(comment: AnchorLike): boolean {
    return getCommentAnchorKind(comment) === "page";
}

export function isAnchoredComment(comment: AnchorLike): boolean {
    return getCommentAnchorStatus(comment) === "anchored";
}

export function isOrphanedComment(comment: AnchorLike): boolean {
    return getCommentAnchorStatus(comment) === "orphaned";
}

export function getPageCommentLabel(filePath: string): string {
    const lastSegment = filePath.split("/").pop() ?? filePath;
    return lastSegment.replace(/\.md$/i, "") || filePath;
}

export function getCommentSelectionLabel(comment: AnchorLike): string {
    if (isPageComment(comment)) {
        return comment.selectedText?.trim() || getPageCommentLabel(comment.filePath ?? "");
    }

    return comment.selectedText?.trim() || "(blank selection)";
}

export function getCommentStatusLabel(comment: AnchorLike): string {
    const status = getCommentAnchorStatus(comment);
    if (status === "page") {
        return "page note";
    }

    if (status === "orphaned") {
        return "orphaned";
    }

    return "anchored";
}
