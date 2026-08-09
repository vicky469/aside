import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import { rankThreadsBySidebarSearchQuery } from "../src/ui/views/sidebarContentFilter";
import {
    buildIndexSidebarSearchWindow,
    includeActiveDraftHostInIndexSearchWindow,
} from "../src/ui/views/indexSidebarSearchWindow";

function createThread(index: number): CommentThread {
    return {
        id: `thread-${index}`,
        filePath: "docs/a.md",
        startLine: index,
        startChar: 0,
        endLine: index,
        endChar: 4,
        selectedText: index % 7 === 0 ? "architecture" : `section ${index}`,
        selectedTextHash: `hash-${index}`,
        anchorKind: "selection",
        orphaned: false,
        entries: [{
            id: `entry-${index}`,
            body: index % 3 === 0 ? "architecture" : `architecture note ${index % 11}`,
            timestamp: 100 + index,
        }],
        createdAt: 100 + index,
        updatedAt: 100 + index,
    };
}

test("global index search returns the exact top 100 and a complete match notice", () => {
    const threads = Array.from({ length: 137 }, (_, index) => createThread(index));
    const complete = rankThreadsBySidebarSearchQuery(threads, "architecture");

    const window = buildIndexSidebarSearchWindow({
        threads,
        query: "architecture",
        mode: "list",
        rootFilePath: null,
    });

    assert.deepEqual(
        window.items.map((thread) => thread.id),
        complete.slice(0, 100).map((thread) => thread.id),
    );
    assert.equal(window.totalMatchCount, 137);
    assert.equal(window.hiddenMatchCount, 37);
    assert.deepEqual(window.notice, {
        primary: "100 of 137 matches shown.",
        secondary: "Refine your search or select a file.",
    });
});

test("file-scoped index search keeps every exact result and omits the global notice", () => {
    const threads = Array.from({ length: 137 }, (_, index) => createThread(index));

    const window = buildIndexSidebarSearchWindow({
        threads,
        query: "architecture",
        mode: "list",
        rootFilePath: "docs/a.md",
    });

    assert.equal(window.items.length, 137);
    assert.equal(window.totalMatchCount, 137);
    assert.equal(window.hiddenMatchCount, 0);
    assert.equal(window.notice, null);
});

test("global index search returns every result when fewer than 100 match", () => {
    const threads = Array.from({ length: 12 }, (_, index) => createThread(index));

    const window = buildIndexSidebarSearchWindow({
        threads,
        query: "architecture",
        mode: "list",
        rootFilePath: null,
    });

    assert.equal(window.items.length, 12);
    assert.equal(window.hiddenMatchCount, 0);
    assert.equal(window.notice, null);
});

test("an active draft host may sit outside the 100 matching-result window", () => {
    const threads = Array.from({ length: 101 }, (_, index) => createThread(index));
    const resultWindow = threads.slice(0, 100);

    const withDraftHost = includeActiveDraftHostInIndexSearchWindow(
        resultWindow,
        threads,
        "thread-100",
    );

    assert.equal(withDraftHost.length, 101);
    assert.deepEqual(withDraftHost.slice(0, 100), resultWindow);
    assert.equal(withDraftHost[100], threads[100]);
    assert.deepEqual(
        includeActiveDraftHostInIndexSearchWindow(resultWindow, threads, "thread-20"),
        resultWindow,
    );
});
