import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment, type CommentThread } from "../src/commentManager";
import type { AgentRunRecord } from "../src/core/agents/agentRuns";
import {
    buildPersistedCommentPresentation,
    buildPersistedCommentPinActionPresentation,
    buildPersistedThreadEntryPresentation,
    formatSidebarCommentIndexLeadLabel,
    formatSidebarSideNoteReferenceLabel,
    formatSidebarCommentSourceFileLabel,
    getDeletedRenderableThreadEntries,
    getInsertableSidebarCommentMarkdown,
    getRetryableAgentRunForSidebarComment,
    isRetryableAgentRunBusy,
    getAppendDraftInsertAfterEntryId,
    getRenderableThreadEntries,
    getAgentRunStatusPresentation,
    resolveSidebarCommentAuthor,
    shouldShowRetryActionForSidebarComment,
    shouldRenderChildEntryMoveHandle,
    shouldRenderSidebarCommentAuthor,
    shouldRenderNestedThreadEntries,
    shouldRenderThreadNestedToggle,
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
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
        deletedAt: overrides.deletedAt,
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
        "aside-comment-item",
        "aside-thread-item",
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
        "aside-comment-item",
        "aside-thread-item",
        "orphaned",
    ]);
    assert.deepEqual(presentation.reanchorAction, {
        label: "Re-anchor to current selection",
    });
});

test("buildPersistedCommentPinActionPresentation toggles the pin affordance label", () => {
    assert.deepEqual(
        buildPersistedCommentPinActionPresentation(true),
        {
            active: true,
            ariaLabel: "Unpin this side note",
        },
    );
    assert.deepEqual(
        buildPersistedCommentPinActionPresentation(false),
        {
            active: false,
            ariaLabel: "Pin this side note",
        },
    );
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
    assert.deepEqual(unresolved.moveAction, {
        ariaLabel: "Move to another file",
        icon: "arrow-right-left",
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
        "aside-comment-item",
        "aside-thread-item",
        "aside-thread-entry-item",
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

test("shouldRenderChildEntryMoveHandle hides child drag handles in index/source cards", () => {
    assert.equal(shouldRenderChildEntryMoveHandle({
        enableChildEntryMove: true,
        showSourceRedirectAction: true,
        entryDeleted: false,
        threadDeleted: false,
    }), false);
    assert.equal(shouldRenderChildEntryMoveHandle({
        enableChildEntryMove: true,
        showSourceRedirectAction: false,
        entryDeleted: false,
        threadDeleted: false,
    }), true);
});

test("shouldRenderChildEntryMoveHandle hides child drag handles for deleted entries", () => {
    assert.equal(shouldRenderChildEntryMoveHandle({
        enableChildEntryMove: true,
        showSourceRedirectAction: false,
        entryDeleted: true,
        threadDeleted: false,
    }), false);
    assert.equal(shouldRenderChildEntryMoveHandle({
        enableChildEntryMove: true,
        showSourceRedirectAction: false,
        entryDeleted: false,
        threadDeleted: true,
    }), false);
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
        showNestedCommentsByDefault: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
    }), false);
});

test("shouldRenderNestedThreadEntries hides a targeted child comment when nested comments are off", () => {
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
        showNestedCommentsByDefault: true,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
    }), false);
});

test("shouldRenderNestedThreadEntries hides an active parent thread when nested comments are hidden", () => {
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
        showNestedCommentsByDefault: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
    }), false);
});

test("shouldRenderNestedThreadEntries does not keep an active parent thread visible after the thread was explicitly hidden", () => {
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
        showNestedCommentsByDefault: true,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
    }), false);
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
        showNestedCommentsByDefault: false,
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
        showNestedCommentsByDefault: false,
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
        showNestedCommentsByDefault: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: true,
    }), true);
});

test("shouldRenderNestedThreadEntries hides finished agent replies when nested comments are off", () => {
    const thread = createThreadWithEntries();

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: false,
        showNestedCommentsByDefault: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
        hasAgentReplies: true,
    }), false);
});

test("shouldRenderNestedThreadEntries hides deleted child entries when nested comments are off", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Deleted child", timestamp: 200, deletedAt: 250 },
        ],
        createdAt: 100,
        updatedAt: 250,
    });

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: false,
        showNestedCommentsByDefault: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
        hasDeletedEntriesVisible: true,
    }), false);
});

test("shouldRenderThreadNestedToggle hides the toggle only while visible drafts are open", () => {
    assert.equal(shouldRenderThreadNestedToggle({
        hasStoredChildEntries: true,
        hasInlineEditDraft: true,
        hasAppendDraftComment: false,
        hasChildEditDraft: false,
    }), false);
    assert.equal(shouldRenderThreadNestedToggle({
        hasStoredChildEntries: true,
        hasInlineEditDraft: false,
        hasAppendDraftComment: true,
        hasChildEditDraft: false,
    }), false);
    assert.equal(shouldRenderThreadNestedToggle({
        hasStoredChildEntries: true,
        hasInlineEditDraft: false,
        hasAppendDraftComment: false,
        hasChildEditDraft: true,
    }), false);
    assert.equal(shouldRenderThreadNestedToggle({
        hasStoredChildEntries: false,
        hasInlineEditDraft: false,
        hasAppendDraftComment: false,
        hasChildEditDraft: false,
    }), false);
    assert.equal(shouldRenderThreadNestedToggle({
        hasStoredChildEntries: true,
        hasInlineEditDraft: false,
        hasAppendDraftComment: false,
        hasChildEditDraft: false,
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
            runtime: "direct-cli",
            status: "succeeded",
            partialText: "Agent reply",
            startedAt: 100,
            updatedAt: 200,
            outputEntryId: "entry-2",
        }),
        thread.entries,
    );
});

