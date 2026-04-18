import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment } from "../src/commentManager";
import {
    buildAgentSidebarThreads,
    countAgentSidebarThreadsByOutcome,
    filterAgentSidebarThreadsByOutcome,
} from "../src/ui/views/agentSidebarPlanner";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "Folder/Note.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 0,
        selectedText: overrides.selectedText ?? "Alpha",
        selectedTextHash: overrides.selectedTextHash ?? "hash:alpha",
        comment: overrides.comment ?? "Comment",
        timestamp: overrides.timestamp ?? 1,
        anchorKind: overrides.anchorKind ?? "page",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
    };
}

test("buildAgentSidebarThreads filters to agent-relevant threads and sorts by status then recency", () => {
    const runningThread = commentToThread(createComment({ id: "thread-running", timestamp: 10 }));
    const failedThread = commentToThread(createComment({ id: "thread-failed", timestamp: 20 }));
    const plainThread = commentToThread(createComment({ id: "thread-plain", timestamp: 30 }));
    const childRunThread = {
        ...commentToThread(createComment({ id: "thread-child", timestamp: 40 })),
        entries: [
            { id: "thread-child", body: "Parent", timestamp: 40 },
            { id: "thread-child-entry-2", body: "Child", timestamp: 50 },
        ],
    };

    const planned = buildAgentSidebarThreads(
        [plainThread, failedThread, runningThread, childRunThread],
        [
            {
                id: "run-failed",
                threadId: "thread-failed",
                triggerEntryId: "thread-failed",
                filePath: failedThread.filePath,
                requestedAgent: "codex",
                runtime: "direct-cli",
                status: "failed",
                promptText: "@codex",
                createdAt: 20,
                endedAt: 30,
            },
            {
                id: "run-running",
                threadId: "thread-running",
                triggerEntryId: "thread-running",
                filePath: runningThread.filePath,
                requestedAgent: "claude",
                runtime: "direct-cli",
                status: "running",
                promptText: "@claude",
                createdAt: 10,
                startedAt: 40,
            },
            {
                id: "run-child-entry",
                threadId: "thread-child-entry-2",
                triggerEntryId: "thread-child-entry-2",
                filePath: childRunThread.filePath,
                requestedAgent: "codex",
                runtime: "direct-cli",
                status: "succeeded",
                promptText: "@codex",
                createdAt: 15,
                endedAt: 25,
            },
        ],
    );

    assert.deepEqual(planned.map((item) => item.thread.id), [
        "thread-running",
        "thread-failed",
        "thread-child",
    ]);
});

test("agent sidebar outcome filters count and filter only latest thread outcomes", () => {
    const planned = buildAgentSidebarThreads(
        [
            commentToThread(createComment({ id: "thread-success", timestamp: 10 })),
            commentToThread(createComment({ id: "thread-failed", timestamp: 20 })),
            commentToThread(createComment({ id: "thread-running", timestamp: 30 })),
        ],
        [
            {
                id: "run-success",
                threadId: "thread-success",
                triggerEntryId: "thread-success",
                filePath: "Folder/Note.md",
                requestedAgent: "codex",
                runtime: "direct-cli",
                status: "succeeded",
                promptText: "@codex",
                createdAt: 10,
                endedAt: 20,
            },
            {
                id: "run-failed",
                threadId: "thread-failed",
                triggerEntryId: "thread-failed",
                filePath: "Folder/Note.md",
                requestedAgent: "claude",
                runtime: "direct-cli",
                status: "failed",
                promptText: "@claude",
                createdAt: 11,
                endedAt: 21,
            },
            {
                id: "run-running",
                threadId: "thread-running",
                triggerEntryId: "thread-running",
                filePath: "Folder/Note.md",
                requestedAgent: "codex",
                runtime: "direct-cli",
                status: "running",
                promptText: "@codex",
                createdAt: 12,
                startedAt: 22,
            },
        ],
    );

    assert.equal(countAgentSidebarThreadsByOutcome(planned, "succeeded"), 1);
    assert.equal(countAgentSidebarThreadsByOutcome(planned, "failed"), 1);
    assert.deepEqual(
        filterAgentSidebarThreadsByOutcome(planned, "succeeded").map((item) => item.thread.id),
        ["thread-success"],
    );
    assert.deepEqual(
        filterAgentSidebarThreadsByOutcome(planned, "failed").map((item) => item.thread.id),
        ["thread-failed"],
    );
});
