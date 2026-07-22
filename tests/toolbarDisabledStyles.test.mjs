import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const importantOverridePattern = new RegExp("!" + "important");

test("stylesheet avoids important overrides", () => {
    assert.doesNotMatch(css, importantOverridePattern);
});

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

test("public markdown view hides rendered properties without source-mode hacks", () => {
    const publicMarkdownPropertiesRule = css.match(
        /\.aside-public-markdown-hide-properties \.metadata-container,[\s\S]*?\.aside-public-markdown-hide-properties \.markdown-preview-view\.show-properties \.metadata-container\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(publicMarkdownPropertiesRule?.groups?.body, "missing public markdown properties rule");
    assert.match(publicMarkdownPropertiesRule.groups.body, /display:\s*none\s*;/);
    assert.match(css, /\.aside-public-markdown-hide-properties \.markdown-source-view\.is-live-preview\.show-properties \.metadata-container:not\(\.mod-error\)/);
    assert.match(css, /\.aside-public-markdown-hide-properties \.markdown-preview-view\.show-properties \.metadata-container/);
    assert.doesNotMatch(publicMarkdownPropertiesRule.groups.body, /cm-hmd-frontmatter|HyperMD-frontmatter|markdown-source-view/);
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

test("thought trail source selector uses native Obsidian theme colors", () => {
    const sourceControlRule = css.match(
        /\.aside-thought-trail-source-control\s*\{(?<body>[\s\S]*?)\}/,
    );
    const sourceOptionRule = css.match(
        /\.aside-thought-trail-source-option\s*\{(?<body>[\s\S]*?)\}/,
    );
    const sourceInputRule = css.match(
        /\.aside-thought-trail-source-option input\[type="radio"\]\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(sourceControlRule?.groups?.body, "missing thought trail source control rule");
    assert.ok(sourceOptionRule?.groups?.body, "missing thought trail source option rule");
    assert.ok(sourceInputRule?.groups?.body, "missing thought trail source radio rule");
    assert.match(sourceControlRule.groups.body, /color:\s*var\(--text-muted\)\s*;/);
    assert.match(sourceOptionRule.groups.body, /color:\s*var\(--text-muted\)\s*;/);
    assert.match(sourceOptionRule.groups.body, /font-size:\s*var\(--font-ui-smaller\)\s*;/);
    assert.match(sourceInputRule.groups.body, /accent-color:\s*var\(--interactive-accent\)\s*;/);
    assert.doesNotMatch(sourceControlRule.groups.body + sourceOptionRule.groups.body + sourceInputRule.groups.body, /#[0-9a-f]{3,6}|purple|blue/i);
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

test("tag selection wrapper uses flexible layout without overlay", () => {
    const wrapperRule = css.match(
        /\.aside-comment-thread-select-wrapper\s*\{(?<body>[\s\S]*?)\}/,
    );
    const checkboxRowRule = css.match(
        /\.aside-comment-thread-select-row\s*\{(?<body>[\s\S]*?)\}/,
    );
    const wrappedCardRule = css.match(
        /\.aside-comment-thread-select-wrapper\s*>\s*\.aside-comment-item\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(wrapperRule?.groups?.body, "missing tag selection wrapper rule");
    assert.match(wrapperRule.groups.body, /display:\s*flex\s*;/);
    assert.doesNotMatch(wrapperRule.groups.body, /display:\s*block\s*;/);
    assert.doesNotMatch(wrapperRule.groups.body, /position:\s*relative\s*;/);

    assert.ok(checkboxRowRule?.groups?.body, "missing tag selection checkbox row rule");
    assert.match(checkboxRowRule.groups.body, /flex:\s*0 0 auto\s*;/);
    assert.doesNotMatch(checkboxRowRule.groups.body, /position:\s*absolute\s*;/);

    assert.ok(wrappedCardRule?.groups?.body, "missing wrapped tag card flex rule");
    assert.match(wrappedCardRule.groups.body, /flex:\s*1 1 0\s*;/);
    assert.match(wrappedCardRule.groups.body, /min-width:\s*0\s*;/);
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
    assert.match(buttonResetRule.groups.body, /color:\s*var\(--text-muted\)\s*;/);
    assert.match(buttonResetRule.groups.body, /background:\s*transparent\s*;/);
    assert.match(buttonResetRule.groups.body, /background-image:\s*none\s*;/);
    assert.match(buttonResetRule.groups.body, /box-shadow:\s*none\s*;/);
    assert.match(buttonResetRule.groups.body, /filter:\s*none\s*;/);
    assert.match(buttonResetRule.groups.body, /text-shadow:\s*none\s*;/);

    assert.ok(buttonHoverFocusRule?.groups?.body, "missing native button hover/focus color override");
    assert.match(buttonHoverFocusRule.groups.body, /color:\s*var\(--text-normal\)\s*;/);
});

test("agent metadata collapse state is backed by stylesheet hiding", () => {
    const collapsedRule = css.match(
        /\.aside-agent-run-visible-metadata\.is-collapsed\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(collapsedRule?.groups?.body, "missing collapsed agent metadata rule");
    assert.match(collapsedRule.groups.body, /display:\s*none\s*;/);
});

test("thread footer actions stay visible without active card state", () => {
    const footerActionsRule = css.match(
        /\.aside-thread-footer-actions\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(footerActionsRule?.groups?.body, "missing thread footer actions rule");
    assert.match(footerActionsRule.groups.body, /display:\s*flex\s*;/);
    assert.doesNotMatch(css, /\.aside-comment-item:not\(\.aside-agent-stream-item\)\s+\.aside-thread-footer-actions/);
    assert.doesNotMatch(css, /\.aside-comment-item:not\(\.aside-agent-stream-item\)\.active\s+\.aside-thread-footer-actions/);
});

test("share copied feedback uses the accent purple", () => {
    const copiedButtonRule = css.match(
        /\.aside-comment-action-button\.is-copied\s*\{(?<body>[\s\S]*?)\}/,
    );
    const shareStatusRule = css.match(
        /\.aside-thread-share-status\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(copiedButtonRule?.groups?.body, "missing copied button state rule");
    assert.ok(shareStatusRule?.groups?.body, "missing share copied status rule");
    assert.match(copiedButtonRule.groups.body, /color:\s*var\(--interactive-accent\)\s*;/);
    assert.match(shareStatusRule.groups.body, /color:\s*var\(--interactive-accent\)\s*;/);
    assert.doesNotMatch(copiedButtonRule.groups.body, /text-success/);
    assert.doesNotMatch(shareStatusRule.groups.body, /text-success/);
});

test("share copied feedback hides the share button while copied text is visible", () => {
    const copiedShareButtonRule = css.match(
        /\.aside-thread-share-button\.is-copied\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(copiedShareButtonRule?.groups?.body, "missing copied share button rule");
    assert.match(copiedShareButtonRule.groups.body, /display:\s*none\s*;/);
});
