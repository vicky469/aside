import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment } from "../src/commentManager";
import {
    deriveIndexSidebarListFilePaths,
    GENERIC_INDEX_EMPTY_STATE_TEXTS,
    filterIndexThreadsByExistingSourceFiles,
    scopeIndexThreadsByFilePaths,
    shouldShowGenericIndexEmptyState,
    shouldShowIndexListToolbarChips,
    shouldShowNestedToolbarChip,
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
    };
}

test("scopeIndexThreadsByFilePaths keeps all threads when no file filter is selected", () => {
    const visibleThreads = [
        commentToThread(createComment({ id: "a", filePath: "docs/a.md" })),
        commentToThread(createComment({ id: "b", filePath: "docs/b.md" })),
    ];
    const allThreads = visibleThreads.concat([
        commentToThread(createComment({ id: "c", filePath: "docs/c.md" })),
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
        commentToThread(createComment({ id: "c", filePath: "docs/c.md" })),
    ]);

    const scoped = scopeIndexThreadsByFilePaths(visibleThreads, allThreads, ["docs/b.md", "docs/c.md"]);

    assert.deepEqual(scoped.scopedVisibleThreads.map((thread) => thread.id), ["b"]);
    assert.deepEqual(scoped.scopedAllThreads.map((thread) => thread.id), ["b", "c"]);
});

test("deriveIndexSidebarListFilePaths scopes index list cards to the selected root only", () => {
    const visibleThreads = [
        commentToThread(createComment({ id: "a", filePath: "docs/a.md" })),
        commentToThread(createComment({ id: "b", filePath: "docs/b.md" })),
    ];
    const allThreads = visibleThreads.concat([
        commentToThread(createComment({ id: "c", filePath: "docs/c.md" })),
    ]);

    const selectedListFilePaths = deriveIndexSidebarListFilePaths(" docs\\b.md ");
    const scoped = scopeIndexThreadsByFilePaths(visibleThreads, allThreads, selectedListFilePaths);

    assert.deepEqual(selectedListFilePaths, ["docs/b.md"]);
    assert.deepEqual(scoped.scopedVisibleThreads.map((thread) => thread.id), ["b"]);
    assert.deepEqual(scoped.scopedAllThreads.map((thread) => thread.id), ["b"]);
});

test("filterIndexThreadsByExistingSourceFiles drops threads whose source file no longer exists", () => {
    const threads = [
        commentToThread(createComment({ id: "a", filePath: "docs/a.md" })),
        commentToThread(createComment({ id: "b", filePath: "docs/missing.md" })),
        commentToThread(createComment({
            id: "c",
            filePath: "docs/c.pdf",
            anchorKind: "page",
            selectedText: "c",
            selectedTextHash: "hash:c",
        })),
    ];

    const filtered = filterIndexThreadsByExistingSourceFiles(
        threads,
        (filePath) => filePath !== "docs/missing.md",
    );

    assert.deepEqual(filtered.map((thread) => thread.id), ["a", "c"]);
});

test("shouldShowIndexListToolbarChips hides list-only chips when thought trail is active", () => {
    assert.equal(shouldShowIndexListToolbarChips(true, "list"), true);
    assert.equal(shouldShowIndexListToolbarChips(true, "tags"), true);
    assert.equal(shouldShowIndexListToolbarChips(true, "todo"), true);
    assert.equal(shouldShowIndexListToolbarChips(true, "agent"), true);
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

test("generic index empty state points users to file filtering", () => {
    assert.deepEqual(GENERIC_INDEX_EMPTY_STATE_TEXTS, [
        "Click a file in the index to see its side notes.",
    ]);
    assert.equal(GENERIC_INDEX_EMPTY_STATE_TEXTS.includes("Choose a file"), false);
    assert.equal(GENERIC_INDEX_EMPTY_STATE_TEXTS.includes("No side notes yet"), false);
    assert.equal(GENERIC_INDEX_EMPTY_STATE_TEXTS.some((text) => text.includes("populate the index")), false);
});
