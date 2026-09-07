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

test("sidebar drop reorders request an optimistic render", () => {
    assert.ok(methodSource, "missing sidebar reorder interaction method");
    const reorderCalls = methodSource.match(/this\.plugin\.reorder(?:ThreadsForFile|ThreadEntries)\(/g) ?? [];
    const optimisticOptions = methodSource.match(/optimisticViewRefresh: true/g) ?? [];
    const skippedPersistedRefreshes = methodSource.match(/skipPersistedViewRefresh: true/g) ?? [];

    assert.equal(reorderCalls.length, 4);
    assert.equal(optimisticOptions.length, reorderCalls.length);
    assert.equal(skippedPersistedRefreshes.length, reorderCalls.length);
});

test("nested moves preserve focus without forcing a post-save scroll", () => {
    const nestMethod = asideViewSource.match(
        /private async nestSidebarCommentThreadUnderThread\([\s\S]*?\n {4}private async moveSidebarCommentEntryToThread\(/,
    )?.[0];
    const moveMethod = asideViewSource.match(
        /private async moveSidebarCommentEntryToThread\([\s\S]*?\n {4}private async togglePinnedSidebarMode\(/,
    )?.[0];

    assert.ok(nestMethod);
    assert.ok(moveMethod);
    assert.match(nestMethod, /setActiveComment\(sourceThreadId\)/);
    assert.match(moveMethod, /setActiveComment\(entryId\)/);
    assert.doesNotMatch(nestMethod, /highlightComment\(/);
    assert.doesNotMatch(moveMethod, /highlightComment\(/);
});
