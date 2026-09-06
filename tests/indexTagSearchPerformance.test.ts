import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import type { TFile } from "obsidian";
import { VaultCapabilityIndex } from "../src/core/vault/vaultCapabilityIndex";
import {
    buildIndexTagSearchResult,
    buildIndexTagSearchWindow,
} from "../src/ui/views/indexTagSearch";

const FILE_COUNT = 10_000;
const INITIAL_VISIBLE_LIMIT = 100;

function createFile(index: number): TFile {
    const basename = `Note ${String(index).padStart(5, "0")}`;
    return {
        path: `Area ${index % 100}/${basename}.md`,
        name: `${basename}.md`,
        basename,
        extension: "md",
    } as TFile;
}

test("10,000-file tag search stays indexed, deduplicated, and render-bounded", (context) => {
    const index = new VaultCapabilityIndex();
    const files = Array.from({ length: FILE_COUNT }, (_, fileIndex) => createFile(fileIndex));
    index.seed(files, (file) => {
        const fileIndex = Number.parseInt(file.basename.slice("Note ".length), 10);
        return ["#project", `#project/bucket-${fileIndex % 20}`];
    });

    let membershipLookupCount = 0;
    const startedAt = performance.now();
    const result = buildIndexTagSearchResult({
        query: "project",
        tags: index.listTagUsage(),
        getFilesForTag: (tag) => {
            membershipLookupCount += 1;
            return index.listMarkdownFilesForTag(tag);
        },
    });
    const elapsedMs = performance.now() - startedAt;
    const initialWindow = buildIndexTagSearchWindow(result, null, INITIAL_VISIBLE_LIMIT);

    assert.equal(membershipLookupCount, result.tags.length);
    assert.ok(membershipLookupCount <= 40, "ranking must bound reverse-index lookups");
    assert.equal(result.files.length, FILE_COUNT);
    assert.equal(new Set(result.files.map((file) => file.filePath)).size, FILE_COUNT);
    assert.equal(initialWindow.visibleCount, INITIAL_VISIBLE_LIMIT);
    assert.equal(initialWindow.totalCount, FILE_COUNT);
    assert.equal(initialWindow.hasMore, true);
    context.diagnostic(
        `10k index tag model: ${elapsedMs.toFixed(2)}ms; ${membershipLookupCount} indexed memberships; ${initialWindow.visibleCount} initially visible`,
    );
});

test("index tag query model has no vault content reader", () => {
    const source = readFileSync("src/ui/views/indexTagSearch.ts", "utf8");

    assert.doesNotMatch(source, /(?:cachedRead|vault\.read|adapter\.read|readFile)\s*\(/u);
});
