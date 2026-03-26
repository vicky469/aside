import * as assert from "node:assert/strict";
import test from "node:test";
import type { Comment } from "../src/commentManager";
import { chooseCommentStateForOpenEditor, shouldDeferManagedCommentPersist } from "../src/core/commentSyncPolicy";

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
