import { env as testEnv, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
	handlePurgeRequest,
	type BrokerDependencies,
	type BrokerEnv,
} from "../src/index";

const brokerEnv: BrokerEnv = {
	CLOUDFLARE_API_TOKEN: "cloudflare-token",
	CLOUDFLARE_ZONE_ID: "zone-id",
	BROKER_AUTH_SECRET: "broker-secret",
	ALLOWED_HOSTS: "publish.example.com",
	ALLOWED_PATH_PREFIXES: "/public/",
	RATE_LIMIT_MAX: "30",
	RATE_LIMIT_WINDOW_SECONDS: "60",
} as BrokerEnv;

const validBody = {
	url: "https://publish.example.com/public/page.md",
	sourcePath: "public/page.md",
	event: "unpublish",
	requestedAt: "2026-07-15T00:00:00.000Z",
	nonce: "nonce-12345678",
};

function createRequest(body: unknown = validBody, options: {
	method?: string;
	auth?: string;
} = {}): Request {
	return new Request("https://broker.example.com/purge", {
		method: options.method ?? "POST",
		headers: {
			Authorization: options.auth ?? "Bearer broker-secret",
			"Content-Type": "application/json",
			"CF-Connecting-IP": "203.0.113.10",
		},
		body: (options.method ?? "POST") === "POST" ? JSON.stringify(body) : undefined,
	});
}

function createDependencies(overrides: Partial<BrokerDependencies> = {}): BrokerDependencies {
	return {
		now: () => Date.parse("2026-07-15T00:00:00.000Z"),
		reserve: async () => ({ ok: true }),
		fetch: async () => new Response(JSON.stringify({ success: true }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		}),
		...overrides,
	};
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
	return response.json() as Promise<Record<string, unknown>>;
}

