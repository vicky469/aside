import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import type { AgentRunRecord } from "../src/core/agents/agentRuns";
import type { DraftComment } from "../src/domain/drafts";
import {
    buildPageSidebarDraftRenderSignature,
    buildPageSidebarThreadRenderSignature,
} from "../src/ui/views/sidebarPageRenderSignature";

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
        resolved: overrides.resolved ?? false,
        deletedAt: overrides.deletedAt,
        entries: overrides.entries ?? [
            { id: "thread-1", body: "Parent entry", timestamp: 100 },
            { id: "entry-2", body: "Child entry", timestamp: 200 },
        ],
        createdAt: overrides.createdAt ?? 100,
        updatedAt: overrides.updatedAt ?? 200,
    };
}

function createDraft(overrides: Partial<DraftComment> = {}): DraftComment {
    return {
        id: overrides.id ?? "draft-1",
        filePath: overrides.filePath ?? "docs/note.md",
        startLine: overrides.startLine ?? 4,
        startChar: overrides.startChar ?? 2,
        endLine: overrides.endLine ?? 4,
        endChar: overrides.endChar ?? 9,
        selectedText: overrides.selectedText ?? "selected text",
        selectedTextHash: overrides.selectedTextHash ?? "hash:selected",
        comment: overrides.comment ?? "Draft body",
        timestamp: overrides.timestamp ?? 100,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
        deletedAt: overrides.deletedAt,
        mode: overrides.mode ?? "append",
        threadId: overrides.threadId ?? "thread-1",
    };
}

function createAgentRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
    return {
        id: overrides.id ?? "run-1",
        threadId: overrides.threadId ?? "thread-1",
        triggerEntryId: overrides.triggerEntryId ?? "thread-1",
        filePath: overrides.filePath ?? "docs/note.md",
        requestedAgent: overrides.requestedAgent ?? "codex",
        runtime: overrides.runtime ?? "direct-cli",
        status: overrides.status ?? "succeeded",
        promptText: overrides.promptText ?? "@codex summarize",
        createdAt: overrides.createdAt ?? 100,
        startedAt: overrides.startedAt ?? 101,
        endedAt: overrides.endedAt ?? 102,
        retryOfRunId: overrides.retryOfRunId,
        outputEntryId: overrides.outputEntryId ?? "entry-2",
        error: overrides.error,
    };
}

test("buildPageSidebarThreadRenderSignature ignores unrelated active comment ids", () => {
    const thread = createThread();
    const base = buildPageSidebarThreadRenderSignature({
        thread,
        activeCommentId: null,
        showNestedComments: false,
        enablePageThreadReorder: true,
        appendDraftComment: null,
        threadAgentRuns: [],
    });
    const withUnrelatedActiveComment = buildPageSidebarThreadRenderSignature({
        thread,
        activeCommentId: "other-thread",
        showNestedComments: false,
        enablePageThreadReorder: true,
        appendDraftComment: null,
        threadAgentRuns: [],
    });
    const withRelatedActiveComment = buildPageSidebarThreadRenderSignature({
        thread,
        activeCommentId: "entry-2",
        showNestedComments: false,
        enablePageThreadReorder: true,
        appendDraftComment: null,
        threadAgentRuns: [],
    });

    assert.equal(base, withUnrelatedActiveComment);
    assert.notEqual(base, withRelatedActiveComment);
});

test("buildPageSidebarThreadRenderSignature changes when nested draft or run state changes", () => {
    const thread = createThread();
    const base = buildPageSidebarThreadRenderSignature({
        thread,
        activeCommentId: null,
        showNestedComments: false,
        enablePageThreadReorder: true,
        appendDraftComment: null,
        threadAgentRuns: [],
    });
    const withAppendDraft = buildPageSidebarThreadRenderSignature({
        thread,
        activeCommentId: null,
        showNestedComments: false,
        enablePageThreadReorder: true,
        appendDraftComment: createDraft(),
        threadAgentRuns: [],
    });
    const withFailedRun = buildPageSidebarThreadRenderSignature({
        thread,
        activeCommentId: null,
        showNestedComments: false,
        enablePageThreadReorder: true,
        appendDraftComment: null,
        threadAgentRuns: [createAgentRun({ status: "failed", error: "Boom" })],
    });

    assert.notEqual(base, withAppendDraft);
    assert.notEqual(base, withFailedRun);
});

test("buildPageSidebarDraftRenderSignature changes only for the matching active draft", () => {
    const draft = createDraft({ id: "draft-1", mode: "edit", threadId: undefined });
    const inactive = buildPageSidebarDraftRenderSignature(draft, null);
    const unrelatedActive = buildPageSidebarDraftRenderSignature(draft, "draft-2");
    const active = buildPageSidebarDraftRenderSignature(draft, "draft-1");

    assert.equal(inactive, unrelatedActive);
    assert.notEqual(inactive, active);
});
