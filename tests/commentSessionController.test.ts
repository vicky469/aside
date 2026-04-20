import * as assert from "node:assert/strict";
import test from "node:test";
import { CommentSessionController } from "../src/control/commentSessionController";
import type { DraftComment } from "../src/domain/drafts";

function createDraft(overrides: Partial<DraftComment> = {}): DraftComment {
    return {
        id: overrides.id ?? "draft-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        startLine: overrides.startLine ?? 10,
        startChar: overrides.startChar ?? 2,
        endLine: overrides.endLine ?? 10,
        endChar: overrides.endChar ?? 18,
        selectedText: overrides.selectedText ?? "Module Blueprint",
        selectedTextHash: overrides.selectedTextHash ?? "hash:module-blueprint",
        comment: overrides.comment ?? "Draft note",
        timestamp: overrides.timestamp ?? 123,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
        mode: overrides.mode ?? "new",
    };
}

function createHarness() {
    let refreshCommentViewsCount = 0;
    let refreshEditorDecorationsCount = 0;
    let refreshMarkdownPreviewsCount = 0;
    const clearedMarkdownSelections: string[] = [];

    const controller = new CommentSessionController({
        refreshCommentViews: async () => {
            refreshCommentViewsCount += 1;
        },
        refreshEditorDecorations: () => {
            refreshEditorDecorationsCount += 1;
        },
        refreshMarkdownPreviews: () => {
            refreshMarkdownPreviewsCount += 1;
        },
        clearMarkdownSelection: (filePath) => {
            clearedMarkdownSelections.push(filePath);
        },
    });

    return {
        controller,
        getRefreshCommentViewsCount: () => refreshCommentViewsCount,
        getRefreshEditorDecorationsCount: () => refreshEditorDecorationsCount,
        getRefreshMarkdownPreviewsCount: () => refreshMarkdownPreviewsCount,
        clearedMarkdownSelections,
    };
}

test("comment session controller refreshes comment visibility when resolved comments are toggled", async () => {
    const harness = createHarness();

    assert.equal(harness.controller.shouldShowResolvedComments(), false);
    assert.equal(await harness.controller.setShowResolvedComments(true), true);
    assert.equal(harness.controller.shouldShowResolvedComments(), true);
    assert.equal(harness.getRefreshCommentViewsCount(), 1);
    assert.equal(harness.getRefreshEditorDecorationsCount(), 1);
    assert.equal(harness.getRefreshMarkdownPreviewsCount(), 1);

    assert.equal(await harness.controller.setShowResolvedComments(true), false);
    assert.equal(harness.getRefreshCommentViewsCount(), 1);
    assert.equal(harness.getRefreshEditorDecorationsCount(), 1);
    assert.equal(harness.getRefreshMarkdownPreviewsCount(), 1);
});

test("comment session controller refreshes comment views when nested comments are toggled", async () => {
    const harness = createHarness();

    assert.equal(harness.controller.shouldShowNestedComments(), true);
    assert.equal(await harness.controller.setShowNestedComments(false), true);
    assert.equal(harness.controller.shouldShowNestedComments(), false);
    assert.equal(harness.getRefreshCommentViewsCount(), 1);
    assert.equal(harness.getRefreshEditorDecorationsCount(), 0);
    assert.equal(harness.getRefreshMarkdownPreviewsCount(), 0);

    assert.equal(await harness.controller.setShowNestedComments(false), false);
    assert.equal(harness.getRefreshCommentViewsCount(), 1);
});

test("comment session controller can override nested comment visibility per thread and reset with show all", async () => {
    const harness = createHarness();

    assert.equal(harness.controller.shouldShowNestedCommentsForThread("thread-1"), true);
    assert.equal(await harness.controller.setShowNestedCommentsForThread("thread-1", false), true);
    assert.equal(harness.controller.shouldShowNestedCommentsForThread("thread-1"), false);
    assert.equal(harness.controller.shouldShowNestedCommentsForThread("thread-2"), true);
    assert.equal(harness.getRefreshCommentViewsCount(), 1);

    assert.equal(await harness.controller.setShowNestedCommentsForThread("thread-1", false), false);
    assert.equal(harness.getRefreshCommentViewsCount(), 1);

    assert.equal(await harness.controller.setShowNestedComments(false), true);
    assert.equal(harness.controller.shouldShowNestedCommentsForThread("thread-1"), false);
    assert.equal(harness.controller.shouldShowNestedCommentsForThread("thread-2"), false);
    assert.equal(harness.getRefreshCommentViewsCount(), 2);

    assert.equal(await harness.controller.setShowNestedCommentsForThread("thread-1", true), true);
    assert.equal(harness.controller.shouldShowNestedCommentsForThread("thread-1"), true);
    assert.equal(harness.controller.shouldShowNestedCommentsForThread("thread-2"), false);
    assert.equal(harness.getRefreshCommentViewsCount(), 3);

    assert.equal(await harness.controller.setShowNestedComments(true), true);
    assert.equal(harness.controller.shouldShowNestedCommentsForThread("thread-1"), true);
    assert.equal(harness.controller.shouldShowNestedCommentsForThread("thread-2"), true);
    assert.equal(harness.getRefreshCommentViewsCount(), 4);
});

