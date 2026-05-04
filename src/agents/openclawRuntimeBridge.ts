import type { RequestUrlParam } from "obsidian";

export type RemoteRuntimeTerminalStatus = "completed" | "failed" | "cancelled";
export type RemoteRuntimeStatus = "queued" | "running" | RemoteRuntimeTerminalStatus;

export type RemoteRuntimeEvent =
    | { type: "progress"; text: string }
    | { type: "output_delta"; text: string }
    | { type: "completed"; replyText: string }
    | { type: "failed"; error: string }
    | { type: "cancelled"; message?: string };

export interface RemoteRuntimeResponseEnvelope {
    httpStatus: number;
    status: RemoteRuntimeStatus;
    cursor: string | null;
    runId: string | null;
    events: RemoteRuntimeEvent[];
    replyText: string | null;
    error: string | null;
}

export interface RemoteRuntimeBridgeRequest {
    baseUrl: string;
    bearerToken: string;
}

export interface RemoteRuntimeRequesterResponse {
    status: number;
    json: unknown;
}

export type RemoteRuntimeRequester = (request: RequestUrlParam) => Promise<RemoteRuntimeRequesterResponse>;

type FetchLike = (
    input: string,
    init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
    },
) => Promise<{
    status: number;
    text(): Promise<string>;
}>;

