import * as assert from "node:assert/strict";
import test from "node:test";
import { DraftSessionStore } from "../src/domain/DraftSessionStore";
import type { DraftComment } from "../src/domain/drafts";

function createDraft(overrides: Partial<DraftComment> = {}): DraftComment {
    return {
        id: overrides.id ?? "draft-1",
        filePath: overrides.filePath ?? "Folder/Note.md",
        startLine: overrides.startLine ?? 1,
        startChar: overrides.startChar ?? 2,
        endLine: overrides.endLine ?? 1,
        endChar: overrides.endChar ?? 6,
        selectedText: overrides.selectedText ?? "beta",
        selectedTextHash: overrides.selectedTextHash ?? "hash:beta",
        comment: overrides.comment ?? "Hello",
        timestamp: overrides.timestamp ?? 123,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        mode: overrides.mode ?? "new",
    };
}

test("draft session store tracks draft state by source file and host view", () => {
    const store = new DraftSessionStore();
    const draft = createDraft();

    store.setDraftComment(draft, "Aside index.md");

    assert.deepEqual(store.getDraftComment(), draft);
    assert.deepEqual(store.getDraftForFile(draft.filePath), draft);
    assert.deepEqual(store.getDraftForView("Aside index.md"), draft);
    assert.equal(store.getDraftForView(draft.filePath), null);
});

test("draft session store updates text only for the active draft id", () => {
    const store = new DraftSessionStore();
    const draft = createDraft({ comment: "Before" });
    store.setDraftComment(draft, draft.filePath);

    assert.equal(store.updateDraftCommentText("other-id", "Ignored"), false);
    assert.equal(store.updateDraftCommentText(draft.id, "After"), true);
    assert.equal(store.getDraftComment()?.comment, "After");
});

test("draft session store tracks saving state and can clear a matching draft", () => {
    const store = new DraftSessionStore();
    const draft = createDraft();
    store.setDraftComment(draft, draft.filePath);
    store.setSavingDraftCommentId(draft.id);

    assert.equal(store.isSavingDraft(draft.id), true);
    assert.equal(store.cancelDraft("other-id"), false);
    assert.equal(store.cancelDraft(draft.id), true);
    assert.equal(store.getDraftComment(), null);
    assert.equal(store.getDraftHostFilePath(), null);
});

test("draft session store can move the draft host path without changing the draft file", () => {
    const store = new DraftSessionStore();
    const draft = createDraft({ filePath: "Folder/Note.md" });
    store.setDraftComment(draft, "Aside comments.md");

    store.setDraftHostFilePath("Aside index.md");

    assert.equal(store.getDraftComment()?.filePath, "Folder/Note.md");
    assert.deepEqual(store.getDraftForView("Aside index.md"), draft);
    assert.equal(store.getDraftForView("Aside comments.md"), null);
});
