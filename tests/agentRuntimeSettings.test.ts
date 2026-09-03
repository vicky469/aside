import * as assert from "node:assert/strict";
import test from "node:test";
import type { AgentRuntimeDiagnostics } from "../src/agents/agentRuntimeAdapter";
import type { AsideAgentTarget } from "../src/core/config/agentTargets";
import {
    buildDefaultAgentOptions,
    resolveDefaultAgentRadioSelection,
} from "../src/ui/settings/agentRuntimeSettings";

test("default agent radio options preserve order and expose status", () => {
    const diagnostics = new Map<AsideAgentTarget, AgentRuntimeDiagnostics>([
        ["gemini", { status: "missing", message: "Missing" }],
        ["codex", { status: "available", message: "Ready" }],
        ["claude", { status: "checking", message: "Checking" }],
        ["deepseek" as AsideAgentTarget, { status: "missing", message: "Missing" }],
    ]);

    assert.deepEqual(buildDefaultAgentOptions("gemini", diagnostics), [
        {
            target: "codex",
            label: "Codex",
            status: "available",
            statusLabel: "Available",
            available: true,
            disabled: false,
            selected: false,
        },
        {
            target: "claude",
            label: "Claude Code",
            status: "checking",
            statusLabel: "Checking…",
            available: false,
            disabled: true,
            selected: false,
        },
        {
            target: "cursor",
            label: "Cursor",
            status: "checking",
            statusLabel: "Checking…",
            available: false,
            disabled: true,
            selected: false,
        },
        {
            target: "gemini",
            label: "Gemini",
            status: "unavailable",
            statusLabel: "Unavailable",
            available: false,
            disabled: true,
            selected: true,
        },
        {
            target: "deepseek",
            label: "DeepSeek",
            status: "unavailable",
            statusLabel: "Unavailable",
            available: false,
            disabled: true,
            selected: false,
        },
    ]);
});

test("default agent radio selection accepts only available choices", () => {
    const options = buildDefaultAgentOptions("gemini", new Map<AsideAgentTarget, AgentRuntimeDiagnostics>([
        ["codex", { status: "available", message: "Ready" }],
        ["claude", { status: "checking", message: "Checking" }],
        ["gemini", { status: "missing", message: "Missing" }],
    ]));

    assert.equal(resolveDefaultAgentRadioSelection(options, "codex"), "codex");
    assert.equal(resolveDefaultAgentRadioSelection(options, "claude"), null);
    assert.equal(resolveDefaultAgentRadioSelection(options, "gemini"), null);
});
