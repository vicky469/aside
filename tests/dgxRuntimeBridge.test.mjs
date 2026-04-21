import * as assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    BridgeRunCancelledError,
    createBridgeConfig,
    createDgxRuntimeBridge,
    getBaseProcessEnv,
    getBridgeTransportProtocol,
} from "../scripts/dgx-runtime-bridge-lib.mjs";

const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUT8DsjVInfWQ4UW4JLpBgXd6XaWswDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDQyMTA3MzMzM1oXDTI3MDQy
MTA3MzMzM1owFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAn2gtjW6YQTuOpOLk3e2xUSHJhiT/2+haZrGJIdUwm0zC
aSxVTsPOYctOfdoWKz5vtv10i041MrCfPQhiFXkJzoB4aaXXwl7T7POJ121msYHb
P0doE+GIgAx0xIDR7VYoTv/30PJe1V+NPSeeh6cwUTuXkkx2flWNrGUDEmgMVFQO
tMDdWsL7zjxSYcs6iw/O3lk6fYWgyScEX/BZzomDRnIbiWcf/8NsIOQr17xv0XRH
8AVPF7UegpEcxPVUetl0Knxg6IOhpll+pstLbxknyXrXVl90Im3j1gYdtcBKTvnO
v1SMQXvPPgHXN1m4DJEIUGB1LELN3i2Yv+MBFT6DawIDAQABo1MwUTAdBgNVHQ4E
FgQU8ksWSCR5rfOyC1LW+cfkQFxDvlcwHwYDVR0jBBgwFoAU8ksWSCR5rfOyC1LW
+cfkQFxDvlcwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAajn1
adScczcUdm5J6OyWWLTib2kzUWfsClOJWISaxulJ0QmtlSWBCFVAR/CtJgGzekrY
l1E5SDIvuPfniZ+X4VRdvl75ri3l2e5wm/Hvm/bDonvSzAqTat0RrF3/ieE+VFzK
8exyOdFUTULav6iARFttCZM0z4pSd4DrLDVoGtBqeFYzbdcRQkxfspQIAaqC35nd
RfS3ZBaKh7+KJYd77wBVMVIn83r/ghppSLGh0iJ1Hq4Sk/7U6zqdw8Dx4whdIR+1
9kv6E1rG/onnTkbzZZYQpCEQ/Bh7G3CO2a7yZronXFFonP5aEEiPVB0t7OEaf8At
YFQmy6nU1Lrb4HmUCg==
-----END CERTIFICATE-----
`;

const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCfaC2NbphBO46k
4uTd7bFRIcmGJP/b6FpmsYkh1TCbTMJpLFVOw85hy0592hYrPm+2/XSLTjUysJ89
CGIVeQnOgHhppdfCXtPs84nXbWaxgds/R2gT4YiADHTEgNHtVihO//fQ8l7VX409
J56HpzBRO5eSTHZ+VY2sZQMSaAxUVA60wN1awvvOPFJhyzqLD87eWTp9haDJJwRf
8FnOiYNGchuJZx//w2wg5CvXvG/RdEfwBU8XtR6CkRzE9VR62XQqfGDog6GmWX6m
y0tvGSfJetdWX3QibePWBh21wEpO+c6/VIxBe88+Adc3WbgMkQhQYHUsQs3eLZi/
4wEVPoNrAgMBAAECggEAGDYYhRzBH1dOaRjVLigGAI6jLy67dckqweJBM9RPl6bm
+FZ1dosi85OPjmnraBIJob+JTgdI6TQOW5TEYQKLTMQShelchfclNR4gV4oUSO2y
QUA1PJ/KvbgmnBn8yJGHechC+Yd2g+4JY7p6x5vLKOtmMCBQ9wtDg2WsO8V16fDF
EBfxVNLE6/shf86/lgz9F3RNARJHQymY9qCWVv8T4JDnPdgZ5Gxrolplkvq58Tv+
+TYtq9oxSN8eHODlFbJgYWxJRFp9xq+kpzZRdCw+m424EK5RLDNWELsn76h7mEGh
CLIDJljeYMgC0+B1Ar+VRTpfNFvzh8+pRTe5GIzt0QKBgQDPa/y1zEYQJ14TjjFq
Tl5jxaISmkumFuNSsQRnIbpR4ShbmpE+A1sssH/BLPEjhYD+am/YHLgHNx9LqG0M
6FbaYoWv21T/cb8hICOl+gt/pjBEIxvJY22IViEQGxwOqO4AEaJ9Vn/WCtCCqPbH
VM61dAAVYY8S8cKB7R1xvaKcRwKBgQDEvXM1RT1Z9syds/YA4CTQDiKYWBvhWjv5
sFJvrTxe0sbMDYIzwbXC5B+zAMnVh9L6yvE0eNuGa/5eJpaHSXvpdimLb1RVVDMz
U3NRctlttggTyA+DlutQIV/QrqO848o+cSCz0H5zD/LYScnXlfMwHspSjcV6h+6V
seDQMl5FvQKBgAr1A2Z/IfxceAXEbyvUc/wFRqiA6hod/2gw3bCtAXCt2jnsklua
Rci4kiccPqjHtqa57KqX6cjHyqlufkQ+SchDiBhgF79evN/9GKT97nmRx97xk9gx
nmmjUx/MrtC/b8MlK1Y/qYUfESC12ENzYXAIbrCydKJljwbaBcIqaFqlAoGADfie
K9RE7RSXp0NWXu2L77JxRnxLTo+H3s1krUWSGfHB6E+1RVOmQrbMgXu22ZERrHmo
8175x+v3XlxDKExRnlyjyqEXTg/yqtxsPgZ35lCc9jqoz2FySHh2Q22DdzB99j02
Y06VDDq/thhXWxXs9Sfamk4zDeaFTOAa5O4Ov8kCgYApareZ7sSsXeTGQMUS/+Kn
H7TADIrHMalZy0TDB4n2YichrWw0S/WJj1aEDWqqDq9Kie23zAovb3yf7jBzgAvb
pfVbNY+qmZOUcXAjV5wyDloueK18gjcY1/l+XLUkym2RvRfa4vWenrWinvGsikL2
pCxwchwUnPP1HU2lomzG5A==
-----END PRIVATE KEY-----
`;

