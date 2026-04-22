import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import {
    countAgentThreads,
    countBookmarkThreads,
    filterThreadsByPinnedSidebarViewState,
    filterThreadsBySidebarContentFilter,
    filterThreadsByPinnedSidebarThreadIds,
    filterThreadsBySidebarSearchQuery,
    isAgentThread,
    isBookmarkThread,
    matchesSidebarDraftSearchQuery,
    matchesSidebarContentFilter,
    matchesSidebarThreadSearchQuery,
    toggleDeletedSidebarViewState,
    toggleSidebarContentFilterState,
    unlockSidebarContentFilterForDraft,
} from "../src/ui/views/sidebarContentFilter";

function createThread(overrides: Partial<CommentThread> = {}): CommentThread {
    return {
        id: overrides.id ?? "thread-1",
        filePath: overrides.filePath ?? "docs/note.md",
        startLine: overrides.startLine ?? 4,
        startChar: overrides.startChar ?? 2,
        endLine: overrides.endLine ?? 4,
        endChar: overrides.endChar ?? 9,
        selectedText: overrides.selectedText ?? "selected text",
        selectedTextHash: overrides.selectedTextHash ?? "hash:selected",
        anchorKind: overrides.anchorKind ?? "selection",
        isBookmark: overrides.isBookmark ?? false,
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
        deletedAt: overrides.deletedAt,
        entries: overrides.entries ?? [
            { id: overrides.id ?? "thread-1", body: "Parent entry", timestamp: 100 },
            { id: "entry-2", body: "Child entry", timestamp: 200 },
        ],
        createdAt: overrides.createdAt ?? 100,
        updatedAt: overrides.updatedAt ?? 200,
    };
}

test("sidebar content filters separate bookmark and agent threads", () => {
    const noteThread = createThread({ id: "thread-note", isBookmark: false });
    const bookmarkThread = createThread({ id: "thread-bookmark", isBookmark: true });
    const agentThread = createThread({
        id: "thread-agent",
        isBookmark: false,
        entries: [
            { id: "thread-agent", body: "Please ask @codex to review this.", timestamp: 100 },
            { id: "entry-agent-child", body: "Child entry", timestamp: 200 },
        ],
    });

    assert.equal(isBookmarkThread(bookmarkThread), true);
    assert.equal(isBookmarkThread(noteThread), false);
    assert.equal(isAgentThread(agentThread), true);
    assert.equal(matchesSidebarContentFilter(bookmarkThread, "bookmarks"), true);
    assert.equal(matchesSidebarContentFilter(agentThread, "bookmarks"), false);
    assert.equal(matchesSidebarContentFilter(agentThread, "agents"), true);
    assert.equal(matchesSidebarContentFilter(noteThread, "agents"), false);

    assert.deepEqual(
        filterThreadsBySidebarContentFilter([noteThread, bookmarkThread, agentThread], "bookmarks")
            .map((thread) => thread.id),
        ["thread-bookmark"],
    );
    assert.deepEqual(
        filterThreadsBySidebarContentFilter([noteThread, bookmarkThread, agentThread], "agents")
            .map((thread) => thread.id),
        ["thread-agent"],
    );
});

test("sidebar content filter counters reflect bookmark and supported agent mentions only", () => {
    const noteThread = createThread({ id: "thread-note", isBookmark: false });
    const bookmarkThread = createThread({ id: "thread-bookmark", isBookmark: true });
    const agentThread = createThread({
        id: "thread-agent",
        entries: [
            { id: "thread-agent", body: "Parent entry", timestamp: 100 },
            { id: "entry-agent-child", body: "Follow up for @codex", timestamp: 200 },
        ],
    });
    const unsupportedAgentThread = createThread({
        id: "thread-unsupported",
        entries: [
            { id: "thread-unsupported", body: "Ask @claude to help", timestamp: 100 },
        ],
    });
    const emailThread = createThread({
        id: "thread-email",
        entries: [
            { id: "thread-email", body: "Reach me at foo@example.com", timestamp: 100 },
        ],
    });

    assert.equal(countBookmarkThreads([noteThread, bookmarkThread, agentThread]), 1);
    assert.equal(countAgentThreads([noteThread, bookmarkThread, agentThread, unsupportedAgentThread, emailThread]), 1);
});

