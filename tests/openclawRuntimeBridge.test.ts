import * as assert from "node:assert/strict";
import test from "node:test";
import {
    cancelRemoteRuntimeRun,
    createRemoteRuntimeRequester,
    parseRemoteRuntimeResponseEnvelope,
    pollRemoteRuntimeRun,
    probeRemoteRuntimeBridge,
    startRemoteRuntimeRun,
} from "../src/control/openclawRuntimeBridge";

test("parseRemoteRuntimeResponseEnvelope normalizes streamed and terminal payloads", () => {
    assert.deepEqual(parseRemoteRuntimeResponseEnvelope({
        status: "running",
        cursor: "evt-9",
        runId: "remote-run-1",
        events: [
            { type: "progress", text: "Preparing context" },
            { type: "output_delta", text: "Hello" },
        ],
    }), {
        httpStatus: 200,
        status: "running",
        cursor: "evt-9",
        runId: "remote-run-1",
        events: [
            { type: "progress", text: "Preparing context" },
            { type: "output_delta", text: "Hello" },
        ],
        replyText: null,
        error: null,
    });

    assert.deepEqual(parseRemoteRuntimeResponseEnvelope({
        status: "completed",
        runId: "remote-run-1",
        replyText: "Done",
    }), {
        httpStatus: 200,
        status: "completed",
        cursor: null,
        runId: "remote-run-1",
        events: [],
        replyText: "Done",
        error: null,
    });
});

test("startRemoteRuntimeRun posts the SideNote2 prompt contract with bearer auth", async () => {
    let lastRequest: {
        method?: string;
        url: string;
        headers?: Record<string, string>;
        body?: string | ArrayBuffer;
    } | null = null;
    const response = await startRemoteRuntimeRun(async (request) => {
        lastRequest = {
            method: request.method,
            url: request.url,
            headers: request.headers,
            body: request.body,
        };
        return {
            status: 200,
            headers: {},
            arrayBuffer: new ArrayBuffer(0),
            json: {
                runId: "remote-run-1",
                status: "queued",
            },
            text: JSON.stringify({
                runId: "remote-run-1",
                status: "queued",
            }),
        };
    }, {
        baseUrl: "https://remote.example.com/api",
        bearerToken: "secret-token",
        agent: "codex",
        promptText: "Prompt text",
        metadata: {
            capability: "workspace-aware",
        },
    });

    const capturedRequest = lastRequest ?? {
        method: undefined,
        url: "",
        headers: undefined,
        body: undefined,
    };
    assert.equal(capturedRequest.method, "POST");
    assert.equal(capturedRequest.url, "https://remote.example.com/api/v1/sidenote2/runs");
    assert.deepEqual(capturedRequest.headers, {
        Authorization: "Bearer secret-token",
    });
    assert.match(String(capturedRequest.body), /"agent":"codex"/);
    assert.deepEqual(response, {
        httpStatus: 200,
        status: "queued",
        cursor: null,
        runId: "remote-run-1",
        events: [],
        replyText: null,
        error: null,
    });
});

test("pollRemoteRuntimeRun appends cursor and wait params when provided", async () => {
    let lastRequestUrl = "";
    await pollRemoteRuntimeRun(async (request) => {
        lastRequestUrl = request.url;
        return {
            status: 200,
            headers: {},
            arrayBuffer: new ArrayBuffer(0),
            json: {
                runId: "remote-run-1",
                status: "running",
                cursor: "evt-10",
                events: [
                    { type: "output_delta", text: "Hello" },
                ],
            },
            text: "",
        };
    }, {
        baseUrl: "https://remote.example.com",
        bearerToken: "secret-token",
        runId: "remote-run-1",
        afterCursor: "evt-9",
        waitMs: 1500,
    });

    assert.equal(lastRequestUrl, "https://remote.example.com/v1/sidenote2/runs/remote-run-1?after=evt-9&waitMs=1500");
});

test("cancelRemoteRuntimeRun calls the cancel endpoint", async () => {
    let lastRequestUrl = "";
    await cancelRemoteRuntimeRun(async (request) => {
        lastRequestUrl = request.url;
        return {
            status: 202,
            headers: {},
            arrayBuffer: new ArrayBuffer(0),
            json: {
                runId: "remote-run-1",
                status: "cancelled",
            },
            text: "",
        };
    }, {
        baseUrl: "https://remote.example.com",
        bearerToken: "secret-token",
        runId: "remote-run-1",
    });

    assert.equal(lastRequestUrl, "https://remote.example.com/v1/sidenote2/runs/remote-run-1/cancel");
});

test("probeRemoteRuntimeBridge calls healthz and normalizes the response", async () => {
    let lastRequestUrl = "";
    const response = await probeRemoteRuntimeBridge(async (request) => {
        lastRequestUrl = request.url;
        return {
            status: 200,
            headers: {},
            arrayBuffer: new ArrayBuffer(0),
            json: {
                ok: true,
                status: "available",
                publicBaseUrl: "http://192.168.1.184:4215",
            },
            text: "",
        };
    }, {
        baseUrl: "http://192.168.1.184:4215",
        bearerToken: "secret-token",
    });

    assert.equal(lastRequestUrl, "http://192.168.1.184:4215/healthz");
    assert.deepEqual(response, {
        httpStatus: 200,
        ok: true,
        status: "available",
        publicBaseUrl: "http://192.168.1.184:4215",
    });
});

test("startRemoteRuntimeRun wraps requester transport errors with mobile bridge guidance", async () => {
    await assert.rejects(
        () => startRemoteRuntimeRun(async () => {
            throw new Error("Request failed, the internet connection appears to be offline.");
        }, {
            baseUrl: "http://192.168.1.184:4215",
            bearerToken: "secret-token",
            agent: "codex",
            promptText: "Prompt text",
            metadata: {},
        }),
        /try HTTPS or check the app's local-network permission/i,
    );
});

test("createRemoteRuntimeRequester falls back to fetch when the primary requester fails", async () => {
    const requester = createRemoteRuntimeRequester({
        primaryRequester: async () => {
            throw new Error("Request failed, the internet connection appears to be offline.");
        },
        fetcher: async (url, init) => {
            assert.equal(url, "http://192.168.1.184:4215/healthz");
            assert.equal(init?.method, "GET");
            assert.deepEqual(init?.headers, {
                Authorization: "Bearer secret-token",
            });
            return {
                status: 200,
                text: async () => JSON.stringify({
                    ok: true,
                    status: "available",
                    publicBaseUrl: "http://192.168.1.184:4215",
                }),
            };
        },
    });

    const response = await probeRemoteRuntimeBridge(requester, {
        baseUrl: "http://192.168.1.184:4215",
        bearerToken: "secret-token",
    });

    assert.deepEqual(response, {
        httpStatus: 200,
        ok: true,
        status: "available",
        publicBaseUrl: "http://192.168.1.184:4215",
    });
});
