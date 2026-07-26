import * as assert from "node:assert/strict";
import test from "node:test";
import {
    cloneCommentThread,
    commentToThread,
    normalizeCommentThread,
    threadEntryToComment,
    threadToComment,
    type Comment,
    type CommentThread,
} from "../src/commentManager";

const remoteAuthor = {
    provider: "google",
    identity: "alice@example.com",
    displayName: "Alice",
};

function createThread(overrides: Partial<CommentThread> = {}): CommentThread {
    return {
        id: "thread-1",
        filePath: "docs/page.md",
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 0,
        selectedText: "",
        selectedTextHash: "",
        anchorKind: "page",
        entries: [{
            id: "entry-1",
            body: "Remote note",
            timestamp: 1710000000000,
            author: remoteAuthor,
        }],
        createdAt: 1710000000000,
        updatedAt: 1710000000000,
        ...overrides,
    };
}

test("comment entry author metadata survives normalization, cloning, and projection", () => {
    const thread = createThread();

    assert.deepEqual(normalizeCommentThread(thread).entries[0].author, remoteAuthor);
    assert.deepEqual(cloneCommentThread(thread).entries[0].author, remoteAuthor);
    assert.deepEqual(threadEntryToComment(thread, thread.entries[0]).author, remoteAuthor);
    assert.deepEqual(threadToComment(thread).author, remoteAuthor);
});

test("legacy comment projection keeps missing authors as current-user entries", () => {
    const comment: Comment = {
        id: "entry-1",
        filePath: "docs/page.md",
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 0,
        selectedText: "",
        selectedTextHash: "",
        comment: "Local note",
        timestamp: 1710000000000,
        anchorKind: "page",
    };

    assert.equal(commentToThread(comment).entries[0].author, undefined);
});

test("commentToThread preserves explicit author metadata from projected comments", () => {
    const comment = {
        id: "entry-1",
        filePath: "docs/page.md",
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 0,
        selectedText: "",
        selectedTextHash: "",
        comment: "Remote note",
        timestamp: 1710000000000,
        anchorKind: "page" as const,
        author: remoteAuthor,
    };

    assert.deepEqual(commentToThread(comment).entries[0].author, remoteAuthor);
});
