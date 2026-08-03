import * as assert from "node:assert/strict";
import test from "node:test";
import { VaultScriptRegistry } from "../src/vaultScripts/vaultScriptRegistry";

test("seed retains only canonical direct runnable script paths", () => {
    const registry = new VaultScriptRegistry();

    registry.seed([
        "README.md",
        "🛠️ scripts/nested/ignored.js",
        "🛠️ scripts\\format.js",
    ]);

    assert.deepEqual(
        Reflect.get(registry, "paths"),
        new Set(["🛠️ scripts/format.js"]),
    );
});

test("mutations use canonical paths across equivalent separators", () => {
    const registry = new VaultScriptRegistry();

    registry.seed(["🛠️ scripts\\format.js"]);
    registry.upsert("🛠️ scripts/format.js");
    assert.deepEqual(
        Reflect.get(registry, "paths"),
        new Set(["🛠️ scripts/format.js"]),
    );

    registry.rename("🛠️ scripts\\format.js", "🛠️ scripts\\rewrite.cjs");
    assert.deepEqual(
        registry.getRunnableScripts().map((script) => script.path),
        ["🛠️ scripts/rewrite.cjs"],
    );

    registry.remove("🛠️ scripts\\rewrite.cjs");
    assert.deepEqual(registry.getRunnableScripts(), []);
});

test("seed, upsert, rename, and remove keep runnable scripts current", () => {
    const registry = new VaultScriptRegistry();

    registry.seed([
        "README.md",
        "src/internal.js",
        "🛠️ scripts/nested/ignored.js",
        "🛠️ scripts/clean.mjs",
    ]);
    assert.deepEqual(registry.getRunnableScripts(), [
        {
            path: "🛠️ scripts/clean.mjs",
            fileName: "clean.mjs",
            mentionName: "clean",
            normalizedMentionName: "clean",
        },
    ]);

    registry.upsert("🛠️ scripts/format.js");
    assert.deepEqual(
        registry.getRunnableScripts().map((script) => script.mentionName),
        ["clean", "format"],
    );

    registry.rename("🛠️ scripts/format.js", "🛠️ scripts/rewrite.cjs");
    assert.deepEqual(
        registry.getRunnableScripts().map((script) => script.mentionName),
        ["clean", "rewrite"],
    );

    registry.remove("🛠️ scripts/rewrite.cjs");
    assert.deepEqual(
        registry.getRunnableScripts().map((script) => script.mentionName),
        ["clean"],
    );
});

test("case-insensitive collisions are ambiguous until one path is removed", () => {
    const registry = new VaultScriptRegistry();
    registry.seed([
        "🛠️ scripts/Clean.mjs",
        "🛠️ scripts/clean.js",
    ]);

    assert.deepEqual(registry.getRunnableScripts(), []);
    assert.deepEqual(registry.getAmbiguousMentionNames(), ["clean"]);
    assert.equal(registry.isAmbiguous(" @ClEaN "), true);
    assert.equal(registry.resolve("@clean"), null);

    registry.remove("🛠️ scripts/clean.js");

    assert.equal(registry.isAmbiguous("clean"), false);
    assert.deepEqual(registry.resolve(" @CLEAN "), {
        path: "🛠️ scripts/Clean.mjs",
        fileName: "Clean.mjs",
        mentionName: "Clean",
        normalizedMentionName: "clean",
    });
});

test("returned arrays and registrations are defensive copies", () => {
    const registry = new VaultScriptRegistry();
    registry.seed(["🛠️ scripts/clean.mjs"]);

    const runnable = registry.getRunnableScripts();
    runnable[0].path = "changed.js";
    runnable.push({
        path: "injected.js",
        fileName: "injected.js",
        mentionName: "injected",
        normalizedMentionName: "injected",
    });
    const resolved = registry.resolve("@clean");
    if (!resolved) {
        assert.fail("expected @clean to resolve");
    }
    resolved.path = "also-changed.js";

    const ambiguous = registry.getAmbiguousMentionNames();
    ambiguous.push("injected");

    assert.deepEqual(registry.getRunnableScripts(), [
        {
            path: "🛠️ scripts/clean.mjs",
            fileName: "clean.mjs",
            mentionName: "clean",
            normalizedMentionName: "clean",
        },
    ]);
    assert.deepEqual(registry.resolve("clean"), {
        path: "🛠️ scripts/clean.mjs",
        fileName: "clean.mjs",
        mentionName: "clean",
        normalizedMentionName: "clean",
    });
    assert.deepEqual(registry.getAmbiguousMentionNames(), []);
});
