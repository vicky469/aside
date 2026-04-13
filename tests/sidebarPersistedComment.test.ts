import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment, type CommentThread } from "../src/commentManager";
import {
    buildPersistedCommentPresentation,
    buildPersistedThreadEntryPresentation,
    formatSidebarCommentSourceFileLabel,
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
        hasAppendDraftComment: false,
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
        hasAppendDraftComment: false,
    }), true);
});

test("shouldRenderNestedThreadEntries keeps append drafts visible even when nested comments are off", () => {
    const thread = createThreadWithEntries();

    assert.equal(shouldRenderNestedThreadEntries(thread, {
        activeCommentId: null,
        showNestedComments: false,
        hasAppendDraftComment: true,
    }), true);
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
