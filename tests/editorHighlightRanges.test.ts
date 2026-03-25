import * as assert from "node:assert/strict";
import test from "node:test";
import type { Comment } from "../src/commentManager";
import { buildEditorHighlightRanges } from "../src/core/editorHighlightRanges";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: "comment-1",
        filePath: "note.md",
        startLine: 0,
        startChar: 6,
        endLine: 0,
        endChar: 10,
        selectedText: "beta",
        selectedTextHash: "hash-1",
        comment: "hello",
        timestamp: 1710000000000,
        resolved: false,
        ...overrides,
    };
}

test("buildEditorHighlightRanges highlights unresolved comments by stored coordinates", () => {
    const docText = "alpha beta gamma";
    const ranges = buildEditorHighlightRanges(
        docText,
        docText,
        [createComment()],
        null,
        false,
    );

    assert.deepEqual(ranges, [{
        commentId: "comment-1",
        from: 6,
        to: 10,
        resolved: false,
    }]);
});

test("buildEditorHighlightRanges hides resolved comments when showResolved is off", () => {
    const docText = "alpha beta gamma";
    const ranges = buildEditorHighlightRanges(
        docText,
        docText,
        [createComment({ resolved: true })],
        null,
        false,
    );

    assert.deepEqual(ranges, []);
});

test("buildEditorHighlightRanges includes resolved comments when showResolved is on", () => {
    const docText = "alpha beta gamma";
    const ranges = buildEditorHighlightRanges(
        docText,
        docText,
        [createComment({ resolved: true })],
        null,
        true,
    );

    assert.deepEqual(ranges, [{
        commentId: "comment-1",
        from: 6,
        to: 10,
        resolved: true,
    }]);
});

test("buildEditorHighlightRanges supports multiline anchors", () => {
    const docText = "alpha\nbeta\ngamma";
    const ranges = buildEditorHighlightRanges(
        docText,
        docText,
        [createComment({
            startLine: 0,
            startChar: 3,
            endLine: 1,
            endChar: 2,
            selectedText: "ha\nbe",
        })],
        null,
        false,
    );

    assert.deepEqual(ranges, [{
        commentId: "comment-1",
        from: 3,
        to: 8,
        resolved: false,
    }]);
});

test("buildEditorHighlightRanges falls back to the nearest matching occurrence", () => {
    const docText = "beta one beta";
    const ranges = buildEditorHighlightRanges(
        docText,
        docText,
        [createComment({
            startChar: 10,
            endChar: 14,
            selectedText: "beta",
        })],
        null,
        false,
    );

    assert.deepEqual(ranges, [{
        commentId: "comment-1",
        from: 9,
        to: 13,
        resolved: false,
    }]);
});
