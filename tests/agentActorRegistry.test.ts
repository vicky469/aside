import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getAgentActorByDirectiveMention,
    getAgentActorById,
    getSupportedAgentActors,
    normalizeAnyAgentTarget,
    normalizeSupportedAgentTarget,
    resolveUnsupportedAgentNotice,
} from "../src/core/agents/agentActorRegistry";

test("agent actor registry resolves actors by directive mention", () => {
    assert.equal(getAgentActorByDirectiveMention("@codex")?.id, "codex");
    assert.equal(getAgentActorByDirectiveMention("@claude")?.id, "claude");
    assert.equal(getAgentActorByDirectiveMention("@unknown"), null);
});

test("agent actor registry exposes codex and claude as peer supported actors", () => {
    assert.deepEqual(getSupportedAgentActors().map((actor) => actor.id), ["codex", "claude"]);
});

test("agent actor registry keeps unsupported notices generic when all known actors are supported", () => {
    assert.equal(getAgentActorById("claude").unsupportedNotice, null);
    assert.equal(resolveUnsupportedAgentNotice(["claude"]), "This build currently supports @codex and @claude only.");
});

test("agent actor registry normalizes any-vs-supported targets separately", () => {
    assert.equal(normalizeAnyAgentTarget("CLAUDE"), "claude");
    assert.equal(normalizeSupportedAgentTarget("CLAUDE"), "claude");
});
