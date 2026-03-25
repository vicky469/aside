import * as assert from "node:assert/strict";
import test from "node:test";
import { Comment, CommentManager } from "../src/commentManager";

function createComment(id: string, timestamp: number, text: string): Comment {
    return {
        id,
        filePath: "note.md",
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 5,
        selectedText: "hello",
        selectedTextHash: "hash",
        comment: text,
        timestamp,
        resolved: false,
    };
}

test("CommentManager edits/deletes/resolves by id under timestamp collision", () => {
    const sameTimestamp = 1710000000000;
    const first = createComment("id-1", sameTimestamp, "first");
    const second = createComment("id-2", sameTimestamp, "second");

    const manager = new CommentManager([first, second]);

    manager.editComment("id-2", "second-updated");
    assert.equal(first.comment, "first");
    assert.equal(second.comment, "second-updated");

    manager.resolveComment("id-1");
    assert.equal(first.resolved, true);
    assert.equal(second.resolved, false);

    manager.unresolveComment("id-1");
    assert.equal(first.resolved, false);

    manager.deleteComment("id-1");
    const remaining = manager.getCommentsForFile("note.md");
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, "id-2");
});

test("CommentManager removes a comment when its anchor text is gone", async () => {
    const manager = new CommentManager([
        createComment("id-1", 1710000000000, "first"),
    ]);

    await manager.updateCommentCoordinatesForFile("goodbye", "note.md");

    assert.equal(manager.getCommentsForFile("note.md").length, 0);
});
