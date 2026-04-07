import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment } from "../src/commentManager";
import {
    getResolvedVisibilityForCommentSelection,
    shouldEnableResolvedVisibilityForComment,
    shouldExpandChildCommentsForSelection,
} from "../src/control/commentSelectionVisibility";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        startLine: overrides.startLine ?? 5,
        startChar: overrides.startChar ?? 1,
        endLine: overrides.endLine ?? 5,
        endChar: overrides.endChar ?? 8,
        selectedText: overrides.selectedText ?? "comment",
        selectedTextHash: overrides.selectedTextHash ?? "hash:comment",
        comment: overrides.comment ?? "Comment body",
        timestamp: overrides.timestamp ?? 100,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
    };
}

test("shouldEnableResolvedVisibilityForComment enables resolved mode for a targeted resolved comment", () => {
    assert.equal(
        shouldEnableResolvedVisibilityForComment(createComment({ resolved: true }), false),
        true,
    );
    assert.equal(
        shouldEnableResolvedVisibilityForComment(createComment({ resolved: true }), true),
        false,
    );
    assert.equal(
        shouldEnableResolvedVisibilityForComment(createComment({ resolved: false }), false),
        false,
    );
    assert.equal(shouldEnableResolvedVisibilityForComment(null, false), false);
});

test("getResolvedVisibilityForCommentSelection switches between active and resolved-only modes for the selected comment", () => {
    assert.equal(
        getResolvedVisibilityForCommentSelection(createComment({ resolved: true }), false),
        true,
    );
    assert.equal(
        getResolvedVisibilityForCommentSelection(createComment({ resolved: false }), true),
        false,
    );
    assert.equal(
        getResolvedVisibilityForCommentSelection(createComment({ resolved: false }), false),
        null,
    );
    assert.equal(
        getResolvedVisibilityForCommentSelection(createComment({ resolved: true }), true),
        null,
    );
    assert.equal(getResolvedVisibilityForCommentSelection(null, true), null);
});

test("shouldExpandChildCommentsForSelection expands a thread only when the targeted comment is a child entry", () => {
    const rootComment = createComment({ id: "thread-1" });
    const thread = commentToThread(rootComment);
    thread.entries.push({
        id: "reply-1",
        body: "Reply body",
        timestamp: 101,
    });

    assert.equal(shouldExpandChildCommentsForSelection(thread, "reply-1"), true);
    assert.equal(shouldExpandChildCommentsForSelection(thread, "thread-1"), false);
    assert.equal(shouldExpandChildCommentsForSelection(commentToThread(rootComment), "thread-1"), false);
    assert.equal(shouldExpandChildCommentsForSelection(null, "reply-1"), false);
});
