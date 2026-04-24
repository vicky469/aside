import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, threadEntryToComment, type Comment, type CommentThread } from "../src/commentManager";
import type { AgentRunRecord } from "../src/core/agents/agentRuns";
import {
    buildSidebarSideNoteReferencePresentation,
    buildPersistedCommentPresentation,
    buildPersistedCommentBookmarkActionPresentation,
    buildPersistedCommentPinActionPresentation,
    buildPersistedThreadEntryPresentation,
    formatSidebarCommentIndexLeadLabel,
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
    shouldRenderPersistedCommentBookmarkAction,
    shouldRenderPersistedCommentBookmarkIndicator,
    shouldRenderPersistedCommentPinIndicator,
    shouldRenderPersistedCommentPinAction,
    shouldRenderSidebarCommentAuthor,
    shouldRenderNestedThreadEntries,
    shouldRenderThreadNestedToggle,
    threadHasLocalSideNoteReferences,
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

test("buildPersistedCommentBookmarkActionPresentation marks bookmarked threads as active", () => {
    assert.deepEqual(
        buildPersistedCommentBookmarkActionPresentation({ isBookmark: true }),
        {
            active: true,
            ariaLabel: "Remove bookmark",
        },
    );
    assert.deepEqual(
        buildPersistedCommentBookmarkActionPresentation({ isBookmark: false }),
        {
            active: false,
            ariaLabel: "Mark as bookmark",
        },
    );
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

test("shouldRenderPersistedCommentBookmarkIndicator only enables bookmarked cards", () => {
    const rootThread = createThread({ id: "thread-1", isBookmark: true });
    const childThread = createThreadWithEntries({
        id: "thread-2",
        isBookmark: true,
        entries: [
            { id: "thread-2", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
    });
    const childComment = threadEntryToComment(childThread, childThread.entries[1]);

    assert.equal(
        shouldRenderPersistedCommentBookmarkIndicator(createComment({ id: "thread-1", isBookmark: true }), rootThread),
        true,
    );
    assert.equal(
        shouldRenderPersistedCommentBookmarkIndicator(createComment({ id: "thread-1", isBookmark: false }), rootThread),
        false,
    );
    assert.equal(shouldRenderPersistedCommentBookmarkIndicator(childComment, childThread), false);
});

test("shouldRenderPersistedCommentPinIndicator only enables pinned root cards", () => {
    const rootThread = createThread({ id: "thread-1" });
    const childThread = createThreadWithEntries({
        id: "thread-2",
        entries: [
            { id: "thread-2", body: "Parent", timestamp: 100 },
            { id: "entry-2", body: "Child", timestamp: 200 },
        ],
    });
    const childComment = threadEntryToComment(childThread, childThread.entries[1]);

    assert.equal(
        shouldRenderPersistedCommentPinIndicator(createComment({ id: "thread-1" }), rootThread, true),
        true,
    );
    assert.equal(
        shouldRenderPersistedCommentPinIndicator(createComment({ id: "thread-1" }), rootThread, false),
        false,
    );
    assert.equal(shouldRenderPersistedCommentPinIndicator(childComment, childThread, true), false);
});

test("threadHasLocalSideNoteReferences detects links anywhere in the thread", () => {
    const thread = createThreadWithEntries({
        entries: [
            { id: "entry-1", body: "Parent", timestamp: 100 },
            {
                id: "entry-2",
                body: "Child body\n\nMentioned:\n- [Target](obsidian://side-note2-comment?vault=dev&file=docs%2Ftarget.md&commentId=target-1)",
                timestamp: 200,
            },
        ],
    });

    assert.equal(threadHasLocalSideNoteReferences(thread, "dev"), true);
    assert.equal(threadHasLocalSideNoteReferences(thread, "other-vault"), false);
});

test("shouldRenderPersistedCommentBookmarkAction enables root cards and excludes child or deleted cards", () => {
    const rootComment = createComment({ id: "thread-1", anchorKind: "selection" });
    const rootThread = createThread({ id: "thread-1", anchorKind: "selection" });
    rootThread.entries.push({ id: "entry-2", body: "Child", timestamp: 200 });
    const childComment = threadEntryToComment(rootThread, rootThread.entries[1]);
    const pageComment = createComment({ id: "thread-2", anchorKind: "page" });
    const pageThread = createThread({ id: "thread-2", anchorKind: "page" });
    const bookmarkedComment = createComment({ id: "thread-4", isBookmark: true });
    const bookmarkedThread = createThread({ id: "thread-4", isBookmark: true });

    assert.equal(shouldRenderPersistedCommentBookmarkAction(rootComment, rootThread), true);
    assert.equal(shouldRenderPersistedCommentBookmarkAction(childComment, rootThread), false);
    assert.equal(shouldRenderPersistedCommentBookmarkAction(pageComment, pageThread), true);
    assert.equal(shouldRenderPersistedCommentBookmarkAction(bookmarkedComment, bookmarkedThread), false);
    assert.equal(
        shouldRenderPersistedCommentBookmarkAction(
            createComment({ id: "thread-3", deletedAt: 123 }),
            createThread({ id: "thread-3" }),
        ),
        false,
    );
});

test("shouldRenderPersistedCommentPinAction hides the right-side action once a root thread is pinned", () => {
    const rootComment = createComment({ id: "thread-1", anchorKind: "selection" });
    const rootThread = createThread({ id: "thread-1", anchorKind: "selection" });
    rootThread.entries.push({ id: "entry-2", body: "Child", timestamp: 200 });
    const childComment = threadEntryToComment(rootThread, rootThread.entries[1]);
    const bookmarkedComment = createComment({ id: "thread-4", isBookmark: true });
    const bookmarkedThread = createThread({ id: "thread-4", isBookmark: true });

    assert.equal(shouldRenderPersistedCommentPinAction(rootComment, rootThread, false), true);
    assert.equal(shouldRenderPersistedCommentPinAction(bookmarkedComment, bookmarkedThread, false), true);
    assert.equal(shouldRenderPersistedCommentPinAction(rootComment, rootThread, true), false);
    assert.equal(shouldRenderPersistedCommentPinAction(childComment, rootThread, false), false);
    assert.equal(
        shouldRenderPersistedCommentPinAction(
            createComment({ id: "thread-2", deletedAt: 123 }),
            createThread({ id: "thread-2" }),
            false,
        ),
        false,
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
    assert.deepEqual(unresolved.linkAction, {
        ariaLabel: "Link side note",
        icon: "link-2",
    });
    assert.deepEqual(unresolved.moveAction, {
        ariaLabel: "Move side note to another file",
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

test("buildSidebarSideNoteReferencePresentation renders note-title previews instead of raw urls", () => {
    const presentation = buildSidebarSideNoteReferencePresentation({
        bodyPreview: "This is a longer side note preview that should be trimmed once it crosses the display limit for related references.",
        filePath: "docs/agent-cross-platform-runtime-plan.md",
        fileTitle: "agent-cross-platform-runtime-plan",
        primaryLabel: "Build runtime abstraction",
        resolved: false,
        selectedText: "runtime abstraction",
    }, {
        filePath: "docs/fallback.md",
    });

    assert.equal(presentation.title, "agent-cross-platform-runtime-plan");
    assert.equal(
        presentation.preview,
        "This is a longer side note preview that should be trimmed once it crosses the display limit for related references.",
    );
    assert.equal(
        presentation.tooltip,
        "docs/agent-cross-platform-runtime-plan.md\nThis is a longer side note preview that should be trimmed once it crosses the display limit for related references.",
    );
    assert.equal(presentation.resolved, false);
});

test("buildSidebarSideNoteReferencePresentation falls back to the source file title when the target is not indexed", () => {
    const presentation = buildSidebarSideNoteReferencePresentation(null, {
        filePath: "docs/related-note.md",
    });

    assert.equal(presentation.title, "related-note");
    assert.equal(presentation.preview, null);
    assert.equal(presentation.tooltip, "docs/related-note.md");
});

test("buildSidebarSideNoteReferencePresentation normalizes whitespace without fixed truncation", () => {
    assert.equal(
        buildSidebarSideNoteReferencePresentation({
            bodyPreview: "  one   two   three   four  ",
            filePath: "docs/related-note.md",
            fileTitle: "related-note",
            primaryLabel: "related-note",
            resolved: false,
            selectedText: "",
        }).preview,
        "one two three four",
    );
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

test("shouldRenderNestedThreadEntries shows outgoing mention details when expanded even without child comments", () => {
    const thread = createThreadWithEntries({
        entries: [
            {
                id: "entry-1",
                body: [
                    "Parent",
                    "",
                    "Mentioned:",
                    "- [linked note](obsidian://side-note2-comment?vault=dev&file=docs%2Flinked.md&commentId=linked-1)",
                ].join("\n"),
                timestamp: 100,
            },
        ],
        createdAt: 100,
        updatedAt: 100,
    });

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: true,
        showNestedCommentsByDefault: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
        hasOutgoingSideNoteReferences: true,
    }), true);
});

test("shouldRenderNestedThreadEntries shows incoming mention details when expanded even without child comments", () => {
    const thread = createThreadWithEntries({
        entries: [
            {
                id: "entry-1",
                body: "Parent",
                timestamp: 100,
            },
        ],
        createdAt: 100,
        updatedAt: 100,
    });

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: true,
        showNestedCommentsByDefault: false,
        hasEditDraftComment: false,
        hasAppendDraftComment: false,
        hasAgentStream: false,
        hasIncomingSideNoteReferences: true,
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
    assert.equal(shouldRenderThreadNestedToggle({
        hasStoredChildEntries: false,
        hasOutgoingSideNoteReferences: true,
        hasInlineEditDraft: false,
        hasAppendDraftComment: false,
        hasChildEditDraft: false,
    }), true);
    assert.equal(shouldRenderThreadNestedToggle({
        hasStoredChildEntries: false,
        hasIncomingSideNoteReferences: true,
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

test("getDeletedRenderableThreadEntries keeps the deleted root only for a deleted thread", () => {
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
        childEntries: [],
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
                "- [linked note](obsidian://side-note2-comment?vault=dev&file=docs%2Flinked.md&commentId=linked-1)",
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

test("getInsertableSidebarCommentMarkdown strips managed SideNote2 blocks before inserting into a file", () => {
    assert.equal(
        getInsertableSidebarCommentMarkdown(
            "entry-2",
            [
                "Intro line.",
                "",
                "<!-- SideNote2 comments",
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
