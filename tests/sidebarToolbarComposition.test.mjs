import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const asideViewSource = readFileSync("src/ui/views/AsideView.ts", "utf8");

test("note and index surfaces consume one shared secondary toolbar renderer", () => {
    const methodSource = asideViewSource.match(
        /private renderSidebarToolbar\([\s\S]*?\n {4}private renderNoteSidebarTagFilterRow\(/,
    )?.[0];

    assert.ok(methodSource, "missing sidebar toolbar composition method");
    assert.equal(methodSource.match(/renderSidebarSecondaryToolbar\(/g)?.length, 1);
    assert.doesNotMatch(methodSource, /createDiv\(["']aside-sidebar-toolbar-row is-(?:note|index)-secondary-row/);
    assert.match(methodSource, /surface:\s*toolbarSurface/);
});

test("index search is supplied only through the shared toolbar plan", () => {
    assert.match(asideViewSource, /search:\s*secondaryPlan\.showSearch/);
    assert.match(asideViewSource, /\? this\.getIndexSearchInputOptions\(\)/);
    assert.doesNotMatch(asideViewSource, /this\.renderIndexSearchInput\(/);
});
