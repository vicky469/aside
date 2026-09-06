import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getActionableBuiltInMentions,
    isActionableBuiltInMention,
    isActionableMention,
    RESERVED_BUILT_IN_MENTION_NAMES,
    type ActionableBuiltInMention,
} from "../src/core/text/actionableMentions";

test("actionable mentions follow active built-ins and live scripts", () => {
    const liveScripts = new Set(["/clean"]);
    const context = {
        scriptsEnabled: true,
        isRunnableVaultScriptMention: (mention: string) => liveScripts.has(mention.toLowerCase()),
    };

    assert.equal(isActionableMention("@todo", context), true);
    assert.equal(isActionableMention("@codex", context), true);
    assert.equal(isActionableMention("@claude", context), true);
    assert.equal(isActionableMention("@cursor", context), true);
    assert.equal(isActionableMention("@gemini", context), true);
    assert.equal(isActionableMention("@deepseek", context), true);
    assert.equal(isActionableMention("/create-script", context), true);
    assert.equal(isActionableMention("/update-script", context), true);
    assert.equal(isActionableMention("/pdf-to-markdown", context), true);
    assert.equal(isActionableMention("/clean", context), true);
    assert.equal(isActionableMention("@hi", context), false);
    assert.equal(isActionableMention("/missing", context), false);
});

test("disabled scripts keep todo and supported agents actionable but reject slash commands", () => {
    const liveScripts = new Set(["/clean"]);
    const context = {
        scriptsEnabled: false,
        isRunnableVaultScriptMention: (mention: string) => liveScripts.has(mention.toLowerCase()),
    };

    assert.equal(isActionableMention("@todo", context), true);
    assert.equal(isActionableMention("@codex", context), true);
    assert.equal(isActionableMention("@claude", context), true);
    assert.equal(isActionableMention("@cursor", context), true);
    assert.equal(isActionableMention("@gemini", context), true);
    assert.equal(isActionableMention("@deepseek", context), true);
    assert.equal(isActionableMention("/create-script", context), false);
    assert.equal(isActionableMention("/update-script", context), false);
    assert.equal(isActionableMention("/pdf-to-markdown", context), false);
    assert.equal(isActionableMention("/clean", context), false);
});

test("built-in candidates and reservations share one definition", () => {
    const enabledBuiltIns = getActionableBuiltInMentions(true);
    const disabledMentionNames = new Set(
        getActionableBuiltInMentions(false).map((item) => item.mention),
    );

    assert.deepEqual(
        enabledBuiltIns.map((item) => item.mention),
        ["@todo", "@codex", "@claude", "@cursor", "@gemini", "@deepseek", "/create-script", "/update-script", "/pdf-to-markdown"],
    );
    assert.deepEqual(
        getActionableBuiltInMentions(false).map((item) => item.mention),
        ["@todo", "@codex", "@claude", "@cursor", "@gemini", "@deepseek"],
    );
    assert.ok(RESERVED_BUILT_IN_MENTION_NAMES.has("cursor"));
    assert.ok(RESERVED_BUILT_IN_MENTION_NAMES.has("deepseek"));
    assert.ok(RESERVED_BUILT_IN_MENTION_NAMES.has("create-script"));
    assert.ok(RESERVED_BUILT_IN_MENTION_NAMES.has("update-script"));
    assert.ok(RESERVED_BUILT_IN_MENTION_NAMES.has("pdf-to-markdown"));
    for (const item of enabledBuiltIns) {
        assert.equal(
            disabledMentionNames.has(item.mention),
            item.capability === "always",
        );
        assert.ok(RESERVED_BUILT_IN_MENTION_NAMES.has(item.mention.slice(1).toLowerCase()));
    }
});

test("built-in availability follows capability metadata instead of mention punctuation", () => {
    const alwaysAvailableSlashMention: ActionableBuiltInMention = {
        mention: "/help",
        label: "Help",
        capability: "always",
    };
    const scriptBackedAtMention: ActionableBuiltInMention = {
        mention: "@script-agent",
        label: "Script agent",
        capability: "scripts",
    };

    assert.equal(isActionableBuiltInMention(alwaysAvailableSlashMention, false), true);
    assert.equal(isActionableBuiltInMention(scriptBackedAtMention, false), false);
    assert.equal(isActionableBuiltInMention(scriptBackedAtMention, true), true);
});
