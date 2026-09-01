import * as assert from "node:assert/strict";
import test from "node:test";
import type { AgentRuntimeDiagnostics } from "../src/agents/agentRuntimeAdapter";
import type { AsideAgentTarget } from "../src/core/config/agentTargets";
import { resolveDefaultAgentSetupGuideState } from "../src/ui/settings/defaultAgentSetupGuide";

function diagnostics(
    entries: Partial<Record<AsideAgentTarget, AgentRuntimeDiagnostics>>,
): Map<AsideAgentTarget, AgentRuntimeDiagnostics> {
    return new Map(Object.entries(entries) as Array<[AsideAgentTarget, AgentRuntimeDiagnostics]>);
}

test("setup guide stays hidden while availability is still checking", () => {
    const state = resolveDefaultAgentSetupGuideState(diagnostics({
        codex: { status: "checking", message: "Checking" },
        claude: { status: "missing", message: "Missing" },
        gemini: { status: "missing", message: "Missing" },
        deepseek: { status: "missing", message: "Missing" },
    }));

    assert.equal(state.kind, "checking");
    assert.equal(state.markdown, "");
});

test("setup guide stays hidden when at least one agent is available", () => {
    const state = resolveDefaultAgentSetupGuideState(diagnostics({
        codex: { status: "available", message: "Ready" },
        claude: { status: "missing", message: "Missing" },
        gemini: { status: "missing", message: "Missing" },
        deepseek: { status: "missing", message: "Missing" },
    }));

    assert.equal(state.kind, "hidden");
});

test("setup guide asks for desktop Obsidian when every agent is unsupported", () => {
    const state = resolveDefaultAgentSetupGuideState(diagnostics({
        codex: { status: "unsupported", message: "Desktop only" },
        claude: { status: "unsupported", message: "Desktop only" },
        gemini: { status: "unsupported", message: "Desktop only" },
        deepseek: { status: "unsupported", message: "Desktop only" },
    }));

    assert.equal(state.kind, "desktop-required");
    assert.match(state.markdown, /desktop Obsidian/i);
});

test("setup guide points users to CLI login when no agent is available", () => {
    const state = resolveDefaultAgentSetupGuideState(diagnostics({
        codex: { status: "missing", message: "Codex was not found on PATH." },
        claude: { status: "unavailable", message: "Claude CLI is not authenticated or could not start." },
        gemini: { status: "missing", message: "Gemini CLI was not found on PATH." },
        deepseek: { status: "missing", message: "OpenCode CLI was not found on PATH." },
    }));

    assert.equal(state.kind, "setup-needed");
    assert.match(state.markdown, /codex login/i);
    assert.match(state.markdown, /claude login/i);
    assert.match(state.markdown, /\/create-script/i);
    assert.match(state.markdown, /Recheck/i);
    assert.match(state.markdown, /opencode\.ai\/docs\/cli/i);
});
