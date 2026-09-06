import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rendererSource = readFileSync("src/ui/views/sidebarIndexTagSearchRenderer.ts", "utf8");
const asideViewSource = readFileSync("src/ui/views/AsideView.ts", "utf8");

test("index tag renderer reuses shared tag filters and file rows", () => {
    assert.match(rendererSource, /renderSidebarTagFilterBar/);
    assert.match(rendererSource, /renderSidebarTagFileRows/);
    assert.match(rendererSource, /buildIndexTagSearchWindow/);
    assert.match(rendererSource, /label:\s*"All matches"/);
    assert.match(rendererSource, /ariaLabel:\s*"Filter tag search results"/);
    assert.match(rendererSource, /pathLabel:\s*file\.filePath/);
});

test("index tag renderer owns quiet initial empty and no-match states", () => {
    assert.match(rendererSource, /Search tags across your vault/);
    assert.match(rendererSource, /No matching tags/);
    assert.match(rendererSource, /aside-index-tag-search-empty/);
});

test("index tag renderer exposes bounded incremental results", () => {
    assert.match(rendererSource, /window\.visibleCount/);
    assert.match(rendererSource, /window\.totalCount/);
    assert.match(rendererSource, /window\.hasMore/);
    assert.match(rendererSource, /aside-index-tag-search-show-more/);
    assert.match(rendererSource, /options\.onShowMore\(\)/);
});

test("index tag renderer has no tag mutation capability", () => {
    assert.doesNotMatch(
        rendererSource,
        /applyTag|removeTag|createTag|checkbox|BatchTag|selectedThread|commentMutation/,
    );
});

test("AsideView owns a tag-only body fast path and direct file navigation", () => {
    const renderCommentsSource = asideViewSource.match(
        /public async renderComments\([\s\S]*?\n {4}private async renderPageSidebar\(/,
    )?.[0];

    assert.ok(renderCommentsSource, "missing renderComments method");
    assert.match(asideViewSource, /private renderIndexTagSearchBody\(/);
    assert.match(asideViewSource, /private renderIndexTagSearchSidebar\(/);
    assert.match(asideViewSource, /renderSidebarIndexTagSearch\(/);
    assert.match(asideViewSource, /getIndexedMarkdownFilesForTag/);
    assert.match(asideViewSource, /effectiveIndexSidebarMode === "tags"/);
    assert.match(asideViewSource, /this\.renderIndexTagSearchBody\(shell\.commentsBodyEl\)/);
    assert.ok(
        renderCommentsSource.indexOf("this.renderIndexTagSearchSidebar(")
            < renderCommentsSource.indexOf("ensureIndexedCommentsLoaded("),
        "index Tags fast path must precede comment loading and scoping",
    );
    assert.match(
        asideViewSource,
        /private async openIndexTagSearchFile\([\s\S]*?getAbstractFileByPath\(filePath\)[\s\S]*?getPreferredFileLeaf\(filePath\)[\s\S]*?openFile\(targetFile\)[\s\S]*?setActiveLeaf/,
    );
    assert.doesNotMatch(
        asideViewSource,
        /openIndexTagSearchFile\([\s\S]{0,400}syncIndexPreviewFileScope/,
    );
});

test("tag query filter and pagination rerender only the tag body", () => {
    const applySource = asideViewSource.match(
        /private applyIndexTagSearchQuery\([\s\S]*?\n {4}(?:private|public) /,
    )?.[0];
    const filterSource = asideViewSource.match(
        /private setIndexTagSearchFilter\([\s\S]*?\n {4}(?:private|public) /,
    )?.[0];
    const moreSource = asideViewSource.match(
        /private showMoreIndexTagSearchFiles\([\s\S]*?\n {4}(?:private|public) /,
    )?.[0];

    assert.ok(applySource && filterSource && moreSource);
    for (const methodSource of [applySource, filterSource, moreSource]) {
        assert.match(methodSource, /renderIndexTagSearchBody/);
        assert.doesNotMatch(methodSource, /renderComments/);
    }
});

test("index tag search uses the shared debounce and read-only search copy", () => {
    assert.match(asideViewSource, /NOTE_SIDEBAR_SEARCH_DEBOUNCE_MS/);
    assert.match(asideViewSource, /placeholder:\s*"Search tags across your vault"/);
    assert.match(asideViewSource, /ariaLabel:\s*"Search vault tags"/);
});

test("metadata refresh keeps the current tag query on the body-only path", () => {
    const refreshSource = asideViewSource.match(
        /public refreshIndexTagSearch\(\): void \{[\s\S]*?\n {4}\}/,
    )?.[0];

    assert.ok(refreshSource, "missing public index tag refresh hook");
    assert.match(refreshSource, /renderedIndexSidebarMode !== "tags"/);
    assert.match(refreshSource, /bodyEl\?\.isConnected/);
    assert.match(refreshSource, /refreshIndexTagSearchResult/);
    assert.match(refreshSource, /renderIndexTagSearchBody/);
    assert.doesNotMatch(refreshSource, /renderComments/);
});

test("metadata refresh respects a rendered Tags to List fallback", () => {
    assert.match(
        asideViewSource,
        /private renderedIndexSidebarMode: IndexSidebarMode \| null = null;/,
    );
    assert.match(
        asideViewSource,
        /this\.renderedIndexSidebarMode = effectiveIndexSidebarMode;/,
    );
    assert.match(
        asideViewSource,
        /private renderIndexTagSearchSidebar\([\s\S]*?this\.renderedIndexSidebarMode = "tags";/,
    );
});
