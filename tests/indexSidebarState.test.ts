import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment } from "../src/commentManager";
import {
    filterIndexThreadsByExistingSourceFiles,
    scopeIndexThreadsByFilePaths,
    shouldShowActiveIndexEmptyState,
    shouldShowGenericIndexEmptyState,
    shouldShowIndexListToolbarChips,
    shouldShowNestedToolbarChip,
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

test("filterIndexThreadsByExistingSourceFiles drops threads whose source file no longer exists", () => {
    const threads = [
        commentToThread(createComment({ id: "a", filePath: "docs/a.md" })),
        commentToThread(createComment({ id: "b", filePath: "docs/missing.md" })),
        commentToThread(createComment({ id: "c", filePath: "docs/c.pdf" })),
    ];

    const filtered = filterIndexThreadsByExistingSourceFiles(
        threads,
        (filePath) => filePath !== "docs/missing.md",
    );

    assert.deepEqual(filtered.map((thread) => thread.id), ["a", "c"]);
});

test("shouldShowResolvedToolbarChip keeps the resolved toggle visible while resolved mode is active", () => {
    assert.equal(shouldShowResolvedToolbarChip(false, false), false);
    assert.equal(shouldShowResolvedToolbarChip(true, false), true);
    assert.equal(shouldShowResolvedToolbarChip(false, true), true);
});

test("shouldShowIndexListToolbarChips hides list-only chips when thought trail is active", () => {
    assert.equal(shouldShowIndexListToolbarChips(true, "list"), true);
    assert.equal(shouldShowIndexListToolbarChips(true, "tags"), true);
    assert.equal(shouldShowIndexListToolbarChips(true, "thought-trail"), false);
    assert.equal(shouldShowIndexListToolbarChips(false, "thought-trail"), true);
});

test("shouldShowNestedToolbarChip shows the nested toggle whenever nested comments exist", () => {
    assert.equal(shouldShowNestedToolbarChip({
        hasNestedComments: true,
        isAllCommentsView: true,
        selectedIndexFileFilterRootPath: "docs/a.md",
        filteredIndexFileCount: 1,
    }), true);

    assert.equal(shouldShowNestedToolbarChip({
        hasNestedComments: false,
        isAllCommentsView: true,
        selectedIndexFileFilterRootPath: "docs/a.md",
        filteredIndexFileCount: 2,
    }), false);

    assert.equal(shouldShowNestedToolbarChip({
        hasNestedComments: true,
        isAllCommentsView: false,
        selectedIndexFileFilterRootPath: null,
        filteredIndexFileCount: 1,
    }), true);
});

test("shouldShowResolvedIndexEmptyState points back to active notes when resolved mode hides all scoped items", () => {
    assert.equal(shouldShowResolvedIndexEmptyState(true, 3, 0), true);
    assert.equal(shouldShowResolvedIndexEmptyState(true, 0, 0), false);
    assert.equal(shouldShowResolvedIndexEmptyState(false, 3, 0), false);
    assert.equal(shouldShowResolvedIndexEmptyState(true, 3, 1), false);
});

test("shouldShowActiveIndexEmptyState points to resolved notes when active mode hides all scoped items", () => {
    assert.equal(shouldShowActiveIndexEmptyState(false, 3, 0), true);
    assert.equal(shouldShowActiveIndexEmptyState(true, 3, 0), false);
    assert.equal(shouldShowActiveIndexEmptyState(false, 0, 0), false);
    assert.equal(shouldShowActiveIndexEmptyState(false, 3, 1), false);
});

test("shouldShowGenericIndexEmptyState hides the generic selected-file-filter empty panel", () => {
    assert.equal(shouldShowGenericIndexEmptyState({
        hasFileFilter: true,
        hasSearchQuery: false,
        renderedItemCount: 0,
    }), false);
    assert.equal(shouldShowGenericIndexEmptyState({
        hasFileFilter: true,
        hasSearchQuery: true,
        renderedItemCount: 0,
    }), true);
    assert.equal(shouldShowGenericIndexEmptyState({
        hasFileFilter: false,
        hasSearchQuery: false,
        renderedItemCount: 0,
    }), true);
    assert.equal(shouldShowGenericIndexEmptyState({
        hasFileFilter: false,
        hasSearchQuery: false,
        renderedItemCount: 1,
    }), false);
});
