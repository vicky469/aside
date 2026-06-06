import type { Comment } from "../../commentManager";
import { resolveAnchorRange } from "../anchors/anchorResolver";
import { isAnchoredComment } from "../anchors/commentAnchors";
import { sortCommentsByPosition } from "../storage/noteCommentStorage";

export interface EditorHighlightRange {
    commentId: string;
    from: number;
    to: number;
    active: boolean;
}

function buildLineStartOffsets(text: string): number[] {
    const lineStarts = [0];
    for (let index = 0; index < text.length; index += 1) {
        if (text.charCodeAt(index) === 10) {
            lineStarts.push(index + 1);
        }
    }

    return lineStarts;
}

function lineChToOffset(text: string, lineStarts: readonly number[], line: number, ch: number): number | null {
    if (line < 0 || ch < 0) {
        return null;
    }

    const lineStart = lineStarts[line];
    if (lineStart === undefined) {
        return null;
    }

    const nextLineStart = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length + 1;
    const lineLength = nextLineStart - lineStart - (line + 1 < lineStarts.length ? 1 : 0);
    if (ch > lineLength) {
        return null;
    }

    return lineStart + ch;
}

function getVisibleCommentsForHighlighting(
    storedComments: Comment[],
    draftComment: Comment | null,
): Comment[] {
    const commentsWithoutDraft = draftComment
        ? storedComments.filter((comment) => comment.id !== draftComment.id)
        : storedComments.slice();

    return sortCommentsByPosition(
        (draftComment ? commentsWithoutDraft.concat(draftComment) : commentsWithoutDraft)
            .filter((comment) => isAnchoredComment(comment))
    );
}

export function buildEditorHighlightRanges(
    docText: string,
    searchableText: string,
    storedComments: Comment[],
    draftComment: Comment | null,
    activeCommentId: string | null,
): EditorHighlightRange[] {
    const comments = getVisibleCommentsForHighlighting(
        storedComments,
        draftComment,
    );
    if (!comments.length) {
        return [];
    }

    const lineStarts = buildLineStartOffsets(docText);
    const ranges: EditorHighlightRange[] = [];

    comments.forEach((comment) => {
        let from = -1;
        let to = -1;

        const storedFrom = lineChToOffset(docText, lineStarts, comment.startLine, comment.startChar);
        const storedTo = lineChToOffset(docText, lineStarts, comment.endLine, comment.endChar);
        if (
            storedFrom !== null &&
            storedTo !== null &&
            storedFrom < storedTo &&
            docText.slice(storedFrom, storedTo) === comment.selectedText
        ) {
            from = storedFrom;
            to = storedTo;
        } else {
            const resolvedAnchor = resolveAnchorRange(searchableText, comment);
            if (resolvedAnchor) {
                from = resolvedAnchor.startOffset;
                to = resolvedAnchor.endOffset;
            }
        }

        if (from >= 0 && to <= docText.length && from < to) {
            ranges.push({
                commentId: comment.id,
                from,
                to,
                active: comment.id === activeCommentId,
            });
        }
    });

    return ranges;
}
