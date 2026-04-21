import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment, type CommentThread } from "../src/commentManager";
import type { AgentRunRecord } from "../src/core/agents/agentRuns";
import {
    buildPersistedCommentPresentation,
    buildPersistedThreadEntryPresentation,
    formatSidebarCommentIndexLeadLabel,
    formatSidebarCommentSourceFileLabel,
    getAppendDraftInsertAfterEntryId,
    getRenderableThreadEntries,
    getAgentRunStatusPresentation,
    resolveSidebarCommentAuthor,
    shouldRenderSidebarCommentAuthor,
    shouldRenderNestedThreadEntries,
} from "../src/ui/views/sidebarPersistedComment";
import { formatSidebarCommentMeta } from "../src/ui/views/sidebarCommentSections";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        startLine: overrides.startLine ?? 8,
        startChar: overrides.startChar ?? 2,
        endLine: overrides.endLine ?? 8,
        endChar: overrides.endChar ?? 9,
        selectedText: overrides.selectedText ?? "comment",
        selectedTextHash: overrides.selectedTextHash ?? "hash:comment",
        comment: overrides.comment ?? "Comment body",
        timestamp: overrides.timestamp ?? 100,
        anchorKind: overrides.anchorKind ?? "selection",
        isBookmark: overrides.isBookmark ?? false,
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
    };
}

function createThread(overrides: Partial<Comment> = {}): CommentThread {
    return commentToThread(createComment(overrides));
}

function createThreadWithEntries(overrides: Partial<CommentThread> = {}): CommentThread {
    const baseThread = createThread();
    return {
        ...baseThread,
        ...overrides,
        entries: overrides.entries ?? baseThread.entries,
    };
}

function createAgentRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
    return {
        id: overrides.id ?? "run-1",
        threadId: overrides.threadId ?? "comment-1",
        triggerEntryId: overrides.triggerEntryId ?? "comment-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        requestedAgent: overrides.requestedAgent ?? "codex",
        runtime: overrides.runtime ?? "direct-cli",
        status: overrides.status ?? "succeeded",
        promptText: overrides.promptText ?? "@codex do it",
        createdAt: overrides.createdAt ?? 100,
        startedAt: overrides.startedAt,
        endedAt: overrides.endedAt ?? 200,
        retryOfRunId: overrides.retryOfRunId,
        outputEntryId: overrides.outputEntryId ?? "entry-2",
        error: overrides.error,
    };
}

test("buildPersistedCommentPresentation includes page and active classes for page notes", () => {
    const presentation = buildPersistedCommentPresentation(createThread({
        id: "comment-2",
        anchorKind: "page",
        resolved: true,
    }), "comment-2");

    assert.deepEqual(presentation.classes, [
        "sidenote2-comment-item",
        "sidenote2-thread-item",
        "page-note",
        "resolved",
        "active",
    ]);
});

test("buildPersistedCommentPresentation includes orphaned class for orphaned selection comments", () => {
    const presentation = buildPersistedCommentPresentation(createThread({
        orphaned: true,
    }), null);

    assert.deepEqual(presentation.classes, [
        "sidenote2-comment-item",
        "sidenote2-thread-item",
        "orphaned",
    ]);
    assert.deepEqual(presentation.reanchorAction, {
        label: "Re-anchor to current selection",
    });
});

test("buildPersistedCommentPresentation includes bookmark class for bookmark threads", () => {
    const presentation = buildPersistedCommentPresentation(createThread({
        isBookmark: true,
    }), null);

    assert.deepEqual(presentation.classes, [
        "sidenote2-comment-item",
        "sidenote2-thread-item",
        "bookmark",
    ]);
});

test("buildPersistedCommentPresentation omits re-anchor action for page notes", () => {
    const presentation = buildPersistedCommentPresentation(createThread({
        anchorKind: "page",
        orphaned: false,
    }), null);

    assert.equal(presentation.reanchorAction, null);
});

