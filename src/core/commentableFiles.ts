import type { TFile } from "obsidian";
import { isAllCommentsNotePath } from "./allCommentsNote";

export function isMarkdownCommentablePath(filePath: string, allCommentsNotePath?: string): boolean {
    return /\.md$/i.test(filePath) && !isAllCommentsNotePath(filePath, allCommentsNotePath);
}

export function isAttachmentCommentablePath(filePath: string): boolean {
    return /\.pdf$/i.test(filePath);
}

export function isSidebarSupportedPath(filePath: string, allCommentsNotePath?: string): boolean {
    return isAllCommentsNotePath(filePath, allCommentsNotePath)
        || isMarkdownCommentablePath(filePath, allCommentsNotePath)
        || isAttachmentCommentablePath(filePath);
}

export function isMarkdownCommentableFile(file: TFile | null, allCommentsNotePath?: string): file is TFile {
    return !!file && isMarkdownCommentablePath(file.path, allCommentsNotePath);
}

export function isAttachmentCommentableFile(file: TFile | null): file is TFile {
    return !!file && isAttachmentCommentablePath(file.path);
}

export function isSidebarSupportedFile(file: TFile | null, allCommentsNotePath?: string): file is TFile {
    return !!file && isSidebarSupportedPath(file.path, allCommentsNotePath);
}
