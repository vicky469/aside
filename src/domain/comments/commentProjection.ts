import {
    normalizeDeletedAt,
} from "../../core/rules/deletedCommentVisibility";
import type { CommentAnchorKind, CommentThread, CommentThreadEntry } from "./commentThread";
import {
    getLatestThreadEntry,
    normalizeCommentThread,
} from "./commentThreadNormalization";

export interface Comment {
    id: string;
    filePath: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    selectedText: string;
    selectedTextHash: string;
    comment: string;
    timestamp: number;
    anchorKind?: CommentAnchorKind;
    orphaned?: boolean;
    isPinned?: boolean;
    deletedAt?: number;
    entryCount?: number;
}

export function isCommentThreadLike(value: Comment | CommentThread): value is CommentThread {
    return Array.isArray((value as CommentThread).entries);
}

export function commentToThread(comment: Comment): CommentThread {
    return normalizeCommentThread({
        id: comment.id,
        filePath: comment.filePath,
        startLine: comment.startLine,
        startChar: comment.startChar,
        endLine: comment.endLine,
        endChar: comment.endChar,
        selectedText: comment.selectedText,
        selectedTextHash: comment.selectedTextHash,
        anchorKind: comment.anchorKind === "page" ? "page" : "selection",
        orphaned: comment.orphaned === true,
        isPinned: comment.isPinned === true,
        deletedAt: normalizeDeletedAt(comment.deletedAt),
        entries: [{
            id: comment.id,
            body: comment.comment,
            timestamp: comment.timestamp,
            deletedAt: normalizeDeletedAt(comment.deletedAt),
        }],
        createdAt: comment.timestamp,
        updatedAt: comment.timestamp,
    });
}

export function threadToComment(thread: CommentThread): Comment {
    const normalized = normalizeCommentThread(thread);
    const latestEntry = getLatestThreadEntry(normalized);
    return {
        ...threadEntryToComment(normalized, latestEntry),
        id: normalized.id,
        isPinned: normalized.isPinned === true,
    };
}

export function threadEntryToComment(thread: CommentThread, entry: CommentThreadEntry): Comment {
    const normalized = normalizeCommentThread(thread);
    const deletedAt = normalizeDeletedAt(entry.deletedAt) ?? normalized.deletedAt;
    const anchor = entry.anchor;

    return {
        id: entry.id,
        filePath: anchor?.filePath ?? normalized.filePath,
        startLine: anchor?.startLine ?? normalized.startLine,
        startChar: anchor?.startChar ?? normalized.startChar,
        endLine: anchor?.endLine ?? normalized.endLine,
        endChar: anchor?.endChar ?? normalized.endChar,
        selectedText: anchor?.selectedText ?? normalized.selectedText,
        selectedTextHash: anchor?.selectedTextHash ?? normalized.selectedTextHash,
        comment: entry.body,
        timestamp: entry.timestamp,
        anchorKind: anchor ? "selection" : normalized.anchorKind,
        orphaned: anchor ? anchor.orphaned === true : normalized.orphaned === true,
        ...(normalized.id === entry.id && normalized.isPinned === true ? { isPinned: true } : {}),
        ...(deletedAt !== undefined ? { deletedAt } : {}),
        entryCount: normalized.entries.length,
    };
}
