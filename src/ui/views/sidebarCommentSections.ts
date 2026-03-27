import type { CommentAnchorKind } from "../../commentManager";
import { isOrphanedComment, isPageComment } from "../../core/commentAnchors";

export type SidebarSectionKey = "page" | "anchored";

export interface SidebarCommentPresentationLike {
    timestamp: number;
    resolved?: boolean;
    anchorKind?: CommentAnchorKind;
    orphaned?: boolean;
}

export interface SidebarSection<T> {
    key: SidebarSectionKey;
    title: string;
    comments: T[];
}

function formatCommentTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
    });
}

export function formatSidebarCommentMeta(comment: SidebarCommentPresentationLike): string {
    const segments = [formatCommentTimestamp(comment.timestamp)];

    if (isOrphanedComment(comment)) {
        segments.push("orphaned");
    }
    if (comment.resolved) {
        segments.push("resolved");
    }

    return segments.join(" · ");
}

export function getSidebarSectionKey(comment: SidebarCommentPresentationLike): SidebarSectionKey {
    return isPageComment(comment) ? "page" : "anchored";
}

export function buildSidebarSections<T extends SidebarCommentPresentationLike>(comments: T[]): SidebarSection<T>[] {
    const pageComments = comments.filter((comment) => getSidebarSectionKey(comment) === "page");
    const anchoredComments = comments.filter((comment) => getSidebarSectionKey(comment) === "anchored");
    return [
        {
            key: "page",
            title: "Page notes",
            comments: pageComments,
        },
        {
            key: "anchored",
            title: "Anchored notes",
            comments: anchoredComments,
        },
    ];
}
