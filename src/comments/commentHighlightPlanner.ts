import type { Comment } from "../commentManager";
import { pickExactTextMatch, pickWhitespaceCollapsedTextMatch, resolveAnchorRange } from "../core/anchors/anchorResolver";

export interface PreviewHighlightWrap {
    start: number;
    end: number;
    comment: Comment;
}

function stripInlineMarkdownTokens(text: string): string {
    return text
        .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
        .replace(/__([\s\S]*?)__/g, "$1")
        .replace(/\*([\s\S]*?)\*/g, "$1")
        .replace(/_([\s\S]*?)_/g, "$1")
        .replace(/~~([\s\S]*?)~~/g, "$1")
        .replace(/==([\s\S]*?)==/g, "$1")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/\[\[([^\]]*?)\]\]/g, "$1")
        .replace(/\[([^\]]*?)\]\([^)]*?\)/g, "$1");
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
        const matchOptions = {
            occurrenceIndex: sourceMatch && sourceMatch.occurrenceIndex >= 0
                ? sourceMatch.occurrenceIndex
                : undefined,
            hintOffset: sourceMatch?.startOffset,
        };
        const renderedMatch = pickExactTextMatch(renderedText, target, matchOptions)
            ?? pickExactTextMatch(renderedText, stripInlineMarkdownTokens(target), matchOptions)
            ?? pickWhitespaceCollapsedTextMatch(renderedText, stripInlineMarkdownTokens(target), matchOptions);
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
