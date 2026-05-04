import * as assert from "node:assert/strict";
import test from "node:test";
import {
    normalizeIndexSidebarMode,
    normalizeSidebarPrimaryMode,
    normalizeIndexFileFilterRootPath,
    resolvePinnedSidebarStateByFilePathFromState,
    resolveIndexFileFilterRootPathFromState,
} from "../src/ui/views/viewState";

test("normalizeSidebarPrimaryMode accepts the supported sidebar modes only", () => {
    assert.equal(normalizeSidebarPrimaryMode("list"), "list");
    assert.equal(normalizeSidebarPrimaryMode("tags"), "tags");
    assert.equal(normalizeSidebarPrimaryMode("thought-trail"), "thought-trail");
    assert.equal(normalizeSidebarPrimaryMode("agent"), null);
    assert.equal(normalizeSidebarPrimaryMode(undefined), null);
});

test("normalizeIndexSidebarMode accepts index modes and rejects tags", () => {
    assert.equal(normalizeIndexSidebarMode("list"), "list");
    assert.equal(normalizeIndexSidebarMode("thought-trail"), "thought-trail");
    assert.equal(normalizeIndexSidebarMode("tags"), null);
    assert.equal(normalizeIndexSidebarMode("agent"), null);
    assert.equal(normalizeIndexSidebarMode(undefined), null);
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

test("resolvePinnedSidebarStateByFilePathFromState normalizes file paths and thread ids", () => {
    assert.deepEqual(
        resolvePinnedSidebarStateByFilePathFromState({
            pinnedSidebarStateByFilePath: {
                " docs\\a.md ": {
                    threadIds: [" thread-1 ", "thread-1", "", 2],
                    showPinnedThreadsOnly: true,
                },
                "": {
                    threadIds: ["thread-ignored"],
                    showPinnedThreadsOnly: true,
                },
            },
        } as unknown as Parameters<typeof resolvePinnedSidebarStateByFilePathFromState>[0]),
        {
            "docs/a.md": {
                threadIds: ["thread-1"],
                showPinnedThreadsOnly: true,
            },
        },
    );
});

test("resolvePinnedSidebarStateByFilePathFromState keeps pinned-only empty views but drops empty inactive entries", () => {
    assert.deepEqual(
        resolvePinnedSidebarStateByFilePathFromState({
            pinnedSidebarStateByFilePath: {
                "docs/a.md": {
                    threadIds: [],
                    showPinnedThreadsOnly: true,
                },
                "docs/b.md": {
                    threadIds: [],
                    showPinnedThreadsOnly: false,
                },
            },
        } as unknown as Parameters<typeof resolvePinnedSidebarStateByFilePathFromState>[0]),
        {
            "docs/a.md": {
                threadIds: [],
                showPinnedThreadsOnly: true,
            },
        },
    );
});

test("resolvePinnedSidebarStateByFilePathFromState returns undefined when pin state is absent", () => {
    assert.equal(
        resolvePinnedSidebarStateByFilePathFromState({}),
        undefined,
    );
});
