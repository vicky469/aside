import * as assert from "node:assert/strict";
import test from "node:test";
import type { DraftComment } from "../src/domain/drafts";
import {
    buildBookmarkDraftButtonPresentation,
    buildDraftCommentPresentation,
    shouldRenderBookmarkDraftButton,
    toggleBookmarkDraftState,
} from "../src/ui/views/sidebarDraftComment";

function createDraft(overrides: Partial<DraftComment> = {}): DraftComment {
    return {
        id: overrides.id ?? "draft-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        startLine: overrides.startLine ?? 9,
        startChar: overrides.startChar ?? 2,
        endLine: overrides.endLine ?? 9,
        endChar: overrides.endChar ?? 11,
        selectedText: overrides.selectedText ?? "draft",
        selectedTextHash: overrides.selectedTextHash ?? "hash:draft",
        comment: overrides.comment ?? "Draft body",
        timestamp: overrides.timestamp ?? 100,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
        mode: overrides.mode ?? "new",
    };
}

test("buildDraftCommentPresentation includes draft state classes and add/save label", () => {
    const createPresentation = buildDraftCommentPresentation(createDraft({
        anchorKind: "page",
        resolved: true,
        mode: "new",
    }), "draft-1");
    const editPresentation = buildDraftCommentPresentation(createDraft({
        id: "draft-2",
        orphaned: true,
        mode: "edit",
    }), null);

    assert.deepEqual(createPresentation.classes, [
        "sidenote2-comment-item",
        "sidenote2-comment-draft",
        "is-new",
        "page-note",
        "resolved",
        "active",
    ]);
    assert.equal(createPresentation.saveLabel, "Add");

    assert.deepEqual(editPresentation.classes, [
        "sidenote2-comment-item",
        "sidenote2-comment-draft",
        "is-edit",
        "orphaned",
    ]);
    assert.equal(editPresentation.saveLabel, "Save");
});

test("buildDraftCommentPresentation keeps append drafts distinct from new drafts", () => {
    const appendPresentation = buildDraftCommentPresentation(createDraft({
        mode: "append",
    }), null);

    assert.deepEqual(appendPresentation.classes, [
        "sidenote2-comment-item",
        "sidenote2-comment-draft",
        "is-append",
    ]);
    assert.equal(appendPresentation.saveLabel, "Add");
    assert.equal(appendPresentation.placeholder, "Add another entry to this thread.");
});

test("buildBookmarkDraftButtonPresentation keeps bookmark toggles lightweight", () => {
    assert.deepEqual(buildBookmarkDraftButtonPresentation({
        mode: "edit",
        isBookmark: false,
    }), {
        ariaLabel: "Mark as bookmark",
        title: "Mark as bookmark and keep editing",
        active: false,
    });
    assert.deepEqual(buildBookmarkDraftButtonPresentation({
        mode: "edit",
        isBookmark: true,
    }), {
        ariaLabel: "Remove bookmark",
        title: "Remove bookmark and keep editing",
        active: true,
    });
    assert.deepEqual(buildBookmarkDraftButtonPresentation({
        mode: "new",
        isBookmark: false,
    }), {
        ariaLabel: "Mark as bookmark",
        title: "Mark as bookmark and keep editing",
        active: false,
    });
    assert.deepEqual(buildBookmarkDraftButtonPresentation({
        mode: "new",
        isBookmark: true,
    }), {
        ariaLabel: "Remove bookmark",
        title: "Remove bookmark and keep editing",
        active: true,
    });
});

test("toggleBookmarkDraftState flips bookmark state", () => {
    assert.equal(toggleBookmarkDraftState(false), true);
    assert.equal(toggleBookmarkDraftState(true), false);
});

test("shouldRenderBookmarkDraftButton supports new and edit drafts but not append or page-note drafts", () => {
    assert.equal(shouldRenderBookmarkDraftButton(createDraft({ mode: "new" })), true);
    assert.equal(shouldRenderBookmarkDraftButton(createDraft({ mode: "edit" })), true);
    assert.equal(shouldRenderBookmarkDraftButton(createDraft({ mode: "append" })), false);
    assert.equal(shouldRenderBookmarkDraftButton(createDraft({
        mode: "edit",
        anchorKind: "page",
    })), false);
});
