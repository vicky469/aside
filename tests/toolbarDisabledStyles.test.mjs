import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("disabled toolbar icon buttons are visibly unavailable and non-interactive", () => {
    const disabledRule = css.match(
        /button\.sidenote2-toolbar-icon-button:disabled,[\s\S]*?button\.sidenote2-toolbar-icon-button\[aria-disabled="true"\]\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(disabledRule?.groups?.body, "missing disabled toolbar icon button rule");
    assert.match(disabledRule.groups.body, /color:\s*var\(--text-faint\).*?!important;/);
    assert.match(disabledRule.groups.body, /opacity:\s*0\.[0-5][0-9]?;/);
    assert.match(disabledRule.groups.body, /cursor:\s*default;/);
    assert.match(disabledRule.groups.body, /pointer-events:\s*none;/);
});

test("active sidebar tabs use theme text color instead of hardcoded black", () => {
    const activeRule = css.match(
        /button\.sidenote2-tab-button\.sidenote2-tab-button--active\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(activeRule?.groups?.body, "missing active sidebar tab rule");
    assert.match(activeRule.groups.body, /color:\s*var\(--text-normal\)\s*!important;/);
    assert.match(activeRule.groups.body, /border-bottom-color:\s*var\(--text-normal\)\s*!important;/);
    assert.doesNotMatch(activeRule.groups.body, /#000|black/i);
});

test("disabled sidebar tabs use a faded unavailable state", () => {
    const disabledTabRule = css.match(
        /button\.sidenote2-tab-button:disabled,[\s\S]*?button\.sidenote2-tab-button\[aria-disabled="true"\]\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(disabledTabRule?.groups?.body, "missing disabled sidebar tab rule");
    assert.match(disabledTabRule.groups.body, /color:\s*var\(--text-faint\)\s*!important;/);
    assert.match(disabledTabRule.groups.body, /opacity:\s*0\.55;/);
    assert.doesNotMatch(disabledTabRule.groups.body, /#000|black/i);
});