test("comment session controller tracks revealed comments and clears markdown selections on reset", () => {
    const harness = createHarness();

    assert.equal(
        harness.controller.setRevealedCommentState("docs/architecture.md", "comment-1"),
        true,
    );
    assert.equal(
        harness.controller.getRevealedCommentId("docs/architecture.md"),
        "comment-1",
    );
    assert.equal(harness.getRefreshEditorDecorationsCount(), 1);
    assert.equal(harness.getRefreshMarkdownPreviewsCount(), 1);

    assert.equal(
        harness.controller.setRevealedCommentState("docs/architecture.md", "comment-1"),
        false,
    );
    assert.equal(harness.getRefreshEditorDecorationsCount(), 1);
    assert.equal(harness.getRefreshMarkdownPreviewsCount(), 1);

    harness.controller.clearRevealedCommentSelection();
    assert.equal(harness.controller.getRevealedCommentId("docs/architecture.md"), null);
    assert.equal(harness.getRefreshEditorDecorationsCount(), 2);
    assert.equal(harness.getRefreshMarkdownPreviewsCount(), 2);
    assert.deepEqual(harness.clearedMarkdownSelections, ["docs/architecture.md"]);
});

test("comment session controller can skip markdown preview rerender for a revealed comment update", () => {
    const harness = createHarness();

    assert.equal(
        harness.controller.setRevealedCommentState("SideNote2 index.md", "comment-7", {
            refreshMarkdownPreviews: false,
        }),
        true,
    );
    assert.equal(harness.controller.getRevealedCommentId("SideNote2 index.md"), "comment-7");
    assert.equal(harness.getRefreshEditorDecorationsCount(), 1);
    assert.equal(harness.getRefreshMarkdownPreviewsCount(), 0);
});

test("comment session controller still refreshes reveal state surfaces when no comment is active", () => {
    const harness = createHarness();

    harness.controller.clearRevealedCommentSelection();

    assert.equal(harness.getRefreshEditorDecorationsCount(), 1);
    assert.equal(harness.getRefreshMarkdownPreviewsCount(), 1);
    assert.deepEqual(harness.clearedMarkdownSelections, []);
});

test("comment session controller manages draft state and refresh side effects", async () => {
    const harness = createHarness();
    const draft = createDraft();

    await harness.controller.setDraftComment(draft, "SideNote2 index.md");
    assert.deepEqual(harness.controller.getDraftForFile(draft.filePath), draft);
    assert.deepEqual(harness.controller.getDraftForView("SideNote2 index.md"), draft);
    assert.equal(harness.controller.getDraftHostFilePath(), "SideNote2 index.md");
    assert.equal(harness.getRefreshCommentViewsCount(), 1);
    assert.equal(harness.getRefreshEditorDecorationsCount(), 1);

    assert.equal(harness.controller.updateDraftCommentText(draft.id, "Updated draft"), true);
    assert.equal(harness.controller.getDraftComment()?.comment, "Updated draft");

    harness.controller.setSavingDraftCommentId(draft.id);
    assert.equal(harness.controller.isSavingDraft(draft.id), true);

    assert.equal(await harness.controller.cancelDraft("other-id"), false);
    assert.equal(harness.getRefreshCommentViewsCount(), 1);
    assert.equal(harness.getRefreshEditorDecorationsCount(), 1);

    assert.equal(await harness.controller.cancelDraft(draft.id), true);
    assert.equal(harness.controller.getDraftComment(), null);
    assert.equal(harness.controller.getDraftHostFilePath(), null);
    assert.equal(harness.getRefreshCommentViewsCount(), 2);
    assert.equal(harness.getRefreshEditorDecorationsCount(), 2);
});