test("getDeletedRenderableThreadEntries keeps only deleted child entries for deleted mode", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Deleted child", timestamp: 200, deletedAt: 250 },
            { id: "entry-3", body: "Active child", timestamp: 300 },
        ],
        createdAt: 100,
        updatedAt: 300,
    });

    assert.deepEqual(getDeletedRenderableThreadEntries(thread), {
        parentEntry: null,
        childEntries: [thread.entries[1]],
    });
});

test("getDeletedRenderableThreadEntries keeps the deleted root and children for a deleted thread", () => {
    const thread = createThreadWithEntries({
        deletedAt: 250,
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100, deletedAt: 250 },
            { id: "entry-2", body: "Deleted child", timestamp: 200, deletedAt: 240 },
        ],
        createdAt: 100,
        updatedAt: 250,
    });

    assert.deepEqual(getDeletedRenderableThreadEntries(thread), {
        parentEntry: thread.entries[0],
        childEntries: [thread.entries[1]],
    });
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

test("formatSidebarCommentIndexLeadLabel uses selected text for anchored notes and filename for page notes", () => {
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
        "First line second line",
    );
});

test("formatSidebarSideNoteReferenceLabel uses filename and selected text for anchored notes", () => {
    assert.equal(
        formatSidebarSideNoteReferenceLabel(createComment({
            filePath: "books/the-goal.md",
            anchorKind: "selection",
            selectedText: "This is a long selected passage that should be trimmed for sidebar link rendering.",
        }), "books/the-goal.md"),
        "the-goal: This is a long selected passage that should b...",
    );
});

test("formatSidebarSideNoteReferenceLabel uses filename and cleaned body preview for page notes", () => {
    assert.equal(
        formatSidebarSideNoteReferenceLabel(createComment({
            filePath: "Notes/The Goal.md",
            anchorKind: "page",
            comment: "Continued from obsidian://aside-comment?vault=public&file=books%2Falpha.md&commentId=comment-1 and then a little more context.",
        }), "Notes/The Goal.md"),
        "The Goal: Continued from side note and then a little mo...",
    );
});

test("getInsertableSidebarCommentMarkdown keeps the full agent reply body without trailing references", () => {
    assert.equal(
        getInsertableSidebarCommentMarkdown(
            "entry-2",
            [
                "Here is the summary.",
                "",
                "| Name | Status |",
                "| --- | --- |",
                "| Alpha | Ready |",
                "",
                "Mentioned:",
                "- [linked note](obsidian://aside-comment?vault=dev&file=docs%2Flinked.md&commentId=linked-1)",
            ].join("\n"),
            [createAgentRun({ outputEntryId: "entry-2" })],
        ),
        [
            "Here is the summary.",
            "",
            "| Name | Status |",
            "| --- | --- |",
            "| Alpha | Ready |",
        ].join("\n"),
    );
});

test("getInsertableSidebarCommentMarkdown strips managed Aside blocks before inserting into a file", () => {
    assert.equal(
        getInsertableSidebarCommentMarkdown(
            "entry-2",
            [
                "Intro line.",
                "",
                "<!-- Aside comments",
                "[]",
                "-->",
                "",
                "Trailing visible line.",
            ].join("\n"),
            [createAgentRun({ outputEntryId: "entry-2" })],
        ),
        [
            "Intro line.",
            "",
            "Trailing visible line.",
        ].join("\n"),
    );
});

test("getInsertableSidebarCommentMarkdown returns null for user-authored comments", () => {
    assert.equal(getInsertableSidebarCommentMarkdown("entry-2", "Reply body", []), null);
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

test("getRetryableAgentRunForSidebarComment resolves runs from the trigger entry instead of the output entry", () => {
    const run = createAgentRun({
        id: "run-1",
        triggerEntryId: "entry-1",
        outputEntryId: "entry-2",
    });

    assert.equal(
        getRetryableAgentRunForSidebarComment("entry-1", [run])?.id,
        "run-1",
    );
    assert.equal(
        getRetryableAgentRunForSidebarComment("entry-2", [run]),
        null,
    );
});

test("getRetryableAgentRunForSidebarComment keeps the newest retryable run for the same ask entry", () => {
    const olderRun = createAgentRun({
        id: "run-1",
        triggerEntryId: "entry-1",
        outputEntryId: "entry-2",
        createdAt: 100,
        endedAt: 150,
    });
    const newerRun = createAgentRun({
        id: "run-2",
        triggerEntryId: "entry-1",
        outputEntryId: "entry-3",
        createdAt: 200,
        endedAt: 250,
        retryOfRunId: "run-1",
    });

    assert.equal(
        getRetryableAgentRunForSidebarComment("entry-1", [olderRun, newerRun])?.id,
        "run-2",
    );
});

test("shouldShowRetryActionForSidebarComment falls back to explicit agent prompts without stored run metadata", () => {
    assert.equal(
        shouldShowRetryActionForSidebarComment("entry-1", "@codex explain this", []),
        true,
    );
});

test("shouldShowRetryActionForSidebarComment stays hidden for plain user comments without a stored run", () => {
    assert.equal(
        shouldShowRetryActionForSidebarComment("entry-1", "plain comment", []),
        false,
    );
});

test("isRetryableAgentRunBusy disables regenerate while a run is queued or running", () => {
    assert.equal(isRetryableAgentRunBusy(createAgentRun({ status: "queued" })), true);
    assert.equal(isRetryableAgentRunBusy(createAgentRun({ status: "running" })), true);
    assert.equal(isRetryableAgentRunBusy(createAgentRun({ status: "succeeded" })), false);
    assert.equal(isRetryableAgentRunBusy(createAgentRun({ status: "failed" })), false);
    assert.equal(isRetryableAgentRunBusy(null), false);
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
