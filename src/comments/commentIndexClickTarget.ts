import {
    parseCommentLocationUrl,
    parseIndexFileOpenUrl,
} from "../core/derived/allCommentsNote";

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

const INDEX_NATIVE_COLLAPSE_CONTROL_SELECTOR = [
    ".heading-collapse-indicator",
    ".collapse-indicator",
    ".collapse-icon",
    ".cm-fold-indicator",
].join(", ");
const INDEX_COMMENT_LINK_SELECTOR = "a.sidenote2-index-comment-link[data-sidenote2-comment-url]";
const INDEX_FILE_HEADING_SELECTOR = ".sidenote2-index-heading-label[title]";
const INDEX_FILE_LINK_SELECTOR = "a[href^=\"obsidian://open\"]";

export function isIndexNativeCollapseControlTarget(target: ClosestLookupTarget | null): boolean {
    return !!target?.closest(INDEX_NATIVE_COLLAPSE_CONTROL_SELECTOR);
}

export function findClickedIndexLivePreviewTarget(
    target: ClosestLookupTarget | null,
): IndexLivePreviewClickTarget | null {
    if (!target) {
        return null;
    }

    if (isIndexNativeCollapseControlTarget(target)) {
        return null;
    }

    const commentLink = target.closest(INDEX_COMMENT_LINK_SELECTOR);
    const commentUrl = commentLink?.dataset?.sidenote2CommentUrl ?? "";
    const commentTarget = commentUrl ? parseCommentLocationUrl(commentUrl) : null;
    if (commentTarget) {
        return {
            kind: "comment",
            ...commentTarget,
        };
    }

    const fileHeading = target.closest(INDEX_FILE_HEADING_SELECTOR);
    const filePath = fileHeading?.getAttribute("title")?.trim() ?? "";
    if (filePath) {
        return {
            kind: "file",
            filePath,
        };
    }

    const fileLink = target.closest(INDEX_FILE_LINK_SELECTOR);
    const linkedFilePath = parseIndexFileOpenUrl(fileLink?.getAttribute("href")?.trim() ?? "");
    if (linkedFilePath) {
        return {
            kind: "file",
            filePath: linkedFilePath,
        };
    }

    return null;
}
