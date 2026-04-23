import type { Comment } from "../../commentManager";
import { resolveAnchorRange } from "../anchors/anchorResolver";
import { isAnchoredComment } from "../anchors/commentAnchors";
import { filterCommentsByResolvedVisibility, matchesResolvedCommentVisibility } from "../rules/resolvedCommentVisibility";
import { sortCommentsByPosition } from "../storage/noteCommentStorage";

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

    const visibleComments = filterCommentsByResolvedVisibility(commentsWithoutDraft, showResolved);
    const visibleDraft = draftComment && matchesResolvedCommentVisibility(draftComment, showResolved)
        ? draftComment
        : null;

    return sortCommentsByPosition(
        (visibleDraft ? visibleComments.concat(visibleDraft) : visibleComments)
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

        const resolvedAnchor = resolveAnchorRange(searchableText, comment);
        if (resolvedAnchor) {
            from = resolvedAnchor.startOffset;
            to = resolvedAnchor.endOffset;
        } else {
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
