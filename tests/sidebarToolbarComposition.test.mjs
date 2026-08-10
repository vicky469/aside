import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const asideViewSource = readFileSync("src/ui/views/AsideView.ts", "utf8");
const rendererSource = readFileSync("src/ui/views/sidebarToolbarRenderer.ts", "utf8");
const stylesSource = readFileSync("styles.css", "utf8");

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
    assert.match(
        asideViewSource,
        /\? this\.getIndexSearchInputOptions\(\s*resolvedIndexSidebarMode,\s*options\.selectedIndexFileFilterRootPath,?\s*\)/,
    );
    assert.doesNotMatch(asideViewSource, /this\.renderIndexSearchInput\(/);
});

test("shared search rendering supports native disabled semantics", () => {
    assert.match(rendererSource, /export interface SidebarSearchInputOptions \{[\s\S]*?disabled\?: boolean;/);
    assert.match(rendererSource, /inputEl\.disabled = options\.disabled \?\? false;/);
    assert.match(rendererSource, /fieldEl\.classList\.toggle\("is-disabled", inputEl\.disabled\);/);
    assert.equal(rendererSource.match(/if \(inputEl\.disabled\) \{/g)?.length, 3);
    assert.match(stylesSource, /\.aside-note-search-field\.is-disabled/);
});

test("index search derives disabled state and guidance from file scope", () => {
    const methodSource = asideViewSource.match(
        /private getIndexSearchInputOptions\([\s\S]*?\): SidebarSearchInputOptions \{[\s\S]*?\n {4}private renderPrimarySidebarModeControl\(/,
    )?.[0];

    assert.ok(methodSource, "missing index search options method");
    assert.match(methodSource, /resolveIndexSidebarSearchAvailability\(/);
    assert.match(methodSource, /disabled:\s*availability\.disabled/);
    assert.match(methodSource, /placeholder:\s*availability\.placeholder/);
    assert.doesNotMatch(methodSource, /ariaLabel:/);
});

test("note search remains enabled through the shared renderer default", () => {
    const methodSource = asideViewSource.match(
        /private getNoteSearchInputOptions\(\): SidebarSearchInputOptions \{[\s\S]*?\n {4}private getIndexSearchInputOptions\(/,
    )?.[0];

    assert.ok(methodSource, "missing note search options method");
    assert.doesNotMatch(methodSource, /disabled:/);
    assert.match(rendererSource, /inputEl\.disabled = options\.disabled \?\? false;/);
});

test("index file-scope changes share search-state cleanup", () => {
    assert.match(asideViewSource, /private applyIndexSidebarSearchStateForFileScope\(/);
    assert.match(asideViewSource, /this\.applyIndexSidebarSearchStateForFileScope\(nextRootPath\)/);
    assert.match(asideViewSource, /this\.applyIndexSidebarSearchStateForFileScope\(normalizedRootPath\)/);
    assert.match(asideViewSource, /this\.applyIndexSidebarSearchStateForFileScope\(selectedIndexFileFilterRootPath\)/);
});

test("scope recovery completes before index search request version is captured", () => {
    const renderSource = asideViewSource.match(
        /public async renderComments\([\s\S]*?\n {4}private async renderPageSidebar\(/,
    )?.[0];

    assert.ok(renderSource, "missing renderComments method");
    const scopeRecoveryIndex = renderSource.lastIndexOf(
        "this.applyIndexSidebarSearchStateForFileScope(selectedIndexFileFilterRootPath)",
    );
    const requestCaptureIndex = renderSource.indexOf(
        "const indexSearchRequestVersion = this.indexSidebarSearchRequestVersion",
    );
    assert.ok(scopeRecoveryIndex >= 0, "missing scope recovery");
    assert.ok(requestCaptureIndex > scopeRecoveryIndex, "request version must be captured after scope recovery");
});

test("note and index card lists consume the shared item reconciler", () => {
    assert.match(asideViewSource, /reconcileSidebarItems\(/u);
    assert.doesNotMatch(asideViewSource, /private async reconcileNoteSidebarItems\(/u);
});

test("index card search uses bounded ranking and shared reconciliation", () => {
    assert.match(asideViewSource, /buildIndexSidebarSearchWindow\(/u);
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

test("toolbar and restored-state mode changes share index search-state cleanup", () => {
    const setStateSource = asideViewSource.match(
        /async setState\(state: CustomViewState,[\s\S]*?await super\.setState\(state, result\);/u,
    )?.[0];
    const toolbarSource = asideViewSource.match(
        /if \(options\.isAllCommentsView\) \{[\s\S]*?\n {8}\} else \{/u,
    )?.[0];

    assert.ok(setStateSource, "missing restored view-state handler");
    assert.ok(toolbarSource, "missing index toolbar mode handler");
    assert.match(setStateSource, /this\.applyIndexSidebarSearchStateForMode\(nextMode\)/u);
    assert.match(toolbarSource, /this\.applyIndexSidebarSearchStateForMode\(mode\)/u);
});
