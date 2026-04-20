import type { TFile } from "obsidian";
import type { CommentAnchorKind } from "../commentManager";
import type { Comment } from "../commentManager";

export interface DraftComment extends Comment {
    mode: "new" | "edit" | "append";
    threadId?: string;
    appendAfterCommentId?: string;
}

export interface DraftSelection {
    file: TFile;
    selectedText: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    anchorKind?: CommentAnchorKind;
}
