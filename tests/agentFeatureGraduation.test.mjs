import * as assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const sourceRoot = join(process.cwd(), "src");
const forbiddenPatterns = [
    ["FeatureFlag", "agents"].join("."),
    ["is", "Agents", "Feature", "Available"].join(""),
    ["agents", "Feature", "Available"].join(""),
    ["AGENTS", "EXPERIMENT", "DISABLED", "NOTICE"].join("_"),
].map((name) => new RegExp(name.replaceAll(".", "\\."), "u"));

function listTypeScriptFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return listTypeScriptFiles(path);
        }
        return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
    });
}

test("agent support has no feature-flag execution gates", () => {
    for (const path of listTypeScriptFiles(sourceRoot)) {
        const source = readFileSync(path, "utf8");
        for (const pattern of forbiddenPatterns) {
            assert.doesNotMatch(source, pattern, `${path} contains ${pattern.source}`);
        }
    }

    assert.equal(
        existsSync(join(sourceRoot, "core/agents/agentsFeaturePolicy.ts")),
        false,
    );
});
