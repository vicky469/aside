import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const asideViewSource = readFileSync("src/ui/views/AsideView.ts", "utf8");
const methodSource = asideViewSource.match(
    /private setupPageThreadReorderInteractions\([\s\S]*?\n {4}private resolveIndexThreadDropTarget\(/,
)?.[0];

function getIndexSurfaceBranch(eventName) {
    assert.ok(methodSource, "missing sidebar reorder interaction method");
    const eventStart = methodSource.indexOf(`commentsBody.addEventListener("${eventName}"`);
    const nextNoteBranch = methodSource.indexOf("\n            const threadDropTarget", eventStart);
    assert.ok(eventStart >= 0, `missing ${eventName} listener`);
    assert.ok(nextNoteBranch > eventStart, `missing note ${eventName} branch`);
    return methodSource.slice(eventStart, nextNoteBranch);
}

test("Index drag routing accepts child entry targets", () => {
    const dragoverIndexBranch = getIndexSurfaceBranch("dragover");
    assert.match(
        dragoverIndexBranch,
        /this\.resolveChildEntryMoveDropTarget\(event\)/,
    );
});

test("Index drops reorder or reparent child entries through canonical handlers", () => {
    const dropIndexBranch = getIndexSurfaceBranch("drop");
    assert.match(dropIndexBranch, /dragState\.kind === "thread-entry"/);
    assert.match(dropIndexBranch, /this\.plugin\.reorderThreadEntries\(/);
    assert.match(dropIndexBranch, /this\.moveSidebarCommentEntryToThread\(/);
});
