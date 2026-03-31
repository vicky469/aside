export interface TextEditResult {
    value: string;
    selectionStart: number;
    selectionEnd: number;
}

function replaceRange(
    value: string,
    from: number,
    to: number,
    replacement: string,
    selectionStart: number,
    selectionEnd: number,
): TextEditResult {
    return {
        value: value.slice(0, from) + replacement + value.slice(to),
        selectionStart,
        selectionEnd,
    };
}

function toggleWrappedSelection(
    value: string,
    selectionStart: number,
    selectionEnd: number,
    marker: string,
): TextEditResult {
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    const selectedText = value.slice(start, end);
    const markerLength = marker.length;

    if (
        selectedText.length >= markerLength * 2
        && selectedText.startsWith(marker)
        && selectedText.endsWith(marker)
    ) {
        const unwrapped = selectedText.slice(markerLength, selectedText.length - markerLength);
        return replaceRange(
            value,
            start,
            end,
            unwrapped,
            start,
            start + unwrapped.length,
        );
    }

    const before = value.slice(Math.max(0, start - markerLength), start);
    const after = value.slice(end, end + markerLength);
    if (start !== end && before === marker && after === marker) {
        return {
            value: value.slice(0, start - markerLength) + selectedText + value.slice(end + markerLength),
            selectionStart: start - markerLength,
            selectionEnd: end - markerLength,
        };
    }

    if (start === end) {
        const insertion = `${marker}${marker}`;
        return replaceRange(
            value,
            start,
            end,
            insertion,
            start + markerLength,
            start + markerLength,
        );
    }

    return replaceRange(
        value,
        start,
        end,
        `${marker}${selectedText}${marker}`,
        start + markerLength,
        end + markerLength,
    );
}

function incrementAlphabeticMarker(marker: string): string {
    const chars = marker.split("");
    let index = chars.length - 1;

    while (index >= 0) {
        const charCode = chars[index].charCodeAt(0);
        const isLower = charCode >= 97 && charCode <= 122;
        const isUpper = charCode >= 65 && charCode <= 90;

        if (!isLower && !isUpper) {
            return marker;
        }

        const endCode = isLower ? 122 : 90;
        const startCode = isLower ? 97 : 65;

        if (charCode < endCode) {
            chars[index] = String.fromCharCode(charCode + 1);
            return chars.join("");
        }

        chars[index] = String.fromCharCode(startCode);
        index -= 1;
    }

    const first = marker.charCodeAt(0);
    const prefix = first >= 97 && first <= 122 ? "a" : "A";
    return `${prefix}${chars.join("")}`;
}

export function continueMarkdownList(
    value: string,
    selectionStart: number,
    selectionEnd: number,
): TextEditResult | null {
    if (selectionStart !== selectionEnd) {
        return null;
    }

    const lineStart = value.lastIndexOf("\n", Math.max(selectionStart - 1, 0)) + 1;
    const nextNewline = value.indexOf("\n", selectionStart);
    const lineEnd = nextNewline === -1 ? value.length : nextNewline;
    const lineText = value.slice(lineStart, lineEnd);

    const unorderedMatch = lineText.match(/^(\s*)([-*+])\s(.*)$/);
    if (unorderedMatch) {
        const [, indent, marker, content] = unorderedMatch;
        if (!content.trim()) {
            return replaceRange(value, lineStart, lineEnd, "", lineStart, lineStart);
        }

        const insertion = `\n${indent}${marker} `;
        return replaceRange(
            value,
            selectionStart,
            selectionEnd,
            insertion,
            selectionStart + insertion.length,
            selectionStart + insertion.length,
        );
    }

    const orderedMatch = lineText.match(/^(\s*)(\d+)\.\s(.*)$/);
    if (orderedMatch) {
        const [, indent, numberText, content] = orderedMatch;
        if (!content.trim()) {
            return replaceRange(value, lineStart, lineEnd, "", lineStart, lineStart);
        }

        const nextNumber = Number(numberText) + 1;
        const insertion = `\n${indent}${nextNumber}. `;
        return replaceRange(
            value,
            selectionStart,
            selectionEnd,
            insertion,
            selectionStart + insertion.length,
            selectionStart + insertion.length,
        );
    }

    const alphabeticMatch = lineText.match(/^(\s*)([a-zA-Z]+)\.\s(.*)$/);
    if (!alphabeticMatch) {
        return null;
    }

    const [, alphaIndent, marker, alphaContent] = alphabeticMatch;
    if (!alphaContent.trim()) {
        return replaceRange(value, lineStart, lineEnd, "", lineStart, lineStart);
    }

    const nextMarker = incrementAlphabeticMarker(marker);
    const alphaInsertion = `\n${alphaIndent}${nextMarker}. `;
    return replaceRange(
        value,
        selectionStart,
        selectionEnd,
        alphaInsertion,
        selectionStart + alphaInsertion.length,
        selectionStart + alphaInsertion.length,
    );
}

export function toggleMarkdownHighlight(
    value: string,
    selectionStart: number,
    selectionEnd: number,
): TextEditResult {
    return toggleWrappedSelection(value, selectionStart, selectionEnd, "==");
}
