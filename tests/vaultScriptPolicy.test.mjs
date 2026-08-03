import assert from "node:assert/strict";
import test from "node:test";
import vaultScriptPolicy from "../shared/vaultScriptPolicy.js";

test("parseVaultScriptPath accepts a direct runnable vault script", () => {
    assert.equal(vaultScriptPolicy.VAULT_SCRIPT_FOLDER_PATH, "🛠️ scripts");
    assert.deepEqual(vaultScriptPolicy.VAULT_SCRIPT_EXTENSIONS, [".mjs", ".js", ".cjs"]);
    assert.equal(Object.isFrozen(vaultScriptPolicy.VAULT_SCRIPT_EXTENSIONS), true);
    assert.deepEqual(
        vaultScriptPolicy.parseVaultScriptPath("🛠️ scripts/clean-links.mjs"),
        {
            path: "🛠️ scripts/clean-links.mjs",
            fileName: "clean-links.mjs",
            mentionName: "clean-links",
            normalizedMentionName: "clean-links",
        },
    );
});

test("parseVaultScriptPath normalizes separators and preserves display casing", () => {
    assert.deepEqual(
        vaultScriptPolicy.parseVaultScriptPath("🛠️ scripts\\Format.CJS"),
        {
            path: "🛠️ scripts/Format.CJS",
            fileName: "Format.CJS",
            mentionName: "Format",
            normalizedMentionName: "format",
        },
    );
});

test("parseVaultScriptPath rejects non-runnable or misplaced scripts", () => {
    for (const path of [
        "scripts/clean-links.mjs",
        "🛠️ scripts/nested/clean-links.mjs",
        "🛠️ scripts/.hidden.js",
        "🛠️ scripts/clean.test.mjs",
        "🛠️ scripts/Clean.SpEc.Js",
        "🛠️ scripts/clean-links.ts",
        "🛠️ scripts/bad name.js",
        "🛠️ scripts/.js",
    ]) {
        assert.equal(vaultScriptPolicy.parseVaultScriptPath(path), null, path);
    }
});

test("collectVaultScriptRegistrations withholds case-insensitive collisions", () => {
    assert.deepEqual(
        vaultScriptPolicy.collectVaultScriptRegistrations([
            "🛠️ scripts/Clean.mjs",
            "🛠️ scripts/clean.js",
            "🛠️ scripts/format.cjs",
            "🛠️ scripts/nested/ignored.js",
        ]),
        {
            runnable: [
                {
                    path: "🛠️ scripts/format.cjs",
                    fileName: "format.cjs",
                    mentionName: "format",
                    normalizedMentionName: "format",
                },
            ],
            ambiguousMentionNames: ["clean"],
        },
    );
});

test("collectVaultScriptRegistrations de-duplicates identical paths and sorts results", () => {
    assert.deepEqual(
        vaultScriptPolicy.collectVaultScriptRegistrations([
            "🛠️ scripts/Zeta.js",
            "🛠️ scripts/alpha.mjs",
            "🛠️ scripts/Zeta.js",
            "🛠️ scripts/beta.js",
            "🛠️ scripts/BETA.cjs",
        ]),
        {
            runnable: [
                {
                    path: "🛠️ scripts/alpha.mjs",
                    fileName: "alpha.mjs",
                    mentionName: "alpha",
                    normalizedMentionName: "alpha",
                },
                {
                    path: "🛠️ scripts/Zeta.js",
                    fileName: "Zeta.js",
                    mentionName: "Zeta",
                    normalizedMentionName: "zeta",
                },
            ],
            ambiguousMentionNames: ["beta"],
        },
    );
});
