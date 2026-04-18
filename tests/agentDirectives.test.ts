import * as assert from "node:assert/strict";
import test from "node:test";
import { parseAgentDirectives } from "../src/core/text/agentDirectives";

test("parseAgentDirectives resolves a single explicit target", () => {
    assert.deepEqual(parseAgentDirectives("Please ask @codex to handle this."), {
        target: "codex",
        hasConflict: false,
        matchedTargets: ["codex"],
        unsupportedTargets: [],
    });
});

test("parseAgentDirectives ignores repeated mentions of the same supported target", () => {
    assert.deepEqual(parseAgentDirectives("@codex please review this for @codex"), {
        target: "codex",
        hasConflict: false,
        matchedTargets: ["codex"],
        unsupportedTargets: [],
    });
});

test("parseAgentDirectives treats unsupported agent mentions as unsupported", () => {
    assert.deepEqual(parseAgentDirectives("ping foo@example.com then ask @claude"), {
        target: null,
        hasConflict: false,
        matchedTargets: [],
        unsupportedTargets: ["claude"],
    });
});

test("parseAgentDirectives blocks mixed supported and unsupported agent mentions", () => {
    assert.deepEqual(parseAgentDirectives("ask @codex and @claude"), {
        target: null,
        hasConflict: false,
        matchedTargets: ["codex"],
        unsupportedTargets: ["claude"],
    });
});
