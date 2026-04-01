import * as assert from "node:assert/strict";
import test from "node:test";
import { remapSelectionOffsetAfterManagedSectionEdit } from "../src/core/text/editOffsets";

test("remapSelectionOffsetAfterManagedSectionEdit keeps the caret before a managed block inserted at offset zero", () => {
    const edit = {
        fromOffset: 0,
        toOffset: 0,
        replacement: "\n<!-- SideNote2 comments\n[]\n-->\n",
    };

    assert.equal(remapSelectionOffsetAfterManagedSectionEdit(0, edit), 0);
});

test("remapSelectionOffsetAfterManagedSectionEdit shifts offsets that are after the edited range", () => {
    const edit = {
        fromOffset: 10,
        toOffset: 15,
        replacement: "\n",
    };

    assert.equal(remapSelectionOffsetAfterManagedSectionEdit(20, edit), 16);
});

test("remapSelectionOffsetAfterManagedSectionEdit clamps offsets inside the edited range to the start", () => {
    const edit = {
        fromOffset: 10,
        toOffset: 20,
        replacement: "\n<!-- SideNote2 comments\n[]\n-->\n",
    };

    assert.equal(remapSelectionOffsetAfterManagedSectionEdit(15, edit), 10);
});
