import * as assert from "node:assert/strict";
import test from "node:test";
import { CommentManager, commentToThread, threadToComment, type Comment, type CommentThread } from "../src/commentManager";
import {
    chooseCommentStateForOpenEditor,
    shouldDeferManagedCommentPersist,
    syncLoadedCommentsForCurrentNote,
} from "../src/core/rules/commentSyncPolicy";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: "comment-1",
        filePath: "note.md",
        startLine: 3,
        startChar: 4,
        endLine: 3,
        endChar: 9,
        selectedText: "alpha",
        selectedTextHash: "hash-alpha",
        comment: "hello",
        timestamp: 1710000000000,
        resolved: false,
        ...overrides,
    };
}

test("defer managed comment persistence while the markdown editor is focused", () => {
    assert.equal(
        shouldDeferManagedCommentPersist({
            isEditorFocused: true,
            fileContent: "Body\n",
            rewrittenContent: "Body\n\n<!-- Aside comments\n[]\n-->\n",
        }),
        true,
    );
});

test("allow managed comment persistence immediately when the editor is not focused", () => {
    assert.equal(
        shouldDeferManagedCommentPersist({
            isEditorFocused: false,
            fileContent: "Body\n",
            rewrittenContent: "Body\n\n<!-- Aside comments\n[]\n-->\n",
        }),
        false,
    );
});

test("prefer in-memory comments over parsed on-disk comments for the open editor", () => {
    const parsedComments = [createComment({ startLine: 1, startChar: 0, endLine: 1, endChar: 5 })];
    const liveComments = [createComment({ startLine: 8, startChar: 2, endLine: 8, endChar: 7 })];

    const chosen = chooseCommentStateForOpenEditor(liveComments, parsedComments);

    assert.deepEqual(chosen, liveComments);
});

test("fall back to parsed comments when no live in-memory comments exist yet", () => {
    const parsedComments = [createComment({ startLine: 1, startChar: 0, endLine: 1, endChar: 5 })];

    const chosen = chooseCommentStateForOpenEditor([], parsedComments);

    assert.deepEqual(chosen, parsedComments);
});

test("syncLoadedCommentsForCurrentNote re-resolves stale parsed coordinates before returning them", async () => {
    const manager = new CommentManager([]);
    let indexedFilePath = "";
    let indexedThreads: CommentThread[] = [];

    const syncedState = await syncLoadedCommentsForCurrentNote(
        "note.md",
        "preamble\nAlpha target omega\n",
        [commentToThread(createComment({
            startLine: 0,
            startChar: 6,
            endLine: 0,
            endChar: 12,
            selectedText: "target",
            selectedTextHash: "hash-target",
        }))],
        manager,
        {
            updateFile(filePath, items) {
                indexedFilePath = filePath;
                const threads = items as CommentThread[];
                indexedThreads = threads.map((thread) => ({
                    ...thread,
                    entries: thread.entries.map((entry) => ({ ...entry })),
                }));
            },
        },
    );

    assert.equal(syncedState.threads.length, 1);
    assert.equal(syncedState.comments.length, 1);
    assert.equal(syncedState.comments[0].startLine, 1);
    assert.equal(syncedState.comments[0].startChar, 6);
    assert.equal(syncedState.comments[0].endLine, 1);
    assert.equal(syncedState.comments[0].endChar, 12);

    const managerComments = manager.getCommentsForFile("note.md");
    assert.equal(managerComments.length, 1);
    assert.equal(managerComments[0].startLine, 1);

    assert.equal(indexedFilePath, "note.md");
    assert.equal(indexedThreads.length, 1);
    assert.equal(threadToComment(indexedThreads[0]).startLine, 1);
});
