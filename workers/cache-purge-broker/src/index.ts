import { DurableObject } from "cloudflare:workers";

const REQUEST_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX = 30;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface BrokerEnv {
	CLOUDFLARE_API_TOKEN: string;
	CLOUDFLARE_ZONE_ID: string;
	BROKER_AUTH_SECRET: string;
	ALLOWED_HOSTS: string;
	ALLOWED_PATH_PREFIXES: string;
	RATE_LIMIT_MAX?: string;
	RATE_LIMIT_WINDOW_SECONDS?: string;
	PURGE_GUARD: DurableObjectNamespace<PurgeGuard>;
}

interface PurgeBody {
	url: string;
	sourcePath: string;
	event: "unpublish" | "republish";
	requestedAt: string;
	nonce: string;
}

interface GuardReservationInput {
	nonce: string;
	now: number;
	rateKeys: string[];
	maxRequests: number;
	windowMs: number;
}

export type GuardReservationResult =
	| { ok: true }
	| { ok: false; status: number; reason: string };

export interface BrokerDependencies {
	now(): number;
	reserve(input: GuardReservationInput): Promise<GuardReservationResult>;
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		},
	});
}

function reject(status: number, reason: string): Response {
	return jsonResponse(status, { ok: false, status: "rejected", reason });
}

function fail(status: number, reason: string): Response {
	return jsonResponse(status, { ok: false, status: "failed", reason });
}

function splitConfig(value: string): string[] {
	return value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function constantTimeEqual(left: string, right: string): boolean {
	const length = Math.max(left.length, right.length);
	let difference = left.length ^ right.length;
	for (let index = 0; index < length; index += 1) {
		difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
	}
	return difference === 0;
}

function readBearerToken(request: Request): string {
	const authorization = request.headers.get("Authorization") ?? "";
	return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function parsePurgeBody(value: unknown): PurgeBody | null {
	if (!isRecord(value)) {
		return null;
	}
	const event = value.event;
	if (event !== "unpublish" && event !== "republish") {
		return null;
	}
	for (const key of ["url", "sourcePath", "requestedAt", "nonce"] as const) {
		if (typeof value[key] !== "string" || !value[key].trim()) {
			return null;
		}
	}
	return {
		url: value.url as string,
		sourcePath: value.sourcePath as string,
		event,
		requestedAt: value.requestedAt as string,
		nonce: value.nonce as string,
	};
}

function isInternalHostname(hostname: string): boolean {
	return hostname === "localhost"
		|| hostname.endsWith(".local")
		|| hostname === "0.0.0.0"
		|| hostname === "127.0.0.1"
		|| hostname === "::1"
		|| /^10\./u.test(hostname)
		|| /^192\.168\./u.test(hostname)
		|| /^172\.(?:1[6-9]|2\d|3[01])\./u.test(hostname);
}

function validateSourcePath(sourcePath: string): boolean {
	if (sourcePath.startsWith("/") || sourcePath.includes("\0")) {
		return false;
	}
	const segments = sourcePath.replace(/\\/gu, "/").split("/").filter(Boolean);
	return segments.length > 0 && segments.every((segment) => segment !== "." && segment !== "..");
}

function validatePurgeUrl(rawUrl: string, env: BrokerEnv): URL | null {
	try {
		const url = new URL(rawUrl);
		const hostname = url.hostname.toLowerCase();
		const allowedHosts = new Set(splitConfig(env.ALLOWED_HOSTS));
		const prefixes = splitConfig(env.ALLOWED_PATH_PREFIXES).map((prefix) =>
			prefix.startsWith("/") ? prefix : `/${prefix}`
		);
		if (url.protocol !== "https:"
			|| !!url.username
			|| !!url.password
			|| (!!url.port && url.port !== "443")
			|| !!url.hash
			|| isInternalHostname(hostname)
			|| hostname.endsWith(".pages.dev")
			|| !allowedHosts.has(hostname)
			|| !prefixes.some((prefix) => url.pathname.startsWith(prefix))) {
			return null;
		}
		const decodedPath = decodeURIComponent(url.pathname);
		if (decodedPath.split("/").some((segment) => segment === "..")) {
			return null;
		}
		return url;
	} catch {
		return null;
	}
}

async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sanitizeReason(value: unknown, secrets: string[]): string {
	let reason = typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : "Cloudflare cache purge failed.";
	for (const secret of secrets) {
		if (secret) {
			reason = reason.split(secret).join("[redacted]");
		}
	}
	return reason;
}

async function readCloudflareFailure(response: Response, env: BrokerEnv): Promise<string> {
	try {
		const body = await response.json<{ errors?: Array<{ message?: unknown }> }>();
		const message = body.errors?.find((error) => typeof error.message === "string")?.message;
		return sanitizeReason(message, [env.CLOUDFLARE_API_TOKEN, env.BROKER_AUTH_SECRET]);
	} catch {
		return `Cloudflare API returned HTTP ${response.status}.`;
	}
}

export async function handlePurgeRequest(
	request: Request,
	env: BrokerEnv,
	dependencies: BrokerDependencies,
): Promise<Response> {
	if (request.method !== "POST") {
		return reject(405, "Only POST is allowed.");
	}
	if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ZONE_ID || !env.BROKER_AUTH_SECRET) {
		return fail(500, "Broker is not configured.");
	}
	const authSecret = readBearerToken(request);
	if (!constantTimeEqual(authSecret, env.BROKER_AUTH_SECRET)) {
		return reject(401, "Authentication failed.");
	}

	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return reject(400, "Request body must be valid JSON.");
	}
	const body = parsePurgeBody(rawBody);
	if (!body || !validateSourcePath(body.sourcePath) || !/^[A-Za-z0-9_-]{8,128}$/u.test(body.nonce)) {
		return reject(400, "Request body is invalid.");
	}
	const requestedAt = Date.parse(body.requestedAt);
	const now = dependencies.now();
	if (!Number.isFinite(requestedAt) || Math.abs(now - requestedAt) > REQUEST_WINDOW_MS) {
		return reject(400, "Request timestamp is outside the allowed window.");
	}
	const purgeUrl = validatePurgeUrl(body.url, env);
	if (!purgeUrl) {
		return reject(400, "URL is not allowed.");
	}

	const sourceIp = request.headers.get("CF-Connecting-IP")?.trim() || "unknown";
	const authHash = await sha256(authSecret);
	const reservation = await dependencies.reserve({
		nonce: body.nonce,
		now,
		rateKeys: [`auth:${authHash}`, `host:${purgeUrl.hostname}`, `ip:${sourceIp}`],
		maxRequests: parsePositiveInteger(env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX),
		windowMs: parsePositiveInteger(env.RATE_LIMIT_WINDOW_SECONDS, DEFAULT_RATE_LIMIT_WINDOW_MS / 1000) * 1000,
	});
	if (!reservation.ok) {
		return reject(reservation.status, reservation.reason);
	}

	let cloudflareResponse: Response;
	try {
		cloudflareResponse = await dependencies.fetch(
			`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(env.CLOUDFLARE_ZONE_ID)}/purge_cache`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ files: [purgeUrl.href] }),
			},
		);
	} catch {
		return fail(502, "Cloudflare cache purge request failed.");
	}

	let success = false;
	try {
		const responseBody = await cloudflareResponse.clone().json<{ success?: unknown }>();
		success = cloudflareResponse.ok && responseBody.success === true;
	} catch {
		success = false;
	}
	if (!success) {
		return fail(502, await readCloudflareFailure(cloudflareResponse, env));
	}

	return jsonResponse(200, { ok: true, status: "purged", url: purgeUrl.href });
}

