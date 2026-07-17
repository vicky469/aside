import * as assert from "node:assert/strict";
import test from "node:test";
import {
	purgeRemoteCache,
	readRemoteCachePurgeAuthSecret,
	type RemoteCachePurgeRequest,
	type RemoteCachePurgeRequestOptions,
	type RemoteCachePurgeResponse,
} from "../src/publish/remoteCachePurgeBroker";

test("readRemoteCachePurgeAuthSecret resolves only the configured SecretStorage name", () => {
	const requestedNames: string[] = [];
	const secret = readRemoteCachePurgeAuthSecret({
		getSecret: (name) => {
			requestedNames.push(name);
			return name === "aside-purge-broker" ? "broker-secret" : null;
		},
	}, " aside-purge-broker ");

	assert.equal(secret, "broker-secret");
	assert.deepEqual(requestedNames, ["aside-purge-broker"]);
});

function createRequestStub(response: RemoteCachePurgeResponse): {
	request: RemoteCachePurgeRequest;
	calls: RemoteCachePurgeRequestOptions[];
} {
	const calls: RemoteCachePurgeRequestOptions[] = [];
	return {
		calls,
		request: async (options) => {
			calls.push(options);
			return response;
		},
	};
}

const input = {
	brokerUrl: "https://purge.example.workers.dev/purge",
	authSecret: "broker-secret",
	publicUrl: "https://publish.example.com/public/page.md",
	sourcePath: "public/page.md",
	event: "unpublish" as const,
};

const runtime = {
	now: () => new Date("2026-07-15T00:00:00.000Z"),
	createNonce: () => "nonce-123",
};

test("purgeRemoteCache rejects missing broker configuration without a request", async () => {
	const { request, calls } = createRequestStub({ status: 200, json: { ok: true, status: "purged" } });

	const result = await purgeRemoteCache(request, {
		...input,
		brokerUrl: "",
		authSecret: "",
	}, runtime);

	assert.deepEqual(result, {
		ok: false,
		notice: "Remote cache purge is enabled but its broker URL and auth secret are not configured.",
	});
	assert.deepEqual(calls, []);
});

test("purgeRemoteCache sends the broker contract with generated freshness fields", async () => {
	const { request, calls } = createRequestStub({
		status: 200,
		json: { ok: true, status: "purged", url: input.publicUrl },
	});

	assert.deepEqual(await purgeRemoteCache(request, input, runtime), { ok: true });
	assert.deepEqual(calls, [{
		url: input.brokerUrl,
		method: "POST",
		contentType: "application/json",
		headers: { Authorization: "Bearer broker-secret" },
		body: JSON.stringify({
			url: input.publicUrl,
			sourcePath: input.sourcePath,
			event: "unpublish",
			requestedAt: "2026-07-15T00:00:00.000Z",
			nonce: "nonce-123",
		}),
		throw: false,
	}]);
});

test("purgeRemoteCache returns a sanitized broker rejection", async () => {
	const { request } = createRequestStub({
		status: 403,
		json: { ok: false, status: "rejected", reason: "Invalid broker-secret credential." },
	});

	assert.deepEqual(await purgeRemoteCache(request, input, runtime), {
		ok: false,
		notice: "Cache purge broker rejected the request: Invalid [redacted] credential.",
	});
});

test("purgeRemoteCache converts network failures to non-secret notices", async () => {
	const request: RemoteCachePurgeRequest = async () => {
		throw new Error("socket closed");
	};

	assert.deepEqual(await purgeRemoteCache(request, input, runtime), {
		ok: false,
		notice: "Cache purge broker request failed: socket closed",
	});
});
