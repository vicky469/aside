export type CommentAnchorKind = "selection" | "page";

export interface CommentThreadEntry {
    id: string;
    body: string;
    timestamp: number;
    deletedAt?: number;
}

export interface CommentThread {
    id: string;
    filePath: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    selectedText: string;
    selectedTextHash: string;
    anchorKind?: CommentAnchorKind;
    orphaned?: boolean;
    isPinned?: boolean;
    deletedAt?: number;
    entries: CommentThreadEntry[];
    createdAt: number;
    updatedAt: number;
}

export interface CommentQueryOptions {
    includeDeleted?: boolean;
}

export type ReorderPlacement = "before" | "after";
