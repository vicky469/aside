import type { TFile } from "obsidian";
import type { Comment } from "./comments/commentProjection";
import type { CommentAnchorKind } from "./comments/commentThread";

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

export function canSaveDraftWithoutComment(
    draft: Pick<DraftComment, "mode" | "anchorKind">,
): boolean {
    return draft.mode === "new" && draft.anchorKind !== "page";
}
