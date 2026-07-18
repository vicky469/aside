import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { ESLint } from "eslint";

const rootDir = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
const ciWorkflow = readFileSync(path.join(rootDir, ".github/workflows/ci.yml"), "utf8");

function createESLint() {
    return new ESLint({ cwd: rootDir });
}

test("central ESLint policy disables inline configuration", async () => {
    const eslint = createESLint();
    const config = await eslint.calculateConfigForFile("src/main.ts");
    const testConfig = await eslint.calculateConfigForFile("tests/publicFilePublishActions.test.ts");

    assert.equal(config.linterOptions.noInlineConfig, true);
    assert.equal(config.linterOptions.reportUnusedDisableDirectives, 2);
    assert.equal(config.linterOptions.reportUnusedInlineConfigs, 2);
    assert.equal(testConfig.linterOptions.noInlineConfig, true);
    assert.equal(testConfig.rules["@typescript-eslint/no-floating-promises"][0], 0);
    assert.equal(testConfig.rules["@typescript-eslint/no-explicit-any"][0], 0);
});

test("inline rule suppressions cannot change lint behavior", async (context) => {
    const cases = new Map([
        ["block disable", "/* eslint-disable no-console */\nconsole.log('blocked');\n/* eslint-enable no-console */\n"],
        ["line disable", "console.log('blocked'); // eslint-disable-line no-console\n"],
        ["next-line disable", "// eslint-disable-next-line no-console\nconsole.log('blocked');\n"],
        ["inline rule override", "/* eslint no-console: off */\nconsole.log('blocked');\n"],
    ]);

    for (const [name, source] of cases) {
        await context.test(name, async () => {
            const eslint = createESLint();
            const [result] = await eslint.lintText(source, {
                filePath: path.join(rootDir, "src/main.ts"),
            });

            assert.ok(
                result.messages.some((message) => message.message.includes("noInlineConfig")),
                JSON.stringify(result.messages, null, 2),
            );
        });
    }
});

test("lint entrypoint covers every maintained runtime", async () => {
    const eslint = createESLint();
    const maintainedPaths = [
        "manifest.json",
        "scripts/check-obsidian-compliance.mjs",
        "src/main.ts",
        "tests/publicFilePublishActions.test.ts",
        "workers/cache-purge-broker/src/index.ts",
        "workers/cache-purge-broker/wrangler.jsonc",
    ];

    assert.equal(packageJson.scripts.lint, "eslint . --max-warnings 0");
    for (const filePath of maintainedPaths) {
        assert.equal(await eslint.isPathIgnored(filePath), false, filePath);
    }
});

test("lint entrypoint excludes derived and local-only files", async () => {
    const eslint = createESLint();
    const ignoredPaths = [
        ".public-release/main.js",
        ".test-dist/tests/example.js",
        ".worktrees/example/src/main.ts",
        "docs/example.ts",
        "main.js",
        "package-lock.json",
    ];

    for (const filePath of ignoredPaths) {
        assert.equal(await eslint.isPathIgnored(filePath), true, filePath);
    }
});

test("CI uses supported Node.js LTS releases", () => {
    assert.match(ciWorkflow, /node-version:\s*\[22, 24\]/u);
    assert.doesNotMatch(ciWorkflow, /node-version:[^\n]*\b20\b/u);
});
