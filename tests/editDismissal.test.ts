import * as assert from "node:assert/strict";
import test from "node:test";
import { decideEditDismissal } from "../src/ui/views/editDismissal";

test("decideEditDismissal keeps edit mode when clicking inside the draft", () => {
    assert.deepEqual(decideEditDismissal(true, true), {
        shouldCancelDraft: false,
        shouldClearActiveState: false,
    });
});

test("decideEditDismissal exits edit mode when clicking another comment", () => {
    assert.deepEqual(decideEditDismissal(false, true), {
        shouldCancelDraft: true,
        shouldClearActiveState: false,
    });
});

test("decideEditDismissal keeps edit mode on sidebar background click", () => {
    assert.deepEqual(decideEditDismissal(false, false), {
        shouldCancelDraft: false,
        shouldClearActiveState: false,
    });
});
