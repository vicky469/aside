import * as assert from "node:assert/strict";
import test from "node:test";
import type { Comment } from "../src/commentManager";
import { AggregateCommentIndex, ParsedNoteCache } from "../src/core/commentIndexes";
import type { ParsedNoteComments } from "../src/core/noteCommentStorage";

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
        resolved: false,
        ...overrides,
    };
}

test("ParsedNoteCache reuses parsed output for unchanged content and evicts oldest entries", () => {
    const cache = new ParsedNoteCache(2);
    let parseCalls = 0;
    const parse = (noteContent: string, filePath: string): ParsedNoteComments => {
        parseCalls += 1;
        return {
            mainContent: noteContent.toUpperCase(),
            comments: [createComment({ filePath, comment: `parsed-${parseCalls}` })],
        };
    };

    const first = cache.getOrParse("a.md", "alpha", parse);
    const second = cache.getOrParse("a.md", "alpha", parse);
    assert.equal(parseCalls, 1);
    assert.equal(first.mainContent, "ALPHA");
    assert.equal(second.comments[0].comment, "parsed-1");

    second.comments[0].comment = "mutated";
    const third = cache.getOrParse("a.md", "alpha", parse);
    assert.equal(third.comments[0].comment, "parsed-1");

    cache.getOrParse("b.md", "beta", parse);
    cache.getOrParse("c.md", "gamma", parse);
    cache.getOrParse("a.md", "alpha", parse);
    assert.equal(parseCalls, 4);
});

test("AggregateCommentIndex updates, renames, deletes, and returns cloned comments", () => {
    const index = new AggregateCommentIndex();
    index.updateFile("a.md", [createComment({ filePath: "a.md", id: "a-1" })]);
    index.updateFile("b.md", [createComment({ filePath: "b.md", id: "b-1", resolved: true })]);

    const initial = index.getAllComments();
    assert.equal(initial.length, 2);
    initial[0].comment = "mutated";

    const fresh = index.getAllComments();
    assert.equal(fresh.find((comment) => comment.id === "a-1")?.comment, "This is a side note.");

    index.renameFile("a.md", "renamed.md");
    const renamed = index.getAllComments();
    assert.equal(renamed.find((comment) => comment.id === "a-1")?.filePath, "renamed.md");

    index.deleteFile("b.md");
    const remaining = index.getAllComments();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, "a-1");
});
