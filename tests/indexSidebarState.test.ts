import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment } from "../src/commentManager";
import {
    scopeIndexThreadsByFilePaths,
    shouldShowResolvedIndexEmptyState,
    shouldShowResolvedToolbarChip,
} from "../src/ui/views/indexSidebarState";

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

test("scopeIndexThreadsByFilePaths keeps all threads when no file filter is selected", () => {
    const visibleThreads = [
        commentToThread(createComment({ id: "a", filePath: "docs/a.md" })),
        commentToThread(createComment({ id: "b", filePath: "docs/b.md" })),
    ];
    const allThreads = visibleThreads.concat([
        commentToThread(createComment({ id: "c", filePath: "docs/c.md", resolved: true })),
    ]);

    const scoped = scopeIndexThreadsByFilePaths(visibleThreads, allThreads, []);

    assert.deepEqual(scoped.scopedVisibleThreads.map((thread) => thread.id), ["a", "b"]);
    assert.deepEqual(scoped.scopedAllThreads.map((thread) => thread.id), ["a", "b", "c"]);
});

test("scopeIndexThreadsByFilePaths filters both visible and total threads by the selected file scope", () => {
    const visibleThreads = [
        commentToThread(createComment({ id: "a", filePath: "docs/a.md" })),
        commentToThread(createComment({ id: "b", filePath: "docs/b.md" })),
    ];
    const allThreads = visibleThreads.concat([
        commentToThread(createComment({ id: "c", filePath: "docs/c.md", resolved: true })),
    ]);

    const scoped = scopeIndexThreadsByFilePaths(visibleThreads, allThreads, ["docs/b.md", "docs/c.md"]);

    assert.deepEqual(scoped.scopedVisibleThreads.map((thread) => thread.id), ["b"]);
    assert.deepEqual(scoped.scopedAllThreads.map((thread) => thread.id), ["b", "c"]);
});

test("shouldShowResolvedToolbarChip keeps the resolved toggle visible while resolved mode is active", () => {
    assert.equal(shouldShowResolvedToolbarChip(false, false), false);
    assert.equal(shouldShowResolvedToolbarChip(true, false), true);
    assert.equal(shouldShowResolvedToolbarChip(false, true), true);
});

test("shouldShowResolvedIndexEmptyState points back to active notes when resolved mode hides all scoped items", () => {
    assert.equal(shouldShowResolvedIndexEmptyState(true, 3, 0), true);
    assert.equal(shouldShowResolvedIndexEmptyState(true, 0, 0), false);
    assert.equal(shouldShowResolvedIndexEmptyState(false, 3, 0), false);
    assert.equal(shouldShowResolvedIndexEmptyState(true, 3, 1), false);
});
