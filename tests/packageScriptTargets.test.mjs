import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

test("node package scripts target existing mjs files", () => {
    const inspectedScripts = new Set();
    for (const [scriptName, command] of Object.entries(packageJson.scripts ?? {})) {
        const targetMatches = command.matchAll(/\bnode\s+([^\s]+\.mjs)(?=\s|$)/gu);
        for (const targetMatch of targetMatches) {
            inspectedScripts.add(scriptName);
            const targetPath = path.join(repoRoot, targetMatch[1]);
            assert.equal(
                existsSync(targetPath),
                true,
                `${scriptName} targets missing file ${targetMatch[1]}`,
            );
        }
    }

    assert.equal(inspectedScripts.has("dev"), true, "compound dev script must be inspected");
});
