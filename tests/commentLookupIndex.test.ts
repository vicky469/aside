import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import {
    buildCommentLookupIndexes,
} from "../src/core/commentLookupIndex";

function createThread(id: string, filePath: string, entryIds: string[]): CommentThread {
    return {
        id,
        filePath,
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 0,
        selectedText: id,
        selectedTextHash: `hash-${id}`,
        anchorKind: "selection",
        orphaned: false,
        resolved: false,
        entries: entryIds.map((entryId, index) => ({
            id: entryId,
            body: `body ${entryId}`,
            timestamp: 1710000000000 + index,
        })),
        createdAt: 1710000000000,
        updatedAt: 1710000000000 + entryIds.length,
    };
}

test("comment lookup indexes preserve file order and resolve thread ids", () => {
    const first = createThread("thread-1", "a.md", ["entry-1"]);
    const second = createThread("thread-2", "b.md", ["entry-2"]);
    const third = createThread("thread-3", "a.md", ["entry-3"]);

    const indexes = buildCommentLookupIndexes([first, second, third]);

    assert.deepEqual(indexes.threadsByFilePath.get("a.md"), [first, third]);
    assert.equal(indexes.threadByThreadId.get("thread-2"), second);
});

test("comment lookup indexes resolve child entries to their parent thread", () => {
    const thread = createThread("thread-1", "note.md", ["entry-1", "entry-2"]);

    const indexes = buildCommentLookupIndexes([thread]);

    assert.equal(indexes.threadByEntryId.get("entry-2"), thread);
    assert.deepEqual(indexes.entryById.get("entry-2"), {
        thread,
        entry: thread.entries[1],
    });
});
