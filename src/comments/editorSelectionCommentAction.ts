export type EditorSelectionCommentAction = "add-comment" | "orphan-anchor";

export const EDITOR_SELECTION_COMMENT_ACTION_LABELS: Record<EditorSelectionCommentAction, string> = {
    "add-comment": "Add comment to selection",
    "orphan-anchor": "Remove anchor from side note",
};

export interface EditorSelectionAnchorRange {
    filePath: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    selectedText: string;
}

export interface EditorSelectionAnchorCandidate extends EditorSelectionAnchorRange {
    id: string;
    anchorKind?: "selection" | "page";
    orphaned?: boolean;
    deletedAt?: number;
}

export function findMatchingEditorSelectionAnchor<T extends EditorSelectionAnchorCandidate>(
    comments: readonly T[],
    selection: EditorSelectionAnchorRange | null,
): T | null {
    if (!selection || !selection.selectedText.trim()) {
        return null;
    }

    return comments.find((comment) =>
        comment.filePath === selection.filePath
        && comment.anchorKind !== "page"
        && comment.orphaned !== true
        && comment.deletedAt === undefined
        && comment.startLine === selection.startLine
        && comment.startChar === selection.startChar
        && comment.endLine === selection.endLine
        && comment.endChar === selection.endChar
        && comment.selectedText === selection.selectedText) ?? null;
}
