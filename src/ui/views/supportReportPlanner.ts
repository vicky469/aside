import { formatFixedLocalDateTime } from "../../core/time/dateTime";

const SUPPORTED_SCREENSHOT_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
]);

export const MAX_SUPPORT_SCREENSHOT_COUNT = 3;
export const MAX_SUPPORT_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const LOG_PREVIEW_CHAR_LIMIT = 120_000;
const LOG_PREVIEW_MAX_EVENTS = 400;
const LOG_PREVIEW_MAX_TOKENS_PER_ROW = 4;

type SupportLogLevel = "info" | "warn" | "error";
export type SupportLogKind = "user" | "system";

interface ParsedSupportLogEntry {
    at: string;
    level: SupportLogLevel;
    area: string;
    event: string;
    payload?: Record<string, unknown>;
}

export interface SupportLogPreviewSummary {
    totalEvents: number;
    filteredEvents: number;
    shownEvents: number;
    hiddenEvents: number;
    invalidLines: number;
    counts: Record<SupportLogLevel, number>;
    kindCounts: Record<SupportLogKind, number>;
    firstAt: string | null;
    lastAt: string | null;
    selectedWindowMinutes: number | null;
    selectedKind: "all" | SupportLogKind;
}

export interface SupportLogPreviewRow {
    at: string;
    displayTime: string;
    level: SupportLogLevel;
    kind: SupportLogKind;
    area: string;
    event: string;
    payloadTokens: string[];
}

export interface SupportLogPreviewModel {
    summary: SupportLogPreviewSummary;
    rows: SupportLogPreviewRow[];
    rawFallbackContent: string | null;
}

export interface SupportLogPreviewSource {
    rows: Array<SupportLogPreviewRow & { atMs: number }>;
    invalidLines: number;
    rawFallbackContent: string | null;
    latestAtMs: number | null;
}

const SUPPORT_LOG_LEVELS: SupportLogLevel[] = ["info", "warn", "error"];
const PRETTY_PAYLOAD_LABELS: Record<string, string> = {
    commentCount: "comments",
    commentId: "comment",
    contentLength: "content",
    created: "created",
    error: "error",
    fileName: "file",
    filePath: "file",
    immediateAggregateRefresh: "refresh",
    indexNotePath: "index",
    logSizeBytes: "log size",
    message: "message",
    mode: "mode",
    pluginVersion: "version",
    relativePath: "path",
    rootFilePath: "root",
    screenshotCount: "screenshots",
    sizeBytes: "size",
    skippedViewRefresh: "view refresh",
    source: "source",
    surface: "surface",
    threadCount: "threads",
    titleLength: "title",
};

export interface ScreenshotFileLike {
    name: string;
    size: number;
    type: string;
}

export interface SupportValidationInput {
    email: string;
    title: string;
    content: string;
}

export interface SupportValidationResult {
    valid: boolean;
    error: string | null;
}

export interface ScreenshotSelectionResult<TFile extends ScreenshotFileLike> {
    accepted: TFile[];
    error: string | null;
}

export function validateSupportReportInput(input: SupportValidationInput): SupportValidationResult {
    if (!input.email.trim()) {
        return { valid: false, error: "Email is required." };
    }
    if (!input.title.trim()) {
        return { valid: false, error: "Title is required." };
    }
    if (!input.content.trim()) {
        return { valid: false, error: "Content is required." };
    }

    return { valid: true, error: null };
}

function inferMimeType(fileName: string): string | null {
    const extension = fileName.split(".").pop()?.toLowerCase();
    if (extension === "png") {
        return "image/png";
    }
    if (extension === "jpg" || extension === "jpeg") {
        return "image/jpeg";
    }
    if (extension === "webp") {
        return "image/webp";
    }

    return null;
}

export function validateScreenshotSelection<TFile extends ScreenshotFileLike>(
    files: readonly TFile[],
    existingCount: number,
): ScreenshotSelectionResult<TFile> {
    if (existingCount + files.length > MAX_SUPPORT_SCREENSHOT_COUNT) {
        return {
            accepted: [],
            error: `Attach up to ${MAX_SUPPORT_SCREENSHOT_COUNT} screenshots.`,
        };
    }

    const accepted: TFile[] = [];
    for (const file of files) {
        const mimeType = file.type || inferMimeType(file.name);
        if (!mimeType || !SUPPORTED_SCREENSHOT_MIME_TYPES.has(mimeType)) {
            return {
                accepted: [],
                error: "Only PNG, JPG, JPEG, and WEBP screenshots are supported.",
            };
        }
        if (file.size > MAX_SUPPORT_SCREENSHOT_BYTES) {
            return {
                accepted: [],
                error: "Each screenshot must be 5 MB or smaller.",
            };
        }
        accepted.push(file);
    }

    return {
        accepted,
        error: null,
    };
}