test("buildPersistedCommentPresentation chooses the right resolve action copy and icon", () => {
    const unresolved = buildPersistedCommentPresentation(createThread({ resolved: false }), null);
    const resolved = buildPersistedCommentPresentation(createThread({ resolved: true }), null);

    assert.deepEqual(unresolved.redirectHint, {
        ariaLabel: "Open source note",
        icon: "obsidian-external-link",
    });
    assert.deepEqual(unresolved.shareAction, {
        ariaLabel: "Share side note",
        icon: "share",
    });
    assert.deepEqual(unresolved.resolveAction, {
        ariaLabel: "Resolve side note",
        icon: "check",
    });
    assert.deepEqual(resolved.resolveAction, {
        ariaLabel: "Reopen side note",
        icon: "rotate-ccw",
    });
});

test("buildPersistedCommentPresentation shows the parent entry time without a note count", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    const presentation = buildPersistedCommentPresentation(thread, null);

    assert.equal(
        presentation.metaText,
        formatSidebarCommentMeta({ timestamp: 100 }),
    );
    assert.equal(presentation.metaPreviewText, "comment");
});

test("buildPersistedThreadEntryPresentation gives child entries their own indented card styling", () => {
    const thread = createThreadWithEntries({
        orphaned: true,
        resolved: true,
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    const childEntry = thread.entries[1];
    const presentation = buildPersistedThreadEntryPresentation(thread, childEntry, childEntry.id);

    assert.deepEqual(presentation.classes, [
        "sidenote2-comment-item",
        "sidenote2-thread-item",
        "sidenote2-thread-entry-item",
        "orphaned",
        "resolved",
        "active",
    ]);
    assert.equal(
        presentation.metaText,
        formatSidebarCommentMeta({
            timestamp: childEntry.timestamp,
            orphaned: true,
            resolved: true,
        }),
    );
    assert.equal(presentation.metaPreviewText, null);
});

test("buildPersistedCommentPresentation omits anchored preview text for page notes", () => {
    const presentation = buildPersistedCommentPresentation(createThread({
        anchorKind: "page",
        selectedText: "Architecture",
    }), null);

    assert.equal(presentation.metaPreviewText, null);
});

test("shouldRenderNestedThreadEntries hides stored child comments when nested comments are off", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
    }), false);
});

test("shouldRenderNestedThreadEntries keeps a targeted child comment visible even when nested comments are off", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: "entry-2",
        showNestedComments: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
    }), true);
});

test("shouldRenderNestedThreadEntries keeps an active parent thread visible even when nested comments are off", () => {
    const thread = createThreadWithEntries({
        id: "entry-1",
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: "entry-1",
        showNestedComments: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
    }), true);
});

test("shouldRenderNestedThreadEntries keeps stored child comments visible while editing a thread entry", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: false,
        hasEditDraftComment: true,
        hasAppendDraftComment: false,
        hasAgentStream: false,
    }), true);
});

test("shouldRenderNestedThreadEntries keeps append drafts visible even when nested comments are off", () => {
    const thread = createThreadWithEntries();

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: true,
        hasAgentStream: false,
    }), true);
});

test("shouldRenderNestedThreadEntries keeps streamed agent replies visible even when nested comments are off", () => {
    const thread = createThreadWithEntries();

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: true,
    }), true);
});

