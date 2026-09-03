import * as assert from "node:assert/strict";
import test from "node:test";
import type { AgentRuntimeDiagnostics } from "../src/agents/agentRuntimeAdapter";
import {
    resolveDefaultAgentSelection,
} from "../src/core/agents/defaultAgentSelection";
import type { AsideAgentTarget } from "../src/core/config/agentTargets";

function diagnostics(available: AsideAgentTarget[]): Map<AsideAgentTarget, AgentRuntimeDiagnostics> {
    return new Map((["codex", "claude", "cursor", "gemini", "deepseek"] as AsideAgentTarget[]).map((target) => [
        target,
        {
            status: available.includes(target) ? "available" : "unavailable",
            message: available.includes(target) ? "Ready" : "Missing",
        },
    ]));
}

test("default agent selection uses the available preference", () => {
    assert.deepEqual(resolveDefaultAgentSelection("gemini", diagnostics(["codex", "gemini"])), {
        kind: "preferred",
        preferredAgent: "gemini",
        selectedAgent: "gemini",
    });
});

test("default agent selection can prefer DeepSeek through OpenCode", () => {
    const deepseek = "deepseek" as AsideAgentTarget;
    assert.deepEqual(resolveDefaultAgentSelection(deepseek, diagnostics([deepseek])), {
        kind: "preferred",
        preferredAgent: "deepseek",
        selectedAgent: "deepseek",
    });
});

test("default agent selection reports none when the preference is unavailable", () => {
    assert.deepEqual(resolveDefaultAgentSelection("gemini", diagnostics(["codex", "claude"])), {
        kind: "none",
        preferredAgent: "gemini",
    });
});

test("default agent selection reports none when no runtime is available", () => {
    assert.deepEqual(resolveDefaultAgentSelection("codex", diagnostics([])), {
        kind: "none",
        preferredAgent: "codex",
    });
});
