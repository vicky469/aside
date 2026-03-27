import type { Comment } from "../commentManager";
import { isAnchoredComment } from "./commentAnchors";
import { sortCommentsByPosition } from "./noteCommentStorage";

export interface EditorHighlightRange {
    commentId: string;
    from: number;
    to: number;
    resolved: boolean;
    active: boolean;
}

function lineChToOffset(text: string, line: number, ch: number): number | null {
    if (line < 0 || ch < 0) {
        return null;
    }

    const lines = text.split("\n");
    if (line >= lines.length || ch > lines[line].length) {
        return null;
    }

    let offset = 0;
    for (let index = 0; index < line; index++) {
        offset += lines[index].length + 1;
    }

    return offset + ch;
}

function getVisibleCommentsForHighlighting(
    storedComments: Comment[],
    draftComment: Comment | null,
    showResolved: boolean,
): Comment[] {
    const commentsWithoutDraft = draftComment
        ? storedComments.filter((comment) => comment.id !== draftComment.id)
        : storedComments.slice();

    const visibleComments = showResolved
        ? commentsWithoutDraft
        : commentsWithoutDraft.filter((comment) => !comment.resolved);

    return sortCommentsByPosition(
        (draftComment ? visibleComments.concat(draftComment) : visibleComments)
            .filter((comment) => isAnchoredComment(comment))
    );
}

export function buildEditorHighlightRanges(
    docText: string,
    searchableText: string,
    storedComments: Comment[],
    draftComment: Comment | null,
    showResolved: boolean,
    activeCommentId: string | null,
): EditorHighlightRange[] {
    const comments = getVisibleCommentsForHighlighting(
        storedComments,
        draftComment,
        showResolved,
    );
    const ranges: EditorHighlightRange[] = [];

    comments.forEach((comment) => {
        let from = -1;
        let to = -1;

        const storedFrom = lineChToOffset(docText, comment.startLine, comment.startChar);
        const storedTo = lineChToOffset(docText, comment.endLine, comment.endChar);
        if (
            storedFrom !== null &&
            storedTo !== null &&
            storedFrom < storedTo &&
            docText.slice(storedFrom, storedTo) === comment.selectedText
        ) {
            from = storedFrom;
            to = storedTo;
        }

        if (from === -1 && comment.selectedText) {
            const approximateOffset = lineChToOffset(docText, comment.startLine, comment.startChar) ?? 0;
            let bestIndex = -1;
            let bestDistance = Number.POSITIVE_INFINITY;
            let searchFrom = 0;

            while (searchFrom <= searchableText.length) {
                const matchIndex = searchableText.indexOf(comment.selectedText, searchFrom);
                if (matchIndex === -1) {
                    break;
                }

                const distance = Math.abs(matchIndex - approximateOffset);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestIndex = matchIndex;
                }

                searchFrom = matchIndex + Math.max(comment.selectedText.length, 1);
            }

            if (bestIndex !== -1) {
                from = bestIndex;
                to = bestIndex + comment.selectedText.length;
            }
        }

        if (from >= 0 && to <= docText.length && from < to) {
            ranges.push({
                commentId: comment.id,
                from,
                to,
                resolved: comment.resolved === true,
                active: comment.id === activeCommentId,
            });
        }
    });

    return ranges;
}