async function reserveWithDurableObject(
	env: BrokerEnv,
	input: GuardReservationInput,
): Promise<GuardReservationResult> {
	const id = env.PURGE_GUARD.idFromName("global");
	const response = await env.PURGE_GUARD.get(id).fetch("https://purge-guard.internal/reserve", {
		method: "POST",
		body: JSON.stringify(input),
	});
	return response.json<GuardReservationResult>();
}

export class PurgeGuard extends DurableObject<BrokerEnv> {
	public async fetch(request: Request): Promise<Response> {
		if (request.method !== "POST" || new URL(request.url).pathname !== "/reserve") {
			return reject(404, "Not found.");
		}
		const input = await request.json<GuardReservationInput>();
		const result = await this.ctx.storage.transaction(async (transaction) => {
			const nonceRecords = await transaction.list<number>({ prefix: "nonce:" });
			const expiredNonceKeys = Array.from(nonceRecords)
				.filter(([, expiresAt]) => expiresAt <= input.now)
				.map(([key]) => key);
			const rateRecords = await transaction.list<number>({ prefix: "rate:" });
			const expiredRateKeys = Array.from(rateRecords.keys()).filter((key) => {
				const windowStart = Number.parseInt(key.slice("rate:".length).split(":", 1)[0] ?? "", 10);
				return Number.isFinite(windowStart) && windowStart + input.windowMs <= input.now;
			});
			if (expiredNonceKeys.length > 0) {
				await transaction.delete(expiredNonceKeys);
			}
			if (expiredRateKeys.length > 0) {
				await transaction.delete(expiredRateKeys);
			}

			const nonceKey = `nonce:${input.nonce}`;
			const nonceExpiry = await transaction.get<number>(nonceKey);
			if (nonceExpiry && nonceExpiry > input.now) {
				return { ok: false, status: 409, reason: "Request nonce was already used." } as const;
			}

			const windowStart = Math.floor(input.now / input.windowMs) * input.windowMs;
			const rateKeys = input.rateKeys.map((key) => `rate:${windowStart}:${key}`);
			const counts = await Promise.all(rateKeys.map((key) => transaction.get<number>(key)));
			if (counts.some((count) => (count ?? 0) >= input.maxRequests)) {
				return { ok: false, status: 429, reason: "Purge rate limit exceeded." } as const;
			}

			await transaction.put(nonceKey, input.now + REQUEST_WINDOW_MS);
			await Promise.all(rateKeys.map((key, index) => transaction.put(key, (counts[index] ?? 0) + 1)));
			return { ok: true } as const;
		});
		return jsonResponse(result.ok ? 200 : result.status, result);
	}
}

export default {
	async fetch(request: Request, env: BrokerEnv): Promise<Response> {
		if (new URL(request.url).pathname !== "/purge") {
			return reject(404, "Not found.");
		}
		return handlePurgeRequest(request, env, {
			now: () => Date.now(),
			reserve: (input) => reserveWithDurableObject(env, input),
			fetch: (input, init) => fetch(input, init),
		});
	},
};