function createTlsFiles(t) {
    const directory = mkdtempSync(path.join(os.tmpdir(), "sidenote2-dgx-tls-"));
    t.after(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    const certPath = path.join(directory, "bridge-cert.pem");
    const keyPath = path.join(directory, "bridge-key.pem");
    writeFileSync(certPath, TEST_TLS_CERT, "utf8");
    writeFileSync(keyPath, TEST_TLS_KEY, "utf8");
    return { certPath, keyPath };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startBridge(t, options = {}) {
    const config = createBridgeConfig({
        env: {
            SIDENOTE2_DGX_BRIDGE_BEARER_TOKEN: "secret-token",
            SIDENOTE2_DGX_WORKSPACE_ROOT: ".test-dgx-workspace",
            SIDENOTE2_DGX_FREE_ALLOWANCE_ENABLED: "false",
            ...options.env,
        },
        rootDir: process.cwd(),
    });
    const bridge = createDgxRuntimeBridge({
        config,
        executeRun: options.executeRun,
        now: options.now,
        createId: options.createId,
        log: () => {},
    });

    await new Promise((resolve, reject) => {
        bridge.server.once("error", reject);
        bridge.server.listen(0, "127.0.0.1", () => {
            bridge.server.off("error", reject);
            resolve(undefined);
        });
    });
    t.after(async () => {
        await bridge.close();
    });

    const address = bridge.server.address();
    assert.ok(address && typeof address === "object");
    return {
        bridge,
        baseUrl: `${getBridgeTransportProtocol(config)}://127.0.0.1:${address.port}`,
        token: config.bridgeBearerToken,
    };
}

function requestJson({ method, url, token, body }) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const payload = body === undefined ? null : JSON.stringify(body);
        const requester = target.protocol === "https:"
            ? https
            : http;
        const request = requester.request({
            method,
            hostname: target.hostname,
            port: target.port,
            path: `${target.pathname}${target.search}`,
            ...(target.protocol === "https:" ? { rejectUnauthorized: false } : {}),
            headers: {
                Accept: "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(payload ? {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(payload),
                } : {}),
            },
        }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            response.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                resolve({
                    statusCode: response.statusCode ?? 0,
                    headers: response.headers,
                    json: text ? JSON.parse(text) : null,
                });
            });
        });
        request.on("error", reject);
        if (payload) {
            request.write(payload);
        }
        request.end();
    });
}

