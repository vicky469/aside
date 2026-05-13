import * as assert from "node:assert/strict";
import test from "node:test";
import type { DraftComment } from "../src/domain/drafts";
import {
    buildDraftCommentPresentation,
    isDraftSaveActionDisabled,
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
        "aside-comment-item",
        "aside-comment-draft",
        "is-new",
        "page-note",
        "resolved",
        "active",
    ]);
    assert.equal(createPresentation.saveLabel, "Add");

    assert.deepEqual(editPresentation.classes, [
        "aside-comment-item",
        "aside-comment-draft",
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
        "aside-comment-item",
        "aside-comment-draft",
        "is-append",
    ]);
    assert.equal(appendPresentation.saveLabel, "Add");
    assert.equal(appendPresentation.placeholder, "Add another entry to this thread.");
});

test("isDraftSaveActionDisabled allows empty new anchored notes but blocks other empty drafts", () => {
    assert.equal(isDraftSaveActionDisabled(createDraft({
        anchorKind: "selection",
        mode: "new",
    }), "   "), false);

    assert.equal(isDraftSaveActionDisabled(createDraft({
        anchorKind: undefined,
        mode: "new",
    }), "   "), false);

    assert.equal(isDraftSaveActionDisabled(createDraft({
        anchorKind: "page",
        mode: "new",
    }), "   "), true);

    assert.equal(isDraftSaveActionDisabled(createDraft({
        anchorKind: "selection",
        mode: "append",
    }), "   "), true);
});

test("isDraftSaveActionDisabled blocks over-limit saves", () => {
    assert.equal(isDraftSaveActionDisabled(createDraft(), `${"word ".repeat(301)}`), true);
});
