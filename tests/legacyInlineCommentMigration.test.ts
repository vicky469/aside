import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import {
    getLegacyInlineConflictEntryId,
    mergeLegacyInlineThreads,
} from "../src/core/storage/legacyInlineCommentMigration";

function createThread(overrides: Partial<CommentThread> = {}): CommentThread {
    const threadId = overrides.id ?? "thread-1";
    return {
        id: threadId,
        filePath: "note.md",
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 5,
        selectedText: "Alpha",
        selectedTextHash: "hash-alpha",
        anchorKind: "selection",
        orphaned: false,
        resolved: false,
        entries: [{
            id: "entry-1",
            body: "Canonical body",
            timestamp: 100,
        }],
        createdAt: 100,
        updatedAt: 100,
        ...overrides,
    };
}

test("legacy inline migration imports threads missing from sidecar storage", () => {
    const sidecarThread = createThread({ id: "sidecar-thread" });
    const inlineThread = createThread({
        id: "legacy-thread",
        entries: [{
            id: "legacy-entry",
            body: "Legacy inline body",
            timestamp: 120,
        }],
    });

    const merged = mergeLegacyInlineThreads([sidecarThread], [inlineThread]);

    assert.equal(merged.changed, true);
    assert.deepEqual(merged.threads.map((thread) => thread.id), ["sidecar-thread", "legacy-thread"]);
    assert.equal(merged.threads[1].entries[0].body, "Legacy inline body");
});

test("legacy inline migration preserves conflicting entry bodies as recovery entries", () => {
    const sidecarThread = createThread();
    const inlineThread = createThread({
        entries: [{
            id: "entry-1",
            body: "Legacy conflicting body",
            timestamp: 90,
        }],
        updatedAt: 90,
    });

    const merged = mergeLegacyInlineThreads([sidecarThread], [inlineThread]);

    assert.equal(merged.changed, true);
    assert.equal(merged.threads.length, 1);
    assert.equal(merged.threads[0].entries.length, 2);
    assert.equal(merged.threads[0].entries[1].id, getLegacyInlineConflictEntryId("entry-1"));
    assert.match(merged.threads[0].entries[1].body, /Legacy conflicting body/);
});

test("legacy inline migration leaves sidecar threads unchanged when inline has no new data", () => {
    const sidecarThread = createThread();
    const inlineThread = createThread();

    const merged = mergeLegacyInlineThreads([sidecarThread], [inlineThread]);

    assert.equal(merged.changed, false);
    assert.equal(merged.threads.length, 1);
    assert.equal(merged.threads[0].id, sidecarThread.id);
    assert.deepEqual(merged.threads[0].entries, sidecarThread.entries);
});
