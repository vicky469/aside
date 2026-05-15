import type { TFile } from "obsidian";
import { isAllCommentsNotePath } from "../derived/allCommentsNote";

const IGNORED_COMMENTABLE_PATH_SEGMENTS = new Set([
    "node_modules",
]);

function isIgnoredCommentablePath(filePath: string): boolean {
    return filePath
        .replace(/\\/g, "/")
        .split("/")
        .some((segment) => segment.startsWith(".") || IGNORED_COMMENTABLE_PATH_SEGMENTS.has(segment));
}

export function isMarkdownCommentablePath(filePath: string, allCommentsNotePath?: string): boolean {
    return /\.md$/i.test(filePath)
        && !isAllCommentsNotePath(filePath, allCommentsNotePath)
        && !isIgnoredCommentablePath(filePath);
}

export function isSidebarSupportedPath(filePath: string, allCommentsNotePath?: string): boolean {
    return isAllCommentsNotePath(filePath, allCommentsNotePath)
        || isMarkdownCommentablePath(filePath, allCommentsNotePath);
}

export function isMarkdownCommentableFile(file: TFile | null, allCommentsNotePath?: string): file is TFile {
    return !!file && isMarkdownCommentablePath(file.path, allCommentsNotePath);
}

export function isSidebarSupportedFile(file: TFile | null, allCommentsNotePath?: string): file is TFile {
    return !!file && isSidebarSupportedPath(file.path, allCommentsNotePath);
}
