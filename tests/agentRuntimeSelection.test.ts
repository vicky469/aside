import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getAgentRuntimeCapabilityLabel,
    getAgentRuntimeOwnershipMessage,
    getAgentRuntimeStatusLabel,
    getRemoteRuntimeAvailability,
    resolveAgentRuntimeSelection,
} from "../src/control/agentRuntimeSelection";

test("resolveAgentRuntimeSelection prefers local on desktop when Codex is available", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "auto",
        localDiagnostics: {
            status: "available",
            message: "Codex is available.",
        },
        remoteRuntimeBaseUrl: "https://remote.example.com",
        remoteRuntimeBearerToken: "secret",
    }), {
        kind: "resolved",
        runtime: "direct-cli",
        modePreference: "auto",
        ownershipMessage: "Using your local Codex setup",
    });
});

test("resolveAgentRuntimeSelection uses remote on mobile when a remote runtime is configured", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "auto",
        localDiagnostics: {
            status: "unsupported",
            message: "Built-in @codex requires desktop Obsidian.",
        },
        remoteRuntimeBaseUrl: "https://remote.example.com",
        remoteRuntimeBearerToken: "secret",
    }), {
        kind: "resolved",
        runtime: "openclaw-acp",
        modePreference: "auto",
        ownershipMessage: "Using your remote runtime",
    });
});

test("resolveAgentRuntimeSelection blocks on desktop when local Codex is unavailable", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "auto",
        localDiagnostics: {
            status: "missing",
            message: "Codex was not found on PATH.",
        },
        remoteRuntimeBaseUrl: "https://remote.example.com",
        remoteRuntimeBearerToken: "secret",
    }), {
        kind: "blocked",
        modePreference: "auto",
        notice: "Local desktop runtime is unavailable on this device.",
    });
});

test("resolveAgentRuntimeSelection blocks on mobile when the remote runtime is not configured", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "auto",
        localDiagnostics: {
            status: "unsupported",
            message: "Built-in @codex requires desktop Obsidian.",
        },
        remoteRuntimeBaseUrl: "",
        remoteRuntimeBearerToken: "",
    }), {
        kind: "blocked",
        modePreference: "auto",
        notice: "Remote bridge is not configured.",
    });
});

test("getRemoteRuntimeAvailability enforces https or localhost http", () => {
    assert.deepEqual(getRemoteRuntimeAvailability({
        remoteRuntimeBaseUrl: "http://192.168.1.9:3000",
        remoteRuntimeBearerToken: "secret",
    }), {
        status: "disallowed-url",
        message: "Remote bridge must use HTTPS, or HTTP only for localhost development.",
        originHost: null,
    });

    assert.deepEqual(getRemoteRuntimeAvailability({
        remoteRuntimeBaseUrl: "http://localhost:3000",
        remoteRuntimeBearerToken: "secret",
    }), {
        status: "available",
        message: "Using your remote runtime",
        originHost: "localhost:3000",
    });
});

test("agent runtime labels stay ownership-explicit", () => {
    assert.equal(getAgentRuntimeOwnershipMessage("direct-cli"), "Using your local Codex setup");
    assert.equal(getAgentRuntimeOwnershipMessage("openclaw-acp"), "Using your remote runtime");
    assert.equal(getAgentRuntimeStatusLabel("direct-cli"), "Runtime: Local desktop");
    assert.equal(getAgentRuntimeStatusLabel("openclaw-acp"), "Runtime: Your remote runtime");
    assert.equal(getAgentRuntimeCapabilityLabel("direct-cli"), "Capability: Workspace-aware");
    assert.equal(getAgentRuntimeCapabilityLabel("openclaw-acp"), "Capability: Reply only");
});
