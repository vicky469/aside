import * as assert from "node:assert/strict";
import test from "node:test";
import { Comment, CommentManager, commentToThread } from "../src/commentManager";

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
    const sameTimestamp = Date.now();
    const first = createComment("id-1", sameTimestamp, "first");
    const second = createComment("id-2", sameTimestamp, "second");

    const manager = new CommentManager([first, second]);

    manager.editComment("id-2", "second-updated");
    let comments = manager.getCommentsForFile("note.md");
    assert.equal(comments.find((comment) => comment.id === "id-1")?.comment, "first");
    assert.equal(comments.find((comment) => comment.id === "id-2")?.comment, "second-updated");

    manager.resolveComment("id-1");
    comments = manager.getCommentsForFile("note.md");
    assert.equal(comments.find((comment) => comment.id === "id-1")?.resolved, true);
    assert.equal(comments.find((comment) => comment.id === "id-2")?.resolved, false);

    manager.unresolveComment("id-1");
    comments = manager.getCommentsForFile("note.md");
    assert.equal(comments.find((comment) => comment.id === "id-1")?.resolved, false);

    manager.deleteComment("id-1", sameTimestamp + 5);
    const remaining = manager.getCommentsForFile("note.md");
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, "id-2");
    assert.equal(manager.getCommentById("id-1")?.deletedAt, sameTimestamp + 5);
});

test("CommentManager targets child thread entries by id", () => {
    const baseTimestamp = Date.now();
    const thread = commentToThread(createComment("thread-1", baseTimestamp, "parent"));
    thread.entries.push({
        id: "entry-2",
        body: "child",
        timestamp: baseTimestamp + 1000,
    });

    const manager = new CommentManager([thread]);

    assert.equal(manager.getCommentById("thread-1")?.comment, "parent");
    assert.equal(manager.getCommentById("entry-2")?.comment, "child");

    manager.editComment("entry-2", "child-updated");
    assert.equal(manager.getCommentById("entry-2")?.comment, "child-updated");

    manager.appendEntry("entry-2", {
        id: "entry-3",
        body: "grandchild",
        timestamp: baseTimestamp + 2000,
    });
    assert.equal(manager.getCommentById("entry-3")?.comment, "grandchild");

    manager.deleteComment("entry-2", baseTimestamp + 3000);
    assert.equal(manager.getCommentById("entry-2")?.deletedAt, baseTimestamp + 3000);
    assert.equal(manager.getThreadById("entry-3")?.entries.length, 3);
    assert.deepEqual(
        manager.getThreadsForFile("note.md")[0]?.entries.map((entry) => entry.id),
        ["thread-1", "entry-3"],
    );
});

test("CommentManager can permanently clear soft-deleted comments for one file", () => {
    const baseTimestamp = Date.now();
    const activeThread = commentToThread(createComment("thread-1", baseTimestamp, "parent"));
    activeThread.entries.push({
        id: "entry-2",
        body: "deleted child",
        timestamp: baseTimestamp + 1000,
        deletedAt: baseTimestamp + 2000,
    });

    const deletedThread = {
        ...commentToThread(createComment("thread-2", baseTimestamp + 3000, "deleted thread")),
        deletedAt: baseTimestamp + 4000,
    };

    const otherFileThread = {
        ...commentToThread(createComment("thread-3", baseTimestamp + 5000, "other file")),
        filePath: "other.md",
    };

    const manager = new CommentManager([activeThread, deletedThread, otherFileThread]);

    assert.equal(manager.clearDeletedCommentsForFile("note.md", baseTimestamp + 6000), true);
    assert.deepEqual(
        manager.getThreadsForFile("note.md", { includeDeleted: true }).map((thread) => ({
            id: thread.id,
            entryIds: thread.entries.map((entry) => entry.id),
        })),
        [{
            id: "thread-1",
            entryIds: ["thread-1"],
        }],
    );
    assert.equal(manager.getThreadById("thread-2"), undefined);
    assert.equal(manager.getThreadById("thread-3")?.filePath, "other.md");
    assert.equal(manager.clearDeletedCommentsForFile("note.md", baseTimestamp + 7000), false);
});

