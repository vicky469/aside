const EXCALIDRAW_CLIPBOARD_TYPE = "excalidraw/clipboard";
const IMAGE_DATA_URL_PATTERN = /data:image\/([a-zA-Z0-9.+-]+);base64,[A-Za-z0-9+/=]{80,}/g;
const LONG_EMBEDDED_TOKEN_PATTERN = /\b(?:data|blob):[^\s<>"'`()[\]{}]{160,}/g;

type ExcalidrawClipboardSummary = {
    imageCount: number;
    elementCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countExcalidrawImageFiles(files: unknown): number {
    if (!isRecord(files)) {
        return 0;
    }

    return Object.values(files).filter((file) => {
        if (!isRecord(file)) {
            return false;
        }

        const mimeType = typeof file.mimeType === "string" ? file.mimeType : "";
        const dataURL = typeof file.dataURL === "string" ? file.dataURL : "";
        return mimeType.startsWith("image/") || dataURL.startsWith("data:image/");
    }).length;
}

function parseExcalidrawClipboardSummary(value: string): ExcalidrawClipboardSummary | null {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes(EXCALIDRAW_CLIPBOARD_TYPE)) {
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return null;
    }

    if (!isRecord(parsed) || parsed.type !== EXCALIDRAW_CLIPBOARD_TYPE) {
        return null;
    }

    const elements = parsed.elements;
    return {
        imageCount: countExcalidrawImageFiles(parsed.files),
        elementCount: Array.isArray(elements) ? elements.length : 0,
    };
}

function formatCount(count: number, singularLabel: string): string | null {
    if (count <= 0) {
        return null;
    }

    return `${count} ${singularLabel}${count === 1 ? "" : "s"}`;
}

function buildExcalidrawClipboardPlaceholder(summary: ExcalidrawClipboardSummary): string {
    const parts = [
        formatCount(summary.imageCount, "image"),
        formatCount(summary.elementCount, "element"),
    ].filter((part): part is string => Boolean(part));

    return `[Excalidraw clipboard${parts.length ? `: ${parts.join(", ")}` : ""}]`;
}

function normalizeImageDataUrl(_match: string, imageType: string): string {
    return `[image data omitted: ${imageType.toLowerCase()}]`;
}

function normalizeLongEmbeddedToken(match: string): string {
    if (match.startsWith("data:")) {
        return "[embedded data omitted]";
    }

    return "[blob URL omitted]";
}

export function createCompactClipboardPayloadText(value: string): string | null {
    const summary = parseExcalidrawClipboardSummary(value);
    if (!summary) {
        return null;
    }

    return buildExcalidrawClipboardPlaceholder(summary);
}

export function compactEmbeddedCommentPayloads(value: string): string {
    if (!value) {
        return value;
    }

    const compactClipboard = createCompactClipboardPayloadText(value);
    if (compactClipboard) {
        return compactClipboard;
    }

    return value
        .replace(IMAGE_DATA_URL_PATTERN, normalizeImageDataUrl)
        .replace(LONG_EMBEDDED_TOKEN_PATTERN, normalizeLongEmbeddedToken);
}
