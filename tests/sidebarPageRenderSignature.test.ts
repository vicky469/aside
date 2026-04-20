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
        isBookmark: overrides.isBookmark ?? false,
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
        isBookmark: overrides.isBookmark ?? false,
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
        editDraftComment: null,
        appendDraftComment: null,
        threadAgentRuns: [],
    });
    const withUnrelatedActiveComment = buildPageSidebarThreadRenderSignature({
        thread,
        activeCommentId: "other-thread",
        showNestedComments: false,
        enablePageThreadReorder: true,
        editDraftComment: null,
        appendDraftComment: null,
        threadAgentRuns: [],
    });
    const withRelatedActiveComment = buildPageSidebarThreadRenderSignature({
        thread,
        activeCommentId: "entry-2",
        showNestedComments: false,
        enablePageThreadReorder: true,
        editDraftComment: null,
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
        editDraftComment: null,
        appendDraftComment: null,
        threadAgentRuns: [],
    });
    const withEditDraft = buildPageSidebarThreadRenderSignature({
        thread,
        activeCommentId: null,
        showNestedComments: false,
        enablePageThreadReorder: true,
        editDraftComment: createDraft({ mode: "edit", id: "entry-2", threadId: "thread-1" }),
        appendDraftComment: null,
        threadAgentRuns: [],
    });
    const withAppendDraft = buildPageSidebarThreadRenderSignature({
        thread,
        activeCommentId: null,
        showNestedComments: false,
        enablePageThreadReorder: true,
        editDraftComment: null,
        appendDraftComment: createDraft(),
        threadAgentRuns: [],
    });
    const withFailedRun = buildPageSidebarThreadRenderSignature({
        thread,
        activeCommentId: null,
        showNestedComments: false,
        enablePageThreadReorder: true,
        editDraftComment: null,
        appendDraftComment: null,
        threadAgentRuns: [createAgentRun({ status: "failed", error: "Boom" })],
    });

    assert.notEqual(base, withEditDraft);
    assert.notEqual(base, withAppendDraft);
    assert.notEqual(base, withFailedRun);
});

test("buildPageSidebarThreadRenderSignature changes when nested comments are shown or hidden", () => {
    const thread = createThread();
    const hidden = buildPageSidebarThreadRenderSignature({
        thread,
        activeCommentId: null,
        showNestedComments: false,
        enablePageThreadReorder: true,
        editDraftComment: null,
        appendDraftComment: null,
        threadAgentRuns: [],
    });
    const visible = buildPageSidebarThreadRenderSignature({
        thread,
        activeCommentId: null,
        showNestedComments: true,
        enablePageThreadReorder: true,
        editDraftComment: null,
        appendDraftComment: null,
        threadAgentRuns: [],
    });

    assert.notEqual(hidden, visible);
});

test("buildPageSidebarThreadRenderSignature changes when bookmark state changes", () => {
    const noteThread = createThread({ isBookmark: false });
    const bookmarkThread = createThread({ isBookmark: true });

    const noteSignature = buildPageSidebarThreadRenderSignature({
        thread: noteThread,
        activeCommentId: null,
        showNestedComments: false,
        enablePageThreadReorder: true,
        editDraftComment: null,
        appendDraftComment: null,
        threadAgentRuns: [],
    });
    const bookmarkSignature = buildPageSidebarThreadRenderSignature({
        thread: bookmarkThread,
        activeCommentId: null,
        showNestedComments: false,
        enablePageThreadReorder: true,
        editDraftComment: null,
        appendDraftComment: null,
        threadAgentRuns: [],
    });

    assert.notEqual(noteSignature, bookmarkSignature);
});

test("buildPageSidebarDraftRenderSignature changes only for the matching active draft", () => {
    const draft = createDraft({ id: "draft-1", mode: "edit", threadId: undefined });
    const inactive = buildPageSidebarDraftRenderSignature(draft, null);
    const unrelatedActive = buildPageSidebarDraftRenderSignature(draft, "draft-2");
    const active = buildPageSidebarDraftRenderSignature(draft, "draft-1");

    assert.equal(inactive, unrelatedActive);
    assert.notEqual(inactive, active);
});

test("buildPageSidebarDraftRenderSignature changes when draft bookmark state changes", () => {
    const noteDraft = createDraft({ isBookmark: false });
    const bookmarkDraft = createDraft({ isBookmark: true });

    assert.notEqual(
        buildPageSidebarDraftRenderSignature(noteDraft, null),
        buildPageSidebarDraftRenderSignature(bookmarkDraft, null),
    );
});
