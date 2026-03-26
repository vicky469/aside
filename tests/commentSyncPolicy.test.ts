import * as assert from "node:assert/strict";
import test from "node:test";
import { CommentManager, type Comment } from "../src/commentManager";
import {
    chooseCommentStateForOpenEditor,
    shouldDeferManagedCommentPersist,
    syncLoadedCommentsForCurrentNote,
} from "../src/core/commentSyncPolicy";

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
            rewrittenContent: "Body\n\n<!-- SideNote2 comments\n[]\n-->\n",
        }),
        true,
    );
});

test("allow managed comment persistence immediately when the editor is not focused", () => {
    assert.equal(
        shouldDeferManagedCommentPersist({
            isEditorFocused: false,
            fileContent: "Body\n",
            rewrittenContent: "Body\n\n<!-- SideNote2 comments\n[]\n-->\n",
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
    let indexedComments: Comment[] = [];

    const syncedComments = await syncLoadedCommentsForCurrentNote(
        "note.md",
        "preamble\nAlpha target omega\n",
        [createComment({
            startLine: 0,
            startChar: 6,
            endLine: 0,
            endChar: 12,
            selectedText: "target",
            selectedTextHash: "hash-target",
        })],
        manager,
        {
            updateFile(filePath, comments) {
                indexedFilePath = filePath;
                indexedComments = comments.map((comment) => ({ ...comment }));
            },
        },
    );

    assert.equal(syncedComments.length, 1);
    assert.equal(syncedComments[0].startLine, 1);
    assert.equal(syncedComments[0].startChar, 6);
    assert.equal(syncedComments[0].endLine, 1);
    assert.equal(syncedComments[0].endChar, 12);

    const managerComments = manager.getCommentsForFile("note.md");
    assert.equal(managerComments.length, 1);
    assert.equal(managerComments[0].startLine, 1);

    assert.equal(indexedFilePath, "note.md");
    assert.equal(indexedComments.length, 1);
    assert.equal(indexedComments[0].startLine, 1);
});
