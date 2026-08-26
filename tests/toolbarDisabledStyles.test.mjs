import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const mentionModalSource = readFileSync(
    new URL("../src/ui/modals/SideNoteMentionSuggestModal.ts", import.meta.url),
    "utf8",
);
const importantOverridePattern = new RegExp("!" + "important");

function normalizeCssSelectors(selectors) {
    return selectors
        .replace(/\/\*.*?\*\//gs, "")
        .split(",")
        .map((selector) => selector.trim().replace(/\s+/g, " "))
        .join(", ");
}

function parseCssRules(source) {
    return [...source.matchAll(/(?<selectors>[^{}]+)\{(?<body>[^{}]*)\}/g)].map((match) => ({
        selectors: normalizeCssSelectors(match.groups.selectors),
        body: match.groups.body,
    }));
}

const cssRules = parseCssRules(css);

function getExactCssRule(selectors) {
    const normalizedSelectors = normalizeCssSelectors(selectors);
    const rule = cssRules.find((candidate) => candidate.selectors === normalizedSelectors);
    assert.ok(rule, `missing exact CSS rule: ${normalizedSelectors}`);
    return rule;
}

test("stylesheet avoids important overrides", () => {
    assert.doesNotMatch(css, importantOverridePattern);
});

test("link and tag suggestion notes share the muted detail style", () => {
    const suggestionNoteRule = css.match(
        /\.aside-link-suggest-note,\s*\.aside-tag-suggest-note\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(suggestionNoteRule?.groups?.body, "missing shared suggestion note detail rule");
    assert.match(suggestionNoteRule.groups.body, /color:\s*var\(--text-muted\)\s*;/);
    assert.match(suggestionNoteRule.groups.body, /font-size:\s*var\(--font-ui-smaller\)\s*;/);
});

test("mention suggestions use a one-line fallback and compact inline geometry", () => {
    const mentionDropdownRule = css.match(
        /\.aside-inline-suggest-dropdown\.is-mention\s*\{(?<body>[\s\S]*?)\}/,
    );
    const mentionListRule = css.match(
        /\.aside-inline-suggest-dropdown\.is-mention \.aside-inline-suggest-list\s*\{(?<body>[\s\S]*?)\}/,
    );
    const mentionItemRule = css.match(
        /\.aside-inline-suggest-dropdown\.is-mention \.aside-inline-suggest-item\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.doesNotMatch(css, /\.aside-mention-suggest-note/);
    assert.match(
        mentionModalSource,
        /import\s*\{[^}]*\bgetMentionSuggestionPresentation\b[^}]*\}\s*from\s*["']\.\.\/editor\/commentMentionSuggestions["'];/,
    );
    assert.match(mentionModalSource, /getMentionSuggestionPresentation\(suggestion\)/);
    const renderSuggestionSource = mentionModalSource.match(
        /renderSuggestion\([\s\S]*?\n[ ]{4}\}\n\n[ ]{4}onChooseSuggestion/,
    )?.[0];
    assert.ok(renderSuggestionSource, "missing mention fallback renderSuggestion");
    assert.match(
        renderSuggestionSource,
        /\bel\.createDiv\s*\(\s*\{\s*text\s*:\s*presentation\.title\s*\}\s*\)\s*;/,
    );
    assert.equal(renderSuggestionSource.match(/\bcreateDiv\s*\(/g)?.length ?? 0, 1);
    assert.doesNotMatch(renderSuggestionSource, /\.label|\.scriptPath|aside-mention-suggest-note/);

    assert.ok(mentionDropdownRule?.groups?.body, "missing mention dropdown compact rule");
    assert.match(mentionDropdownRule.groups.body, /justify-self:\s*start\s*;/);
    assert.match(mentionDropdownRule.groups.body, /width:\s*fit-content\s*;/);
    assert.doesNotMatch(mentionDropdownRule.groups.body, /min-width\s*:/);
    assert.match(mentionDropdownRule.groups.body, /max-width:\s*100%\s*;/);
    assert.match(mentionDropdownRule.groups.body, /box-sizing:\s*border-box\s*;/);

    assert.ok(mentionListRule?.groups?.body, "missing mention list compact rule");
    assert.match(mentionListRule.groups.body, /padding:\s*2px 0\s*;/);

    assert.ok(mentionItemRule?.groups?.body, "missing mention item compact rule");
    assert.match(mentionItemRule.groups.body, /padding:\s*3px 5px\s*;/);
});

test("inline suggestions use one visual selection state", () => {
    const selectedRule = css.match(
        /\.aside-inline-suggest-item\.is-selected\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(selectedRule?.groups?.body, "missing selected suggestion rule");
    assert.match(selectedRule.groups.body, /background:\s*color-mix\(/);
    assert.doesNotMatch(css, /\.aside-inline-suggest-item:hover/);
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

test("index shared secondary toolbar stays compact and yields search space first", () => {
    const rowRule = css.match(
        /\.aside-sidebar-toolbar-row\.is-index-secondary-row\s*\{(?<body>[\s\S]*?)\}/,
    );
    const filterRule = css.match(
        /\.aside-sidebar-toolbar-row\.is-index-secondary-row \.aside-sidebar-toolbar-group\.is-filter-group\s*\{(?<body>[\s\S]*?)\}/,
    );
    const actionRule = css.match(
        /\.aside-sidebar-toolbar-row\.is-index-secondary-row \.aside-sidebar-toolbar-group\.is-action-group\s*\{(?<body>[\s\S]*?)\}/,
    );
    const narrowIndexFilterRule = css.match(
        /@container \(max-width: 180px\)[\s\S]*?\.aside-sidebar-toolbar-row\.is-index-secondary-row\.is-search-row \.aside-sidebar-toolbar-group\.is-filter-group\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(rowRule?.groups?.body, "missing compact index secondary row rule");
    assert.match(rowRule.groups.body, /flex-wrap:\s*nowrap\s*;/);
    assert.match(rowRule.groups.body, /width:\s*100%\s*;/);
    assert.match(rowRule.groups.body, /min-width:\s*0\s*;/);
    assert.match(rowRule.groups.body, /max-width:\s*100%\s*;/);
    assert.ok(filterRule?.groups?.body, "missing index filter group flex rule");
    assert.match(filterRule.groups.body, /flex:\s*1 1 0\s*;/);
    assert.match(filterRule.groups.body, /min-width:\s*0\s*;/);
    assert.ok(actionRule?.groups?.body, "missing index action group flex rule");
    assert.match(actionRule.groups.body, /margin-left:\s*auto\s*;/);
    assert.match(css, /@container \(max-width: 180px\)[\s\S]*\.is-index-secondary-row\.is-search-row \.aside-sidebar-toolbar-group\.is-search-group[\s\S]*display:\s*none\s*;/);
    assert.ok(narrowIndexFilterRule?.groups?.body, "missing narrow index filter preservation rule");
    assert.match(narrowIndexFilterRule.groups.body, /flex:\s*0 0 22px\s*;/);
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

test("thought trail unique tag file set stays compact and theme-native", () => {
    const filterBarRule = getExactCssRule(".aside-tag-related-filter-bar");
    const filterRule = getExactCssRule(".aside-thought-trail button.aside-tag-related-filter");
    const filterHoverFocusRule = getExactCssRule(`
        .aside-thought-trail button.aside-tag-related-filter:hover,
        .aside-thought-trail button.aside-tag-related-filter:focus-visible
    `);
    const filterFocusRule = getExactCssRule(
        ".aside-thought-trail button.aside-tag-related-filter:focus-visible",
    );
    const selectedFilterRule = getExactCssRule(
        '.aside-thought-trail button.aside-tag-related-filter[aria-pressed="true"]',
    );
    const listRule = getExactCssRule(".aside-thought-trail .aside-tag-related-files");
    const rowRule = getExactCssRule(".aside-tag-related-file-row");
    const tagsRule = getExactCssRule(".aside-tag-related-file-tags");
    const tagRule = getExactCssRule(".aside-tag-related-file-tag");
    const linkRule = getExactCssRule(".aside-thought-trail button.aside-tag-related-file-link");
    const linkHoverFocusRule = getExactCssRule(`
        .aside-thought-trail button.aside-tag-related-file-link:hover,
        .aside-thought-trail button.aside-tag-related-file-link:focus-visible
    `);
    const linkFocusRule = getExactCssRule(
        ".aside-thought-trail button.aside-tag-related-file-link:focus-visible",
    );
    const currentRule = getExactCssRule(".aside-tag-related-current-file");

    assert.match(filterBarRule.body, /display:\s*flex\s*;/);
    assert.match(filterBarRule.body, /flex-wrap:\s*wrap\s*;/);
    assert.match(filterBarRule.body, /gap:\s*3px\s*;/);
    assert.match(filterBarRule.body, /margin:\s*2px 0 4px\s*;/);
    assert.match(filterRule.body, /-webkit-appearance:\s*none\s*;/);
    assert.match(filterRule.body, /appearance:\s*none\s*;/);
    assert.match(filterRule.body, /box-sizing:\s*border-box\s*;/);
    assert.match(filterRule.body, /width:\s*auto\s*;/);
    assert.match(filterRule.body, /min-width:\s*0\s*;/);
    assert.match(filterRule.body, /max-width:\s*100%\s*;/);
    assert.match(filterRule.body, /min-height:\s*0\s*;/);
    assert.match(filterRule.body, /height:\s*auto\s*;/);
    assert.match(filterRule.body, /margin:\s*0\s*;/);
    assert.match(filterRule.body, /padding:\s*1px 5px\s*;/);
    assert.match(filterRule.body, /border:\s*1px solid var\(--background-modifier-border\)\s*;/);
    assert.match(filterRule.body, /border-radius:\s*var\(--radius-s\)\s*;/);
    assert.match(filterRule.body, /background:\s*transparent\s*;/);
    assert.match(filterRule.body, /box-shadow:\s*none\s*;/);
    assert.match(filterRule.body, /cursor:\s*pointer\s*;/);
    assert.match(filterRule.body, /color:\s*var\(--text-muted\)\s*;/);
    assert.match(filterRule.body, /font-family:\s*inherit\s*;/);
    assert.match(filterRule.body, /font-size:\s*var\(--font-ui-smaller\)\s*;/);
    assert.match(filterRule.body, /line-height:\s*1\.3\s*;/);
    assert.match(filterRule.body, /white-space:\s*nowrap\s*;/);
    assert.match(filterRule.body, /overflow:\s*hidden\s*;/);
    assert.match(filterRule.body, /text-overflow:\s*ellipsis\s*;/);
    assert.match(filterHoverFocusRule.body, /background:\s*var\(--background-modifier-hover\)\s*;/);
    assert.match(filterHoverFocusRule.body, /color:\s*var\(--text-normal\)\s*;/);
    assert.match(filterFocusRule.body, /outline:\s*1px solid var\(--interactive-accent\)\s*;/);
    assert.match(filterFocusRule.body, /outline-offset:\s*1px\s*;/);
    assert.match(selectedFilterRule.body, /border-color:\s*var\(--interactive-accent\)\s*;/);
    assert.match(selectedFilterRule.body, /background:\s*var\(--background-modifier-hover\)\s*;/);
    assert.match(selectedFilterRule.body, /color:\s*var\(--text-normal\)\s*;/);

    assert.match(listRule.body, /display:\s*flex\s*;/);
    assert.match(listRule.body, /flex-direction:\s*column\s*;/);
    assert.match(listRule.body, /list-style:\s*none\s*;/);
    assert.match(listRule.body, /margin:\s*0\s*;/);
    assert.match(listRule.body, /padding:\s*0\s*;/);
    assert.match(listRule.body, /gap:\s*3px\s*;/);
    assert.match(rowRule.body, /display:\s*flex\s*;/);
    assert.match(rowRule.body, /flex-direction:\s*column\s*;/);
    assert.match(rowRule.body, /gap:\s*0\s*;/);
    assert.match(rowRule.body, /margin:\s*0\s*;/);
    assert.match(rowRule.body, /padding:\s*0\s*;/);
    assert.match(rowRule.body, /min-width:\s*0\s*;/);
    assert.match(tagsRule.body, /display:\s*flex\s*;/);
    assert.match(tagsRule.body, /flex-wrap:\s*wrap\s*;/);
    assert.match(tagsRule.body, /gap:\s*2px 5px\s*;/);
    assert.match(tagsRule.body, /min-width:\s*0\s*;/);
    assert.match(tagRule.body, /min-width:\s*0\s*;/);
    assert.match(tagRule.body, /max-width:\s*100%\s*;/);
    assert.match(tagRule.body, /color:\s*var\(--text-faint\)\s*;/);
    assert.match(tagRule.body, /font-size:\s*var\(--font-ui-smaller\)\s*;/);
    assert.match(tagRule.body, /line-height:\s*1\.25\s*;/);
    assert.match(tagRule.body, /overflow-wrap:\s*anywhere\s*;/);

    assert.match(linkRule.body, /padding:\s*1px 0\s*;/);
    assert.match(linkRule.body, /background:\s*transparent\s*;/);
    assert.match(linkRule.body, /background-image:\s*none\s*;/);
    assert.match(linkRule.body, /border:\s*none\s*;/);
    assert.match(linkRule.body, /border-radius:\s*0\s*;/);
    assert.match(linkRule.body, /box-shadow:\s*none\s*;/);
    assert.match(linkRule.body, /height:\s*auto\s*;/);
    assert.match(linkRule.body, /min-height:\s*0\s*;/);
    assert.match(linkRule.body, /width:\s*auto\s*;/);
    assert.match(linkRule.body, /max-width:\s*100%\s*;/);
    assert.match(linkRule.body, /-webkit-appearance:\s*none\s*;/);
    assert.match(linkRule.body, /appearance:\s*none\s*;/);
    assert.match(linkRule.body, /font-size:\s*var\(--font-ui-smaller\)\s*;/);
    assert.match(linkRule.body, /white-space:\s*nowrap\s*;/);
    assert.match(linkRule.body, /overflow:\s*hidden\s*;/);
    assert.match(linkRule.body, /text-overflow:\s*ellipsis\s*;/);
    assert.doesNotMatch(linkRule.body, /border-radius:\s*var\(/);
    assert.doesNotMatch(linkRule.body, /background:\s*var\(--background-modifier-hover\)/);
    assert.match(linkHoverFocusRule.body, /background:\s*transparent\s*;/);
    assert.match(linkHoverFocusRule.body, /box-shadow:\s*none\s*;/);
    assert.match(linkHoverFocusRule.body, /color:\s*var\(--text-accent\)\s*;/);
    assert.match(linkHoverFocusRule.body, /text-decoration:\s*underline\s*;/);
    assert.doesNotMatch(linkHoverFocusRule.body, /background-modifier-hover/);
    assert.match(linkFocusRule.body, /outline:\s*1px solid var\(--interactive-accent\)\s*;/);
    assert.match(linkFocusRule.body, /outline-offset:\s*2px\s*;/);

    assert.match(currentRule.body, /display:\s*block\s*;/);
    assert.match(currentRule.body, /padding:\s*1px 0\s*;/);
    assert.match(currentRule.body, /color:\s*var\(--text-muted\)\s*;/);
    assert.match(currentRule.body, /cursor:\s*default\s*;/);
    assert.match(currentRule.body, /font-size:\s*var\(--font-ui-smaller\)\s*;/);
    assert.match(currentRule.body, /white-space:\s*nowrap\s*;/);
    assert.match(currentRule.body, /overflow:\s*hidden\s*;/);
    assert.match(currentRule.body, /text-overflow:\s*ellipsis\s*;/);
    assert.doesNotMatch(currentRule.body, /background:/);

    assert.doesNotMatch(
        css,
        /\.aside-tag-related-files-group|\.aside-tag-related-files-tag-header|\.aside-tag-related-files-list/,
    );
    const tagRelatedClassPattern = /\.aside-tag-related-(?:filter(?:-bar)?|current-file|files|file-(?:row|tags|tag|link))\b/;
    const relatedFilesRules = cssRules.filter((rule) => tagRelatedClassPattern.test(rule.selectors));
    assert.notEqual(relatedFilesRules.length, 0, "missing parsed Thought Trail tag-related rules");
    const relatedFilesRuleBodies = relatedFilesRules.map((rule) => rule.body).join("\n");
    const hardcodedColorPattern = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(|(?<![-\w])(?:black|white|red|green|blue|purple|orange|yellow|gr[ae]y|pink|cyan|magenta|teal|navy|maroon|olive|lime|aqua|fuchsia|silver)(?![-\w])/i;
    assert.doesNotMatch(relatedFilesRuleBodies, hardcodedColorPattern);
    assert.doesNotMatch(relatedFilesRuleBodies, importantOverridePattern);
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
