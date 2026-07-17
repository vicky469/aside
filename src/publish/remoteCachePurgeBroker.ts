export type RemoteCachePurgeEvent = "unpublish" | "republish";

export interface RemoteCachePurgeRequestOptions {
	url: string;
	method: "POST";
	contentType: "application/json";
	headers: Record<string, string>;
	body: string;
	throw: false;
}

export interface RemoteCachePurgeResponse {
	status: number;
	json?: unknown;
	text?: string;
}

export type RemoteCachePurgeRequest = (
	options: RemoteCachePurgeRequestOptions,
) => Promise<RemoteCachePurgeResponse>;

export interface RemoteCachePurgeInput {
	brokerUrl: string;
	authSecret: string;
	publicUrl: string;
	sourcePath: string;
	event: RemoteCachePurgeEvent;
}

export interface RemoteCachePurgeRuntime {
	now(): Date;
	createNonce(): string;
}

export type RemoteCachePurgeResult =
	| { ok: true }
	| { ok: false; notice: string };

export interface RemoteCachePurgeSecretStorage {
	getSecret(name: string): string | null;
}

function normalizeText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function readRemoteCachePurgeAuthSecret(
	secretStorage: RemoteCachePurgeSecretStorage | null | undefined,
	secretName: string,
): string {
	const normalizedName = normalizeText(secretName);
	if (!secretStorage || !normalizedName) {
		return "";
	}
	return normalizeText(secretStorage.getSecret(normalizedName));
}

function sanitizeMessage(value: unknown, secret: string): string {
	const message = normalizeText(value).slice(0, 240) || "Unknown broker error.";
	return secret ? message.split(secret).join("[redacted]") : message;
}

function readBrokerFailureReason(response: RemoteCachePurgeResponse, secret: string): string {
	if (response.json && typeof response.json === "object") {
		const reason = (response.json as { reason?: unknown }).reason;
		if (normalizeText(reason)) {
			return sanitizeMessage(reason, secret);
		}
	}
	if (normalizeText(response.text)) {
		return sanitizeMessage(response.text, secret);
	}
	return `HTTP ${response.status}.`;
}

function isSuccessfulBrokerResponse(response: RemoteCachePurgeResponse): boolean {
	return response.status >= 200
		&& response.status < 300
		&& !!response.json
		&& typeof response.json === "object"
		&& (response.json as { ok?: unknown }).ok === true
		&& (response.json as { status?: unknown }).status === "purged";
}

export async function purgeRemoteCache(
	request: RemoteCachePurgeRequest,
	input: RemoteCachePurgeInput,
	runtime: RemoteCachePurgeRuntime,
): Promise<RemoteCachePurgeResult> {
	const brokerUrl = normalizeText(input.brokerUrl);
	const authSecret = normalizeText(input.authSecret);
	if (!brokerUrl || !authSecret) {
		const missing = [
			!brokerUrl ? "broker URL" : "",
			!authSecret ? "auth secret" : "",
		].filter(Boolean).join(" and ");
		return {
			ok: false,
			notice: `Remote cache purge is enabled but its ${missing} ${missing.includes(" and ") ? "are" : "is"} not configured.`,
		};
	}

	try {
		const response = await request({
			url: brokerUrl,
			method: "POST",
			contentType: "application/json",
			headers: {
				Authorization: `Bearer ${authSecret}`,
			},
			body: JSON.stringify({
				url: input.publicUrl,
				sourcePath: input.sourcePath,
				event: input.event,
				requestedAt: runtime.now().toISOString(),
				nonce: runtime.createNonce(),
			}),
			throw: false,
		});

		if (isSuccessfulBrokerResponse(response)) {
			return { ok: true };
		}

		return {
			ok: false,
			notice: `Cache purge broker rejected the request: ${readBrokerFailureReason(response, authSecret)}`,
		};
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : error;
		return {
			ok: false,
			notice: `Cache purge broker request failed: ${sanitizeMessage(message, authSecret)}`,
		};
	}
}
