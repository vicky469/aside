import * as assert from "node:assert/strict";
import test from "node:test";
import {
    buildSidebarFileInsertEdit,
    getSingleOpenFileInsertTarget,
    type SidebarFileInsertEdit,
} from "../src/ui/views/sidebarFileInsertion";

function applyEdit(content: string, edit: SidebarFileInsertEdit): string {
    const lines = content.split("\n");
    const line = lines[edit.position.line] ?? "";
    lines[edit.position.line] = `${line.slice(0, edit.position.ch)}${edit.text}${line.slice(edit.position.ch)}`;
    return lines.join("\n");
}

test("buildSidebarFileInsertEdit inserts on the next line after the cursor line", () => {
    const content = "Alpha\nBeta\nGamma";
    const edit = buildSidebarFileInsertEdit(content, "Inserted", 1);

    assert.deepEqual(edit, {
        position: {
            line: 1,
            ch: 4,
        },
        text: "\nInserted",
    });
    assert.equal(applyEdit(content, edit!), "Alpha\nBeta\nInserted\nGamma");
});

test("buildSidebarFileInsertEdit appends to the end when no cursor line exists", () => {
    const content = "Alpha\nBeta";
    const edit = buildSidebarFileInsertEdit(content, "Inserted", null);

    assert.deepEqual(edit, {
        position: {
            line: 1,
            ch: 4,
        },
        text: "\n\nInserted",
    });
    assert.equal(applyEdit(content, edit!), "Alpha\nBeta\n\nInserted");
});

test("buildSidebarFileInsertEdit appends cleanly when the file already ends with blank space", () => {
    const content = "Alpha\n\n";
    const edit = buildSidebarFileInsertEdit(content, "Inserted", null);

    assert.deepEqual(edit, {
        position: {
            line: 2,
            ch: 0,
        },
        text: "Inserted",
    });
    assert.equal(applyEdit(content, edit!), "Alpha\n\nInserted");
});

test("buildSidebarFileInsertEdit appends to empty files", () => {
    const edit = buildSidebarFileInsertEdit("", "Inserted", null);

    assert.deepEqual(edit, {
        position: {
            line: 0,
            ch: 0,
        },
        text: "Inserted",
    });
    assert.equal(applyEdit("", edit!), "Inserted");
});

test("buildSidebarFileInsertEdit falls back to file end for stale cursor lines", () => {
    const content = "Alpha";
    const edit = buildSidebarFileInsertEdit(content, "Inserted", 3);

    assert.deepEqual(edit, {
        position: {
            line: 0,
            ch: 5,
        },
        text: "\n\nInserted",
    });
});

test("getSingleOpenFileInsertTarget returns a target only when exactly one file is open", () => {
    assert.equal(getSingleOpenFileInsertTarget([]), null);
    assert.equal(getSingleOpenFileInsertTarget(["only"]), "only");
    assert.equal(getSingleOpenFileInsertTarget(["first", "second"]), null);
});
