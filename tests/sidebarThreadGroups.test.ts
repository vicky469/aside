import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import {
    filterThreadsBySidebarGroupMode,
    getSidebarThreadGroupCounts,
    resolveModeWithSidebarGroupAvailability,
    threadMatchesSidebarGroup,
} from "../src/ui/views/sidebarThreadGroups";

function createThread(
    id: string,
    bodies: readonly string[],
    overrides: Partial<CommentThread> = {},
): CommentThread {
    return {
        id,
        filePath: overrides.filePath ?? "docs/current.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 5,
        selectedText: overrides.selectedText ?? "selection",
        selectedTextHash: overrides.selectedTextHash ?? `hash:${id}`,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
        deletedAt: overrides.deletedAt,
        entries: bodies.map((body, index) => ({
            id: `${id}-${index}`,
            body,
            timestamp: 100 + index,
        })),
        createdAt: overrides.createdAt ?? 100,
        updatedAt: overrides.updatedAt ?? 100,
    };
}

test("threadMatchesSidebarGroup finds todo and agent mentions case-insensitively", () => {
    const todoThread = createThread("todo", ["Need follow-up. @TODO"]);
    const codexReplyThread = createThread("codex", ["Initial note", "ask @codex to check"]);
    const claudeThread = createThread("claude", ["Route to @Claude"]);
    const unrelatedThread = createThread("plain", ["No routed marker here."]);

    assert.equal(threadMatchesSidebarGroup(todoThread, "todo"), true);
    assert.equal(threadMatchesSidebarGroup(todoThread, "agent"), false);
    assert.equal(threadMatchesSidebarGroup(codexReplyThread, "agent"), true);
    assert.equal(threadMatchesSidebarGroup(claudeThread, "agent"), true);
    assert.equal(threadMatchesSidebarGroup(unrelatedThread, "todo"), false);
    assert.equal(threadMatchesSidebarGroup(unrelatedThread, "agent"), false);
});

test("filterThreadsBySidebarGroupMode filters only the grouped sidebar modes", () => {
    const todoThread = createThread("todo", ["@todo"]);
    const agentThread = createThread("agent", ["@codex"]);
    const plainThread = createThread("plain", ["plain"]);
    const threads = [todoThread, agentThread, plainThread];

    assert.deepEqual(filterThreadsBySidebarGroupMode(threads, "list").map((thread) => thread.id), ["todo", "agent", "plain"]);
    assert.deepEqual(filterThreadsBySidebarGroupMode(threads, "tags").map((thread) => thread.id), ["todo", "agent", "plain"]);
    assert.deepEqual(filterThreadsBySidebarGroupMode(threads, "thought-trail").map((thread) => thread.id), ["todo", "agent", "plain"]);
    assert.deepEqual(filterThreadsBySidebarGroupMode(threads, "todo").map((thread) => thread.id), ["todo"]);
    assert.deepEqual(filterThreadsBySidebarGroupMode(threads, "agent").map((thread) => thread.id), ["agent"]);
});

test("getSidebarThreadGroupCounts counts overlapping todo and agent threads", () => {
    assert.deepEqual(
        getSidebarThreadGroupCounts([
            createThread("todo", ["@todo"]),
            createThread("agent", ["@claude"]),
            createThread("both", ["@todo for @Codex"]),
            createThread("plain", ["plain"]),
        ]),
        {
            agent: 2,
            todo: 2,
        },
    );
});

test("resolveModeWithSidebarGroupAvailability falls back from empty grouped modes", () => {
    assert.equal(resolveModeWithSidebarGroupAvailability("todo", { todo: 0, agent: 1 }), "list");
    assert.equal(resolveModeWithSidebarGroupAvailability("agent", { todo: 1, agent: 0 }), "list");
    assert.equal(resolveModeWithSidebarGroupAvailability("todo", { todo: 1, agent: 0 }), "todo");
    assert.equal(resolveModeWithSidebarGroupAvailability("agent", { todo: 0, agent: 1 }), "agent");
    assert.equal(resolveModeWithSidebarGroupAvailability("tags", { todo: 0, agent: 0 }), "tags");
});
