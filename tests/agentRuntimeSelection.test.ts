import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getAgentRuntimeCapabilityLabel,
    getAgentRuntimeOwnershipMessage,
    getAgentRuntimeStatusLabel,
    getRemoteRuntimeAvailability,
    resolveAgentRuntimeSelection,
} from "../src/control/agentRuntimeSelection";

test("resolveAgentRuntimeSelection prefers local in auto mode on desktop with a filesystem-backed vault", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "auto",
        isDesktopWithFilesystem: true,
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

test("resolveAgentRuntimeSelection uses remote on non-filesystem devices when a remote runtime is configured", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "auto",
        isDesktopWithFilesystem: false,
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
        ownershipMessage: "Using remote runtime",
    });
});

test("resolveAgentRuntimeSelection falls back to local in auto mode when remote is unavailable", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "auto",
        isDesktopWithFilesystem: true,
        localDiagnostics: {
            status: "available",
            message: "Codex is available.",
        },
        remoteRuntimeBaseUrl: "",
        remoteRuntimeBearerToken: "",
    }), {
        kind: "resolved",
        runtime: "direct-cli",
        modePreference: "auto",
        ownershipMessage: "Using your local Codex setup",
    });
});

test("resolveAgentRuntimeSelection blocks in auto mode on non-filesystem devices when remote is unavailable", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "auto",
        isDesktopWithFilesystem: false,
        localDiagnostics: {
            status: "missing",
            message: "Codex was not found on PATH.",
        },
        remoteRuntimeBaseUrl: "",
        remoteRuntimeBearerToken: "",
    }), {
        kind: "blocked",
        modePreference: "auto",
        notice: "Remote bridge is not configured.",
    });
});

test("resolveAgentRuntimeSelection honors explicit remote mode", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "remote",
        isDesktopWithFilesystem: true,
        localDiagnostics: {
            status: "available",
            message: "Codex is available.",
        },
        remoteRuntimeBaseUrl: "https://remote.example.com",
        remoteRuntimeBearerToken: "secret",
    }), {
        kind: "resolved",
        runtime: "openclaw-acp",
        modePreference: "remote",
        ownershipMessage: "Using remote runtime",
    });
});

test("resolveAgentRuntimeSelection blocks in explicit remote mode when remote is unavailable", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "remote",
        isDesktopWithFilesystem: true,
        localDiagnostics: {
            status: "available",
            message: "Codex is available.",
        },
        remoteRuntimeBaseUrl: "",
        remoteRuntimeBearerToken: "",
    }), {
        kind: "blocked",
        modePreference: "remote",
        notice: "Remote bridge is not configured.",
    });
});

test("resolveAgentRuntimeSelection honors explicit local mode", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "local",
        isDesktopWithFilesystem: false,
        localDiagnostics: {
            status: "available",
            message: "Codex is available.",
        },
        remoteRuntimeBaseUrl: "https://remote.example.com",
        remoteRuntimeBearerToken: "secret",
    }), {
        kind: "resolved",
        runtime: "direct-cli",
        modePreference: "local",
        ownershipMessage: "Using your local Codex setup",
    });
});

test("resolveAgentRuntimeSelection blocks in explicit local mode with the real local diagnostics", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "local",
        isDesktopWithFilesystem: false,
        localDiagnostics: {
            status: "unsupported",
            message: "Built-in @codex requires desktop Obsidian.",
        },
        remoteRuntimeBaseUrl: "https://remote.example.com",
        remoteRuntimeBearerToken: "secret",
    }), {
        kind: "blocked",
        modePreference: "local",
        notice: "Built-in @codex requires desktop Obsidian.",
    });
});

test("resolveAgentRuntimeSelection blocks in auto mode on desktop when local Codex is unavailable even if remote is configured", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "auto",
        isDesktopWithFilesystem: true,
        localDiagnostics: {
            status: "missing",
            message: "Codex was not found on PATH.",
        },
        remoteRuntimeBaseUrl: "https://remote.example.com",
        remoteRuntimeBearerToken: "secret",
    }), {
        kind: "blocked",
        modePreference: "auto",
        notice: "Codex was not found on PATH.",
    });
});

test("getRemoteRuntimeAvailability allows HTTP for localhost and private LAN addresses only", () => {
    assert.deepEqual(getRemoteRuntimeAvailability({
        remoteRuntimeBaseUrl: "http://192.168.1.9:3000",
        remoteRuntimeBearerToken: "secret",
    }), {
        status: "available",
        message: "Using remote runtime",
        originHost: "192.168.1.9:3000",
    });

    assert.deepEqual(getRemoteRuntimeAvailability({
        remoteRuntimeBaseUrl: "http://10.0.0.8:4215",
        remoteRuntimeBearerToken: "secret",
    }), {
        status: "available",
        message: "Using remote runtime",
        originHost: "10.0.0.8:4215",
    });

    assert.deepEqual(getRemoteRuntimeAvailability({
        remoteRuntimeBaseUrl: "http://8.8.8.8:3000",
        remoteRuntimeBearerToken: "secret",
    }), {
        status: "disallowed-url",
        message: "Remote bridge must use HTTPS, or HTTP only for localhost and private LAN development.",
        originHost: null,
    });

    assert.deepEqual(getRemoteRuntimeAvailability({
        remoteRuntimeBaseUrl: "http://localhost:3000",
        remoteRuntimeBearerToken: "secret",
    }), {
        status: "available",
        message: "Using remote runtime",
        originHost: "localhost:3000",
    });
});

test("agent runtime labels stay ownership-explicit", () => {
    assert.equal(getAgentRuntimeOwnershipMessage("direct-cli"), "Using your local Codex setup");
    assert.equal(getAgentRuntimeOwnershipMessage("openclaw-acp"), "Using remote runtime");
    assert.equal(getAgentRuntimeStatusLabel("direct-cli"), "Runtime: Local desktop");
    assert.equal(getAgentRuntimeStatusLabel("openclaw-acp"), "Runtime: Your remote runtime");
    assert.equal(getAgentRuntimeCapabilityLabel("direct-cli"), "Capability: Workspace-aware");
    assert.equal(getAgentRuntimeCapabilityLabel("openclaw-acp"), "Capability: Workspace-aware");
});