export function formatSupportAttachmentSize(sizeBytes: number): string {
    if (sizeBytes >= 1024 * 1024) {
        return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (sizeBytes >= 1024) {
        return `${Math.round(sizeBytes / 1024)} KB`;
    }
    return `${sizeBytes} B`;
}

export function truncateLogPreview(content: string): {
    content: string;
    truncated: boolean;
} {
    if (content.length <= LOG_PREVIEW_CHAR_LIMIT) {
        return {
            content,
            truncated: false,
        };
    }

    return {
        content: `${content.slice(0, LOG_PREVIEW_CHAR_LIMIT)}\n\n[Preview truncated]`,
        truncated: true,
    };
}

function isSupportLogLevel(value: unknown): value is SupportLogLevel {
    return typeof value === "string" && SUPPORT_LOG_LEVELS.includes(value as SupportLogLevel);
}

function isScalarPreviewValue(value: unknown): value is string | number | boolean {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function parseSupportLogEntry(line: string): ParsedSupportLogEntry | null {
    try {
        const parsed = JSON.parse(line) as Partial<ParsedSupportLogEntry>;
        if (
            typeof parsed.at !== "string"
            || !isSupportLogLevel(parsed.level)
            || typeof parsed.area !== "string"
            || typeof parsed.event !== "string"
        ) {
            return null;
        }

        return {
            at: parsed.at,
            level: parsed.level,
            area: parsed.area,
            event: parsed.event,
            payload: parsed.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload)
                ? parsed.payload
                : undefined,
        };
    } catch {
        return null;
    }
}

interface SupportLogDisplayOptions {
    timeZone?: string;
}

function truncatePreviewToken(value: string, maxLength = 72): string {
    return value.length > maxLength
        ? `${value.slice(0, maxLength - 1)}…`
        : value;
}

function formatPayloadLabel(key: string): string {
    return PRETTY_PAYLOAD_LABELS[key]
        ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function formatPayloadValue(value: string | number | boolean | null): string {
    if (value === null) {
        return "null";
    }

    return truncatePreviewToken(String(value));
}

function collectPayloadTokens(payload: Record<string, unknown> | undefined): string[] {
    if (!payload) {
        return [];
    }

    const priorityKeys = [
        "filePath",
        "message",
        "mode",
        "source",
        "rootFilePath",
        "commentId",
        "threadCount",
        "commentCount",
        "sizeBytes",
        "error",
    ];
    const remainingKeys = Object.keys(payload)
        .filter((key) => !priorityKeys.includes(key))
        .sort((left, right) => left.localeCompare(right));

    const orderedKeys = priorityKeys.filter((key) => key in payload).concat(remainingKeys);
    const tokens: string[] = [];

    for (const key of orderedKeys) {
        const value = payload[key];
        if (isScalarPreviewValue(value) || value === null) {
            tokens.push(`${formatPayloadLabel(key)}: ${formatPayloadValue(value)}`);
            continue;
        }

        if (key === "error" && value && typeof value === "object" && !Array.isArray(value)) {
            const errorName = isScalarPreviewValue((value as Record<string, unknown>).name)
                ? String((value as Record<string, unknown>).name)
                : null;
            const errorMessage = isScalarPreviewValue((value as Record<string, unknown>).message)
                ? String((value as Record<string, unknown>).message)
                : null;
            const errorSummary = [errorName, errorMessage].filter(Boolean).join(": ");
            if (errorSummary) {
                tokens.push(`error: ${truncatePreviewToken(errorSummary)}`);
            }
        }

        if (tokens.length >= LOG_PREVIEW_MAX_TOKENS_PER_ROW) {
            break;
        }
    }

    return tokens.slice(0, LOG_PREVIEW_MAX_TOKENS_PER_ROW);
}

function classifySupportLogKind(entry: ParsedSupportLogEntry): SupportLogKind {
    const userEventPrefixes = [
        "draft.selection.created",
        "draft.page.created",
        "draft.append.created",
        "draft.save.begin",
        "draft.edit.begin",
        "thread.resolve",
        "thread.reopen",
        "thread.delete",
        "thread.reanchor.begin",
        "navigation.reveal.requested",
        "sidebar.focus.requested",
        "index.filter.changed",
        "index.mode.changed",
        "support.debugger.opened",
        "support.form.opened",
        "support.log.preview.opened",
        "support.submit.begin",
    ];

    if (userEventPrefixes.some((prefix) => entry.event === prefix || entry.event.startsWith(`${prefix}.`))) {
        return "user";
    }

    if (entry.area === "draft" || entry.area === "navigation") {
        return "user";
    }

    return "system";
}

function buildPreviewRows(entries: readonly ParsedSupportLogEntry[]): Array<SupportLogPreviewRow & { atMs: number }> {
    return entries.map((entry) => ({
        at: entry.at,
        atMs: Date.parse(entry.at),
        displayTime: formatFixedLocalDateTime(entry.at, {
            includeDate: false,
            includeMilliseconds: true,
        }) ?? entry.at,
        level: entry.level,
        kind: classifySupportLogKind(entry),
        area: entry.area,
        event: entry.event,
        payloadTokens: collectPayloadTokens(entry.payload),
    }));
}

export function buildSupportLogPreviewSource(content: string): SupportLogPreviewSource {
    const lines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const parsedEntries: ParsedSupportLogEntry[] = [];
    let invalidLines = 0;
    for (const line of lines) {
        const parsed = parseSupportLogEntry(line);
        if (!parsed) {
            invalidLines += 1;
            continue;
        }
        parsedEntries.push(parsed);
    }

    const rows = buildPreviewRows(parsedEntries);
    const latestAtMs = rows
        .map((row) => row.atMs)
        .filter((atMs) => Number.isFinite(atMs))
        .reduce<number | null>((latest, atMs) => {
            if (latest === null || atMs > latest) {
                return atMs;
            }
            return latest;
        }, null);

    return {
        rows,
        invalidLines,
        rawFallbackContent: parsedEntries.length ? null : truncateLogPreview(content).content,
        latestAtMs,
    };
}

export function buildSupportLogPreviewFromSource(source: SupportLogPreviewSource, options: {
    recentWindowMinutes?: number;
    kind?: "all" | SupportLogKind;
    referenceAt?: string | null;
} = {}): SupportLogPreviewModel {
    const recentWindowMinutes = options.recentWindowMinutes ?? null;
    const selectedKind = options.kind ?? "all";
    let filteredEntries = source.rows;
    if (recentWindowMinutes && source.rows.length > 0) {
        const referenceAtMs = options.referenceAt ? Date.parse(options.referenceAt) : Number.NaN;
        const cutoffSourceMs = Number.isFinite(referenceAtMs)
            ? referenceAtMs
            : source.latestAtMs;
        if (Number.isFinite(cutoffSourceMs)) {
            const effectiveCutoffSourceMs = cutoffSourceMs as number;
            const cutoffMs = effectiveCutoffSourceMs - recentWindowMinutes * 60 * 1000;
            filteredEntries = source.rows.filter((entry) => {
                return Number.isFinite(entry.atMs) && entry.atMs >= cutoffMs && entry.atMs <= effectiveCutoffSourceMs;
            });
        }
    }
    if (selectedKind !== "all") {
        filteredEntries = filteredEntries.filter((entry) => entry.kind === selectedKind);
    }

    const counts: Record<SupportLogLevel, number> = {
        info: 0,
        warn: 0,
        error: 0,
    };
    const kindCounts: Record<SupportLogKind, number> = {
        user: 0,
        system: 0,
    };
    for (const entry of filteredEntries) {
        counts[entry.level] += 1;
        kindCounts[entry.kind] += 1;
    }

    const shownEntries = filteredEntries
        .slice(-LOG_PREVIEW_MAX_EVENTS)
        .reverse();
    const summary: SupportLogPreviewSummary = {
        totalEvents: source.rows.length,
        filteredEvents: filteredEntries.length,
        shownEvents: shownEntries.length,
        hiddenEvents: Math.max(0, filteredEntries.length - shownEntries.length),
        invalidLines: source.invalidLines,
        counts,
        kindCounts,
        firstAt: filteredEntries[0]?.at ?? null,
        lastAt: filteredEntries[filteredEntries.length - 1]?.at ?? null,
        selectedWindowMinutes: recentWindowMinutes,
        selectedKind,
    };

    if (!source.rows.length) {
        return {
            summary,
            rows: [],
            rawFallbackContent: source.rawFallbackContent,
        };
    }

    return {
        summary,
        rows: shownEntries.map(({ at, displayTime, level, kind, area, event, payloadTokens }) => ({
            at,
            displayTime,
            level,
            kind,
            area,
            event,
            payloadTokens,
        })),
        rawFallbackContent: null,
    };
}

export function buildSupportLogPreview(content: string, options: {
    recentWindowMinutes?: number;
    kind?: "all" | SupportLogKind;
    referenceAt?: string | null;
} = {}): SupportLogPreviewModel {
    return buildSupportLogPreviewFromSource(buildSupportLogPreviewSource(content), options);
}

export function formatSupportLogSummaryLine(
    summary: SupportLogPreviewSummary,
    options: SupportLogDisplayOptions = {},
): string {
    const rangeStart = formatFixedLocalDateTime(summary.firstAt, {
        includeMilliseconds: true,
        timeZone: options.timeZone,
    });
    const rangeEnd = formatFixedLocalDateTime(summary.lastAt, {
        includeMilliseconds: true,
        timeZone: options.timeZone,
    });
    if (!rangeStart || !rangeEnd) {
        return "No parsed log events.";
    }

    return rangeStart === rangeEnd
        ? rangeStart
        : `${rangeStart} -> ${rangeEnd}`;
}

export function formatSupportLogRowTime(
    row: SupportLogPreviewRow,
    options: SupportLogDisplayOptions = {},
): string {
    if (!options.timeZone) {
        return row.displayTime;
    }

    return formatFixedLocalDateTime(row.at, {
        includeDate: false,
        includeMilliseconds: true,
        timeZone: options.timeZone,
    }) ?? row.displayTime;
}