export interface RemoteRuntimeHealthEnvelope {
    httpStatus: number;
    ok: boolean;
    status: string | null;
    publicBaseUrl: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | null {
    return typeof value === "string" && value.trim()
        ? value.trim()
        : null;
}

function normalizeStatus(value: unknown): RemoteRuntimeStatus {
    switch (value) {
        case "running":
        case "completed":
        case "failed":
        case "cancelled":
            return value;
        default:
            return "queued";
    }
}

function normalizeRemoteRuntimeEvent(value: unknown): RemoteRuntimeEvent | null {
    if (!isRecord(value) || typeof value.type !== "string") {
        return null;
    }

    switch (value.type) {
        case "progress": {
            const text = normalizeOptionalString(value.text);
            return text ? { type: "progress", text } : null;
        }
        case "output_delta": {
            const text = normalizeOptionalString(value.text);
            return text ? { type: "output_delta", text } : null;
        }
        case "completed": {
            const replyText = normalizeOptionalString(value.replyText)
                ?? normalizeOptionalString(value.text)
                ?? normalizeOptionalString(value.outputText)
                ?? normalizeOptionalString(value.finalText);
            return replyText ? { type: "completed", replyText } : null;
        }
        case "failed": {
            const error = normalizeOptionalString(value.error)
                ?? normalizeOptionalString(value.message)
                ?? "Remote runtime failed.";
            return { type: "failed", error };
        }
        case "cancelled":
            return {
                type: "cancelled",
                ...(normalizeOptionalString(value.message) ? { message: normalizeOptionalString(value.message) ?? undefined } : {}),
            };
        default:
            return null;
    }
}

export function parseRemoteRuntimeResponseEnvelope(payload: unknown, httpStatus: number = 200): RemoteRuntimeResponseEnvelope {
    const record = isRecord(payload) ? payload : {};
    const events = Array.isArray(record.events)
        ? record.events
            .map((event) => normalizeRemoteRuntimeEvent(event))
            .filter((event): event is RemoteRuntimeEvent => !!event)
        : [];
    const replyText = normalizeOptionalString(record.replyText)
        ?? normalizeOptionalString(record.outputText)
        ?? normalizeOptionalString(record.finalText)
        ?? events.find((event): event is Extract<RemoteRuntimeEvent, { type: "completed" }> => event.type === "completed")?.replyText
        ?? null;
    const error = normalizeOptionalString(record.error)
        ?? normalizeOptionalString(record.message)
        ?? events.find((event): event is Extract<RemoteRuntimeEvent, { type: "failed" }> => event.type === "failed")?.error
        ?? null;

    return {
        httpStatus,
        status: normalizeStatus(record.status),
        cursor: normalizeOptionalString(record.cursor),
        runId: normalizeOptionalString(record.runId),
        events,
        replyText,
        error,
    };
}

function buildUrl(baseUrl: string, path: string, query: URLSearchParams | null = null): string {
    const url = new URL(path, `${baseUrl}/`);
    if (query) {
        url.search = query.toString();
    }
    return url.toString();
}

function buildRequest(
    options: RemoteRuntimeBridgeRequest,
    path: string,
    method: string,
    body: Record<string, unknown> | null = null,
    query: URLSearchParams | null = null,
): RequestUrlParam {
    return {
        url: buildUrl(options.baseUrl, path, query),
        method,
        contentType: "application/json",
        throw: false,
        headers: {
            Authorization: `Bearer ${options.bearerToken}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    };
}

function shouldAttemptFetchFallback(url: string): boolean {
    try {
        const protocol = new URL(url).protocol;
        return protocol === "http:" || protocol === "https:";
    } catch {
        return false;
    }
}

async function requestViaFetch(fetcher: FetchLike, request: RequestUrlParam): Promise<RemoteRuntimeRequesterResponse> {
    const response = await fetcher(request.url, {
        method: request.method,
        headers: request.headers,
        body: typeof request.body === "string" ? request.body : undefined,
    });
    const text = await response.text();
    let json: unknown = {};
    if (text.trim()) {
        try {
            json = JSON.parse(text);
        } catch {
            json = {};
        }
    }

    return {
        status: response.status,
        json,
    };
}

export function createRemoteRuntimeRequester(options: {
    primaryRequester: RemoteRuntimeRequester;
    fetcher?: FetchLike;
}): RemoteRuntimeRequester {
    return async (request) => {
        try {
            return await options.primaryRequester(request);
        } catch (primaryError) {
            if (!options.fetcher || !shouldAttemptFetchFallback(request.url)) {
                throw primaryError;
            }

            try {
                return await requestViaFetch(options.fetcher, request);
            } catch (fetchError) {
                if (primaryError instanceof Error && fetchError instanceof Error) {
                    throw new Error(`${primaryError.message} (fetch fallback also failed: ${fetchError.message})`);
                }
                throw fetchError;
            }
        }
    };
}

function summarizeRequesterError(error: unknown, options: RemoteRuntimeBridgeRequest): Error {
    const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Remote bridge request failed.";
    const protocol = (() => {
        try {
            return new URL(options.baseUrl).protocol;
        } catch {
            return null;
        }
    })();

    if (protocol === "http:") {
        return new Error(
            `Remote bridge request failed before the server responded. ${message} If browser access works but SideNote2 still fails on mobile, try HTTPS or check the app's local-network permission.`,
        );
    }

    return new Error(`Remote bridge request failed before the server responded. ${message}`);
}

export async function startRemoteRuntimeRun(
    requester: RemoteRuntimeRequester,
    options: RemoteRuntimeBridgeRequest & {
        agent: string;
        promptText: string;
        metadata: Record<string, unknown>;
    },
): Promise<RemoteRuntimeResponseEnvelope> {
    try {
        const response = await requester(buildRequest(options, "v1/sidenote2/runs", "POST", {
            agent: options.agent,
            promptText: options.promptText,
            metadata: options.metadata,
        }));
        return parseRemoteRuntimeResponseEnvelope(response.json, response.status);
    } catch (error) {
        throw summarizeRequesterError(error, options);
    }
}

export async function pollRemoteRuntimeRun(
    requester: RemoteRuntimeRequester,
    options: RemoteRuntimeBridgeRequest & {
        runId: string;
        afterCursor?: string | null;
        waitMs?: number;
    },
): Promise<RemoteRuntimeResponseEnvelope> {
    const query = new URLSearchParams();
    if (options.afterCursor) {
        query.set("after", options.afterCursor);
    }
    if (typeof options.waitMs === "number" && Number.isFinite(options.waitMs) && options.waitMs > 0) {
        query.set("waitMs", String(Math.max(1, Math.floor(options.waitMs))));
    }
    try {
        const response = await requester(buildRequest(
            options,
            `v1/sidenote2/runs/${encodeURIComponent(options.runId)}`,
            "GET",
            null,
            query,
        ));
        return parseRemoteRuntimeResponseEnvelope(response.json, response.status);
    } catch (error) {
        throw summarizeRequesterError(error, options);
    }
}

export async function cancelRemoteRuntimeRun(
    requester: RemoteRuntimeRequester,
    options: RemoteRuntimeBridgeRequest & {
        runId: string;
    },
): Promise<RemoteRuntimeResponseEnvelope> {
    try {
        const response = await requester(buildRequest(
            options,
            `v1/sidenote2/runs/${encodeURIComponent(options.runId)}/cancel`,
            "POST",
            {},
        ));
        return parseRemoteRuntimeResponseEnvelope(response.json, response.status);
    } catch (error) {
        throw summarizeRequesterError(error, options);
    }
}

export async function probeRemoteRuntimeBridge(
    requester: RemoteRuntimeRequester,
    options: RemoteRuntimeBridgeRequest,
): Promise<RemoteRuntimeHealthEnvelope> {
    try {
        const response = await requester(buildRequest(options, "healthz", "GET"));
        const record = isRecord(response.json) ? response.json : {};
        return {
            httpStatus: response.status,
            ok: record.ok === true,
            status: normalizeOptionalString(record.status),
            publicBaseUrl: normalizeOptionalString(record.publicBaseUrl),
        };
    } catch (error) {
        throw summarizeRequesterError(error, options);
    }
}
