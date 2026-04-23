import { parseCommentLocationUrl } from "../core/derived/allCommentsNote";

export type IndexLivePreviewClickTarget =
    | {
        kind: "comment";
        commentId: string;
        filePath: string;
    }
    | {
        kind: "file";
        filePath: string;
    };

export interface ClosestLookupTarget {
    closest(selector: string): {
        dataset?: Record<string, string | undefined>;
        getAttribute(name: string): string | null;
    } | null;
}

export function findClickedIndexLivePreviewTarget(
    target: ClosestLookupTarget | null,
): IndexLivePreviewClickTarget | null {
    if (!target) {
        return null;
    }

    const commentLink = target.closest("a.sidenote2-index-comment-link[data-sidenote2-comment-url]");
    const commentUrl = commentLink?.dataset?.sidenote2CommentUrl ?? "";
    const commentTarget = commentUrl ? parseCommentLocationUrl(commentUrl) : null;
    if (commentTarget) {
        return {
            kind: "comment",
            ...commentTarget,
        };
    }

    const fileHeading = target.closest(".sidenote2-index-heading-label[title]");
    const filePath = fileHeading?.getAttribute("title")?.trim() ?? "";
    if (filePath) {
        return {
            kind: "file",
            filePath,
        };
    }

    return null;
}
