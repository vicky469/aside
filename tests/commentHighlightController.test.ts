import * as assert from "node:assert/strict";
import test from "node:test";
import type { Comment } from "../src/commentManager";
import { findClickedHighlightCommentId } from "../src/comments/commentHighlightClickTarget";
import {
    findClickedIndexLivePreviewTarget,
    isIndexNativeCollapseControlTarget,
} from "../src/comments/commentIndexClickTarget";
import { buildPreviewHighlightWraps } from "../src/comments/commentHighlightPlanner";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: "comment-1",
        filePath: "note.md",
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 4,
        selectedText: "beta",
        selectedTextHash: "hash-beta",
        comment: "note",
        timestamp: 1710000000000,
        resolved: false,
        ...overrides,
    };
}

test("buildPreviewHighlightWraps follows the source occurrence when rendered text repeats", () => {
    const wraps = buildPreviewHighlightWraps(
        "beta one beta",
        0,
        "beta one beta",
        [createComment({
            startChar: 9,
            endChar: 13,
            selectedText: "beta",
        })],
    );

    assert.equal(wraps.length, 1);
    assert.equal(wraps[0].start, 9);
    assert.equal(wraps[0].end, 13);
    assert.equal(wraps[0].comment.id, "comment-1");
});

test("buildPreviewHighlightWraps respects section line offsets for later lines", () => {
    const wraps = buildPreviewHighlightWraps(
        "alpha beta\nsecond beta",
        10,
        "alpha beta\nsecond beta",
        [createComment({
            id: "comment-2",
            startLine: 11,
            startChar: 7,
            endLine: 11,
            endChar: 11,
            selectedText: "beta",
        })],
    );

    assert.equal(wraps.length, 1);
    assert.equal(wraps[0].start, 18);
    assert.equal(wraps[0].end, 22);
    assert.equal(wraps[0].comment.id, "comment-2");
});

test("findClickedHighlightCommentId returns the clicked highlight comment id", () => {
    const target = {
        closest: (selector: string) => {
            assert.equal(selector, ".sidenote2-highlight");
            return {
                getAttribute: (name: string) => {
                    assert.equal(name, "data-comment-id");
                    return "comment-7";
                },
            };
        },
    };

    assert.equal(findClickedHighlightCommentId(target), "comment-7");
});

test("findClickedHighlightCommentId returns null when the target is not inside a highlight", () => {
    const target = {
        closest: () => null,
    };

    assert.equal(findClickedHighlightCommentId(target), null);
    assert.equal(findClickedHighlightCommentId(null), null);
});

test("findClickedIndexLivePreviewTarget resolves comment links from live preview DOM", () => {
    const target = {
        closest: (selector: string) => {
            if (selector === "a.sidenote2-index-comment-link[data-sidenote2-comment-url]") {
                return {
                    dataset: {
                        sidenote2CommentUrl: "obsidian://side-note2-comment?vault=public&file=books%2FNote.md&commentId=comment-7",
                    },
                    getAttribute: () => null,
                };
            }

            return null;
        },
    };

    assert.deepEqual(findClickedIndexLivePreviewTarget(target), {
        kind: "comment",
        filePath: "books/Note.md",
        commentId: "comment-7",
    });
});

test("findClickedIndexLivePreviewTarget resolves file headings from live preview DOM", () => {
    const target = {
        closest: (selector: string) => {
            if (selector === "a.sidenote2-index-comment-link[data-sidenote2-comment-url]") {
                return null;
            }
            if (selector === ".sidenote2-index-heading-label[title]") {
                return {
                    dataset: {},
                    getAttribute: (name: string) => {
                        assert.equal(name, "title");
                        return "books/Note.md";
                    },
                };
            }

            return null;
        },
    };

    assert.deepEqual(findClickedIndexLivePreviewTarget(target), {
        kind: "file",
        filePath: "books/Note.md",
    });
});

test("findClickedIndexLivePreviewTarget leaves native collapse controls alone", () => {
    const target = {
        closest: (selector: string) => {
            if (selector.includes(".collapse-indicator")) {
                return {
                    dataset: {},
                    getAttribute: () => null,
                };
            }
            if (selector === "a.sidenote2-index-comment-link[data-sidenote2-comment-url]") {
                return {
                    dataset: {
                        sidenote2CommentUrl: "obsidian://side-note2-comment?vault=public&file=books%2FNote.md&commentId=comment-7",
                    },
                    getAttribute: () => null,
                };
            }

            return null;
        },
    };

    assert.equal(isIndexNativeCollapseControlTarget(target), true);
    assert.equal(findClickedIndexLivePreviewTarget(target), null);
});

test("findClickedIndexLivePreviewTarget returns null for non-index elements", () => {
    const target = {
        closest: () => null,
    };

    assert.equal(findClickedIndexLivePreviewTarget(target), null);
    assert.equal(findClickedIndexLivePreviewTarget(null), null);
});
