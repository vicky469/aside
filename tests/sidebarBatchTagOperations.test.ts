import * as assert from "node:assert/strict";
import test from "node:test";
import { CommentManager, type CommentThread } from "../src/commentManager";
import {
    appendTagToCommentBody,
    applyBatchTagToThreads,
    persistBatchTagMutation,
    removeBatchTagFromThreads,
    removeTagFromCommentBody,
} from "../src/ui/views/sidebarBatchTagOperations";

function createThread(overrides: Partial<CommentThread> = {}): CommentThread {
    return {
        id: overrides.id ?? "thread-1",
        filePath: overrides.filePath ?? "docs/note.md",
        startLine: overrides.startLine ?? 4,
        startChar: overrides.startChar ?? 2,
        endLine: overrides.endLine ?? 4,
        endChar: overrides.endChar ?? 9,
        selectedText: overrides.selectedText ?? "selected text",
        selectedTextHash: overrides.selectedTextHash ?? "hash:selected",
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
        deletedAt: overrides.deletedAt,
        entries: overrides.entries ?? [
            { id: "thread-1", body: "Parent entry", timestamp: 100 },
            { id: "entry-2", body: "Child entry", timestamp: 200 },
        ],
        createdAt: overrides.createdAt ?? 100,
        updatedAt: overrides.updatedAt ?? 200,
    };
}

test("applyBatchTagToThreads treats an existing child tag as already tagged", () => {
    const manager = new CommentManager([
        createThread({
            entries: [
                { id: "thread-1", body: "Parent entry", timestamp: 100 },
                { id: "entry-2", body: "Child entry with #project", timestamp: 200 },
            ],
        }),
    ]);

    const result = applyBatchTagToThreads({
        filePath: "docs/note.md",
        selectedThreadIds: ["thread-1"],
        getThreadById: (threadId) => manager.getThreadById(threadId),
        editComment: (commentId, nextBody) => {
            manager.editComment(commentId, nextBody);
        },
        normalizedTagText: "#project",
    });

    assert.equal(result.hasMutations, false);
    assert.deepEqual(result.successfulIds, ["thread-1"]);
    assert.equal(manager.getThreadById("thread-1")?.entries[0]?.body, "Parent entry");
});

test("appendTagToCommentBody keeps added tags on one leading line", () => {
    assert.equal(
        appendTagToCommentBody("#project\nParent entry", "#todo"),
        "#project #todo\nParent entry",
    );
});

test("appendTagToCommentBody normalizes stacked leading tag lines when appending", () => {
    assert.equal(
        appendTagToCommentBody("#project\n#todo\nParent entry", "#later"),
        "#project #todo #later\nParent entry",
    );
});

test("applyBatchTagToThreads appends onto an existing leading tag line", () => {
    const manager = new CommentManager([
        createThread({
            entries: [
                { id: "thread-1", body: "#project\nParent entry", timestamp: 100 },
                { id: "entry-2", body: "Child entry", timestamp: 200 },
            ],
        }),
    ]);

    const result = applyBatchTagToThreads({
        filePath: "docs/note.md",
        selectedThreadIds: ["thread-1"],
        getThreadById: (threadId) => manager.getThreadById(threadId),
        editComment: (commentId, nextBody) => {
            manager.editComment(commentId, nextBody);
        },
        normalizedTagText: "#todo",
    });

    assert.equal(result.hasMutations, true);
    assert.equal(manager.getThreadById("thread-1")?.entries[0]?.body, "#project #todo\nParent entry");
});

test("removeTagFromCommentBody preserves unrelated spacing and indentation", () => {
    const commentBody = [
        "Intro paragraph.",
        "",
        "#todo",
        "",
        "-   keep   spacing",
        "\tindented line",
    ].join("\n");

    assert.equal(
        removeTagFromCommentBody(commentBody, "#todo"),
        [
            "Intro paragraph.",
            "",
            "-   keep   spacing",
            "\tindented line",
        ].join("\n"),
    );
});

test("removeBatchTagFromThreads removes tags from matching entries only", () => {
    const manager = new CommentManager([
        createThread({
            entries: [
                { id: "thread-1", body: "Parent entry", timestamp: 100 },
                { id: "entry-2", body: "Child entry with #project", timestamp: 200 },
            ],
        }),
    ]);

    const result = removeBatchTagFromThreads({
        filePath: "docs/note.md",
        selectedThreadIds: ["thread-1"],
        getThreadById: (threadId) => manager.getThreadById(threadId),
        editComment: (commentId, nextBody) => {
            manager.editComment(commentId, nextBody);
        },
        normalizedTagText: "#project",
        targetTagTextForNotice: "#project",
    });

    assert.equal(result.hasMutations, true);
    assert.equal(manager.getThreadById("thread-1")?.entries[0]?.body, "Parent entry");
    assert.equal(manager.getThreadById("thread-1")?.entries[1]?.body, "Child entry with");
});

test("persistBatchTagMutation rolls back manager state when persistence fails", async () => {
    const manager = new CommentManager([
        createThread({
            entries: [
                { id: "thread-1", body: "Parent entry", timestamp: 100 },
                { id: "entry-2", body: "Child entry", timestamp: 200 },
            ],
        }),
    ]);

    const result = await persistBatchTagMutation({
        filePath: "docs/note.md",
        selectedThreadIds: ["thread-1"],
        manager,
        mutate: () => applyBatchTagToThreads({
            filePath: "docs/note.md",
            selectedThreadIds: ["thread-1"],
            getThreadById: (threadId) => manager.getThreadById(threadId),
            editComment: (commentId, nextBody) => {
                manager.editComment(commentId, nextBody);
            },
            normalizedTagText: "#project",
        }),
        persist: async () => {
            throw new Error("disk full");
        },
    });

    assert.ok(result.persistError instanceof Error);
    assert.deepEqual(result.failedIds, ["thread-1"]);
    assert.equal(manager.getThreadById("thread-1")?.entries[0]?.body, "Parent entry");
});
