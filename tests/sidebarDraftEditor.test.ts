import * as assert from "node:assert/strict";
import test from "node:test";
import type { Comment } from "../src/commentManager";
import type { DraftComment } from "../src/domain/drafts";
import {
    DEFAULT_HIGHLIGHT_HOTKEY,
    SidebarDraftEditorController,
    eventMatchesHotkey,
    estimateDraftTextareaRows,
    getSidebarComments,
    resolveHighlightHotkeysFromConfig,
} from "../src/ui/views/sidebarDraftEditor";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        startLine: overrides.startLine ?? 5,
        startChar: overrides.startChar ?? 1,
        endLine: overrides.endLine ?? 5,
        endChar: overrides.endChar ?? 8,
        selectedText: overrides.selectedText ?? "comment",
        selectedTextHash: overrides.selectedTextHash ?? "hash:comment",
        comment: overrides.comment ?? "Comment body",
        timestamp: overrides.timestamp ?? 100,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
    };
}

function createDraft(overrides: Partial<DraftComment> = {}): DraftComment {
    return {
        ...createComment(overrides),
        mode: overrides.mode ?? "new",
    };
}

test("getSidebarComments replaces the persisted version of the draft, hides resolved comments, and sorts consistently", () => {
    const persistedComments = [
        createComment({ id: "comment-b", filePath: "docs/b.md", startLine: 8, timestamp: 300 }),
        createComment({ id: "draft-1", filePath: "docs/b.md", startLine: 12, timestamp: 400 }),
        createComment({ id: "comment-resolved", filePath: "docs/a.md", resolved: true, timestamp: 50 }),
        createComment({ id: "comment-a", filePath: "docs/a.md", startLine: 3, timestamp: 200 }),
    ];
    const draft = createDraft({
        id: "draft-1",
        filePath: "docs/b.md",
        startLine: 12,
        timestamp: 500,
        comment: "Draft body",
    });

    const comments = getSidebarComments(persistedComments, draft, false);

    assert.deepEqual(comments.map((comment) => ({
        id: comment.id,
        filePath: comment.filePath,
        timestamp: comment.timestamp,
        isDraft: "mode" in comment,
    })), [
        { id: "comment-a", filePath: "docs/a.md", timestamp: 200, isDraft: false },
        { id: "comment-b", filePath: "docs/b.md", timestamp: 300, isDraft: false },
        { id: "draft-1", filePath: "docs/b.md", timestamp: 500, isDraft: true },
    ]);
});

test("estimateDraftTextareaRows keeps draft editors within their intended bounds", () => {
    assert.equal(estimateDraftTextareaRows("Short", false), 4);
    assert.equal(estimateDraftTextareaRows("Short", true), 6);

    const longLine = "x".repeat(2_000);
    assert.equal(estimateDraftTextareaRows(longLine, false), 10);
    assert.equal(estimateDraftTextareaRows(longLine, true), 18);
});

test("sidebar draft editor controller saves only on plain enter", () => {
    const controller = new SidebarDraftEditorController({
        getAllIndexedComments: () => [],
        updateDraftCommentText: () => {},
        renderComments: async () => {},
        scheduleDraftFocus: () => {},
        openLinkSuggestModal: () => {},
        openTagSuggestModal: () => {},
    });

    assert.equal(controller.shouldSaveDraftFromEnter({
        key: "Enter",
        shiftKey: false,
        altKey: false,
        isComposing: false,
    } as KeyboardEvent), true);
    assert.equal(controller.shouldSaveDraftFromEnter({
        key: "Enter",
        shiftKey: true,
        altKey: false,
        isComposing: false,
    } as KeyboardEvent), false);
    assert.equal(controller.shouldSaveDraftFromEnter({
        key: "Enter",
        shiftKey: false,
        altKey: true,
        isComposing: false,
    } as KeyboardEvent), false);
    assert.equal(controller.shouldSaveDraftFromEnter({
        key: "Enter",
        shiftKey: false,
        altKey: false,
        isComposing: true,
    } as KeyboardEvent), false);
});

test("resolveHighlightHotkeysFromConfig uses the configured editor highlight shortcut", () => {
    assert.deepEqual(resolveHighlightHotkeysFromConfig([
        {
            modifiers: ["Mod", "Shift"],
            key: "H",
        },
    ]), [
        {
            modifiers: ["Mod", "Shift"],
            key: "H",
        },
    ]);
});

test("resolveHighlightHotkeysFromConfig falls back to Alt+H when the command is unbound", () => {
    assert.deepEqual(resolveHighlightHotkeysFromConfig(null), [DEFAULT_HIGHLIGHT_HOTKEY]);
    assert.deepEqual(resolveHighlightHotkeysFromConfig([]), [DEFAULT_HIGHLIGHT_HOTKEY]);
});

test("eventMatchesHotkey supports Mod bindings on macOS", () => {
    assert.equal(eventMatchesHotkey({
        key: "h",
        altKey: false,
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        isComposing: false,
    } as KeyboardEvent, {
        modifiers: ["Mod"],
        key: "H",
    }, true), true);
});

test("eventMatchesHotkey supports Alt fallback bindings", () => {
    assert.equal(eventMatchesHotkey({
        key: "H",
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        isComposing: false,
    } as KeyboardEvent, DEFAULT_HIGHLIGHT_HOTKEY, true), true);
});
