const MAX_LOG_STRING_LENGTH = 280;
const DISALLOWED_TEXT_KEYS = new Set([
    "noteContent",
    "comment",
    "selectedText",
    "clipboardText",
    "contentBase64",
    "body",
    "stack",
    "token",
    "authorization",
    "bearerToken",
    "remoteRuntimeBearerToken",
]);

export interface LogSanitizerContext {
    vaultRootPath?: string | null;
    pluginDirPath?: string | null;
    pluginDirRelativePath?: string | null;
}

function normalizePathForMatch(value: string): string {
    return value.replace(/\\/g, "/");
}

function isAbsolutePath(value: string): boolean {
    return /^([a-zA-Z]:[\\/]|\/)/.test(value);
}

function truncateLogString(value: string): string {
    return value.length > MAX_LOG_STRING_LENGTH
        ? `${value.slice(0, MAX_LOG_STRING_LENGTH - 1)}…`
        : value;
}

function replacePathPrefix(
    text: string,
    prefix: string | null | undefined,
    replacementPrefix: string,
): string {
    if (!prefix) {
        return text;
    }

    const normalizedPrefix = normalizePathForMatch(prefix).replace(/\/+$/, "");
    if (!normalizedPrefix) {
        return text;
    }

    const escapedPrefix = normalizedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = replacementPrefix
        ? new RegExp(`${escapedPrefix}(?=/|$)`, "g")
        : new RegExp(`${escapedPrefix}/?`, "g");
    return text.replace(pattern, replacementPrefix);
}

function scrubAbsolutePathsInText(value: string, context: LogSanitizerContext): string {
    let nextValue = normalizePathForMatch(value);
    nextValue = replacePathPrefix(nextValue, context.vaultRootPath, "");
    nextValue = replacePathPrefix(nextValue, context.pluginDirPath, context.pluginDirRelativePath ?? "[config-dir]/plugins/side-note2");
    nextValue = nextValue
        .replace(/\/Users\/[^/\s]+(?:\/[^\s]*)?/g, "[absolute-path]")
        .replace(/\/home\/[^/\s]+(?:\/[^\s]*)?/g, "[absolute-path]")
        .replace(/[a-zA-Z]:\/Users\/[^/\s]+(?:\/[^\s]*)?/g, "[absolute-path]");

    return nextValue.replace(/^\/+/, "");
}

function sanitizePathString(value: string, context: LogSanitizerContext): string {
    const normalized = scrubAbsolutePathsInText(value, context);
    if (!isAbsolutePath(value)) {
        return truncateLogString(normalized);
    }

    if (normalized && !isAbsolutePath(normalized)) {
        return truncateLogString(normalized);
    }

    return "[absolute-path]";
}

function sanitizeUrlString(value: string): string {
    try {
        const url = new URL(value);
        return truncateLogString(`${url.protocol}//${url.host}${url.pathname}`);
    } catch {
        return truncateLogString(value);
    }
}

function sanitizeStringValue(
    key: string | null,
    value: string,
    context: LogSanitizerContext,
): string | undefined {
    if (key && DISALLOWED_TEXT_KEYS.has(key)) {
        return undefined;
    }

    const looksLikePath = key === "filePath"
        || key === "relativePath"
        || key === "logPath"
        || key === "path"
        || key?.endsWith("Path") === true;
    const looksLikeUrl = key === "url"
        || key === "baseUrl"
        || key?.endsWith("Url") === true
        || key?.endsWith("URL") === true
        || key === "endpoint";

    const nextValue = looksLikePath
        ? sanitizePathString(value, context)
        : looksLikeUrl
            ? sanitizeUrlString(value)
        : truncateLogString(scrubAbsolutePathsInText(value, context));

    return nextValue || undefined;
}

function sanitizePrimitive(
    key: string | null,
    value: unknown,
    context: LogSanitizerContext,
): string | number | boolean | null | undefined {
    if (value == null || typeof value === "boolean" || typeof value === "number") {
        return value as boolean | number | null;
    }

    if (typeof value === "string") {
        return sanitizeStringValue(key, value, context);
    }

    return undefined;
}

function sanitizeUnknown(
    key: string | null,
    value: unknown,
    context: LogSanitizerContext,
): unknown {
    const primitive = sanitizePrimitive(key, value, context);
    if (primitive !== undefined || value === null) {
        return primitive;
    }

    if (value instanceof Error) {
        const errorPayload = sanitizeErrorForLog(value, context);
        return Object.keys(errorPayload).length ? errorPayload : undefined;
    }

    if (Array.isArray(value)) {
        const sanitizedItems = value
            .map((item) => sanitizeUnknown(null, item, context))
            .filter((item) => item !== undefined);
        return sanitizedItems.length ? sanitizedItems : undefined;
    }

    if (!value || typeof value !== "object") {
        return undefined;
    }

    const sanitizedEntries = Object.entries(value as Record<string, unknown>)
        .map(([entryKey, entryValue]) => [entryKey, sanitizeUnknown(entryKey, entryValue, context)] as const)
        .filter(([, entryValue]) => entryValue !== undefined);

    if (!sanitizedEntries.length) {
        return undefined;
    }

    return Object.fromEntries(sanitizedEntries);
}

export function sanitizeLogPayload(
    payload: Record<string, unknown> | undefined,
    context: LogSanitizerContext,
): Record<string, unknown> | undefined {
    if (!payload) {
        return undefined;
    }

    const sanitized = sanitizeUnknown(null, payload, context);
    if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
        return undefined;
    }

    return sanitized as Record<string, unknown>;
}

export function sanitizeErrorForLog(
    error: unknown,
    context: LogSanitizerContext,
): Record<string, unknown> {
    if (error instanceof Error) {
        const payload: Record<string, unknown> = {
            name: error.name,
        };
        const sanitizedMessage = sanitizeStringValue("message", error.message, context);
        if (sanitizedMessage) {
            payload.message = sanitizedMessage;
        }
        return payload;
    }

    const sanitizedMessage = sanitizeStringValue("message", String(error), context);
    return sanitizedMessage ? { message: sanitizedMessage } : {};
}