async function pollUntil(url, token, predicate, attempts = 30) {
    for (let index = 0; index < attempts; index += 1) {
        const response = await requestJson({
            method: "GET",
            url,
            token,
        });
        if (predicate(response)) {
            return response;
        }

        await sleep(20);
    }

    throw new Error(`Condition was not met for ${url}`);
}

test("createBridgeConfig resolves relative workspace roots", () => {
    const config = createBridgeConfig({
        env: {
            SIDENOTE2_DGX_BRIDGE_BEARER_TOKEN: "secret-token",
            SIDENOTE2_DGX_WORKSPACE_ROOT: ".dgx-workspace",
        },
        rootDir: "/tmp/sidenote2",
    });

    assert.equal(config.workspaceRoot, "/tmp/sidenote2/.dgx-workspace");
    assert.equal(config.bindHost, "127.0.0.1");
    assert.equal(config.port, 4215);
    assert.equal(config.codexBin, "codex");
});

test("getBaseProcessEnv fills in HOME when it is missing", () => {
    const env = getBaseProcessEnv({
        PATH: "/usr/bin:/bin",
        SHELL: "/usr/bin/zsh",
    });

    assert.equal(env.PATH, "/usr/bin:/bin");
    assert.equal(env.SHELL, "/usr/bin/zsh");
    assert.equal(env.HOME, os.homedir());
});

test("createBridgeConfig enables HTTPS when TLS files are configured", (t) => {
    const tls = createTlsFiles(t);
    const config = createBridgeConfig({
        env: {
            SIDENOTE2_DGX_BRIDGE_BEARER_TOKEN: "secret-token",
            SIDENOTE2_DGX_TLS_KEY_FILE: tls.keyPath,
            SIDENOTE2_DGX_TLS_CERT_FILE: tls.certPath,
        },
        rootDir: "/tmp/sidenote2",
    });

    assert.equal(config.tlsEnabled, true);
    assert.equal(config.tlsKeyPath, tls.keyPath);
    assert.equal(config.tlsCertPath, tls.certPath);
});

