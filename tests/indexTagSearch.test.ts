import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import {
    buildIndexTagSearchResult,
    buildIndexTagSearchWindow,
    selectIndexTagSearchFiles,
} from "../src/ui/views/indexTagSearch";

function createFile(path: string): TFile {
    const name = path.split("/").pop() ?? path;
    return {
        path,
        name,
        basename: name.replace(/\.[^.]+$/u, ""),
        extension: name.includes(".") ? name.split(".").pop() ?? "" : "",
    } as TFile;
}

test("empty index tag queries perform no membership lookups", () => {
    let lookupCount = 0;
    const result = buildIndexTagSearchResult({
        query: "   ",
        tags: [{ tag: "#project", usageCount: 1 }],
        getFilesForTag: () => {
            lookupCount += 1;
            return [createFile("Project.md")];
        },
    });

    assert.deepEqual(result, { query: "", tags: [], files: [] });
    assert.equal(lookupCount, 0);
});

test("index notes are excluded from tag results and counts, including index-only tags", () => {
    const options = {
        query: "灵感",
        tags: [
            { tag: "#灵感", usageCount: 7 },
            { tag: "#灵感/index-only", usageCount: 1 },
        ],
        isExcludedFilePath: (path: string) => ["🐰 Aside Index.md", "Aside index.md"].includes(path),
        getFilesForTag: (tag: string) => tag === "#灵感"
            ? ["🐰 Aside Index.md", "Aside index.md", "A.md", "B.md", "C.md", "D.md", "notes/index.md"].map(createFile)
            : [createFile("🐰 Aside Index.md")],
    };
    const model = buildIndexTagSearchResult(options);
    assert.deepEqual(model.tags, [{ tag: "#灵感", tagKey: "灵感", fileCount: 5 }]);
    assert.deepEqual(model.files.map((file) => file.filePath), ["A.md", "B.md", "C.md", "D.md", "notes/index.md"]);
    assert.equal(buildIndexTagSearchWindow(model, "灵感", 100).totalCount, 5);
});

test("all matches deduplicates files and exact filters keep complete membership", () => {
    const shared = createFile("docs/Shared.md");
    const model = buildIndexTagSearchResult({
        query: "proj",
        tags: [
            { tag: "#project", usageCount: 2 },
            { tag: "#project/alpha", usageCount: 2 },
        ],
        getFilesForTag: (tag) => tag === "#project"
            ? [createFile("docs/A.md"), shared]
            : [shared, createFile("other/A.md")],
    });

    assert.deepEqual(model.tags, [
        { tag: "#project", tagKey: "project", fileCount: 2 },
        { tag: "#project/alpha", tagKey: "project/alpha", fileCount: 2 },
    ]);
    assert.deepEqual(selectIndexTagSearchFiles(model, null).map((file) => file.filePath), [
        "docs/A.md",
        "docs/Shared.md",
        "other/A.md",
    ]);
    assert.deepEqual(
        selectIndexTagSearchFiles(model, "project/alpha").map((file) => file.filePath),
        ["other/A.md", "docs/Shared.md"],
    );
    assert.deepEqual(
        model.files.find((file) => file.filePath === shared.path)?.matchedTags,
        [
            { tag: "#project", tagKey: "project" },
            { tag: "#project/alpha", tagKey: "project/alpha" },
        ],
    );
});

test("unknown or stale tag filters fall back to all matches", () => {
    const model = buildIndexTagSearchResult({
        query: "project",
        tags: [{ tag: "#project", usageCount: 1 }],
        getFilesForTag: () => [createFile("Project.md")],
    });

    assert.deepEqual(
        selectIndexTagSearchFiles(model, "deleted-tag").map((file) => file.filePath),
        ["Project.md"],
    );
});

test("same basenames remain distinct and use path as a stable tie breaker", () => {
    const model = buildIndexTagSearchResult({
        query: "same",
        tags: [{ tag: "#same", usageCount: 2 }],
        getFilesForTag: () => [createFile("z/A.md"), createFile("a/A.md")],
    });

    assert.deepEqual(model.files.map((file) => [file.label, file.filePath]), [
        ["A", "a/A.md"],
        ["A", "z/A.md"],
    ]);
});

test("a fuzzy tag match filters by that tag's exact membership", () => {
    const model = buildIndexTagSearchResult({
        query: "architectuer",
        tags: [
            { tag: "#architecture", usageCount: 1 },
            { tag: "#architectural", usageCount: 1 },
        ],
        getFilesForTag: (tag) => tag === "#architecture"
            ? [createFile("Architecture.md")]
            : [createFile("Architectural.md")],
    });

    assert.equal(model.tags[0]?.tag, "#architecture");
    assert.deepEqual(
        selectIndexTagSearchFiles(model, model.tags[0]?.tagKey ?? null).map((file) => file.filePath),
        ["Architecture.md"],
    );
});

test("hyphen-insensitive discovery preserves exact tag memberships", () => {
    const model = buildIndexTagSearchResult({
        query: "anapple",
        tags: [
            { tag: "#an-apple", usageCount: 1 },
            { tag: "#anapple", usageCount: 1 },
        ],
        getFilesForTag: (tag) => tag === "#an-apple"
            ? [createFile("With Hyphen.md")]
            : [createFile("Without Hyphen.md")],
    });

    assert.deepEqual(
        selectIndexTagSearchFiles(model, "an-apple").map((file) => file.filePath),
        ["With Hyphen.md"],
    );
    assert.deepEqual(
        selectIndexTagSearchFiles(model, "anapple").map((file) => file.filePath),
        ["Without Hyphen.md"],
    );
});

test("result windows expose every file in stable increments", () => {
    const files = Array.from({ length: 205 }, (_, index) => (
        createFile(`docs/${String(index).padStart(3, "0")}.md`)
    ));
    const model = buildIndexTagSearchResult({
        query: "bulk",
        tags: [{ tag: "#bulk", usageCount: files.length }],
        getFilesForTag: () => files,
    });

    const first = buildIndexTagSearchWindow(model, null, 100);
    assert.deepEqual({
        paths: first.files.map((file) => file.filePath),
        visibleCount: first.visibleCount,
        totalCount: first.totalCount,
        hasMore: first.hasMore,
    }, {
        paths: selectIndexTagSearchFiles(model, null).slice(0, 100).map((file) => file.filePath),
        visibleCount: 100,
        totalCount: 205,
        hasMore: true,
    });

    const complete = buildIndexTagSearchWindow(model, null, 300);
    assert.equal(complete.visibleCount, 205);
    assert.equal(complete.totalCount, 205);
    assert.equal(complete.hasMore, false);

    const empty = buildIndexTagSearchWindow(model, null, -1);
    assert.equal(empty.visibleCount, 0);
    assert.equal(empty.totalCount, 205);
    assert.equal(empty.hasMore, true);
});
