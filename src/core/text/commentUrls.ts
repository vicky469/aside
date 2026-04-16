const URL_PATTERN = /https?:\/\/[^\s<]+/g;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;
const LINK_DEFINITION_LINE = /^ {0,3}\[[^\]]+]:\s*https?:\/\//i;
const URL_LABEL_MAX_LENGTH = 72;
const URL_SHORTEN_MIN_LENGTH = 48;
const MARKDOWN_LABEL_ESCAPE_PATTERN = /([`*_[\]()~<>])/g;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

type FenceState = {
    marker: "`" | "~";
    length: number;
};

type OffsetRange = {
    start: number;
    end: number;
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
    if (!trimmed || trimmed[0] !== fenceState.marker) {
        return false;
    }

    const markerRun = trimmed.match(/^(`+|~+)/)?.[1] ?? "";
    return markerRun.length >= fenceState.length
        && markerRun.split("").every((char) => char === fenceState.marker)
        && trimmed.slice(markerRun.length).trim().length === 0;
}

function buildInlineCodeRanges(line: string): OffsetRange[] {
    const ranges: OffsetRange[] = [];

    for (let index = 0; index < line.length; index += 1) {
        if (line.charAt(index) !== "`") {
            continue;
        }

        let markerEnd = index + 1;
        while (markerEnd < line.length && line.charAt(markerEnd) === "`") {
            markerEnd += 1;
        }

        const markerLength = markerEnd - index;
        const closingIndex = line.indexOf("`".repeat(markerLength), markerEnd);
        if (closingIndex === -1) {
            index = markerEnd - 1;
            continue;
        }

        ranges.push({
            start: index,
            end: closingIndex + markerLength,
        });
        index = closingIndex + markerLength - 1;
    }

    return ranges;
}

function isOffsetInsideRanges(offset: number, ranges: OffsetRange[]): boolean {
    return ranges.some((range) => offset >= range.start && offset < range.end);
}

function isBareUrlBoundary(line: string, start: number): boolean {
    if (start <= 0) {
        return true;
    }

    const previousChar = line.charAt(start - 1);
    const previousPreviousChar = line.charAt(start - 2);
    if (!previousChar.trim()) {
        return true;
    }

    if (previousChar === "<" || previousChar === "[" || previousChar === "`") {
        return false;
    }

    if (previousChar === "(" && previousPreviousChar === "]") {
        return false;
    }

    if ((previousChar === "\"" || previousChar === "'") && previousPreviousChar === "=") {
        return false;
    }

    return !/[A-Za-z0-9_/-]/.test(previousChar);
}

function hasUnbalancedClosingParenthesis(value: string): boolean {
    let balance = 0;
    for (const char of value) {
        if (char === "(") {
            balance += 1;
        } else if (char === ")") {
            balance -= 1;
        }
    }

    return balance < 0;
}

function splitTrailingUrlPunctuation(rawValue: string): { url: string; trailingText: string } {
    let url = rawValue;
    let trailingText = "";

    while (url.length > 0) {
        const lastChar = url.charAt(url.length - 1);
        if (/[?!.,;:'"]/.test(lastChar)) {
            trailingText = `${lastChar}${trailingText}`;
            url = url.slice(0, -1);
            continue;
        }

        if (lastChar === ")" && hasUnbalancedClosingParenthesis(url)) {
            trailingText = `${lastChar}${trailingText}`;
            url = url.slice(0, -1);
            continue;
        }

        break;
    }

    return { url, trailingText };
}

function decodeUrlLabelSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

function truncateMiddle(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    if (maxLength <= 3) {
        return value.slice(0, maxLength);
    }

    const available = maxLength - 3;
    const leading = Math.ceil(available / 2);
    const trailing = Math.floor(available / 2);
    return `${value.slice(0, leading)}...${value.slice(value.length - trailing)}`;
}

function buildUrlLabel(url: URL): string {
    const hostname = url.hostname.replace(/^www\./i, "");
    const segments = url.pathname
        .replace(/\/+$/, "")
        .split("/")
        .filter(Boolean)
        .map((segment) => decodeUrlLabelSegment(segment));

    if (!segments.length) {
        return hostname;
    }

    const fullPathLabel = `${hostname}/${segments.join("/")}`;
    if (fullPathLabel.length <= URL_LABEL_MAX_LENGTH) {
        return fullPathLabel;
    }

    const compactLabel = `${hostname}/${segments[0]}/.../${segments[segments.length - 1]}`;
    return truncateMiddle(compactLabel, URL_LABEL_MAX_LENGTH);
}

function escapeMarkdownLinkLabel(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(MARKDOWN_LABEL_ESCAPE_PATTERN, "\\$1");
}

function buildShortMarkdownLink(urlValue: string): string | null {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(urlValue);
    } catch {
        return null;
    }

    if (!(parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")) {
        return null;
    }

    const label = buildUrlLabel(parsedUrl);
    const shouldShorten = urlValue.length > URL_SHORTEN_MIN_LENGTH
        || parsedUrl.search.length > 0
        || parsedUrl.hash.length > 0;
    if (!shouldShorten) {
        return null;
    }

    return `[${escapeMarkdownLinkLabel(label)}](${urlValue})`;
}

function shortenBareUrlsInLine(line: string): string {
    if (!line || LINK_DEFINITION_LINE.test(line)) {
        return line;
    }

    const inlineCodeRanges = buildInlineCodeRanges(line);
    let normalized = "";
    let lastIndex = 0;
    let replaced = false;

    URL_PATTERN.lastIndex = 0;
    for (let match = URL_PATTERN.exec(line); match; match = URL_PATTERN.exec(line)) {
        const rawValue = match[0];
        const start = match.index;
        if (!isBareUrlBoundary(line, start) || isOffsetInsideRanges(start, inlineCodeRanges)) {
            continue;
        }

        const { url, trailingText } = splitTrailingUrlPunctuation(rawValue);
        const shortenedLink = buildShortMarkdownLink(url);
        if (!shortenedLink) {
            continue;
        }

        normalized += line.slice(lastIndex, start);
        normalized += `${shortenedLink}${trailingText}`;
        lastIndex = start + rawValue.length;
        replaced = true;
    }

    if (!replaced) {
        return line;
    }

    return `${normalized}${line.slice(lastIndex)}`;
}

export function shortenBareUrlsInMarkdown(markdown: string): string {
    if (!markdown) {
        return markdown;
    }

    const lines = markdown.split("\n");
    const normalized: string[] = [];
    let activeFence: FenceState | null = null;

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

        normalized.push(shortenBareUrlsInLine(line));
    }

    return normalized.join("\n");
}

export function stripMarkdownLinksForPreview(value: string): string {
    if (!value) {
        return value;
    }

    return value
        .replace(MARKDOWN_LINK_PATTERN, "$1")
        .replace(/\\([`*_[\]()~<>])/g, "$1");
}
