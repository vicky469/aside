import * as assert from "node:assert/strict";
import test from "node:test";
import { UpdateScriptCommandController } from "../src/agents/updateScriptCommandController";
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
    const dispatchedRequests: Array<{ requestText: string; scriptPath: string }> = [];
    const controller = new UpdateScriptCommandController({
        getRegistry: () => registry,
        appendReply: async (_event, body) => {
            replies.push(body);
        },
        dispatchRequest: async (_event, requestText, targetScript) => {
            dispatchedRequests.push({
                requestText,
                scriptPath: targetScript.path,
            });
        },
    });

    return {
        controller,
        replies,
        dispatchedRequests,
    };
}

test("update-script dispatches one resolved target and opaque request text", async () => {
    const harness = createHarness({ scripts: ["🛠️ scripts/embed-image-urls.mjs"] });

    assert.equal(await harness.controller.handleSavedUserEntry(event(
        "/update-script /embed-image-urls make the default size reasonable. currently too big.",
    )), true);
    assert.deepEqual(harness.dispatchedRequests, [{
        requestText: "make the default size reasonable. currently too big.",
        scriptPath: "🛠️ scripts/embed-image-urls.mjs",
    }]);
    assert.deepEqual(harness.replies, []);

    await harness.controller.handleSavedUserEntry(event(
        "/update-script /embed-image-urls explain /update-script and @codex",
        "entry-2",
    ));
    assert.equal(
        harness.dispatchedRequests[1]?.requestText,
        "explain /update-script and @codex",
    );
});

test("update-script rejects unavailable and ambiguous targets before dispatch", async () => {
    const missing = createHarness();
    await missing.controller.handleSavedUserEntry(event("/update-script /missing change it"));
    assert.deepEqual(missing.dispatchedRequests, []);
    assert.match(missing.replies[0] ?? "", /not available to update/iu);

    const ambiguous = createHarness({
        scripts: ["🛠️ scripts/Clean.mjs", "🛠️ scripts/clean.js"],
    });
    await ambiguous.controller.handleSavedUserEntry(event("/update-script /clean change it"));
    assert.deepEqual(ambiguous.dispatchedRequests, []);
    assert.match(ambiguous.replies[0] ?? "", /not available to update/iu);
});

test("update-script returns usage once for empty, malformed, and misplaced input", async () => {
    const harness = createHarness({ scripts: ["🛠️ scripts/clean.mjs"] });
    const emptyEvent = event("/update-script /clean");

    assert.equal(await harness.controller.handleSavedUserEntry(emptyEvent), true);
    assert.equal(await harness.controller.handleSavedUserEntry(emptyEvent), true);
    await harness.controller.handleSavedUserEntry(event(
        "/update-script clean change it",
        "entry-2",
    ));
    await harness.controller.handleSavedUserEntry(event(
        "please /update-script /clean change it",
        "entry-3",
    ));

    assert.equal(harness.replies.length, 3);
    assert.ok(harness.replies.every((reply) => reply.startsWith("Use /update-script")));
    assert.deepEqual(harness.dispatchedRequests, []);

    harness.controller.dispose();
    assert.equal(await harness.controller.handleSavedUserEntry(emptyEvent), true);
    assert.equal(harness.replies.length, 4);
});

test("update-script controller ignores entries without the built-in directive", async () => {
    const harness = createHarness();

    assert.equal(await harness.controller.handleSavedUserEntry(event("ordinary note")), false);
    assert.deepEqual(harness.dispatchedRequests, []);
    assert.deepEqual(harness.replies, []);
});
