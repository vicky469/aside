import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync("styles.css", "utf8");

function cssRuleBody(selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`${escapedSelector}\\s*\\{(?<body>[\\s\\S]*?)\\}`, "m").exec(styles);
    return match?.groups?.body ?? "";
}

test("note sidebar toolbar keeps action icons from shrinking out of view", () => {
    const actionGroup = cssRuleBody(".aside-sidebar-toolbar-group.is-action-group");
    const noteIconButton = cssRuleBody(".aside-sidebar-toolbar-row.is-note-secondary-row .aside-toolbar-icon-button");

    assert.match(actionGroup, /flex:\s*0\s+0\s+auto\s*;/);
    assert.match(noteIconButton, /flex:\s*0\s+0\s+26px\s*;/);
    assert.match(noteIconButton, /min-width:\s*26px\s*;/);
});

test("note sidebar search row reserves default sidebar width for page-note actions", () => {
    const searchRow = cssRuleBody(".aside-sidebar-toolbar-row.is-note-search-row");
    const searchFilterGroup = cssRuleBody(
        ".aside-sidebar-toolbar-row.is-note-search-row .aside-sidebar-toolbar-group.is-filter-group",
    );

    assert.match(searchRow, /flex-wrap:\s*nowrap\s*;/);
    assert.match(searchFilterGroup, /flex:\s*1\s+1\s+0\s*;/);
});

test("narrow note sidebar collapses search before hiding action buttons", () => {
    const noteToolbar = cssRuleBody(".aside-sidebar-toolbar.is-note-toolbar");
    const searchRow = cssRuleBody(".aside-sidebar-toolbar-row.is-note-search-row");

    assert.match(noteToolbar, /container-type:\s*inline-size\s*;/);
    assert.match(searchRow, /width:\s*100%\s*;/);
    assert.match(searchRow, /min-width:\s*0\s*;/);
    assert.match(searchRow, /max-width:\s*100%\s*;/);
    assert.match(searchRow, /box-sizing:\s*border-box\s*;/);
    assert.match(
        styles,
        /@container\s+\(max-width:\s*180px\)\s*\{[\s\S]*\.aside-sidebar-toolbar-row\.is-note-search-row\s+\.aside-sidebar-toolbar-group\.is-search-group\s*\{[\s\S]*display:\s*none\s*;/,
    );
    assert.match(
        styles,
        /@container\s+\(max-width:\s*112px\)\s*\{[\s\S]*\.aside-sidebar-toolbar-row\.is-note-search-row\s+\.aside-toolbar-icon-button\s*\{[\s\S]*flex:\s*0\s+0\s+22px\s*;/,
    );
});
