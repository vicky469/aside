import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment } from "../src/commentManager";
import {
    deriveIndexSidebarListFilePaths,
    GENERIC_INDEX_EMPTY_STATE_TEXTS,
    filterIndexThreadsByExistingSourceFiles,
    resolveIndexSidebarEmptyStateTexts,
    resolveIndexSidebarModeScope,
    resolveIndexSidebarSearchStateForMode,
    resolveIndexSidebarSearchStateForScope,
    resolveIndexSidebarSearchPlaceholder,
    scopeIndexThreadsByFilePaths,
    scopeIndexThreadsByMode,
    shouldShowGenericIndexEmptyState,
    shouldShowIndexListToolbarChips,
    shouldShowIndexSidebarSearch,
    shouldShowNestedToolbarChip,
    shouldUseEmptyIndexDefaultCache,
} from "../src/ui/views/indexSidebarState";

test("index generic search is available in List Todo and Agent", () => {
    for (const mode of ["list", "todo", "agent"] as const) {
        assert.equal(shouldShowIndexSidebarSearch(mode), true);
    }
    for (const mode of ["tags", "thought-trail"] as const) {
        assert.equal(shouldShowIndexSidebarSearch(mode), false);
    }
});

test("switching among index card modes preserves generic search", () => {
    const state = { searchInputValue: "odoo", searchQuery: "odoo" };
    for (const mode of ["list", "todo", "agent"] as const) {
        assert.deepEqual(resolveIndexSidebarSearchStateForMode(state, mode), state);
    }
    for (const mode of ["tags", "thought-trail"] as const) {
        assert.deepEqual(resolveIndexSidebarSearchStateForMode(state, mode), {
            searchInputValue: "",
            searchQuery: "",
        });
    }
});

test("index card modes resolve global todo and gated local modes without a file", () => {
    assert.deepEqual(resolveIndexSidebarModeScope("list", null), {
        kind: "unavailable",
        rootFilePath: null,
    });
    assert.deepEqual(resolveIndexSidebarModeScope("agent", "   "), {
        kind: "unavailable",
        rootFilePath: null,
    });
    assert.deepEqual(resolveIndexSidebarModeScope("todo", null), {
        kind: "global-todo",
        rootFilePath: null,
    });
    assert.deepEqual(resolveIndexSidebarModeScope("tags", null), {
        kind: "global-tags",
        rootFilePath: null,
    });
});

test("index Tags stays vault-wide when a file filter is selected", () => {
    assert.deepEqual(resolveIndexSidebarModeScope("tags", "docs/b.md"), {
        kind: "global-tags",
        rootFilePath: null,
    });
});

test("a selected file scopes every index card mode", () => {
    for (const mode of ["list", "todo", "agent"] as const) {
        assert.deepEqual(resolveIndexSidebarModeScope(mode, " docs\\b.md "), {
            kind: "file",
            rootFilePath: "docs/b.md",
        });
    }
});

test("global Todo preserves search while unscoped List and Agent clear it", () => {
    const state = { searchInputValue: "odoo", searchQuery: "odoo" };
    assert.deepEqual(resolveIndexSidebarSearchStateForScope(state, "todo", null), state);
    for (const mode of ["list", "agent"] as const) {
        assert.deepEqual(resolveIndexSidebarSearchStateForScope(state, mode, null), {
            searchInputValue: "",
            searchQuery: "",
        });
    }
    assert.deepEqual(resolveIndexSidebarSearchStateForScope(state, "agent", "docs/a.md"), state);
});

test("index generic search copy follows its active scope", () => {
    assert.equal(
        resolveIndexSidebarSearchPlaceholder("global-todo"),
        "Search todo side notes across your vault",
    );
    assert.equal(
        resolveIndexSidebarSearchPlaceholder("file"),
        "Search side notes in selected file",
    );
});

test("the empty-index cache never bypasses live aggregate controls", () => {
    assert.equal(shouldUseEmptyIndexDefaultCache(0), true);
    assert.equal(shouldUseEmptyIndexDefaultCache(1), false);
    assert.equal(shouldUseEmptyIndexDefaultCache(4), false);
});

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

test("index mode scope selects empty, global, or file threads", () => {
    const visibleThreads = [
        commentToThread(createComment({ id: "todo-a", filePath: "docs/a.md", comment: "@todo A" })),
        commentToThread(createComment({ id: "agent-b", filePath: "docs/b.md", comment: "@codex B" })),
    ];
    const allThreads = visibleThreads.concat([
        commentToThread(createComment({ id: "todo-b", filePath: "docs/b.md", comment: "@todo B" })),
    ]);

    assert.deepEqual(
        scopeIndexThreadsByMode(visibleThreads, allThreads, resolveIndexSidebarModeScope("list", null))
            .scopedVisibleThreads,
        [],
    );
    assert.deepEqual(
        scopeIndexThreadsByMode(visibleThreads, allThreads, resolveIndexSidebarModeScope("todo", null))
            .scopedAllThreads.map((thread) => thread.id),
        ["todo-a", "agent-b", "todo-b"],
    );
    assert.deepEqual(
        scopeIndexThreadsByMode(visibleThreads, allThreads, resolveIndexSidebarModeScope("todo", "docs/b.md"))
            .scopedAllThreads.map((thread) => thread.id),
        ["agent-b", "todo-b"],
    );
    assert.deepEqual(
        scopeIndexThreadsByMode(visibleThreads, allThreads, resolveIndexSidebarModeScope("tags", null)),
        { scopedVisibleThreads: [], scopedAllThreads: [] },
    );
});

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

test("index empty states distinguish unavailable, global Todo, and selected-file scopes", () => {
    assert.deepEqual(resolveIndexSidebarEmptyStateTexts({
        mode: "list",
        scopeKind: "unavailable",
    }), GENERIC_INDEX_EMPTY_STATE_TEXTS);
    assert.deepEqual(resolveIndexSidebarEmptyStateTexts({
        mode: "agent",
        scopeKind: "unavailable",
    }), GENERIC_INDEX_EMPTY_STATE_TEXTS);
    assert.deepEqual(resolveIndexSidebarEmptyStateTexts({
        mode: "todo",
        scopeKind: "global-todo",
    }), [
        "No todo side notes yet.",
        "Add @todo to any side note or reply to show it here.",
    ]);
    assert.deepEqual(resolveIndexSidebarEmptyStateTexts({
        mode: "todo",
        scopeKind: "file",
    }), [
        "No todo side notes in this file yet.",
        "Add @todo to any side note or reply to show it here.",
    ]);
    assert.deepEqual(resolveIndexSidebarEmptyStateTexts({
        mode: "agent",
        scopeKind: "file",
    }), [
        "No agent side notes in this file yet.",
        "Add an agent mention to any side note or reply to show it here.",
    ]);
    assert.equal(resolveIndexSidebarEmptyStateTexts({
        mode: "list",
        scopeKind: "file",
    }), null);
});
