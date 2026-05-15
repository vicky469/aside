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
    matches?(selector: string): boolean;
    closest(selector: string): {
        dataset?: Record<string, string | undefined>;
        getAttribute(name: string): string | null;
        querySelector?(selector: string): unknown;
    } | null;
}

const INDEX_NATIVE_COLLAPSE_CONTROL_SELECTOR = [
    ".heading-collapse-indicator",
    ".collapse-indicator",
    ".collapse-icon",
    ".cm-fold-indicator",
].join(", ");
const INDEX_COMMENT_LINK_SELECTOR = "a.aside-index-comment-link[data-aside-comment-url]";
const INDEX_FILE_HEADING_SELECTOR = ".aside-index-heading-label[title], a[data-aside-file-path]";
const INDEX_FILE_LINK_SELECTOR = "a[href^=\"obsidian://open\"], a[href^=\"obsidian://aside-index-file\"]";
const INDEX_ROW_SELECTOR = "p, li";
const INDEX_PREVIEW_BACKGROUND_SELECTOR = [
    ".aside-index-note-view .markdown-preview-view",
    ".aside-index-note-view .markdown-preview-sizer",
    ".aside-index-note-view .markdown-preview-section",
].join(", ");
const INDEX_ACTIONABLE_TARGET_SELECTOR = [
    INDEX_COMMENT_LINK_SELECTOR,
    INDEX_FILE_HEADING_SELECTOR,
    INDEX_FILE_LINK_SELECTOR,
].join(", ");

export function isIndexNativeCollapseControlTarget(target: ClosestLookupTarget | null): boolean {
    return !!target?.closest(INDEX_NATIVE_COLLAPSE_CONTROL_SELECTOR);
}

export function shouldUseIndexLivePreviewLineFallback(_target: unknown, _lineElement: unknown): boolean {
    return false;
}

export function shouldUseIndexPreviewRowActivator(_target: unknown, _rowElement: unknown): boolean {
    return false;
}

export function shouldBlockIndexPreviewBackgroundTarget(target: ClosestLookupTarget | null): boolean {
    if (!target || isIndexNativeCollapseControlTarget(target)) {
        return false;
    }

    if (findClickedIndexLivePreviewTarget(target)) {
        return false;
    }

    const row = target.closest(INDEX_ROW_SELECTOR);
    if (typeof row?.querySelector === "function"
        && !!row.querySelector(INDEX_ACTIONABLE_TARGET_SELECTOR)) {
        return true;
    }

    return typeof target.matches === "function"
        && target.matches(INDEX_PREVIEW_BACKGROUND_SELECTOR);
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
    const commentUrl = commentLink?.dataset?.asideCommentUrl ?? "";
    const commentTarget = commentUrl ? parseCommentLocationUrl(commentUrl) : null;
    if (commentTarget) {
        return {
            kind: "comment",
            ...commentTarget,
        };
    }

    const fileHeading = target.closest(INDEX_FILE_HEADING_SELECTOR);
    const filePath = fileHeading?.dataset?.asideFilePath?.trim()
        || fileHeading?.getAttribute("title")?.trim()
        || "";
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
