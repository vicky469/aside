import * as assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const settingSource = await readFile(
    new URL("../src/ui/settings/AsideSetting.ts", import.meta.url),
    "utf8",
);
const infoIconSource = await readFile(
    new URL("../src/ui/settings/asideSettingInfoIcon.ts", import.meta.url),
    "utf8",
);

test("agent settings radio choices form a horizontal wrapping row", () => {
    const group = styles.match(
        /\.aside-default-agent-radio-group\s*\{(?<body>[\s\S]*?)\}/,
    );
    const option = styles.match(
        /\.aside-default-agent-option\s*\{(?<body>[\s\S]*?)\}/,
    );
    const radio = styles.match(
        /\.aside-default-agent-option input\[type="radio"\]\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.match(group?.groups?.body ?? "", /display:\s*flex\s*;/);
    assert.match(group?.groups?.body ?? "", /align-items:\s*center\s*;/);
    assert.match(group?.groups?.body ?? "", /flex-wrap:\s*wrap\s*;/);
    assert.match(group?.groups?.body ?? "", /row-gap:\s*var\(--size-2-1\)\s*;/);
    assert.match(
        group?.groups?.body ?? "",
        /column-gap:\s*calc\(var\(--size-4-2\) \* 2\)\s*;/,
    );
    assert.match(option?.groups?.body ?? "", /display:\s*grid\s*;/);
    assert.match(
        option?.groups?.body ?? "",
        /grid-template-columns:\s*auto auto auto\s*;/,
    );
    assert.match(option?.groups?.body ?? "", /flex:\s*0 0 auto\s*;/);
    assert.match(option?.groups?.body ?? "", /white-space:\s*nowrap\s*;/);
    assert.match(radio?.groups?.body ?? "", /margin:\s*0/);
    assert.match(styles, /\.aside-default-agent-option\.is-disabled/);
    assert.match(styles, /var\(--text-muted\)/);
    assert.doesNotMatch(
        styles,
        /\.aside-default-agent-option-status\s*\{[^}]*grid-column:\s*2\s*;/,
    );
});

test("agent radio text uses Obsidian control typography", () => {
    const option = styles.match(
        /\.aside-default-agent-option\s*\{(?<body>[\s\S]*?)\}/,
    );
    const status = styles.match(
        /\.aside-default-agent-option-status\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.match(option?.groups?.body ?? "", /font-family:\s*inherit\s*;/);
    assert.match(option?.groups?.body ?? "", /font-size:\s*var\(--font-ui-small\)\s*;/);
    assert.match(
        option?.groups?.body ?? "",
        /font-weight:\s*var\(--input-font-weight\)\s*;/,
    );
    assert.match(
        option?.groups?.body ?? "",
        /line-height:\s*var\(--line-height-tight\)\s*;/,
    );
    assert.doesNotMatch(status?.groups?.body ?? "", /font-(?:family|size|weight)\s*:/);
});

test("default agent settings render a labeled native radio group", () => {
    assert.match(settingSource, /role:\s*"radiogroup"/);
    assert.match(settingSource, /type:\s*"radio"/);
    assert.match(settingSource, /resolveDefaultAgentRadioSelection/);
    assert.match(settingSource, /appendAsideSettingInfoIcon/);
    assert.doesNotMatch(settingSource, /agentSetting\.addDropdown/);
});

test("default agent label exposes a Lucide info icon for hover help", () => {
    assert.match(styles, /\.aside-settings-tab \.aside-setting-info-icon/);
    assert.match(styles, /--icon-size:/);
    assert.match(infoIconSource, /aside-setting-info-icon/);
    assert.match(infoIconSource, /setIcon\(infoIconEl,\s*"info"\)/);
    assert.match(infoIconSource, /setTooltip/);
});

test("Aside headings and default agent controls use scoped left-aligned spacing", () => {
    assert.match(settingSource, /this\.containerEl\.addClass\("aside-settings-tab"\)/);

    const heading = styles.match(
        /\.aside-settings-tab \.setting-item\.setting-item-heading\s*\{(?<body>[\s\S]*?)\}/,
    );
    const setting = styles.match(
        /\.aside-default-agent-setting\s*\{(?<body>[\s\S]*?)\}/,
    );
    const info = styles.match(
        /\.aside-default-agent-setting \.setting-item-info\s*\{(?<body>[\s\S]*?)\}/,
    );
    const control = styles.match(
        /\.aside-default-agent-setting \.setting-item-control\s*\{(?<body>[\s\S]*?)\}/,
    );
    const group = styles.match(
        /\.aside-default-agent-radio-group\s*\{(?<body>[\s\S]*?)\}/,
    );
    const option = styles.match(
        /\.aside-default-agent-option\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.match(heading?.groups?.body ?? "", /padding:\s*0\s*;/);
    assert.doesNotMatch(styles, /(?:^|\})\s*\.setting-item\.setting-item-heading\s*\{/m);
    assert.match(setting?.groups?.body ?? "", /flex-direction:\s*column\s*;/);
    assert.match(setting?.groups?.body ?? "", /align-items:\s*flex-start\s*;/);
    assert.match(setting?.groups?.body ?? "", /gap:\s*var\(--size-4-2\)\s*;/);
    assert.match(info?.groups?.body ?? "", /display:\s*flex\s*;/);
    assert.match(info?.groups?.body ?? "", /align-items:\s*baseline\s*;/);
    assert.match(info?.groups?.body ?? "", /flex-wrap:\s*wrap\s*;/);
    assert.match(info?.groups?.body ?? "", /max-width:\s*100%\s*;/);
    assert.match(control?.groups?.body ?? "", /flex:\s*none\s*;/);
    assert.match(control?.groups?.body ?? "", /width:\s*fit-content\s*;/);
    assert.match(control?.groups?.body ?? "", /max-width:\s*100%\s*;/);
    assert.match(group?.groups?.body ?? "", /width:\s*fit-content\s*;/);
    assert.match(group?.groups?.body ?? "", /max-width:\s*100%\s*;/);
    assert.match(option?.groups?.body ?? "", /grid-template-columns:\s*auto auto auto\s*;/);
    assert.match(option?.groups?.body ?? "", /padding:\s*var\(--size-2-1\) 0\s*;/);
});