test("DGX bridge serves HTTPS when TLS files are configured", async (t) => {
    const tls = createTlsFiles(t);
    const { baseUrl } = await startBridge(t, {
        env: {
            SIDENOTE2_DGX_TLS_KEY_FILE: tls.keyPath,
            SIDENOTE2_DGX_TLS_CERT_FILE: tls.certPath,
        },
        executeRun: async () => ({ replyText: "Done" }),
    });

    assert.match(baseUrl, /^https:\/\//u);

    const healthResponse = await requestJson({
        method: "GET",
        url: `${baseUrl}/healthz`,
    });

    assert.equal(healthResponse.statusCode, 200);
    assert.equal(healthResponse.json.listenProtocol, "https");
});

test("DGX bridge accepts HEAD health checks without auth", async (t) => {
    const { baseUrl } = await startBridge(t, {
        executeRun: async () => ({ replyText: "Done" }),
    });

    const healthResponse = await requestJson({
        method: "HEAD",
        url: `${baseUrl}/healthz`,
    });

    assert.equal(healthResponse.statusCode, 200);
    assert.equal(healthResponse.json, null);
    assert.equal(healthResponse.headers["access-control-allow-origin"], "*");
    assert.match(String(healthResponse.headers["access-control-allow-methods"]), /HEAD/);
    assert.match(String(healthResponse.headers["content-type"]), /^application\/json/u);
});

test("DGX bridge starts, streams, completes, and honors cursors", async (t) => {
    const { baseUrl, token } = await startBridge(t, {
        executeRun: async ({ onProgressText, onOutputDelta }) => {
            onProgressText?.("Preparing context");
            onOutputDelta?.("Hello");
            await sleep(10);
            onOutputDelta?.(" world");
            return { replyText: "Hello world" };
        },
    });

    const startResponse = await requestJson({
        method: "POST",
        url: `${baseUrl}/v1/sidenote2/runs`,
        token,
        body: {
            agent: "codex",
            promptText: "Review this note.",
            metadata: {
                capability: "workspace-aware",
            },
        },
    });

    assert.equal(startResponse.statusCode, 200);
    assert.equal(typeof startResponse.json.runId, "string");

    const runUrl = `${baseUrl}/v1/sidenote2/runs/${encodeURIComponent(startResponse.json.runId)}`;
    const completedResponse = await pollUntil(runUrl, token, (response) => response.json?.status === "completed");

    assert.equal(completedResponse.json.replyText, "Hello world");
    assert.equal(completedResponse.json.runId, startResponse.json.runId);
    assert.ok(completedResponse.json.cursor);
    assert.ok(completedResponse.json.events.some((event) => event.type === "progress"));
    assert.ok(completedResponse.json.events.some((event) => event.type === "output_delta"));
    assert.ok(completedResponse.json.events.some((event) => event.type === "completed"));

    const afterCursorResponse = await requestJson({
        method: "GET",
        url: `${runUrl}?after=${encodeURIComponent(completedResponse.json.cursor)}`,
        token,
    });

    assert.equal(afterCursorResponse.statusCode, 200);
    assert.deepEqual(afterCursorResponse.json.events, []);
    assert.equal(afterCursorResponse.json.cursor, completedResponse.json.cursor);
});

test("DGX bridge long-polls until the next event when waitMs is provided", async (t) => {
    const { baseUrl, token } = await startBridge(t, {
        executeRun: async ({ onProgressText }) => {
            await sleep(120);
            onProgressText?.("Preparing context");
            await sleep(120);
            return { replyText: "Done" };
        },
    });

    const startResponse = await requestJson({
        method: "POST",
        url: `${baseUrl}/v1/sidenote2/runs`,
        token,
        body: {
            agent: "codex",
            promptText: "Wait for me.",
            metadata: {
                contextBytes: 128,
            },
        },
    });

    const runUrl = `${baseUrl}/v1/sidenote2/runs/${encodeURIComponent(startResponse.json.runId)}`;
    const startedAt = Date.now();
    const pollResponse = await requestJson({
        method: "GET",
        url: `${runUrl}?after=${encodeURIComponent(startResponse.json.cursor ?? "")}&waitMs=400`,
        token,
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(pollResponse.statusCode, 200);
    assert.ok(elapsedMs >= 90, `expected waitMs poll to block briefly, got ${elapsedMs}ms`);
    assert.ok(elapsedMs < 380, `expected waitMs poll to return before the full timeout once an event arrives, got ${elapsedMs}ms`);
    assert.equal(pollResponse.json.status, "running");
    assert.ok(pollResponse.json.events.some((event) => event.type === "progress"));
});

test("DGX bridge responds to CORS preflight and includes CORS headers", async (t) => {
    const { baseUrl } = await startBridge(t, {
        executeRun: async () => ({ replyText: "Done" }),
    });

    const optionsResponse = await requestJson({
        method: "OPTIONS",
        url: `${baseUrl}/v1/sidenote2/runs`,
    });

    assert.equal(optionsResponse.statusCode, 204);
    assert.equal(optionsResponse.headers["access-control-allow-origin"], "*");
    assert.match(String(optionsResponse.headers["access-control-allow-methods"]), /OPTIONS/);
    assert.match(String(optionsResponse.headers["access-control-allow-methods"]), /HEAD/);
    assert.match(String(optionsResponse.headers["access-control-allow-headers"]), /Authorization/i);

    const healthResponse = await requestJson({
        method: "GET",
        url: `${baseUrl}/healthz`,
    });

    assert.equal(healthResponse.statusCode, 200);
    assert.equal(healthResponse.headers["access-control-allow-origin"], "*");
});

test("DGX bridge cancels an in-flight run", async (t) => {
    const { baseUrl, token } = await startBridge(t, {
        executeRun: async ({ signal, onProgressText }) => {
            onProgressText?.("Preparing context");
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, 10_000);
                signal?.addEventListener("abort", () => {
                    clearTimeout(timer);
                    reject(new BridgeRunCancelledError());
                }, { once: true });
            });
            return { replyText: "Should not complete" };
        },
    });

    const startResponse = await requestJson({
        method: "POST",
        url: `${baseUrl}/v1/sidenote2/runs`,
        token,
        body: {
            agent: "codex",
            promptText: "Cancel me.",
            metadata: {},
        },
    });
    const runId = startResponse.json.runId;
    const runUrl = `${baseUrl}/v1/sidenote2/runs/${encodeURIComponent(runId)}`;

    const cancelResponse = await requestJson({
        method: "POST",
        url: `${runUrl}/cancel`,
        token,
        body: {},
    });

    assert.equal(cancelResponse.statusCode, 202);
    assert.equal(cancelResponse.json.status, "cancelled");

    const finalResponse = await pollUntil(runUrl, token, (response) => response.json?.status === "cancelled");
    assert.equal(finalResponse.json.error, "Cancelled.");
    assert.ok(finalResponse.json.events.some((event) => event.type === "cancelled"));
});

