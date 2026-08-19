import * as assert from "node:assert/strict";
import test from "node:test";
import {
    buildDefaultAgentOptions,
    formatDefaultAgentFallback,
    formatAgentRuntimeStatusLines,
} from "../src/ui/settings/agentRuntimeSettings";

test("default agent options keep registry order and disable unavailable choices", () => {
    assert.deepEqual(buildDefaultAgentOptions("gemini", new Map([
        ["codex", { status: "available", message: "Ready" }],
        ["claude", { status: "unavailable", message: "Missing" }],
        ["gemini", { status: "unavailable", message: "Missing" }],
    ])), [
        { target: "codex", label: "Codex", available: true, selected: false },
        { target: "claude", label: "Claude Code", available: false, selected: false },
        { target: "gemini", label: "Gemini", available: false, selected: true },
    ]);
});

test("agent runtime statuses are formatted as one setting description line below the label", () => {
    assert.deepEqual(
        formatAgentRuntimeStatusLines([
            { label: "Codex", statusBadge: "..." },
            { label: "Claude Code", statusBadge: "✅" },
            { label: "Gemini", statusBadge: "❌" },
        ]),
        [
            "Codex ...    Claude Code ✅    Gemini ❌",
        ],
    );
});

test("default agent fallback copy identifies the effective provider", () => {
    assert.equal(formatDefaultAgentFallback("codex", "claude"), "Using Claude Code while Codex is unavailable.");
    assert.equal(formatDefaultAgentFallback("codex", "codex"), "");
});