test("sidebar search matches selected text and entry bodies case-insensitively", () => {
    const selectionThread = createThread({
        id: "thread-selection",
        selectedText: "Architecture review",
        entries: [
            { id: "thread-selection", body: "Parent entry", timestamp: 100 },
        ],
    });
    const bodyThread = createThread({
        id: "thread-body",
        selectedText: "Different note",
        entries: [
            { id: "thread-body", body: "Follow up on API cleanup", timestamp: 100 },
        ],
    });

    assert.equal(matchesSidebarThreadSearchQuery(selectionThread, "architecture"), true);
    assert.equal(matchesSidebarThreadSearchQuery(bodyThread, "api cleanup"), true);
    assert.equal(matchesSidebarThreadSearchQuery(bodyThread, "missing term"), false);
    assert.deepEqual(
        filterThreadsBySidebarSearchQuery([selectionThread, bodyThread], "api cleanup").map((thread) => thread.id),
        ["thread-body"],
    );
});

test("sidebar search also matches draft text", () => {
    assert.equal(matchesSidebarDraftSearchQuery({
        selectedText: "Anchor label",
        comment: "Need to revisit the search affordance",
    }, "search affordance"), true);
    assert.equal(matchesSidebarDraftSearchQuery({
        selectedText: "Anchor label",
        comment: "Need to revisit the search affordance",
    }, "anchor"), true);
    assert.equal(matchesSidebarDraftSearchQuery({
        selectedText: "Anchor label",
        comment: "Need to revisit the search affordance",
    }, "bookmark"), false);
});

test("sidebar content filters unlock when a new draft starts", () => {
    assert.equal(unlockSidebarContentFilterForDraft("bookmarks", { mode: "new" }), "all");
    assert.equal(unlockSidebarContentFilterForDraft("agents", { mode: "new" }), "all");
    assert.equal(unlockSidebarContentFilterForDraft("agents", { mode: "edit" }), "agents");
    assert.equal(unlockSidebarContentFilterForDraft("bookmarks", null), "bookmarks");
});

test("bookmark filter removes a thread immediately once it is unbookmarked", () => {
    const removedBookmarkThread = createThread({ id: "thread-bookmark", isBookmark: false });
    const freshBookmarkThread = createThread({ id: "thread-new-bookmark", isBookmark: true });
    const noteThread = createThread({ id: "thread-note", isBookmark: false });

    const filtered = filterThreadsBySidebarContentFilter(
        [removedBookmarkThread, freshBookmarkThread, noteThread],
        "bookmarks",
    );

    assert.deepEqual(filtered.map((thread) => thread.id), ["thread-new-bookmark"]);
});

test("pinned thread filter narrows the sidebar to the temporary pinned set", () => {
    const noteThread = createThread({ id: "thread-note" });
    const bookmarkThread = createThread({ id: "thread-bookmark", isBookmark: true });
    const agentThread = createThread({ id: "thread-agent" });

    assert.deepEqual(
        filterThreadsByPinnedSidebarThreadIds(
            [noteThread, bookmarkThread, agentThread],
            new Set(["thread-bookmark", "thread-agent"]),
        )
            .map((thread) => thread.id),
        ["thread-bookmark", "thread-agent"],
    );
    assert.deepEqual(
        filterThreadsByPinnedSidebarThreadIds([noteThread, bookmarkThread], new Set())
            .map((thread) => thread.id),
        ["thread-note", "thread-bookmark"],
    );
});

