import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

function findNodeMjsTargets(command) {
    const tokens = Array.from(
        command.matchAll(/\s*(?:(&&|\|\||;)|"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s;&|]+))/gu),
        (match) => match[1]
            ? { kind: "operator", value: match[1] }
            : { kind: "word", value: match[2] ?? match[3] ?? match[4] ?? "" },
    );
    const targets = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        const previousToken = tokens[index - 1];
        if (
            token.kind !== "word"
            || token.value !== "node"
            || (previousToken && previousToken.kind !== "operator")
        ) {
            continue;
        }

        for (let targetIndex = index + 1; targetIndex < tokens.length; targetIndex += 1) {
            const candidate = tokens[targetIndex];
            if (candidate.kind === "operator") {
                break;
            }
            if (candidate.value.endsWith(".mjs")) {
                targets.push(candidate.value);
                break;
            }
        }
    }
    return targets;
}

test("node package target scanner handles quotes, flags, and adjacent operators", () => {
    const fixtures = [
        ["node \"scripts/quoted target.mjs\"", ["scripts/quoted target.mjs"]],
        ["node --no-warnings 'scripts/flagged.mjs'", ["scripts/flagged.mjs"]],
        [
            "npm run typecheck&&node scripts/bare.mjs||node --test tests/runner.test.mjs;node 'scripts/final.mjs'",
            ["scripts/bare.mjs", "tests/runner.test.mjs", "scripts/final.mjs"],
        ],
    ];
    for (const [command, expectedTargets] of fixtures) {
        assert.deepEqual(findNodeMjsTargets(command), expectedTargets, command);
    }
});

test("node package scripts target existing mjs files", () => {
    const inspectedScripts = new Set();
    for (const [scriptName, command] of Object.entries(packageJson.scripts ?? {})) {
        for (const target of findNodeMjsTargets(command)) {
            inspectedScripts.add(scriptName);
            const targetPath = path.join(repoRoot, target);
            assert.equal(
                existsSync(targetPath),
                true,
                `${scriptName} targets missing file ${target}`,
            );
        }
    }

    assert.equal(inspectedScripts.has("dev"), true, "compound dev script must be inspected");
});
