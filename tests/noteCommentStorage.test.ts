import * as assert from "node:assert/strict";
import test from "node:test";
import type { Comment } from "../src/commentManager";
import {
    getVisibleNoteContent,
    parseNoteComments,
    sortCommentsByPosition,
} from "../src/core/storage/noteCommentStorage";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: "comment-1",
        filePath: "note.md",
        startLine: 1,
        startChar: 2,
        endLine: 1,
        endChar: 7,
        selectedText: "hello",
        selectedTextHash: "hash-1",
        comment: "This is a side note.",
        timestamp: 1710000000000,
        ...overrides,
    };
}

test("parseNoteComments treats source markdown as note content only", () => {
    const parsed = parseNoteComments("# Title\r\n\r\nBody\r\n", "note.md");

    assert.equal(parsed.mainContent, "# Title\n\nBody");
    assert.deepEqual(parsed.comments, []);
    assert.deepEqual(parsed.threads, []);
});

test("source note helpers expose visible markdown without storage metadata", () => {
    const noteContent = "# Title\n\nBody";

    assert.equal(getVisibleNoteContent(noteContent), noteContent);
});

test("sortCommentsByPosition orders by anchor position then timestamp", () => {
    const comments = [
        createComment({ id: "late", startLine: 2, startChar: 3, timestamp: 3 }),
        createComment({ id: "second", startLine: 1, startChar: 4, timestamp: 2 }),
        createComment({ id: "first", startLine: 1, startChar: 4, timestamp: 1 }),
        createComment({ id: "earliest-position", startLine: 0, startChar: 9, timestamp: 4 }),
    ];

    assert.deepEqual(
        sortCommentsByPosition(comments).map((comment) => comment.id),
        ["earliest-position", "first", "second", "late"],
    );
});
