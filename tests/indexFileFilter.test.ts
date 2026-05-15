import * as assert from "node:assert/strict";
import test from "node:test";
import type { Comment } from "../src/commentManager";
import { buildIndexFileFilterGraph } from "../src/core/derived/indexFileFilterGraph";
import {
    buildIndexFileFilterOptions,
    deriveIndexSidebarScopedFilePaths,
    filterCommentsByFilePaths,
    getIndexFileFilterLabel,
    getIndexFileFilterSuggestions,
    isIndexFileFilterPathSelected,
    normalizeIndexFileFilterPaths,
    resolveAutoIndexFileFilterRootPath,
    shouldLimitIndexSidebarList,
} from "../src/ui/views/indexFileFilter";
import { updateRenderedActiveFileFilters } from "../src/ui/views/sidebarActiveFileFilterDom";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        startLine: overrides.startLine ?? 5,
        startChar: overrides.startChar ?? 1,
        endLine: overrides.endLine ?? 5,
        endChar: overrides.endChar ?? 8,
        selectedText: overrides.selectedText ?? "comment",
        selectedTextHash: overrides.selectedTextHash ?? "hash:comment",
        comment: overrides.comment ?? "Comment body",
        timestamp: overrides.timestamp ?? 100,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
    };
}

test("normalizeIndexFileFilterPaths deduplicates, trims, and sorts file paths", () => {
    assert.deepEqual(
        normalizeIndexFileFilterPaths([" docs/b.md ", "docs/a.md", "docs/b.md", ""]),
        ["docs/a.md", "docs/b.md"],
    );
});

test("resolveAutoIndexFileFilterRootPath preserves explicit roots and otherwise selects the first index file", () => {
    assert.equal(
        resolveAutoIndexFileFilterRootPath({
            currentRootPath: " docs/current.md ",
            firstIndexFilePath: "docs/first.md",
            autoSelectSuppressed: false,
        }),
        "docs/current.md",
    );
    assert.equal(
        resolveAutoIndexFileFilterRootPath({
            currentRootPath: null,
            firstIndexFilePath: " docs/first.md ",
            autoSelectSuppressed: false,
        }),
        "docs/first.md",
    );
    assert.equal(
        resolveAutoIndexFileFilterRootPath({
            currentRootPath: null,
            firstIndexFilePath: "docs/first.md",
            autoSelectSuppressed: true,
        }),
        null,
    );
    assert.equal(
        resolveAutoIndexFileFilterRootPath({
            currentRootPath: null,
            firstIndexFilePath: "",
            autoSelectSuppressed: false,
        }),
        null,
    );
});

test("isIndexFileFilterPathSelected matches normalized selected file paths", () => {
    assert.equal(isIndexFileFilterPathSelected("docs/a.md", " docs/a.md "), true);
    assert.equal(isIndexFileFilterPathSelected("docs/a.md", "docs/b.md"), false);
    assert.equal(isIndexFileFilterPathSelected("docs/a.md", null), false);
});

test("buildIndexFileFilterOptions counts comments per file and sorts by file name", () => {
    const options = buildIndexFileFilterOptions([
        createComment({ filePath: "notes/zeta.md" }),
        createComment({ filePath: "notes/alpha.md" }),
        createComment({ filePath: "other/alpha.md" }),
        createComment({ filePath: "notes/zeta.md" }),
    ]);

    assert.deepEqual(options, [
        { filePath: "notes/alpha.md", commentCount: 1 },
        { filePath: "other/alpha.md", commentCount: 1 },
        { filePath: "notes/zeta.md", commentCount: 2 },
    ]);
});

test("filterCommentsByFilePaths returns only matching comment files", () => {
    const comments = [
        createComment({ id: "a", filePath: "docs/a.md" }),
        createComment({ id: "b", filePath: "docs/b.md" }),
    ];

    assert.deepEqual(
        filterCommentsByFilePaths(comments, ["docs/b.md"]).map((comment) => comment.id),
        ["b"],
    );
    assert.deepEqual(
        filterCommentsByFilePaths(comments, []).map((comment) => comment.id),
        ["a", "b"],
    );
});

