import * as assert from "node:assert/strict";
import test from "node:test";
import {
    normalizeSidebarPrimaryMode,
    normalizeIndexFileFilterRootPath,
    resolveIndexFileFilterRootPathFromState,
} from "../src/ui/views/viewState";

test("normalizeSidebarPrimaryMode accepts the supported sidebar modes only", () => {
    assert.equal(normalizeSidebarPrimaryMode("list"), "list");
    assert.equal(normalizeSidebarPrimaryMode("thought-trail"), "thought-trail");
    assert.equal(normalizeSidebarPrimaryMode("agent"), null);
    assert.equal(normalizeSidebarPrimaryMode(undefined), null);
});

test("normalizeIndexFileFilterRootPath normalizes one file path", () => {
    assert.equal(
        normalizeIndexFileFilterRootPath(" docs\\Folder\\Note.md "),
        "docs/Folder/Note.md",
    );
    assert.equal(normalizeIndexFileFilterRootPath(null), null);
});

test("resolveIndexFileFilterRootPathFromState prefers the explicit root path", () => {
    assert.equal(
        resolveIndexFileFilterRootPathFromState({
            indexFileFilterRootPath: " docs\\a.md ",
            indexFileFilterPaths: ["docs/b.md"],
        }),
        "docs/a.md",
    );
});

test("resolveIndexFileFilterRootPathFromState migrates the first legacy file path", () => {
    assert.equal(
        resolveIndexFileFilterRootPathFromState({
            indexFileFilterPaths: [" docs\\b.md ", "docs/a.md"],
        }),
        "docs/b.md",
    );
    assert.equal(
        resolveIndexFileFilterRootPathFromState({
            indexFileFilterPaths: [],
        }),
        null,
    );
});

test("resolveIndexFileFilterRootPathFromState returns undefined when no filter state is present", () => {
    assert.equal(
        resolveIndexFileFilterRootPathFromState({}),
        undefined,
    );
});