test("pinned thread filter drops pinned ids that are no longer available in the current view", () => {
    const noteThread = createThread({ id: "thread-note" });
    const bookmarkThread = createThread({ id: "thread-bookmark", isBookmark: true });

    assert.deepEqual(
        filterThreadsByPinnedSidebarThreadIds(
            [noteThread, bookmarkThread],
            new Set(["thread-missing", "thread-bookmark"]),
        ).map((thread) => thread.id),
        ["thread-bookmark"],
    );
});

test("pin state does not narrow the sidebar until pinned-only view is active", () => {
    const noteThread = createThread({ id: "thread-note" });
    const bookmarkThread = createThread({ id: "thread-bookmark", isBookmark: true });

    assert.deepEqual(
        filterThreadsByPinnedSidebarViewState(
            [noteThread, bookmarkThread],
            new Set(["thread-bookmark"]),
            false,
        ).map((thread) => thread.id),
        ["thread-note", "thread-bookmark"],
    );
    assert.deepEqual(
        filterThreadsByPinnedSidebarViewState(
            [noteThread, bookmarkThread],
            new Set(["thread-bookmark"]),
            true,
        ).map((thread) => thread.id),
        ["thread-bookmark"],
    );
});

test("pin acts as an intersecting filter with bookmark results once pinned-only view is active", () => {
    const noteThread = createThread({ id: "thread-note", isBookmark: false });
    const bookmarkThread = createThread({ id: "thread-bookmark", isBookmark: true });

    const bookmarkFiltered = filterThreadsBySidebarContentFilter(
        [noteThread, bookmarkThread],
        "bookmarks",
    );

    assert.deepEqual(
        filterThreadsByPinnedSidebarViewState(
            bookmarkFiltered,
            new Set(["thread-note", "thread-bookmark"]),
            true,
        ).map((thread) => thread.id),
        ["thread-bookmark"],
    );
});

test("pinned-only view can go empty when the pinned set is empty", () => {
    const noteThread = createThread({ id: "thread-note" });
    const bookmarkThread = createThread({ id: "thread-bookmark", isBookmark: true });

    assert.deepEqual(
        filterThreadsByPinnedSidebarViewState(
            [noteThread, bookmarkThread],
            new Set<string>(),
            true,
        ),
        [],
    );
});

test("toggling the note bookmark filter preserves temporary pin filters", () => {
    assert.deepEqual(
        toggleSidebarContentFilterState("all", "bookmarks", new Set(["thread-1", "thread-2"])),
        {
            filter: "bookmarks",
            pinnedThreadIds: new Set(["thread-1", "thread-2"]),
        },
    );
    assert.deepEqual(
        toggleSidebarContentFilterState("bookmarks", "bookmarks", new Set(["thread-1"])),
        {
            filter: "all",
            pinnedThreadIds: new Set(["thread-1"]),
        },
    );
});

test("entering deleted mode clears filters and search so all soft-deleted threads are visible", () => {
    assert.deepEqual(
        toggleDeletedSidebarViewState({
            showDeleted: false,
            showResolved: true,
            contentFilter: "bookmarks",
            showPinnedThreadsOnly: true,
            pinnedThreadIds: new Set(["thread-1"]),
            searchQuery: "draft",
            searchInputValue: "draft",
        }),
        {
            showDeleted: true,
            showResolved: false,
            contentFilter: "all",
            showPinnedThreadsOnly: false,
            pinnedThreadIds: new Set(["thread-1"]),
            searchQuery: "",
            searchInputValue: "",
        },
    );
});

test("leaving deleted mode keeps the already-cleared sidebar state stable", () => {
    assert.deepEqual(
        toggleDeletedSidebarViewState({
            showDeleted: true,
            showResolved: false,
            contentFilter: "all",
            showPinnedThreadsOnly: false,
            pinnedThreadIds: new Set<string>(),
            searchQuery: "",
            searchInputValue: "",
        }),
        {
            showDeleted: false,
            showResolved: false,
            contentFilter: "all",
            showPinnedThreadsOnly: false,
            pinnedThreadIds: new Set<string>(),
            searchQuery: "",
            searchInputValue: "",
        },
    );
});
