import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import {
    countAgentThreads,
    filterThreadsByPinnedSidebarThreadIds,
    filterThreadsByPinnedSidebarViewState,
    filterThreadsBySidebarContentFilter,
    filterThreadsBySidebarSearchQuery,
    getSidebarThreadSearchScore,
    isAgentThread,
    matchesSidebarDraftSearchQuery,
    matchesSidebarContentFilter,
    matchesSidebarThreadSearchQuery,
    rankSidebarSearchResults,
    rankThreadsBySidebarSearchQuery,
    resolveSidebarSearchShowNestedComments,
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
        orphaned: overrides.orphaned ?? false,
        deletedAt: overrides.deletedAt,
        entries: overrides.entries ?? [
            { id: overrides.id ?? "thread-1", body: "Parent entry", timestamp: 100 },
            { id: "entry-2", body: "Child entry", timestamp: 200 },
        ],
        createdAt: overrides.createdAt ?? 100,
        updatedAt: overrides.updatedAt ?? 200,
    };
}

test("sidebar content filters separate agent and ordinary threads", () => {
    const noteThread = createThread({ id: "thread-note" });
    const agentThread = createThread({
        id: "thread-agent",
        entries: [
            { id: "thread-agent", body: "Please ask @codex to review this.", timestamp: 100 },
            { id: "entry-agent-child", body: "Child entry", timestamp: 200 },
        ],
    });

    assert.equal(isAgentThread(agentThread), true);
    assert.equal(isAgentThread(noteThread), false);
    assert.equal(matchesSidebarContentFilter(agentThread, "agents"), true);
    assert.equal(matchesSidebarContentFilter(noteThread, "agents"), false);
    assert.deepEqual(
        filterThreadsBySidebarContentFilter([noteThread, agentThread], "agents").map((thread) => thread.id),
        ["thread-agent"],
    );
});

