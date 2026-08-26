import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getAgentActorByDirectiveMention,
    getAgentActorById,
    getSupportedAgentActors,
    formatSupportedAgentDirectives,
    normalizeAnyAgentTarget,
    normalizeSupportedAgentTarget,
    resolveUnsupportedAgentNotice,
} from "../src/core/agents/agentActorRegistry";

test("agent actor registry resolves actors by directive mention", () => {
    assert.equal(getAgentActorByDirectiveMention("@codex")?.id, "codex");
    assert.equal(getAgentActorByDirectiveMention("@claude")?.id, "claude");
    assert.equal(getAgentActorByDirectiveMention("@GeMiNi")?.id, "gemini");
    assert.equal(getAgentActorByDirectiveMention("@DeEpSeEk")?.id, "deepseek");
    assert.equal(getAgentActorByDirectiveMention("@unknown"), null);
});

test("agent actor registry exposes every local CLI as a peer supported actor", () => {
    assert.deepEqual(getSupportedAgentActors().map((actor) => actor.id), ["codex", "claude", "gemini", "deepseek"]);
    assert.equal(formatSupportedAgentDirectives("or"), "@codex, @claude, @gemini, or @deepseek");
});

test("agent actor registry keeps unsupported notices generic when all known actors are supported", () => {
    assert.equal(getAgentActorById("claude").unsupportedNotice, null);
    assert.equal(resolveUnsupportedAgentNotice(["gemini"]), "This build currently supports @codex, @claude, @gemini, and @deepseek only.");
});

test("agent actor registry normalizes any-vs-supported targets separately", () => {
    assert.equal(normalizeAnyAgentTarget("CLAUDE"), "claude");
    assert.equal(normalizeSupportedAgentTarget("CLAUDE"), "claude");
    assert.equal(normalizeAnyAgentTarget("GEMINI"), "gemini");
    assert.equal(normalizeSupportedAgentTarget("GEMINI"), "gemini");
    assert.equal(normalizeAnyAgentTarget("DEEPSEEK"), "deepseek");
    assert.equal(normalizeSupportedAgentTarget("DEEPSEEK"), "deepseek");
});
