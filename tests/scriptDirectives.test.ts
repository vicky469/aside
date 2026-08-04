import * as assert from "node:assert/strict";
import test from "node:test";
import { resolveScriptDirective } from "../src/vaultScripts/scriptDirectives";
import { VaultScriptRegistry } from "../src/vaultScripts/vaultScriptRegistry";

function createRegistry(): VaultScriptRegistry {
    const registry = new VaultScriptRegistry();
    registry.seed([
        "🛠️ scripts/clean.mjs",
        "🛠️ scripts/other-script.js",
        "🛠️ scripts/format.js",
        "🛠️ scripts/Format.cjs",
        "🛠️ scripts/codex.js",
        "🛠️ scripts/todo.js",
    ]);
    return registry;
}

test("resolveScriptDirective recognizes registered mentions at text boundaries", () => {
    const registry = createRegistry();

    assert.deepEqual(resolveScriptDirective("run (@CLEAN), please", registry), {
        kind: "script",
        script: registry.resolve("clean"),
    });
    assert.equal(resolveScriptDirective("ordinary @person", registry).kind, "none");
    assert.equal(resolveScriptDirective("email@clean", registry).kind, "none");
    assert.equal(resolveScriptDirective("@cleaner", registry).kind, "none");
});

test("resolveScriptDirective rejects ambiguous, multiple, and mixed directives with stable names", () => {
    const registry = createRegistry();

    assert.deepEqual(resolveScriptDirective("@format", registry), {
        kind: "rejected",
        mentionName: "format",
        mentionNames: ["format"],
        message: "Script @format matches more than one vault file.",
    });
    assert.deepEqual(resolveScriptDirective("@other-script then @clean", registry), {
        kind: "rejected",
        mentionName: "clean",
        mentionNames: ["clean", "other-script"],
        message: "Use only one vault script per side note.",
    });
    assert.deepEqual(resolveScriptDirective("@clean and @codex", registry), {
        kind: "rejected",
        mentionName: "clean",
        mentionNames: ["clean", "codex"],
        message: "Use a vault script or an agent, not both.",
    });
});

test("reserved built-ins never resolve as scripts", () => {
    const registry = createRegistry();

    assert.equal(resolveScriptDirective("@todo", registry).kind, "none");
    assert.equal(resolveScriptDirective("@codex", registry).kind, "none");
    assert.equal(resolveScriptDirective("@claude", registry).kind, "none");
});
