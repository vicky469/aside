import * as assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const settingSource = await readFile(
    new URL("../src/ui/settings/AsideSetting.ts", import.meta.url),
    "utf8",
);

test("agent settings radio rows use compact native controls and theme states", () => {
    const group = styles.match(
        /\.aside-default-agent-radio-group\s*\{(?<body>[\s\S]*?)\}/,
    );
    const option = styles.match(
        /\.aside-default-agent-option\s*\{(?<body>[\s\S]*?)\}/,
    );
    const radio = styles.match(
        /\.aside-default-agent-option input\[type="radio"\]\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.match(group?.groups?.body ?? "", /display:\s*grid/);
    assert.match(option?.groups?.body ?? "", /grid-template-columns/);
    assert.match(radio?.groups?.body ?? "", /margin:\s*0/);
    assert.match(styles, /\.aside-default-agent-option\.is-disabled/);
    assert.match(styles, /var\(--text-muted\)/);
    assert.match(styles, /@media\s*\(max-width:\s*600px\)/);
});

test("default agent settings render a labeled native radio group", () => {
    assert.match(settingSource, /role:\s*"radiogroup"/);
    assert.match(settingSource, /type:\s*"radio"/);
    assert.match(settingSource, /resolveDefaultAgentRadioSelection/);
    assert.doesNotMatch(settingSource, /agentSetting\.addDropdown/);
});
