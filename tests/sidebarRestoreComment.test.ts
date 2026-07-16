import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/domain/comments/commentThread";
import {
    restoreSidebarComment,
    type SidebarRestoreCommentHost,
} from "../src/ui/views/sidebarRestoreComment";

function createThread(id: string, deletedAt?: number): CommentThread {
    return {
        id,
        filePath: "docs/note.md",
        startLine: 2,
        startChar: 0,
        endLine: 2,
        endChar: 6,
        selectedText: "target",
        selectedTextHash: "hash:target",
        anchorKind: "selection",
        deletedAt,
        entries: [{
            id,
            body: "Comment",
            timestamp: 100,
            deletedAt,
        }],
        createdAt: 100,
        updatedAt: deletedAt ?? 100,
    };
}

function createHarness(options: {
    targetCommentId?: string;
    targetThreadId?: string;
    remainingDeletedThreads: CommentThread[];
}) {
    const targetCommentId = options.targetCommentId ?? "thread-1";
    const targetThread = createThread(options.targetThreadId ?? targetCommentId, 200);
    if (targetCommentId !== targetThread.id) {
        targetThread.entries.push({
            id: targetCommentId,
            body: "Child",
            timestamp: 150,
            deletedAt: 200,
        });
    }
    const showDeletedCalls: boolean[] = [];
    const highlightedIds: string[] = [];
    const expandedThreadIds: string[] = [];
    const host: SidebarRestoreCommentHost = {
        getThreadById: (commentId) => commentId === targetCommentId ? targetThread : undefined,
        restoreComment: async (commentId) => commentId === targetCommentId,
        setShowNestedCommentsForThread: (threadId, show) => {
            if (show) {
                expandedThreadIds.push(threadId);
            }
        },
        shouldShowDeletedComments: () => true,
        getThreadsForFile: () => options.remainingDeletedThreads,
        setShowDeletedComments: (show) => {
            showDeletedCalls.push(show);
        },
        highlightComment: (commentId) => {
            highlightedIds.push(commentId);
        },
    };

    return {
        host,
        showDeletedCalls,
        highlightedIds,
        expandedThreadIds,
    };
}

test("restoreSidebarComment stays in Trash while another deleted card remains", async () => {
    const harness = createHarness({
        remainingDeletedThreads: [createThread("thread-2", 300)],
    });

    const restored = await restoreSidebarComment("thread-1", harness.host);

    assert.equal(restored, true);
    assert.deepEqual(harness.showDeletedCalls, []);
    assert.deepEqual(harness.highlightedIds, []);
});

test("restoreSidebarComment exits Trash and highlights the final restored card", async () => {
    const harness = createHarness({ remainingDeletedThreads: [] });

    const restored = await restoreSidebarComment("thread-1", harness.host);

    assert.equal(restored, true);
    assert.deepEqual(harness.showDeletedCalls, [false]);
    assert.deepEqual(harness.highlightedIds, ["thread-1"]);
});

test("restoreSidebarComment expands a restored child parent", async () => {
    const harness = createHarness({
        targetCommentId: "entry-2",
        targetThreadId: "thread-1",
        remainingDeletedThreads: [createThread("thread-2", 300)],
    });

    await restoreSidebarComment("entry-2", harness.host);

    assert.deepEqual(harness.expandedThreadIds, ["thread-1"]);
});