test("sidebar content filter counters count supported agent mentions", () => {
    const noteThread = createThread({ id: "thread-note" });
    const agentThread = createThread({
        id: "thread-agent",
        entries: [
            { id: "thread-agent", body: "Parent entry", timestamp: 100 },
            { id: "entry-agent-child", body: "Follow up for @codex", timestamp: 200 },
        ],
    });
    const claudeAgentThread = createThread({
        id: "thread-claude",
        entries: [
            { id: "thread-claude", body: "Ask @claude to help", timestamp: 100 },
        ],
    });
    const emailThread = createThread({
        id: "thread-email",
        entries: [
            { id: "thread-email", body: "Reach me at foo@example.com", timestamp: 100 },
        ],
    });

    assert.equal(countAgentThreads([noteThread, agentThread, claudeAgentThread, emailThread]), 2);
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

test("sidebar search ranks exact selection matches ahead of body and unordered term matches", () => {
    const unorderedBodyThread = createThread({
        id: "thread-unordered-body",
        selectedText: "Different note",
        entries: [
            { id: "thread-unordered-body", body: "Need cleanup before API release", timestamp: 100 },
        ],
    });
    const exactBodyThread = createThread({
        id: "thread-exact-body",
        selectedText: "Different note",
        entries: [
            { id: "thread-exact-body", body: "Parent entry", timestamp: 100 },
            { id: "entry-exact-body", body: "API cleanup", timestamp: 200 },
        ],
    });
    const prefixSelectionThread = createThread({
        id: "thread-prefix-selection",
        selectedText: "API cleanup checklist",
        entries: [
            { id: "thread-prefix-selection", body: "Parent entry", timestamp: 100 },
        ],
    });
    const exactSelectionThread = createThread({
        id: "thread-exact-selection",
        selectedText: "API cleanup",
        entries: [
            { id: "thread-exact-selection", body: "Parent entry", timestamp: 100 },
        ],
    });
    const partialBodyThread = createThread({
        id: "thread-partial-body",
        selectedText: "Different note",
        entries: [
            { id: "thread-partial-body", body: "API follow-up only", timestamp: 100 },
        ],
    });

    assert.deepEqual(
        filterThreadsBySidebarSearchQuery(
            [
                unorderedBodyThread,
                exactBodyThread,
                prefixSelectionThread,
                exactSelectionThread,
                partialBodyThread,
            ],
            "api cleanup",
        ).map((thread) => thread.id),
        [
            "thread-exact-selection",
            "thread-prefix-selection",
            "thread-exact-body",
            "thread-unordered-body",
        ],
    );
    assert.equal(
        getSidebarThreadSearchScore(exactSelectionThread, "api cleanup")
            > getSidebarThreadSearchScore(exactBodyThread, "api cleanup"),
        true,
    );
});

test("sidebar search keeps the original thread order when scores tie", () => {
    const firstThread = createThread({
        id: "thread-first",
        selectedText: "Different note",
        entries: [
            { id: "thread-first", body: "Alpha", timestamp: 100 },
        ],
    });
    const secondThread = createThread({
        id: "thread-second",
        selectedText: "Different note",
        entries: [
            { id: "thread-second", body: "Alpha", timestamp: 100 },
        ],
    });

    assert.equal(getSidebarThreadSearchScore(firstThread, "alpha"), getSidebarThreadSearchScore(secondThread, "alpha"));
    assert.deepEqual(
        filterThreadsBySidebarSearchQuery([secondThread, firstThread], "alpha").map((thread) => thread.id),
        ["thread-second", "thread-first"],
    );
});

test("bounded sidebar search returns the exact stable top results and complete count", () => {
    const threads = Array.from({ length: 137 }, (_, index) => createThread({
        id: `thread-${index}`,
        selectedText: index % 7 === 0 ? "architecture" : `section ${index}`,
        entries: [{
            id: `entry-${index}`,
            body: index % 3 === 0 ? "architecture" : `architecture note ${index % 11}`,
            timestamp: 100 + index,
        }],
    }));
    const complete = rankThreadsBySidebarSearchQuery(threads, "architecture");

    const bounded = rankSidebarSearchResults(threads, "architecture", { limit: 100 });

    assert.deepEqual(
        bounded.items.map((thread) => thread.id),
        complete.slice(0, 100).map((thread) => thread.id),
    );
    assert.equal(bounded.totalMatchCount, complete.length);
    assert.equal(bounded.hiddenMatchCount, complete.length - 100);
});

test("bounded sidebar search preserves input order when scores tie", () => {
    const threads = Array.from({ length: 5 }, (_, index) => createThread({
        id: `thread-${index}`,
        entries: [{
            id: `entry-${index}`,
            body: "same architecture body",
            timestamp: 100 + index,
        }],
    }));

    assert.deepEqual(
        rankSidebarSearchResults(threads, "architecture", { limit: 3 }).items.map((thread) => thread.id),
        ["thread-0", "thread-1", "thread-2"],
    );
});

test("bounded sidebar search handles empty and zero-sized windows", () => {
    const threads = [
        createThread({
            id: "a",
            entries: [{ id: "entry-a", body: "alpha", timestamp: 100 }],
        }),
        createThread({
            id: "b",
            entries: [{ id: "entry-b", body: "beta", timestamp: 101 }],
        }),
    ];

    assert.deepEqual(rankSidebarSearchResults(threads, "", { limit: 1 }), {
        items: [threads[0]],
        totalMatchCount: 2,
        hiddenMatchCount: 1,
    });
    assert.deepEqual(rankSidebarSearchResults(threads, "a", { limit: 0 }), {
        items: [],
        totalMatchCount: 2,
        hiddenMatchCount: 2,
    });
});

test("sidebar search renders full matching threads without changing saved nested preference", () => {
    assert.equal(resolveSidebarSearchShowNestedComments("api cleanup", false), true);
    assert.equal(resolveSidebarSearchShowNestedComments("  api cleanup  ", false), true);
    assert.equal(resolveSidebarSearchShowNestedComments("", false), false);
    assert.equal(resolveSidebarSearchShowNestedComments("   ", true), true);
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
    assert.equal(unlockSidebarContentFilterForDraft("agents", { mode: "new" }), "all");
    assert.equal(unlockSidebarContentFilterForDraft("agents", { mode: "edit" }), "agents");
    assert.equal(unlockSidebarContentFilterForDraft("all", null), "all");
});

test("pinned thread filter narrows the sidebar to the temporary pinned set", () => {
    const noteThread = createThread({ id: "thread-note" });
    const agentThread = createThread({ id: "thread-agent" });

    assert.deepEqual(
        filterThreadsByPinnedSidebarThreadIds(
            [noteThread, agentThread],
            new Set(["thread-agent"]),
        ).map((thread) => thread.id),
        ["thread-agent"],
    );
    assert.deepEqual(
        filterThreadsByPinnedSidebarThreadIds([noteThread, agentThread], new Set())
            .map((thread) => thread.id),
        ["thread-note", "thread-agent"],
    );
});

test("pinned thread filter drops pinned ids that are no longer available in the current view", () => {
    const noteThread = createThread({ id: "thread-note" });
    const agentThread = createThread({ id: "thread-agent" });

    assert.deepEqual(
        filterThreadsByPinnedSidebarThreadIds(
            [noteThread, agentThread],
            new Set(["thread-missing", "thread-agent"]),
        ).map((thread) => thread.id),
        ["thread-agent"],
    );
});

test("pin state does not narrow the sidebar until pinned-only view is active", () => {
    const noteThread = createThread({ id: "thread-note" });
    const agentThread = createThread({ id: "thread-agent" });

    assert.deepEqual(
        filterThreadsByPinnedSidebarViewState(
            [noteThread, agentThread],
            new Set(["thread-agent"]),
            false,
        ).map((thread) => thread.id),
        ["thread-note", "thread-agent"],
    );
    assert.deepEqual(
        filterThreadsByPinnedSidebarViewState(
            [noteThread, agentThread],
            new Set(["thread-agent"]),
            true,
        ).map((thread) => thread.id),
        ["thread-agent"],
    );
});

test("pinned filtering composes with an aggregate cross-file thread list", () => {
    const threads = [
        createThread({ id: "a", filePath: "a.md" }),
        createThread({ id: "b", filePath: "b.md" }),
    ];

    assert.deepEqual(
        filterThreadsByPinnedSidebarViewState(threads, new Set(["b"]), true)
            .map((thread) => thread.id),
        ["b"],
    );
});

test("pin acts as an intersecting filter with agent results once pinned-only view is active", () => {
    const noteThread = createThread({ id: "thread-note" });
    const agentThread = createThread({
        id: "thread-agent",
        entries: [
            { id: "thread-agent", body: "Ask @codex for help", timestamp: 100 },
        ],
    });

    const agentFiltered = filterThreadsBySidebarContentFilter(
        [noteThread, agentThread],
        "agents",
    );

    assert.deepEqual(
        filterThreadsByPinnedSidebarViewState(
            agentFiltered,
            new Set(["thread-note", "thread-agent"]),
            true,
        ).map((thread) => thread.id),
        ["thread-agent"],
    );
});

test("pinned-only view can go empty when the pinned set is empty", () => {
    const noteThread = createThread({ id: "thread-note" });
    const agentThread = createThread({ id: "thread-agent" });

    assert.deepEqual(
        filterThreadsByPinnedSidebarViewState(
            [noteThread, agentThread],
            new Set<string>(),
            true,
        ),
        [],
    );
});

test("toggling the agent filter preserves temporary pin filters", () => {
    assert.deepEqual(
        toggleSidebarContentFilterState("all", "agents", new Set(["thread-1", "thread-2"])),
        {
            filter: "agents",
            pinnedThreadIds: new Set(["thread-1", "thread-2"]),
        },
    );
    assert.deepEqual(
        toggleSidebarContentFilterState("agents", "agents", new Set(["thread-1"])),
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
            contentFilter: "agents",
            showPinnedThreadsOnly: true,
            pinnedThreadIds: new Set(["thread-1"]),
            searchQuery: "draft",
            searchInputValue: "draft",
        }),
        {
            showDeleted: true,
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
            contentFilter: "all",
            showPinnedThreadsOnly: false,
            pinnedThreadIds: new Set<string>(),
            searchQuery: "",
            searchInputValue: "",
        }),
        {
            showDeleted: false,
            contentFilter: "all",
            showPinnedThreadsOnly: false,
            pinnedThreadIds: new Set<string>(),
            searchQuery: "",
            searchInputValue: "",
        },
    );
});
