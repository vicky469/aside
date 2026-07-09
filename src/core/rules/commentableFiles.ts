import type { TFile } from "obsidian";
import { isAllCommentsNotePath } from "../derived/allCommentsNote";

export function isMarkdownCommentablePath(filePath: string, allCommentsNotePath?: string): boolean {
    return /\.md$/i.test(filePath) && !isAllCommentsNotePath(filePath, allCommentsNotePath);
}

export function isPdfPageNotePath(filePath: string, allCommentsNotePath?: string): boolean {
    return /\.pdf$/i.test(filePath) && !isAllCommentsNotePath(filePath, allCommentsNotePath);
}

export function isHtmlPageNotePath(filePath: string, allCommentsNotePath?: string): boolean {
    return /\.html?$/i.test(filePath) && !isAllCommentsNotePath(filePath, allCommentsNotePath);
}

export function isPageNoteCapablePath(filePath: string, allCommentsNotePath?: string): boolean {
    return isMarkdownCommentablePath(filePath, allCommentsNotePath)
        || isPdfPageNotePath(filePath, allCommentsNotePath)
        || isHtmlPageNotePath(filePath, allCommentsNotePath);
}

export function isSidebarSupportedPath(filePath: string, allCommentsNotePath?: string): boolean {
    return isAllCommentsNotePath(filePath, allCommentsNotePath)
        || isPageNoteCapablePath(filePath, allCommentsNotePath);
}

export function isMarkdownCommentableFile(file: TFile | null, allCommentsNotePath?: string): file is TFile {
    return !!file && isMarkdownCommentablePath(file.path, allCommentsNotePath);
}

export function isPageNoteCapableFile(file: TFile | null, allCommentsNotePath?: string): file is TFile {
    return !!file && isPageNoteCapablePath(file.path, allCommentsNotePath);
}

export function isSidebarSupportedFile(file: TFile | null, allCommentsNotePath?: string): file is TFile {
    return !!file && isSidebarSupportedPath(file.path, allCommentsNotePath);
}
