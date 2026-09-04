import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const HEAVY_RUNTIME_DEPENDENCIES = ["acorn", "entities"];

function collectTypescriptFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectTypescriptFiles(entryPath);
        return /\.(?:ts|tsx)$/u.test(entry.name) ? [entryPath] : [];
    });
}

test("production source excludes heavyweight general-purpose parsers", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const rootLockDependencies = packageLock.packages?.[""]?.dependencies ?? {};
    const sourceText = collectTypescriptFiles("src")
        .map((filePath) => readFileSync(filePath, "utf8"))
        .join("\n");

    for (const dependency of HEAVY_RUNTIME_DEPENDENCIES) {
        assert.equal(packageJson.dependencies?.[dependency], undefined, `${dependency} package dependency`);
        assert.equal(rootLockDependencies[dependency], undefined, `${dependency} lockfile dependency`);
    }
    assert.doesNotMatch(sourceText, /from\s+["'](?:acorn|entities)(?:\/[^"']*)?["']/u);
});
