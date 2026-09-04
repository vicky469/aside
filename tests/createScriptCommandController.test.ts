import * as assert from "node:assert/strict";
import test from "node:test";
import {
    CreateScriptCommandController,
} from "../src/agents/createScriptCommandController";
import type { SavedUserEntryEvent } from "../src/core/comments/savedUserEntry";
import { VaultScriptRegistry } from "../src/vaultScripts/vaultScriptRegistry";

function event(body: string, entryId = "entry-1"): SavedUserEntryEvent {
    return {
        threadId: "thread-1",
        entryId,
        filePath: "Folder/Note.md",
        body,
    };
}

function createHarness(options: {
    scripts?: string[];
} = {}) {
    const registry = new VaultScriptRegistry();
    registry.seed(options.scripts ?? []);
    const replies: string[] = [];
    const dispatchedRequests: string[] = [];
    const controller = new CreateScriptCommandController({
        getRegistry: () => registry,
        appendReply: async (_event, body) => {
            replies.push(body);
        },
        dispatchRequest: async (_event, requestText) => {
            dispatchedRequests.push(requestText);
        },
    });

    return {
        controller,
        replies,
        dispatchedRequests,
    };
}

test("create-script command delegates valid request text before vault scripts", async () => {
    const harness = createHarness({ scripts: ["🛠️ scripts/clean.mjs"] });

    assert.equal(await harness.controller.handleSavedUserEntry(event(
        "/create-script build a formatter",
    )), true);
    assert.deepEqual(harness.dispatchedRequests, ["build a formatter"]);
    assert.deepEqual(harness.replies, []);
});

test("create-script rejects mixed registered scripts and explicit agents", async () => {
    const harness = createHarness({ scripts: ["🛠️ scripts/clean.mjs"] });

    await harness.controller.handleSavedUserEntry(event("/create-script /clean do it"));
    await harness.controller.handleSavedUserEntry(event("/create-script @claude do it", "entry-2"));

    assert.deepEqual(harness.dispatchedRequests, []);
    assert.match(harness.replies[0] ?? "", /or a vault script, not both/i);
    assert.match(harness.replies[1] ?? "", /Settings → Scripts/i);
});

test("create-script returns usage once for one saved entry and resets on disposal", async () => {
    const harness = createHarness();
    const savedEvent = event("/create-script");

    assert.equal(await harness.controller.handleSavedUserEntry(savedEvent), true);
    assert.equal(await harness.controller.handleSavedUserEntry(savedEvent), true);
    assert.equal(harness.replies.length, 1);

    harness.controller.dispose();
    assert.equal(await harness.controller.handleSavedUserEntry(savedEvent), true);
    assert.equal(harness.replies.length, 2);
});

test("create-script controller ignores entries without the built-in directive", async () => {
    const harness = createHarness();

    assert.equal(await harness.controller.handleSavedUserEntry(event("ordinary note")), false);
    assert.deepEqual(harness.dispatchedRequests, []);
    assert.deepEqual(harness.replies, []);
});
