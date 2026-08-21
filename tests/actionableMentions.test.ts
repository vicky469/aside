import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getActionableBuiltInMentions,
    isActionableMention,
    RESERVED_BUILT_IN_MENTION_NAMES,
} from "../src/core/text/actionableMentions";

test("actionable mentions follow active built-ins and live scripts", () => {
    const liveScripts = new Set(["/clean"]);
    const enabled = {
        agentsFeatureAvailable: true,
        isRunnableVaultScriptMention: (mention: string) => liveScripts.has(mention.toLowerCase()),
    };

    assert.equal(isActionableMention("@todo", enabled), true);
    assert.equal(isActionableMention("@codex", enabled), true);
    assert.equal(isActionableMention("/create-script", enabled), true);
    assert.equal(isActionableMention("/update-script", enabled), true);
    assert.equal(isActionableMention("/clean", enabled), true);
    assert.equal(isActionableMention("@hi", enabled), false);
    assert.equal(isActionableMention("/missing", enabled), false);
});

test("disabled Agents keeps only todo and live scripts actionable", () => {
    const disabled = {
        agentsFeatureAvailable: false,
        isRunnableVaultScriptMention: (mention: string) => mention.toLowerCase() === "/clean",
    };

    assert.equal(isActionableMention("@todo", disabled), true);
    assert.equal(isActionableMention("/clean", disabled), true);
    assert.equal(isActionableMention("@codex", disabled), false);
    assert.equal(isActionableMention("/update-script", disabled), false);
});

test("built-in candidates and reservations share one definition", () => {
    assert.deepEqual(
        getActionableBuiltInMentions(true).map((item) => item.mention),
        ["@todo", "@codex", "@claude", "@gemini", "/create-script", "/update-script"],
    );
    assert.ok(RESERVED_BUILT_IN_MENTION_NAMES.has("update-script"));
});
