import * as assert from "node:assert/strict";
import test from "node:test";
import { decideEditDismissal } from "../src/ui/views/editDismissal";

test("decideEditDismissal keeps edit mode when clicking inside the draft", () => {
    assert.deepEqual(decideEditDismissal(true, true, false), {
        shouldSaveDraft: false,
        shouldClearActiveState: false,
        shouldClearRevealedCommentSelection: false,
    });
});

test("decideEditDismissal autosaves when clicking another comment", () => {
    assert.deepEqual(decideEditDismissal(false, true, false), {
        shouldSaveDraft: true,
        shouldClearActiveState: false,
        shouldClearRevealedCommentSelection: false,
    });
});

test("decideEditDismissal autosaves and clears state on sidebar background click", () => {
    assert.deepEqual(decideEditDismissal(false, false, false), {
        shouldSaveDraft: true,
        shouldClearActiveState: true,
        shouldClearRevealedCommentSelection: true,
    });
});

test("decideEditDismissal autosaves without clearing revealed selection on toolbar click", () => {
    assert.deepEqual(decideEditDismissal(false, false, true), {
        shouldSaveDraft: true,
        shouldClearActiveState: true,
        shouldClearRevealedCommentSelection: false,
    });
});
