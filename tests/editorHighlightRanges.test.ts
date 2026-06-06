import * as assert from "node:assert/strict";
import test from "node:test";
import type { Comment } from "../src/commentManager";
import { buildEditorHighlightRanges } from "../src/core/derived/editorHighlightRanges";

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
        ...overrides,
    };
}

test("buildEditorHighlightRanges highlights comments by stored coordinates", () => {
    const docText = "alpha beta gamma";
    const ranges = buildEditorHighlightRanges(
        docText,
        docText,
        [createComment()],
        null,
        "comment-1",
    );

    assert.deepEqual(ranges, [{
        commentId: "comment-1",
        from: 6,
        to: 10,
        active: true,
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
        "comment-1",
    );

    assert.deepEqual(ranges, [{
        commentId: "comment-1",
        from: 3,
        to: 8,
        active: true,
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
        "comment-1",
    );

    assert.deepEqual(ranges, [{
        commentId: "comment-1",
        from: 9,
        to: 13,
        active: true,
    }]);
});

test("buildEditorHighlightRanges resolves anchors when multiline anchor text collapses onto one line", () => {
    const docText = "# note\n\n## title title content\n";
    const ranges = buildEditorHighlightRanges(
        docText,
        docText,
        [createComment({
            startLine: 2,
            startChar: 0,
            endLine: 3,
            endChar: 13,
            selectedText: "## title\ntitle content",
        })],
        null,
        "comment-1",
    );

    assert.deepEqual(ranges, [{
        commentId: "comment-1",
        from: 8,
        to: 30,
        active: true,
    }]);
});

test("buildEditorHighlightRanges skips orphaned comments", () => {
    const docText = "alpha beta gamma";
    const ranges = buildEditorHighlightRanges(
        docText,
        docText,
        [createComment({ orphaned: true })],
        null,
        "comment-1",
    );

    assert.deepEqual(ranges, []);
});

test("buildEditorHighlightRanges skips page notes", () => {
    const docText = "alpha beta gamma";
    const ranges = buildEditorHighlightRanges(
        docText,
        docText,
        [createComment({
            anchorKind: "page",
            selectedText: "note",
            startChar: 0,
            endChar: 0,
        })],
        null,
        "comment-1",
    );

    assert.deepEqual(ranges, []);
});

test("buildEditorHighlightRanges keeps passive highlights without an active comment", () => {
    const docText = "alpha beta gamma";
    const ranges = buildEditorHighlightRanges(
        docText,
        docText,
        [createComment()],
        null,
        null,
    );

    assert.deepEqual(ranges, [{
        commentId: "comment-1",
        from: 6,
        to: 10,
        active: false,
    }]);
});

test("buildEditorHighlightRanges marks only the active anchored comment", () => {
    const docText = "alpha beta gamma delta";
    const ranges = buildEditorHighlightRanges(
        docText,
        docText,
        [
            createComment(),
            createComment({
                id: "comment-2",
                startChar: 17,
                endChar: 22,
                selectedText: "delta",
                selectedTextHash: "hash-2",
            }),
        ],
        null,
        "comment-2",
    );

    assert.deepEqual(ranges, [
        {
            commentId: "comment-1",
            from: 6,
            to: 10,
            active: false,
        },
        {
            commentId: "comment-2",
            from: 17,
            to: 22,
            active: true,
        },
    ]);
});
