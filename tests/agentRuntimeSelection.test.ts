import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getAgentRuntimeCapabilityLabel,
    getAgentRuntimeOwnershipMessage,
    getAgentRuntimeStatusLabel,
    resolveAgentRuntimeSelection,
} from "../src/agents/agentRuntimeSelection";
import { normalizeAgentRuntimeModePreference } from "../src/core/agents/agentRuntimePreferences";

test("normalizeAgentRuntimeModePreference treats legacy remote preference as auto", () => {
    assert.equal(normalizeAgentRuntimeModePreference("remote"), "auto");
});

test("resolveAgentRuntimeSelection resolves local in auto mode when local Codex is available", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "auto",
        localDiagnostics: {
            status: "available",
            message: "Codex is available.",
        },
    }), {
        kind: "resolved",
        runtime: "direct-cli",
        modePreference: "auto",
        ownershipMessage: "Using your local Codex setup",
    });
});

test("resolveAgentRuntimeSelection blocks in auto mode on non-filesystem devices", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "auto",
        localDiagnostics: {
            status: "unsupported",
            message: "Built-in @codex requires desktop Obsidian.",
        },
    }), {
        kind: "blocked",
        modePreference: "auto",
        notice: "Built-in @codex requires desktop Obsidian.",
    });
});

test("resolveAgentRuntimeSelection honors explicit local mode", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        modePreference: "local",
        localDiagnostics: {
            status: "available",
            message: "Codex is available.",
        },
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
        localDiagnostics: {
            status: "unsupported",
            message: "Built-in @codex requires desktop Obsidian.",
        },
    }), {
        kind: "blocked",
        modePreference: "local",
        notice: "Built-in @codex requires desktop Obsidian.",
    });
});

test("agent runtime labels stay local and ownership-explicit", () => {
    assert.equal(getAgentRuntimeOwnershipMessage("direct-cli"), "Using your local Codex setup");
    assert.equal(getAgentRuntimeStatusLabel("direct-cli"), "Runtime: Local");
    assert.equal(getAgentRuntimeCapabilityLabel("direct-cli"), "Capability: Workspace-aware");
});