test("deriveIndexSidebarScopedFilePaths returns the selected root connected component", () => {
    const graph = buildIndexFileFilterGraph([
        createComment({ id: "a", filePath: "docs/a.md", comment: "[[B]]" }),
        createComment({ id: "b", filePath: "docs/b.md", comment: "" }),
        createComment({ id: "c", filePath: "docs/c.md", comment: "" }),
    ], {
        resolveWikiLinkPath: (linkPath) => ({
            B: "docs/b.md",
        }[linkPath] ?? null),
    });

    assert.deepEqual(
        deriveIndexSidebarScopedFilePaths(graph, "docs/a.md"),
        ["docs/a.md", "docs/b.md"],
    );
});

test("deriveIndexSidebarScopedFilePaths returns an empty scope for missing roots", () => {
    const graph = buildIndexFileFilterGraph([
        createComment({ id: "a", filePath: "docs/a.md", comment: "[[B]]" }),
        createComment({ id: "b", filePath: "docs/b.md", comment: "" }),
    ], {
        resolveWikiLinkPath: (linkPath) => ({
            B: "docs/b.md",
        }[linkPath] ?? null),
    });

    assert.deepEqual(
        deriveIndexSidebarScopedFilePaths(graph, "docs/missing.md"),
        [],
    );
});

test("shouldLimitIndexSidebarList applies the cap only when no root scope or search is active", () => {
    assert.equal(shouldLimitIndexSidebarList(null), true);
    assert.equal(shouldLimitIndexSidebarList("docs/a.md"), false);
    assert.equal(shouldLimitIndexSidebarList(null, "design"), false);
});

test("getIndexFileFilterSuggestions keeps selected files visible and orders them first", () => {
    const options = [
        { filePath: "notes/alpha.md", commentCount: 1 },
        { filePath: "archive/alpha.md", commentCount: 3 },
        { filePath: "notes/beta.md", commentCount: 2 },
    ];

    assert.deepEqual(
        getIndexFileFilterSuggestions(options, "alp", ["notes/alpha.md"]).map((option) => option.filePath),
        ["notes/alpha.md", "archive/alpha.md"],
    );
    assert.deepEqual(
        getIndexFileFilterSuggestions(options, "", ["notes/beta.md"]).map((option) => option.filePath),
        ["notes/beta.md", "archive/alpha.md", "notes/alpha.md"],
    );
});

test("getIndexFileFilterLabel falls back to full path when selected basenames collide", () => {
    assert.equal(
        getIndexFileFilterLabel("notes/alpha.md", ["notes/alpha.md", "archive/alpha.md"]),
        "notes/alpha.md",
    );
    assert.equal(
        getIndexFileFilterLabel("notes/beta.md", ["notes/beta.md", "archive/alpha.md"]),
        "beta",
    );
});

test("updateRenderedActiveFileFilters replaces the visible filter chip immediately", () => {
    const labelEl = { textContent: "old" };
    const summaryEl = { textContent: "old summary" };
    const clearButton = {
        attributes: new Map<string, string>(),
        setAttribute(name: string, value: string) {
            this.attributes.set(name, value);
        },
    };
    const container = {
        querySelector(selector: string) {
            if (selector === ".aside-active-file-filter-label") {
                return labelEl;
            }
            if (selector === ".aside-active-file-filter-summary") {
                return summaryEl;
            }
            if (selector === ".aside-active-file-filter-clear") {
                return clearButton;
            }
            return null;
        },
    };

    const updated = updateRenderedActiveFileFilters(container as unknown as HTMLElement, {
        rootFilePath: "test.md",
        filteredIndexFilePaths: ["test.md"],
    });

    assert.equal(updated, true);
    assert.equal(labelEl.textContent, "test");
    assert.equal(summaryEl.textContent, "1 file");
    assert.equal(clearButton.attributes.get("aria-label"), "Clear file filter for test.md");
});
