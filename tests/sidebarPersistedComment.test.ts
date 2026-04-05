import * as assert from "node:assert/strict";
import test from "node:test";
import type { Comment } from "../src/commentManager";
import { buildPersistedCommentPresentation } from "../src/ui/views/sidebarPersistedComment";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        startLine: overrides.startLine ?? 8,
        startChar: overrides.startChar ?? 2,
        endLine: overrides.endLine ?? 8,
        endChar: overrides.endChar ?? 9,
        selectedText: overrides.selectedText ?? "comment",
        selectedTextHash: overrides.selectedTextHash ?? "hash:comment",
        comment: overrides.comment ?? "Comment body",
        timestamp: overrides.timestamp ?? 100,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
    };
}

test("buildPersistedCommentPresentation includes page and active classes for page notes", () => {
    const presentation = buildPersistedCommentPresentation(createComment({
        id: "comment-2",
        anchorKind: "page",
        resolved: true,
    }), "comment-2");

    assert.deepEqual(presentation.classes, [
        "sidenote2-comment-item",
        "page-note",
        "resolved",
        "active",
    ]);
});

test("buildPersistedCommentPresentation includes orphaned class for orphaned selection comments", () => {
    const presentation = buildPersistedCommentPresentation(createComment({
        orphaned: true,
    }), null);

    assert.deepEqual(presentation.classes, [
        "sidenote2-comment-item",
        "orphaned",
    ]);
});

test("buildPersistedCommentPresentation chooses the right resolve action copy and icon", () => {
    const unresolved = buildPersistedCommentPresentation(createComment({ resolved: false }), null);
    const resolved = buildPersistedCommentPresentation(createComment({ resolved: true }), null);

    assert.deepEqual(unresolved.redirectHint, {
        title: "Open source note",
        icon: "arrow-up-right",
    });
    assert.deepEqual(unresolved.resolveAction, {
        ariaLabel: "Resolve side note",
        title: "Resolve side note",
        icon: "check",
    });
    assert.deepEqual(resolved.resolveAction, {
        ariaLabel: "Reopen side note",
        title: "Reopen side note",
        icon: "rotate-ccw",
    });
});
