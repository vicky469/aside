import * as assert from "node:assert/strict";
import test from "node:test";
import { pickExactTextMatch, resolveAnchorRange } from "../src/core/anchorResolver";
import type { Comment } from "../src/commentManager";
import { CommentManager } from "../src/commentManager";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: "comment-1",
        filePath: "note.md",
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 6,
        selectedText: "target",
        selectedTextHash: "hash-target",
        comment: "note",
        timestamp: 1710000000000,
        resolved: false,
        ...overrides,
    };
}

test("resolveAnchorRange re-matches the nearest repeated occurrence by stored position", () => {
    const updatedText = "target\ninserted\nmiddle\ntarget\n";

    const resolved = resolveAnchorRange(updatedText, {
        startLine: 2,
        startChar: 0,
        endLine: 2,
        endChar: 6,
        selectedText: "target",
    });

    assert.ok(resolved);
    assert.equal(resolved.startLine, 3);
    assert.equal(resolved.startChar, 0);
    assert.equal(resolved.occurrenceIndex, 1);
});

test("pickExactTextMatch can follow a stored occurrence index in preview text", () => {
    const match = pickExactTextMatch("target and target", "target", {
        occurrenceIndex: 1,
        hintOffset: 0,
    });

    assert.ok(match);
    assert.equal(match.startOffset, 11);
    assert.equal(match.endOffset, 17);
});

test("CommentManager preserves multiline anchors after note edits", async () => {
    const manager = new CommentManager([
        createComment({
            selectedText: "ha\nbe",
            startLine: 0,
            startChar: 3,
            endLine: 1,
            endChar: 2,
        }),
    ]);

    await manager.updateCommentCoordinatesForFile("intro\nalpha\nbeta\ngamma\n", "note.md");

    const comments = manager.getCommentsForFile("note.md");
    assert.equal(comments.length, 1);
    assert.equal(comments[0].startLine, 1);
    assert.equal(comments[0].startChar, 3);
    assert.equal(comments[0].endLine, 2);
    assert.equal(comments[0].endChar, 2);
    assert.equal(comments[0].selectedText, "ha\nbe");
});
