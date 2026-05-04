import type { Comment } from "../commentManager";
import { pickExactTextMatch, resolveAnchorRange } from "../core/anchors/anchorResolver";

export interface PreviewHighlightWrap {
    start: number;
    end: number;
    comment: Comment;
}

export function buildPreviewHighlightWraps(
    sectionText: string,
    sectionLineStart: number,
    renderedText: string,
    comments: Comment[],
): PreviewHighlightWrap[] {
    const wraps: PreviewHighlightWrap[] = [];

    for (const comment of comments) {
        const target = comment.selectedText;
        if (!target) {
            continue;
        }

        const sourceMatch = resolveAnchorRange(sectionText, {
            startLine: comment.startLine - sectionLineStart,
            startChar: comment.startChar,
            endLine: comment.endLine - sectionLineStart,
            endChar: comment.endChar,
            selectedText: target,
        });
        const renderedMatch = pickExactTextMatch(renderedText, target, {
            occurrenceIndex: sourceMatch && sourceMatch.occurrenceIndex >= 0
                ? sourceMatch.occurrenceIndex
                : undefined,
            hintOffset: sourceMatch?.startOffset,
        });
        if (!renderedMatch) {
            continue;
        }

        wraps.push({
            start: renderedMatch.startOffset,
            end: renderedMatch.endOffset,
            comment,
        });
    }

    return wraps;
}