test("DGX bridge enforces auth and free-allowance limits", async (t) => {
    const { baseUrl, token } = await startBridge(t, {
        env: {
            SIDENOTE2_DGX_FREE_ALLOWANCE_ENABLED: "true",
            SIDENOTE2_DGX_FREE_ALLOWANCE_RUNS_PER_DAY: "1",
        },
        executeRun: async () => ({ replyText: "Done" }),
        createId: (() => {
            let index = 0;
            return () => `run-${++index}`;
        })(),
    });

    const unauthorizedResponse = await requestJson({
        method: "POST",
        url: `${baseUrl}/v1/sidenote2/runs`,
        token: "wrong-token",
        body: {
            agent: "codex",
            promptText: "Unauthorized",
            metadata: {},
        },
    });

    assert.equal(unauthorizedResponse.statusCode, 401);
    assert.equal(unauthorizedResponse.json.status, "failed");

    const firstRun = await requestJson({
        method: "POST",
        url: `${baseUrl}/v1/sidenote2/runs`,
        token,
        body: {
            agent: "codex",
            promptText: "First run",
            metadata: {},
        },
    });

    assert.equal(firstRun.statusCode, 200);
    assert.equal(firstRun.json.runId, "run-1");

    const secondRun = await requestJson({
        method: "POST",
        url: `${baseUrl}/v1/sidenote2/runs`,
        token,
        body: {
            agent: "codex",
            promptText: "Second run",
            metadata: {},
        },
    });

    assert.equal(secondRun.statusCode, 429);
    assert.equal(secondRun.json.status, "failed");
    assert.equal(secondRun.json.runId, "run-2");
    assert.match(secondRun.json.error, /allowance/i);
});