describe("cache purge broker", () => {
	it("rejects methods other than POST", async () => {
		const response = await handlePurgeRequest(createRequest(undefined, { method: "GET" }), brokerEnv, createDependencies());

		expect(response.status).toBe(405);
		expect(await readJson(response)).toMatchObject({ ok: false, status: "rejected" });
	});

	it("rejects invalid authentication", async () => {
		const response = await handlePurgeRequest(createRequest(validBody, { auth: "Bearer wrong" }), brokerEnv, createDependencies());

		expect(response.status).toBe(401);
		expect(await readJson(response)).toEqual({
			ok: false,
			status: "rejected",
			reason: "Authentication failed.",
		});
	});

	it("rejects stale requests", async () => {
		const response = await handlePurgeRequest(createRequest({
			...validBody,
			requestedAt: "2026-07-14T23:54:59.000Z",
		}), brokerEnv, createDependencies());

		expect(response.status).toBe(400);
		expect(await readJson(response)).toMatchObject({ reason: "Request timestamp is outside the allowed window." });
	});

	it("rejects disallowed and pages.dev URLs before guard or Cloudflare calls", async () => {
		let calls = 0;
		const dependencies = createDependencies({
			reserve: async () => { calls += 1; return { ok: true }; },
			fetch: async () => { calls += 1; return new Response(); },
		});

		for (const url of [
			"https://other.example.com/public/page.md",
			"https://project.pages.dev/public/page.md",
			"https://publish.example.com/private/page.md",
		]) {
			const response = await handlePurgeRequest(createRequest({ ...validBody, url }), brokerEnv, dependencies);
			expect(response.status).toBe(400);
		}
		expect(calls).toBe(0);
	});

	it("rejects replayed nonces and rate-limited callers", async () => {
		for (const rejection of [
			{ status: 409, reason: "Request nonce was already used." },
			{ status: 429, reason: "Purge rate limit exceeded." },
		]) {
			const response = await handlePurgeRequest(createRequest(), brokerEnv, createDependencies({
				reserve: async () => ({ ok: false, ...rejection }),
			}));
			expect(response.status).toBe(rejection.status);
			expect(await readJson(response)).toMatchObject({ reason: rejection.reason });
		}
	});

	it("purges exactly the validated URL", async () => {
		const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
		const response = await handlePurgeRequest(createRequest(), brokerEnv, createDependencies({
			fetch: async (input, init) => {
				fetchCalls.push({ url: String(input), init });
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			},
		}));

		expect(response.status).toBe(200);
		expect(await readJson(response)).toEqual({ ok: true, status: "purged", url: validBody.url });
		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0]?.url).toBe("https://api.cloudflare.com/client/v4/zones/zone-id/purge_cache");
		expect(fetchCalls[0]?.init?.headers).toEqual({
			Authorization: "Bearer cloudflare-token",
			"Content-Type": "application/json",
		});
		expect(fetchCalls[0]?.init?.body).toBe(JSON.stringify({ files: [validBody.url] }));
	});

	it("sanitizes Cloudflare API failures", async () => {
		const response = await handlePurgeRequest(createRequest(), brokerEnv, createDependencies({
			fetch: async () => new Response(JSON.stringify({
				success: false,
				errors: [{ message: "Token cloudflare-token lacks permission" }],
			}), { status: 403 }),
		}));
		const body = await response.text();

		expect(response.status).toBe(502);
		expect(body).not.toContain("cloudflare-token");
		expect(JSON.parse(body)).toMatchObject({ ok: false, status: "failed" });
	});

	it("PurgeGuard rejects a replayed nonce", async () => {
		const id = testEnv.PURGE_GUARD.idFromName("replay-test");
		const stub = testEnv.PURGE_GUARD.get(id);
		const reservation = {
			nonce: "durable-nonce-1",
			now: Date.parse("2026-07-15T00:00:00.000Z"),
			rateKeys: ["auth:test", "host:publish.example.com", "ip:203.0.113.10"],
			maxRequests: 30,
			windowMs: 60_000,
		};

		expect(await (await stub.fetch("https://purge-guard.internal/reserve", {
			method: "POST",
			body: JSON.stringify(reservation),
		})).json()).toEqual({ ok: true });
		const replay = await stub.fetch("https://purge-guard.internal/reserve", {
			method: "POST",
			body: JSON.stringify(reservation),
		});
		expect(replay.status).toBe(409);
		expect(await replay.json()).toMatchObject({ reason: "Request nonce was already used." });
	});

	it("PurgeGuard rate-limits repeated caller keys", async () => {
		const id = testEnv.PURGE_GUARD.idFromName("rate-test");
		const stub = testEnv.PURGE_GUARD.get(id);
		const reservation = {
			nonce: "durable-rate-1",
			now: Date.parse("2026-07-15T00:00:00.000Z"),
			rateKeys: ["auth:test", "host:publish.example.com", "ip:203.0.113.10"],
			maxRequests: 1,
			windowMs: 60_000,
		};
		await stub.fetch("https://purge-guard.internal/reserve", {
			method: "POST",
			body: JSON.stringify(reservation),
		});

		const limited = await stub.fetch("https://purge-guard.internal/reserve", {
			method: "POST",
			body: JSON.stringify({ ...reservation, nonce: "durable-rate-2" }),
		});
		expect(limited.status).toBe(429);
		expect(await limited.json()).toMatchObject({ reason: "Purge rate limit exceeded." });
	});

	it("PurgeGuard removes expired nonce and rate-limit records", async () => {
		const id = testEnv.PURGE_GUARD.idFromName("cleanup-test");
		const stub = testEnv.PURGE_GUARD.get(id);
		const firstNow = Date.parse("2026-07-15T00:00:00.000Z");
		const firstReservation = {
			nonce: "durable-cleanup-1",
			now: firstNow,
			rateKeys: ["auth:test", "host:publish.example.com", "ip:203.0.113.10"],
			maxRequests: 30,
			windowMs: 60_000,
		};

		await stub.fetch("https://purge-guard.internal/reserve", {
			method: "POST",
			body: JSON.stringify(firstReservation),
		});
		await stub.fetch("https://purge-guard.internal/reserve", {
			method: "POST",
			body: JSON.stringify({
				...firstReservation,
				nonce: "durable-cleanup-2",
				now: firstNow + 6 * 60_000,
			}),
		});

		const keys = await runInDurableObject(stub, async (_instance, state) =>
			Array.from((await state.storage.list()).keys())
		);
		expect(keys).not.toContain("nonce:durable-cleanup-1");
		expect(keys.some((key) => key.startsWith(`rate:${firstNow}:`))).toBe(false);
		expect(keys).toContain("nonce:durable-cleanup-2");
	});
});
