import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getAgentActorByDirectiveMention,
    getAgentActorById,
    getPrimarySupportedAgentActor,
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

test("agent actor registry exposes codex as the current primary supported actor", () => {
    assert.equal(getPrimarySupportedAgentActor().id, "codex");
    assert.deepEqual(getSupportedAgentActors().map((actor) => actor.id), ["codex"]);
});

test("agent actor registry keeps unsupported actor notices with the actor definition", () => {
    assert.equal(getAgentActorById("claude").unsupportedNotice, "This build currently supports @codex only.");
    assert.equal(resolveUnsupportedAgentNotice(["claude"]), "This build currently supports @codex only.");
});

test("agent actor registry normalizes any-vs-supported targets separately", () => {
    assert.equal(normalizeAnyAgentTarget("CLAUDE"), "claude");
    assert.equal(normalizeSupportedAgentTarget("CLAUDE"), "codex");
});
