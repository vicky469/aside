export interface TextAnchor {
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    selectedText: string;
}

export interface ExactTextMatch {
    startOffset: number;
    endOffset: number;
    occurrenceIndex: number;
}

export interface ResolvedAnchorRange extends ExactTextMatch {
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    text: string;
}

function getLineStartOffsets(text: string): number[] {
    const starts = [0];

    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) {
            starts.push(i + 1);
        }
    }

    return starts;
}

export function lineChToOffset(text: string, line: number, ch: number): number | null {
    if (line < 0 || ch < 0) {
        return null;
    }

    const lineStarts = getLineStartOffsets(text);
    if (line >= lineStarts.length) {
        return null;
    }

    const startOffset = lineStarts[line];
    const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;
    if (startOffset + ch > lineEnd) {
        return null;
    }

    return startOffset + ch;
}

export function offsetToLineCh(text: string, offset: number): { line: number; ch: number } {
    const clamped = Math.max(0, Math.min(offset, text.length));
    const lineStarts = getLineStartOffsets(text);

    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (lineStarts[mid] <= clamped) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    const line = Math.max(0, high);
    return {
        line,
        ch: clamped - lineStarts[line],
    };
}

export function findExactTextMatches(text: string, target: string): ExactTextMatch[] {
    if (!target) {
        return [];
    }

    const matches: ExactTextMatch[] = [];
    let searchFrom = 0;
    let occurrenceIndex = 0;

    while (searchFrom <= text.length - target.length) {
        const matchIndex = text.indexOf(target, searchFrom);
        if (matchIndex === -1) {
            break;
        }

        matches.push({
            startOffset: matchIndex,
            endOffset: matchIndex + target.length,
            occurrenceIndex,
        });
        occurrenceIndex++;
        searchFrom = matchIndex + 1;
    }

    return matches;
}

export function pickExactTextMatch(
    text: string,
    target: string,
    options: {
        hintOffset?: number;
        occurrenceIndex?: number;
    } = {},
): ExactTextMatch | null {
    const matches = findExactTextMatches(text, target);
    if (!matches.length) {
        return null;
    }

    if (options.occurrenceIndex !== undefined) {
        const byOccurrence = matches.find((match) => match.occurrenceIndex === options.occurrenceIndex);
        if (byOccurrence) {
            return byOccurrence;
        }
    }

    if (options.hintOffset === undefined) {
        return matches[0];
    }

    let bestMatch = matches[0];
    let bestDistance = Math.abs(bestMatch.startOffset - options.hintOffset);

    for (const match of matches.slice(1)) {
        const distance = Math.abs(match.startOffset - options.hintOffset);
        if (distance < bestDistance) {
            bestMatch = match;
            bestDistance = distance;
        }
    }

    return bestMatch;
}

function toResolvedRange(text: string, match: ExactTextMatch): ResolvedAnchorRange {
    const start = offsetToLineCh(text, match.startOffset);
    const end = offsetToLineCh(text, match.endOffset);

    return {
        ...match,
        startLine: start.line,
        startChar: start.ch,
        endLine: end.line,
        endChar: end.ch,
        text: text.slice(match.startOffset, match.endOffset),
    };
}

export function resolveAnchorRange(text: string, anchor: TextAnchor): ResolvedAnchorRange | null {
    const target = anchor.selectedText;
    if (!target) {
        return null;
    }

    const storedStart = lineChToOffset(text, anchor.startLine, anchor.startChar);
    const storedEnd = lineChToOffset(text, anchor.endLine, anchor.endChar);
    if (storedStart !== null && storedEnd !== null && storedStart < storedEnd) {
        const storedText = text.slice(storedStart, storedEnd);
        if (storedText === target) {
            return toResolvedRange(text, {
                startOffset: storedStart,
                endOffset: storedEnd,
                occurrenceIndex: findExactTextMatches(text, target).findIndex(
                    (match) => match.startOffset === storedStart && match.endOffset === storedEnd,
                ),
            });
        }
    }

    const hintOffset = storedStart ?? 0;
    const bestMatch = pickExactTextMatch(text, target, { hintOffset });
    return bestMatch ? toResolvedRange(text, bestMatch) : null;
}
