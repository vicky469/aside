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
        target: "codex",
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

test("resolveAgentRuntimeSelection carries actionable blocked diagnostics", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        target: "codex",
        modePreference: "auto",
        localDiagnostics: {
            status: "unavailable",
            message: "Codex could not be launched from this Obsidian environment.",
            detail: "Missing optional dependency @openai/codex-darwin-arm64.",
        },
    }), {
        kind: "blocked",
        runtime: "direct-cli",
        modePreference: "auto",
        notice: "Codex could not be launched from this Obsidian environment.",
        diagnostic: "Missing optional dependency @openai/codex-darwin-arm64.",
    });
});

test("resolveAgentRuntimeSelection honors explicit local mode", () => {
    assert.deepEqual(resolveAgentRuntimeSelection({
        target: "codex",
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
        target: "codex",
        modePreference: "local",
        localDiagnostics: {
            status: "unsupported",
            message: "Built-in @codex requires desktop Obsidian.",
        },
    }), {
        kind: "blocked",
        runtime: "direct-cli",
        modePreference: "local",
        notice: "Built-in @codex requires desktop Obsidian.",
        diagnostic: "Built-in @codex requires desktop Obsidian.",
    });
});

test("agent runtime labels stay local and ownership-explicit", () => {
    assert.equal(getAgentRuntimeOwnershipMessage("direct-cli", "codex"), "Using your local Codex setup");
    assert.equal(getAgentRuntimeOwnershipMessage("direct-cli", "claude"), "Using your local Claude Code setup");
    assert.equal(getAgentRuntimeStatusLabel("direct-cli"), "Runtime: Local");
    assert.equal(getAgentRuntimeCapabilityLabel("direct-cli"), "Capability: Workspace-aware");
});
