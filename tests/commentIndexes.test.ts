import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment } from "../src/commentManager";
import { ParsedNoteCache } from "../src/cache/ParsedNoteCache";
import { AggregateCommentIndex } from "../src/index/AggregateCommentIndex";
import type { ParsedNoteComments } from "../src/core/storage/noteCommentStorage";

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
        const comment = createComment({ filePath, comment: `parsed-${parseCalls}` });
        return {
            mainContent: noteContent.toUpperCase(),
            comments: [comment],
            threads: [commentToThread(comment)],
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
    assert.equal(index.getCommentById("a-1")?.filePath, "a.md");

    index.renameFile("a.md", "renamed.md");
    const renamed = index.getAllComments();
    assert.equal(renamed.find((comment) => comment.id === "a-1")?.filePath, "renamed.md");
    assert.equal(index.getCommentById("a-1")?.filePath, "renamed.md");

    index.deleteFile("b.md");
    const remaining = index.getAllComments();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, "a-1");
    assert.equal(index.getCommentById("missing"), null);
});

test("AggregateCommentIndex deletes every cached file under a folder path", () => {
    const index = new AggregateCommentIndex();
    index.updateFile("Deleted/a.md", [createComment({ filePath: "Deleted/a.md", id: "deleted-a" })]);
    index.updateFile("Deleted/nested/b.md", [createComment({ filePath: "Deleted/nested/b.md", id: "deleted-b" })]);
    index.updateFile("Deletedness/c.md", [createComment({ filePath: "Deletedness/c.md", id: "keep-c" })]);
    index.updateFile("Other.md", [createComment({ filePath: "Other.md", id: "keep-other" })]);

    index.deleteFolder("Deleted");

    assert.deepEqual(
        index.getAllComments().map((comment) => comment.id).sort(),
        ["keep-c", "keep-other"],
    );
});

test("AggregateCommentIndex resolves child thread entries by id", () => {
    const index = new AggregateCommentIndex();
    const thread = commentToThread(createComment({ filePath: "a.md", id: "thread-1", comment: "parent" }));
    thread.entries.push({
        id: "entry-2",
        body: "child",
        timestamp: thread.updatedAt + 100,
    });

    index.updateFile("a.md", [thread]);

    assert.equal(index.getCommentById("thread-1")?.comment, "parent");
    assert.equal(index.getCommentById("entry-2")?.comment, "child");
    assert.equal(index.getThreadById("entry-2")?.id, "thread-1");
});

test("AggregateCommentIndex hides soft-deleted threads and child entries from sidebar queries", () => {
    const index = new AggregateCommentIndex();
    const baseTimestamp = Date.now();
    const activeThread = commentToThread(createComment({
        filePath: "a.md",
        id: "thread-1",
        comment: "parent",
        timestamp: baseTimestamp,
    }));
    activeThread.entries.push({
        id: "entry-2",
        body: "deleted child",
        timestamp: baseTimestamp + 1000,
        deletedAt: baseTimestamp + 2000,
    });

    const deletedThread = commentToThread(createComment({
        filePath: "a.md",
        id: "thread-2",
        comment: "deleted thread",
        timestamp: baseTimestamp + 3000,
        deletedAt: baseTimestamp + 4000,
    }));

    index.updateFile("a.md", [activeThread, deletedThread]);

    assert.deepEqual(
        index.getThreadsForFile("a.md").map((thread) => ({
            id: thread.id,
            entryIds: thread.entries.map((entry) => entry.id),
        })),
        [{
            id: "thread-1",
            entryIds: ["thread-1"],
        }],
    );
    assert.equal(index.getAllComments().length, 1);
    assert.equal(index.getCommentById("entry-2")?.deletedAt, baseTimestamp + 2000);
    assert.equal(index.getCommentById("thread-2")?.deletedAt, baseTimestamp + 4000);
});
