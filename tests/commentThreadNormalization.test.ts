import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import {
    cloneCommentThread,
    normalizeCommentThread,
} from "../src/domain/comments/commentThreadNormalization";

type LegacyResolvedCommentThread = CommentThread & { resolved: true };

function createLegacyResolvedThread(): LegacyResolvedCommentThread {
    return {
        id: "thread-1",
        filePath: "docs/note.md",
        startLine: 2,
        startChar: 3,
        endLine: 2,
        endChar: 9,
        selectedText: "target",
        selectedTextHash: "hash-target",
        anchorKind: "selection",
        orphaned: true,
        isPinned: true,
        deletedAt: 1710000000300,
        entries: [{
            id: "entry-1",
            body: "hello",
            timestamp: 1710000000000,
            deletedAt: 1710000000200,
            anchor: {
                filePath: "docs/note.md",
                startLine: 2,
                startChar: 3,
                endLine: 2,
                endChar: 9,
                selectedText: "target",
                selectedTextHash: "hash-target",
                anchorKind: "selection",
                orphaned: true,
            },
        }],
        createdAt: 1710000000000,
        updatedAt: 1710000000100,
        resolved: true,
    };
}

function assertDefinedThreadFieldsPreserved(
    actual: CommentThread,
    legacyThread: LegacyResolvedCommentThread,
): void {
    assert.deepEqual(actual, {
        id: legacyThread.id,
        filePath: legacyThread.filePath,
        startLine: legacyThread.startLine,
        startChar: legacyThread.startChar,
        endLine: legacyThread.endLine,
        endChar: legacyThread.endChar,
        selectedText: legacyThread.selectedText,
        selectedTextHash: legacyThread.selectedTextHash,
        anchorKind: legacyThread.anchorKind,
        orphaned: legacyThread.orphaned,
        isPinned: legacyThread.isPinned,
        deletedAt: legacyThread.deletedAt,
        entries: legacyThread.entries,
        createdAt: legacyThread.createdAt,
        updatedAt: legacyThread.updatedAt,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(actual, "resolved"), false);
}

test("cloneCommentThread strips runtime-only legacy resolution state without mutating input", () => {
    const legacyThread = createLegacyResolvedThread();

    const cloned = cloneCommentThread(legacyThread);

    assertDefinedThreadFieldsPreserved(cloned, legacyThread);
    assert.deepEqual(legacyThread, createLegacyResolvedThread());
});

test("normalizeCommentThread strips runtime-only legacy resolution state without mutating input", () => {
    const legacyThread = createLegacyResolvedThread();

    const normalized = normalizeCommentThread(legacyThread);

    assertDefinedThreadFieldsPreserved(normalized, legacyThread);
    assert.deepEqual(legacyThread, createLegacyResolvedThread());
});
