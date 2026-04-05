import type { CommentAnchorKind } from "./commentAnchors";
import { isPageComment } from "./commentAnchors";

export type CommentSectionKey = "page" | "anchored";

export interface SectionedCommentLike {
    filePath: string;
    startLine: number;
    startChar: number;
    timestamp: number;
    anchorKind?: CommentAnchorKind;
}

export const COMMENT_SECTION_DEFINITIONS: Array<{ key: CommentSectionKey; title: string }> = [
    {
        key: "page",
        title: "Page notes",
    },
    {
        key: "anchored",
        title: "Anchored notes",
    },
];

export function getCommentSectionKey(comment: Pick<SectionedCommentLike, "anchorKind">): CommentSectionKey {
    return isPageComment(comment) ? "page" : "anchored";
}

export function compareCommentsForSidebarOrder<T extends SectionedCommentLike>(left: T, right: T): number {
    if (left.filePath !== right.filePath) {
        return left.filePath.localeCompare(right.filePath);
    }
    const leftSection = getCommentSectionKey(left);
    const rightSection = getCommentSectionKey(right);
    if (leftSection !== rightSection) {
        return leftSection === "page" ? -1 : 1;
    }
    if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine;
    }
    if (left.startChar !== right.startChar) {
        return left.startChar - right.startChar;
    }

    return left.timestamp - right.timestamp;
}
