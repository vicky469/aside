import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

test("node package scripts target existing mjs files", () => {
    for (const [scriptName, command] of Object.entries(packageJson.scripts ?? {})) {
        const targetMatch = /^node\s+([^\s]+\.mjs)(?:\s|$)/u.exec(command);
        if (!targetMatch) {
            continue;
        }

        const targetPath = path.join(repoRoot, targetMatch[1]);
        assert.equal(
            existsSync(targetPath),
            true,
            `${scriptName} targets missing file ${targetMatch[1]}`,
        );
    }
});
