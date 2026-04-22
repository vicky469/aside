import { shortenBareUrlsInMarkdown } from "../../core/text/commentUrls";

const DASH_RULE_LINE = /^ {0,3}-(?:[ \t]*-){2,}[ \t]*$/;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM_LINE = /^(\s{0,3})([-+*]|\d+[.)]|[A-Za-z][.)])[ \t]+/;
const LIST_CONTINUATION_BLOCK_BOUNDARY_LINE = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|>[ \t]?)/;
const DISPLAY_MATH_OPEN_LINE = /^(\s*)\\\[\s*$/;
const DISPLAY_MATH_CLOSE_LINE = /^(\s*)\\\]\s*$/;

type FenceState = {
    marker: "`" | "~";
    length: number;
};

type ListState = {
    continuationIndent: string;
    pendingIndentedContinuation: boolean;
};

function parseFenceState(line: string): FenceState | null {
    const match = line.match(FENCE_LINE);
    if (!match) {
        return null;
    }

    const markerSequence = match[1];
    return {
        marker: markerSequence[0] as "`" | "~",
        length: markerSequence.length,
    };
}

function isClosingFence(line: string, fenceState: FenceState): boolean {
    const trimmed = line.trim();
    if (!trimmed) {
        return false;
    }

    if (trimmed[0] !== fenceState.marker) {
        return false;
    }

    const markerRun = trimmed.match(/^(`+|~+)/)?.[1] ?? "";
    return markerRun.length >= fenceState.length
        && markerRun.split("").every((char) => char === fenceState.marker)
        && trimmed.slice(markerRun.length).trim().length === 0;
}

function getListContinuationIndent(line: string): string | null {
    const match = line.match(LIST_ITEM_LINE);
    if (!match) {
        return null;
    }

    const [, leadingWhitespace, marker] = match;
    return leadingWhitespace + " ".repeat(marker.length + 1);
}

function shouldKeepLineOutsideListContinuation(line: string): boolean {
    return DASH_RULE_LINE.test(line) || FENCE_LINE.test(line) || LIST_CONTINUATION_BLOCK_BOUNDARY_LINE.test(line);
}

function countLeadingWhitespace(line: string): number {
    return line.match(/^[ \t]*/)?.[0].length ?? 0;
}

function replaceLatexMathDelimitersOutsideInlineCode(line: string): string {
    let result = "";
    let cursor = 0;

    while (cursor < line.length) {
        const backtickStart = line.indexOf("`", cursor);
        const segmentEnd = backtickStart === -1 ? line.length : backtickStart;
        const plainSegment = line.slice(cursor, segmentEnd)
            .replace(/\\\((.+?)\\\)/g, (_match, content: string) => `$${content}$`)
            .replace(/\\\[(.+?)\\\]/g, (_match, content: string) => `$$${content}$$`);
        result += plainSegment;

        if (backtickStart === -1) {
            break;
        }

        let fenceLength = 1;
        while (line[backtickStart + fenceLength] === "`") {
            fenceLength += 1;
        }
        const fence = "`".repeat(fenceLength);
        const backtickEnd = line.indexOf(fence, backtickStart + fenceLength);
        if (backtickEnd === -1) {
            result += line.slice(backtickStart);
            break;
        }

        result += line.slice(backtickStart, backtickEnd + fenceLength);
        cursor = backtickEnd + fenceLength;
    }

    return result;
}

export function normalizeCommentMarkdownForRender(markdown: string): string {
    if (!markdown) {
        return markdown;
    }

    const lines = shortenBareUrlsInMarkdown(markdown).split("\n");
    const normalized: string[] = [];
    let activeFence: FenceState | null = null;
    let activeList: ListState | null = null;

    for (const line of lines) {
        if (activeFence) {
            normalized.push(line);
            if (isClosingFence(line, activeFence)) {
                activeFence = null;
            }
            continue;
        }

        const fenceState = parseFenceState(line);
        if (fenceState) {
            normalized.push(line);
            activeFence = fenceState;
            continue;
        }

        const displayMathOpenMatch = line.match(DISPLAY_MATH_OPEN_LINE);
        if (displayMathOpenMatch) {
            normalized.push(`${displayMathOpenMatch[1]}$$`);
            continue;
        }

        const displayMathCloseMatch = line.match(DISPLAY_MATH_CLOSE_LINE);
        if (displayMathCloseMatch) {
            normalized.push(`${displayMathCloseMatch[1]}$$`);
            continue;
        }

        const normalizedLine = replaceLatexMathDelimitersOutsideInlineCode(line);
        const listContinuationIndent = getListContinuationIndent(normalizedLine);
        if (listContinuationIndent) {
            normalized.push(normalizedLine);
            activeList = {
                continuationIndent: listContinuationIndent,
                pendingIndentedContinuation: false,
            };
            continue;
        }

        if (activeList) {
            if (normalizedLine.trim().length === 0) {
                normalized.push(normalizedLine);
                activeList.pendingIndentedContinuation = true;
                continue;
            }

            if (activeList.pendingIndentedContinuation) {
                if (shouldKeepLineOutsideListContinuation(normalizedLine)) {
                    activeList = null;
                } else {
                    const leadingWhitespace = countLeadingWhitespace(normalizedLine);
                    if (leadingWhitespace < activeList.continuationIndent.length) {
                        normalized.push(activeList.continuationIndent + normalizedLine.slice(leadingWhitespace));
                    } else {
                        normalized.push(normalizedLine);
                    }
                    activeList.pendingIndentedContinuation = false;
                    continue;
                }
            }
        }

        if (
            DASH_RULE_LINE.test(normalizedLine)
            && normalized.length > 0
            && normalized[normalized.length - 1].trim().length > 0
        ) {
            normalized.push("");
        }

        normalized.push(normalizedLine);
    }

    return normalized.join("\n");
}
