export type InstantValue = number | string | Date;

export interface FixedLocalDateTimeOptions {
    includeDate?: boolean;
    includeMilliseconds?: boolean;
    timeZone?: string;
}

export interface FriendlyLocalDateTimeOptions {
    includeSeconds?: boolean;
    timeZone?: string;
}

type FixedDateTimePart = "year" | "month" | "day" | "hour" | "minute" | "second" | "fractionalSecond";

const fixedDateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();
const friendlyDateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function resolveInstant(value: InstantValue | null | undefined): Date | null {
    if (value === null || value === undefined) {
        return null;
    }

    const date = value instanceof Date
        ? new Date(value.getTime())
        : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

export function toUtcIsoString(value: InstantValue = new Date()): string {
    const date = resolveInstant(value);
    if (!date) {
        throw new Error("Cannot serialize an invalid instant.");
    }

    return date.toISOString();
}

function getFixedDateTimeFormatter(options: FixedLocalDateTimeOptions): Intl.DateTimeFormat {
    const cacheKey = JSON.stringify({
        includeMilliseconds: options.includeMilliseconds ?? false,
        timeZone: options.timeZone ?? null,
    });
    const cached = fixedDateTimeFormatterCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const formatterOptions: Intl.DateTimeFormatOptions = {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZone: options.timeZone,
    };
    if (options.includeMilliseconds) {
        Object.defineProperty(formatterOptions, "fractionalSecondDigits", {
            enumerable: true,
            value: 3,
        });
    }
    const formatter = new Intl.DateTimeFormat("en-CA", formatterOptions);
    fixedDateTimeFormatterCache.set(cacheKey, formatter);
    return formatter;
}

function getFriendlyDateTimeFormatter(options: FriendlyLocalDateTimeOptions): Intl.DateTimeFormat {
    const cacheKey = JSON.stringify({
        includeSeconds: options.includeSeconds ?? false,
        timeZone: options.timeZone ?? null,
    });
    const cached = friendlyDateTimeFormatterCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const formatter = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: options.includeSeconds ? "2-digit" : undefined,
        timeZone: options.timeZone,
    });
    friendlyDateTimeFormatterCache.set(cacheKey, formatter);
    return formatter;
}

function formatToFixedParts(
    value: InstantValue | null | undefined,
    options: FixedLocalDateTimeOptions,
): Record<FixedDateTimePart, string> | null {
    const date = resolveInstant(value);
    if (!date) {
        return null;
    }

    const formatter = getFixedDateTimeFormatter(options);
    const parts = formatter.formatToParts(date);
    const collected = new Map<string, string>();
    for (const part of parts) {
        if (part.type === "literal") {
            continue;
        }
        collected.set(part.type, part.value);
    }

    const requiredParts: FixedDateTimePart[] = options.includeMilliseconds
        ? ["year", "month", "day", "hour", "minute", "second", "fractionalSecond"]
        : ["year", "month", "day", "hour", "minute", "second"];
    for (const requiredPart of requiredParts) {
        if (!collected.has(requiredPart)) {
            return null;
        }
    }

    return {
        year: collected.get("year") ?? "0000",
        month: collected.get("month") ?? "00",
        day: collected.get("day") ?? "00",
        hour: collected.get("hour") ?? "00",
        minute: collected.get("minute") ?? "00",
        second: collected.get("second") ?? "00",
        fractionalSecond: collected.get("fractionalSecond") ?? "000",
    };
}

export function formatFixedLocalDateTime(
    value: InstantValue | null | undefined,
    options: FixedLocalDateTimeOptions = {},
): string | null {
    const includeDate = options.includeDate ?? true;
    const includeMilliseconds = options.includeMilliseconds ?? false;
    const parts = formatToFixedParts(value, {
        includeDate,
        includeMilliseconds,
        timeZone: options.timeZone,
    });
    if (!parts) {
        return null;
    }

    const time = includeMilliseconds
        ? `${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}`
        : `${parts.hour}:${parts.minute}:${parts.second}`;
    if (!includeDate) {
        return time;
    }

    return `${parts.year}-${parts.month}-${parts.day} ${time}`;
}

export function formatFriendlyLocalDateTime(
    value: InstantValue | null | undefined,
    options: FriendlyLocalDateTimeOptions = {},
): string | null {
    const date = resolveInstant(value);
    if (!date) {
        return null;
    }

    return getFriendlyDateTimeFormatter(options).format(date);
}
