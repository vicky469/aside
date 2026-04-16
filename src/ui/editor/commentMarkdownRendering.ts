import { shortenBareUrlsInMarkdown } from "../../core/text/commentUrls";

const DASH_RULE_LINE = /^ {0,3}-(?:[ \t]*-){2,}[ \t]*$/;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

type FenceState = {
    marker: "`" | "~";
    length: number;
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

export function normalizeCommentMarkdownForRender(markdown: string): string {
    if (!markdown) {
        return markdown;
    }

    const lines = shortenBareUrlsInMarkdown(markdown).split("\n");
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

        if (
            DASH_RULE_LINE.test(line)
            && normalized.length > 0
            && normalized[normalized.length - 1].trim().length > 0
        ) {
            normalized.push("");
        }

        normalized.push(line);
    }

    return normalized.join("\n");
}
