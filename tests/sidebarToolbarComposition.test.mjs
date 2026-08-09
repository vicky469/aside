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

test("index search keeps its placeholder without a tooltip-producing label", () => {
    const methodSource = asideViewSource.match(
        /private getIndexSearchInputOptions\(\): SidebarSearchInputOptions \{[\s\S]*?\n {4}private renderPrimarySidebarModeControl\(/,
    )?.[0];

    assert.ok(methodSource, "missing index search options method");
    assert.match(methodSource, /placeholder:\s*"Search side notes in index"/);
    assert.doesNotMatch(methodSource, /ariaLabel:\s*"Search index side notes"/);
});

test("note and index card lists consume the shared item reconciler", () => {
    assert.match(asideViewSource, /reconcileSidebarItems\(/u);
    assert.doesNotMatch(asideViewSource, /private async reconcileNoteSidebarItems\(/u);
});

test("index card search uses bounded ranking and shared reconciliation", () => {
    assert.match(asideViewSource, /resolveIndexSidebarSearchResultLimit\(/u);
    assert.match(asideViewSource, /rankSidebarSearchResults\(/u);
    assert.match(asideViewSource, /ensureIndexSidebarShell\(/u);
    assert.doesNotMatch(asideViewSource, /const renderPromises = renderedItems\.map/u);
});

test("superseded index search stops before highlights are committed", () => {
    const reconciliationSource = asideViewSource.match(
        /const completed = await reconcileSidebarItems\(shell\.commentsBodyEl,[\s\S]*?this\.refreshSidebarSearchHighlights\(shell\.commentsBodyEl, this\.indexSidebarSearchQuery\);/u,
    )?.[0];

    assert.ok(reconciliationSource, "missing index reconciliation and highlight sequence");
    assert.match(reconciliationSource, /indexSearchRequestVersion === this\.indexSidebarSearchRequestVersion/u);
    assert.match(reconciliationSource, /if \(!completed\) \{\s*return;\s*\}/u);
    assert.ok(
        reconciliationSource.indexOf("if (!completed)")
            < reconciliationSource.indexOf("this.refreshSidebarSearchHighlights"),
        "stale reconciliation must return before highlighting",
    );
});