test("CommentManager reorders root threads within the same file", () => {
    const first = createComment("thread-1", 1710000000000, "first");
    const second = createComment("thread-2", 1710000001000, "second");
    const third = createComment("thread-3", 1710000002000, "third");
    const manager = new CommentManager([first, second, third]);

    assert.equal(manager.reorderThreadsForFile("note.md", "thread-3", "thread-1", "before"), true);
    assert.deepEqual(
        manager.getThreadsForFile("note.md").map((thread) => thread.id),
        ["thread-3", "thread-1", "thread-2"],
    );

    assert.equal(manager.reorderThreadsForFile("note.md", "thread-3", "thread-2", "after"), true);
    assert.deepEqual(
        manager.getThreadsForFile("note.md").map((thread) => thread.id),
        ["thread-1", "thread-2", "thread-3"],
    );

    assert.equal(manager.reorderThreadsForFile("note.md", "thread-3", "thread-3", "before"), false);
});

test("CommentManager reorders child entries only within their parent thread", () => {
    const thread = commentToThread(createComment("thread-1", 1710000000000, "parent"));
    thread.entries.push({
        id: "entry-2",
        body: "second",
        timestamp: 1710000001000,
    });
    thread.entries.push({
        id: "entry-3",
        body: "third",
        timestamp: 1710000002000,
    });
    thread.entries.push({
        id: "entry-4",
        body: "fourth",
        timestamp: 1710000003000,
    });

    const manager = new CommentManager([thread]);

    assert.equal(manager.reorderThreadEntries("thread-1", "entry-4", "entry-2", "before"), true);
    assert.deepEqual(
        manager.getThreadById("thread-1")?.entries.map((entry) => entry.id),
        ["thread-1", "entry-4", "entry-2", "entry-3"],
    );

    assert.equal(manager.reorderThreadEntries("thread-1", "entry-3", "thread-1", "after"), true);
    assert.deepEqual(
        manager.getThreadById("thread-1")?.entries.map((entry) => entry.id),
        ["thread-1", "entry-3", "entry-4", "entry-2"],
    );

    assert.equal(manager.reorderThreadEntries("thread-1", "thread-1", "entry-2", "before"), false);
    assert.equal(manager.reorderThreadEntries("thread-1", "entry-4", "thread-1", "before"), false);
});

test("CommentManager keeps id and file lookups current after replacement and rename", () => {
    const manager = new CommentManager([
        createComment("old-thread", 1710000000000, "old"),
    ]);
    const nextThread = commentToThread(createComment("new-thread", 1710000001000, "new"));
    nextThread.entries.push({
        id: "new-child",
        body: "child",
        timestamp: 1710000002000,
    });

    manager.replaceThreadsForFile("note.md", [nextThread]);
    assert.equal(manager.getThreadById("old-thread"), undefined);
    assert.equal(manager.getCommentById("new-child")?.comment, "child");

    manager.renameFile("note.md", "renamed.md");
    assert.equal(manager.getThreadsForFile("note.md").length, 0);
    assert.equal(manager.getThreadById("new-child")?.filePath, "renamed.md");
    assert.deepEqual(
        manager.getThreadsForFile("renamed.md").map((thread) => thread.id),
        ["new-thread"],
    );
});

test("CommentManager preserves a comment when its anchor text is gone", async () => {
    const manager = new CommentManager([
        createComment("id-1", 1710000000000, "first"),
    ]);

    await manager.updateCommentCoordinatesForFile("goodbye", "note.md");

    const remaining = manager.getCommentsForFile("note.md");
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, "id-1");
    assert.equal(remaining[0].selectedText, "hello");
    assert.equal(remaining[0].orphaned, true);
});

test("CommentManager clears orphaned when the anchor text returns", async () => {
    const manager = new CommentManager([
        {
            ...createComment("id-1", 1710000000000, "first"),
            orphaned: true,
        },
    ]);

    await manager.updateCommentCoordinatesForFile("hello again", "note.md");

    const remaining = manager.getCommentsForFile("note.md");
    assert.equal(remaining[0].orphaned, false);
});
