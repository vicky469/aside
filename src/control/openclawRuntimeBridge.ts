import type { RequestUrlParam, RequestUrlResponse } from "obsidian";

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

export type RemoteRuntimeRequester = (request: RequestUrlParam) => Promise<RequestUrlResponse>;

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

export async function startRemoteRuntimeRun(
    requester: RemoteRuntimeRequester,
    options: RemoteRuntimeBridgeRequest & {
        agent: string;
        promptText: string;
        metadata: Record<string, unknown>;
    },
): Promise<RemoteRuntimeResponseEnvelope> {
    const response = await requester(buildRequest(options, "v1/sidenote2/runs", "POST", {
        agent: options.agent,
        promptText: options.promptText,
        metadata: options.metadata,
    }));
    return parseRemoteRuntimeResponseEnvelope(response.json, response.status);
}

export async function pollRemoteRuntimeRun(
    requester: RemoteRuntimeRequester,
    options: RemoteRuntimeBridgeRequest & {
        runId: string;
        afterCursor?: string | null;
    },
): Promise<RemoteRuntimeResponseEnvelope> {
    const query = new URLSearchParams();
    if (options.afterCursor) {
        query.set("after", options.afterCursor);
    }
    const response = await requester(buildRequest(
        options,
        `v1/sidenote2/runs/${encodeURIComponent(options.runId)}`,
        "GET",
        null,
        query,
    ));
    return parseRemoteRuntimeResponseEnvelope(response.json, response.status);
}

export async function cancelRemoteRuntimeRun(
    requester: RemoteRuntimeRequester,
    options: RemoteRuntimeBridgeRequest & {
        runId: string;
    },
): Promise<RemoteRuntimeResponseEnvelope> {
    const response = await requester(buildRequest(
        options,
        `v1/sidenote2/runs/${encodeURIComponent(options.runId)}/cancel`,
        "POST",
        {},
    ));
    return parseRemoteRuntimeResponseEnvelope(response.json, response.status);
}
