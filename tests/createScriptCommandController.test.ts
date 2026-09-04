import * as assert from "node:assert/strict";
import test from "node:test";
import {
    CreateScriptCommandController,
} from "../src/agents/createScriptCommandController";
import type { SavedUserEntryEvent } from "../src/core/comments/savedUserEntry";
import type { VaultScriptFolderProvisionResult } from "../src/vaultScripts/vaultScriptFolderProvisioner";
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
    folderResult?: VaultScriptFolderProvisionResult;
} = {}) {
    const registry = new VaultScriptRegistry();
    registry.seed(options.scripts ?? []);
    const replies: string[] = [];
    const dispatchedRequests: string[] = [];
    const operations: string[] = [];
    const controller = new CreateScriptCommandController({
        getRegistry: () => registry,
        appendReply: async (_event, body) => {
            operations.push("reply");
            replies.push(body);
        },
        ensureScriptFolder: async () => {
            operations.push("ensure-folder");
            return options.folderResult ?? { ok: true };
        },
        dispatchRequest: async (_event, requestText) => {
            operations.push("dispatch");
            dispatchedRequests.push(requestText);
        },
    });

    return {
        controller,
        replies,
        dispatchedRequests,
        operations,
    };
}

test("create-script command delegates valid request text before vault scripts", async () => {
    const harness = createHarness({ scripts: ["🛠️ scripts/clean.mjs"] });

    assert.equal(await harness.controller.handleSavedUserEntry(event(
        "/create-script build a formatter",
    )), true);
    assert.deepEqual(harness.dispatchedRequests, ["build a formatter"]);
    assert.deepEqual(harness.replies, []);
    assert.deepEqual(harness.operations, ["ensure-folder", "dispatch"]);
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

test("invalid create-script requests never provision the script folder", async () => {
    const cases = [
        "/create-script",
        "/create-script one /create-script two",
        "/create-script /clean do it",
        "/create-script @claude do it",
    ];

    for (const [index, body] of cases.entries()) {
        const harness = createHarness({ scripts: ["🛠️ scripts/clean.mjs"] });

        assert.equal(await harness.controller.handleSavedUserEntry(event(body, `entry-${index}`)), true);
        assert.equal(harness.operations.includes("ensure-folder"), false, body);
        assert.deepEqual(harness.dispatchedRequests, [], body);
    }
});

test("failed folder provisioning appends its persistent reply once and does not dispatch", async () => {
    const message = "Couldn’t create 🛠️ scripts/. Check that the vault is writable and try again.";
    const harness = createHarness({ folderResult: { ok: false, message } });
    const savedEvent = event("/create-script build a formatter");

    assert.equal(await harness.controller.handleSavedUserEntry(savedEvent), true);
    assert.equal(await harness.controller.handleSavedUserEntry(savedEvent), true);
    assert.deepEqual(harness.replies, [message]);
    assert.deepEqual(harness.dispatchedRequests, []);
    assert.deepEqual(harness.operations, ["ensure-folder", "reply"]);
});

test("duplicate saved create-script entry provisions and dispatches at most once", async () => {
    const harness = createHarness();
    const savedEvent = event("/create-script build a formatter");

    assert.equal(await harness.controller.handleSavedUserEntry(savedEvent), true);
    assert.equal(await harness.controller.handleSavedUserEntry(savedEvent), true);
    assert.deepEqual(harness.operations, ["ensure-folder", "dispatch"]);
    assert.deepEqual(harness.dispatchedRequests, ["build a formatter"]);
});
