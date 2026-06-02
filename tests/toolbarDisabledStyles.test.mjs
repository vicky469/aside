import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("disabled toolbar icon buttons are visibly unavailable and non-interactive", () => {
    const disabledRule = css.match(
        /button\.aside-toolbar-icon-button:disabled,[\s\S]*?button\.aside-toolbar-icon-button\[aria-disabled="true"\]\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(disabledRule?.groups?.body, "missing disabled toolbar icon button rule");
    assert.match(disabledRule.groups.body, /color:\s*var\(--text-faint\)\s*;/);
    assert.match(disabledRule.groups.body, /opacity:\s*0\.[0-5][0-9]?;/);
    assert.match(disabledRule.groups.body, /cursor:\s*default;/);
    assert.match(disabledRule.groups.body, /pointer-events:\s*none;/);
});

test("active sidebar tabs use theme text color instead of hardcoded black", () => {
    const activeRule = css.match(
        /button\.aside-tab-button\.aside-tab-button--active\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(activeRule?.groups?.body, "missing active sidebar tab rule");
    assert.match(activeRule.groups.body, /color:\s*var\(--text-normal\)\s*;/);
    assert.match(activeRule.groups.body, /border-bottom-color:\s*var\(--text-normal\)\s*;/);
    assert.doesNotMatch(activeRule.groups.body, /#000|black/i);
});

test("disabled sidebar tabs use a faded unavailable state", () => {
    const disabledTabRule = css.match(
        /button\.aside-tab-button:disabled,[\s\S]*?button\.aside-tab-button\[aria-disabled="true"\]\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(disabledTabRule?.groups?.body, "missing disabled sidebar tab rule");
    assert.match(disabledTabRule.groups.body, /color:\s*var\(--text-faint\)\s*;/);
    assert.match(disabledTabRule.groups.body, /opacity:\s*0\.55;/);
    assert.doesNotMatch(disabledTabRule.groups.body, /#000|black/i);
});

test("empty states stay muted without promoted heading text", () => {
    const emptyStateRule = css.match(
        /\.aside-empty-state\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(emptyStateRule?.groups?.body, "missing empty state rule");
    assert.match(emptyStateRule.groups.body, /color:\s*var\(--text-muted\)\s*;/);
    assert.match(emptyStateRule.groups.body, /font-size:\s*var\(--font-ui-small\)\s*;/);
    assert.doesNotMatch(css, /\.aside-empty-state p:first-child\s*\{[\s\S]*?font-weight:\s*var\(--font-semibold\)/);
});

test("index note file names are larger than metadata text", () => {
    const indexListRule = css.match(
        /\.aside-index-note-view \.markdown-preview-view li,[\s\S]*?\.aside-index-note-view \.cm-line\.HyperMD-list-line \.cm-hmd-internal-link\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(indexListRule?.groups?.body, "missing index note list font rule");
    assert.match(indexListRule.groups.body, /font-size:\s*14px\s*;/);
    assert.doesNotMatch(indexListRule.groups.body, /font-size:\s*12px\s*;/);
});

test("index note file rows keep breathing room", () => {
    const indexRowSpacingRule = css.match(
        /\.aside-index-note-view \.markdown-preview-view li,[\s\S]*?\.aside-index-note-view \.markdown-source-view\.mod-cm6 \.markdown-rendered li\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(indexRowSpacingRule?.groups?.body, "missing index note row spacing rule");
    assert.match(indexRowSpacingRule.groups.body, /margin-block:\s*0\.45rem\s*;/);
});

test("regular index file links use normal text color", () => {
    const indexFileLinkRule = css.match(
        /\.aside-index-note-view \.markdown-preview-view \.aside-index-file-filter-link,[\s\S]*?\.aside-index-note-view \.markdown-source-view\.mod-cm6 \.markdown-rendered \.aside-index-file-filter-link\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(indexFileLinkRule?.groups?.body, "missing index file link color rule");
    assert.match(indexFileLinkRule.groups.body, /color:\s*var\(--text-normal\)\s*;/);
    assert.doesNotMatch(indexFileLinkRule.groups.body, /var\(--link-color|--interactive-accent\)|purple/i);
});

test("selected index file rows use accent background without a left strip", () => {
    const selectedFileRule = css.match(
        /\.aside-index-selected-file,[\s\S]*?\.aside-index-note-view \.aside-index-selected-file\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(selectedFileRule?.groups?.body, "missing selected index file rule");
    assert.match(selectedFileRule.groups.body, /background:\s*hsla\(var\(--interactive-accent-hsl\),\s*0\.(?:1[4-9]|2[0-9])\)/);
    assert.doesNotMatch(selectedFileRule.groups.body, /inset\s+3px\s+0\s+0\s+var\(--interactive-accent\)/);
});

test("thread footer meta action uses a minimal muted text action", () => {
    const baseRule = css.match(
        /\.aside-thread-footer-meta-action\s*\{(?<body>[\s\S]*?)\}/,
    );
    const hoverFocusRule = css.match(
        /(?:^|\n)\.aside-thread-footer-meta-action:hover,[\s\S]*?\n\.aside-thread-footer-meta-action:focus-visible\s*\{(?<body>[\s\S]*?)\}/,
    );
    const focusRule = css.match(
        /(?:^|\n\n)\.aside-thread-footer-meta-action:focus-visible\s*\{(?<body>[\s\S]*?)\}/,
    );
    const activeRule = css.match(
        /\.aside-thread-footer-meta-action:active\s*\{(?<body>[\s\S]*?)\}/,
    );
    const buttonResetRule = css.match(
        /button\.aside-thread-footer-meta-action\s*\{(?<body>[\s\S]*?)\}/,
    );
    const buttonHoverFocusRule = css.match(
        /button\.aside-thread-footer-meta-action:hover,[\s\S]*?button\.aside-thread-footer-meta-action:focus-visible\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(baseRule?.groups?.body, "missing thread footer meta action base rule");
    assert.match(baseRule.groups.body, /color:\s*var\(--text-muted\)\s*;/);
    assert.match(baseRule.groups.body, /font-weight:\s*400\s*;/);
    assert.match(baseRule.groups.body, /background:\s*transparent\s*;/);
    assert.match(baseRule.groups.body, /border:\s*0\s*;/);
    assert.match(baseRule.groups.body, /border-radius:\s*0\s*;/);
    assert.match(baseRule.groups.body, /box-shadow:\s*none\s*;/);
    assert.doesNotMatch(baseRule.groups.body, /var\(--background-primary\)|var\(--button-radius/);

    assert.ok(hoverFocusRule?.groups?.body, "missing thread footer meta action hover/focus rule");
    assert.match(hoverFocusRule.groups.body, /color:\s*var\(--text-normal\)\s*;/);
    assert.match(hoverFocusRule.groups.body, /background:\s*transparent\s*;/);
    assert.doesNotMatch(hoverFocusRule.groups.body, /background-modifier-hover/);
    assert.ok(focusRule?.groups?.body, "missing thread footer meta action focus rule");
    assert.match(focusRule.groups.body, /box-shadow:\s*none\s*;/);

    assert.ok(activeRule?.groups?.body, "missing thread footer meta action active rule");
    assert.match(activeRule.groups.body, /background:\s*transparent\s*;/);

    assert.ok(buttonResetRule?.groups?.body, "missing native button reset for thread footer meta action");
    assert.match(buttonResetRule.groups.body, /-webkit-appearance:\s*none\s*;/);
    assert.match(buttonResetRule.groups.body, /color:\s*var\(--text-muted\)\s*!important\s*;/);
    assert.match(buttonResetRule.groups.body, /background:\s*transparent\s*!important\s*;/);
    assert.match(buttonResetRule.groups.body, /background-image:\s*none\s*!important\s*;/);
    assert.match(buttonResetRule.groups.body, /box-shadow:\s*none\s*!important\s*;/);
    assert.match(buttonResetRule.groups.body, /filter:\s*none\s*!important\s*;/);
    assert.match(buttonResetRule.groups.body, /text-shadow:\s*none\s*!important\s*;/);

    assert.ok(buttonHoverFocusRule?.groups?.body, "missing native button hover/focus color override");
    assert.match(buttonHoverFocusRule.groups.body, /color:\s*var\(--text-normal\)\s*!important\s*;/);
});