test("getAppendDraftInsertAfterEntryId returns the clicked child entry id for child-targeted appends", () => {
    const thread = createThreadWithEntries({
        id: "thread-1",
        entries: [
            { id: "thread-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
            { id: "entry-3", body: "Later child", timestamp: 300 },
        ],
        createdAt: 100,
        updatedAt: 300,
    });

    assert.equal(getAppendDraftInsertAfterEntryId(thread, {
        ...createComment({
            id: "draft-1",
            comment: "",
            timestamp: 400,
        }),
        mode: "append",
        threadId: "thread-1",
        appendAfterCommentId: "entry-2",
    }), "entry-2");
});

test("getAppendDraftInsertAfterEntryId falls back to end-of-thread for parent-targeted or unknown append targets", () => {
    const thread = createThreadWithEntries({
        id: "thread-1",
        entries: [
            { id: "thread-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    assert.equal(getAppendDraftInsertAfterEntryId(thread, {
        ...createComment({
            id: "draft-1",
            comment: "",
            timestamp: 300,
        }),
        mode: "append",
        threadId: "thread-1",
        appendAfterCommentId: "thread-1",
    }), null);
    assert.equal(getAppendDraftInsertAfterEntryId(thread, {
        ...createComment({
            id: "draft-2",
            comment: "",
            timestamp: 300,
        }),
        mode: "append",
        threadId: "thread-1",
        appendAfterCommentId: "missing-entry",
    }), null);
});

test("getRenderableThreadEntries keeps the persisted agent output entry visible while the live stream is retained", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Agent reply", timestamp: 200 },
        ],
        createdAt: 100,
        updatedAt: 200,
    });

    assert.deepEqual(
        getRenderableThreadEntries(thread, {
            runId: "run-1",
            threadId: thread.id,
            requestedAgent: "codex",
            status: "succeeded",
            partialText: "Agent reply",
            startedAt: 100,
            updatedAt: 200,
            outputEntryId: "entry-2",
        }),
        thread.entries,
    );
});

test("formatSidebarCommentSourceFileLabel keeps the basename without md, even for long paths", () => {
    assert.equal(
        formatSidebarCommentSourceFileLabel("docs/thoughts/refactored.md"),
        "refactored",
    );
    assert.equal(
        formatSidebarCommentSourceFileLabel("Folder\\Nested\\Note.md"),
        "Note",
    );
    assert.equal(
        formatSidebarCommentSourceFileLabel(
            "docs/thoughts/very/deeply/nested/this-is-a-deliberately-extremely-long-file-name-to-check-how-the-sidebar-header-allocates-space-for-the-source-label.md",
        ),
        "this-is-a-deliberately-extremely-long-file-name-to-check-how-the-sidebar-header-allocates-space-for-the-source-label",
    );
});

test("formatSidebarCommentIndexLeadLabel uses the source page name for both page and anchored notes", () => {
    assert.equal(
        formatSidebarCommentIndexLeadLabel(createComment({
            anchorKind: "page",
            filePath: "docs/architecture.md",
            selectedText: "Ignored page label",
        })),
        "architecture",
    );
    assert.equal(
        formatSidebarCommentIndexLeadLabel(createComment({
            anchorKind: "selection",
            selectedText: "First line\nsecond line",
            filePath: "docs/architecture.md",
        })),
        "architecture",
    );
});

test("resolveSidebarCommentAuthor labels user-written entries as the current user", () => {
    assert.deepEqual(resolveSidebarCommentAuthor("entry-1", [createAgentRun()], "You"), {
        kind: "user",
        label: "You",
    });
});

test("shouldRenderSidebarCommentAuthor hides the current user badge but keeps agent badges", () => {
    assert.equal(shouldRenderSidebarCommentAuthor({
        kind: "user",
        label: "You",
    }), false);
    assert.equal(shouldRenderSidebarCommentAuthor({
        kind: "codex",
        label: "Codex",
    }), true);
});

test("resolveSidebarCommentAuthor labels agent-produced replies from their output run", () => {
    assert.deepEqual(
        resolveSidebarCommentAuthor(
            "entry-2",
            [createAgentRun({ requestedAgent: "claude", outputEntryId: "entry-2" })],
            "You",
        ),
        {
            kind: "claude",
            label: "Claude",
        },
    );
});

test("getAgentRunStatusPresentation uses compact success and failure markers", () => {
    assert.deepEqual(getAgentRunStatusPresentation("succeeded"), {
        marker: "✓",
        markerKind: "text",
    });
    assert.deepEqual(getAgentRunStatusPresentation("failed"), {
        marker: "✕",
        markerKind: "text",
    });
});

test("getAgentRunStatusPresentation distinguishes queued from running", () => {
    assert.deepEqual(getAgentRunStatusPresentation("queued"), {
        marker: "…",
        markerKind: "text",
    });
    assert.deepEqual(getAgentRunStatusPresentation("running"), {
        marker: null,
        markerKind: "spinner",
    });
});
