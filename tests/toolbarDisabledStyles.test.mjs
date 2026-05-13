import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("disabled toolbar icon buttons are visibly unavailable and non-interactive", () => {
    const disabledRule = css.match(
        /button\.aside-toolbar-icon-button:disabled,[\s\S]*?button\.aside-toolbar-icon-button\[aria-disabled="true"\]\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(disabledRule?.groups?.body, "missing disabled toolbar icon button rule");
    assert.match(disabledRule.groups.body, /color:\s*var\(--text-faint\).*?!important;/);
    assert.match(disabledRule.groups.body, /opacity:\s*0\.[0-5][0-9]?;/);
    assert.match(disabledRule.groups.body, /cursor:\s*default;/);
    assert.match(disabledRule.groups.body, /pointer-events:\s*none;/);
});

test("active sidebar tabs use theme text color instead of hardcoded black", () => {
    const activeRule = css.match(
        /button\.aside-tab-button\.aside-tab-button--active\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(activeRule?.groups?.body, "missing active sidebar tab rule");
    assert.match(activeRule.groups.body, /color:\s*var\(--text-normal\)\s*!important;/);
    assert.match(activeRule.groups.body, /border-bottom-color:\s*var\(--text-normal\)\s*!important;/);
    assert.doesNotMatch(activeRule.groups.body, /#000|black/i);
});

test("disabled sidebar tabs use a faded unavailable state", () => {
    const disabledTabRule = css.match(
        /button\.aside-tab-button:disabled,[\s\S]*?button\.aside-tab-button\[aria-disabled="true"\]\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(disabledTabRule?.groups?.body, "missing disabled sidebar tab rule");
    assert.match(disabledTabRule.groups.body, /color:\s*var\(--text-faint\)\s*!important;/);
    assert.match(disabledTabRule.groups.body, /opacity:\s*0\.55;/);
    assert.doesNotMatch(disabledTabRule.groups.body, /#000|black/i);
});

test("index note file names are larger than metadata text", () => {
    const indexListRule = css.match(
        /\.aside-index-note-view \.markdown-preview-view li,[\s\S]*?\.aside-index-note-view \.cm-line\.HyperMD-list-line \.cm-hmd-internal-link\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(indexListRule?.groups?.body, "missing index note list font rule");
    assert.match(indexListRule.groups.body, /font-size:\s*14px\s*!important;/);
    assert.doesNotMatch(indexListRule.groups.body, /font-size:\s*12px\s*!important;/);
});

test("selected index file rows use the accent purple background", () => {
    const selectedRowRule = css.match(
        /\.aside-index-selected-file-row,[\s\S]*?\.aside-index-note-view li\.aside-index-selected-file-row\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(selectedRowRule?.groups?.body, "missing selected index file row rule");
    assert.match(selectedRowRule.groups.body, /background:\s*hsla\(var\(--interactive-accent-hsl\),\s*0\.(?:1[4-9]|2[0-9])\)/);
    assert.match(selectedRowRule.groups.body, /box-shadow:\s*inset 3px 0 0 var\(--interactive-accent\)/);
});
