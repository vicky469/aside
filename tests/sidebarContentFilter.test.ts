import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import {
    countAgentThreads,
    countBookmarkThreads,
    filterThreadsBySidebarContentFilter,
    isAgentThread,
    isBookmarkThread,
    matchesSidebarContentFilter,
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

test("sidebar content filters unlock when a new draft starts", () => {
    assert.equal(unlockSidebarContentFilterForDraft("bookmarks", { mode: "new" }), "all");
    assert.equal(unlockSidebarContentFilterForDraft("agents", { mode: "new" }), "all");
    assert.equal(unlockSidebarContentFilterForDraft("agents", { mode: "edit" }), "agents");
    assert.equal(unlockSidebarContentFilterForDraft("bookmarks", null), "bookmarks");
});
