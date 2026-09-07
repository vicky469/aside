import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const SCRIPTS_SETTINGS_PATH = "Settings → Aside → Scripts (advanced) → Enable scripts";
const PUBLISHING_SETTINGS_PATH = "Settings → Aside → Publishing (advanced) → Enable publishing";
const AGENT_TAB_SETTINGS_PATH = "Settings → Aside → Sidebar tabs → Show agent tab";
const SETTINGS_SECTION_ORDER = "Sidebar tabs → Scripts (advanced) → Publishing (advanced) → Index note";

function readRequiredFile(path) {
    assert.equal(existsSync(path), true, `${path} must exist`);
    return readFileSync(path, "utf8");
}

function getParagraphContaining(markdown, phrase) {
    const paragraph = markdown
        .split(/\n\s*\n/u)
        .find((candidate) => candidate.includes(phrase));
    assert.ok(paragraph, `documentation must include a paragraph containing ${phrase}`);
    return paragraph;
}

function getLineContaining(markdown, phrase) {
    const line = markdown
        .split("\n")
        .find((candidate) => candidate.includes(phrase));
    assert.ok(line, `documentation must include a line containing ${phrase}`);
    return line;
}

function assertUsesGenerateButtonVocabulary(markdown, actionCopy) {
    assert.match(actionCopy, /\bGenerate\b/u);
    assert.doesNotMatch(actionCopy, /\bretr(?:y|ies)\b/iu);
    assert.doesNotMatch(markdown, /\bRegenerate\b/iu);
}

function assertPublishingDisabledPolicy(markdown) {
    const disabledPolicy = getParagraphContaining(markdown, "Turning Publishing off");

    assert.match(disabledPolicy, /hides Publishing settings details/iu);
    assert.match(disabledPolicy, /disables new Publish, Republish, and Unpublish actions/iu);
    assert.match(
        disabledPolicy,
        /preserves saved publishing configuration[^.]*does not delete it/iu,
    );
    assert.match(disabledPolicy, /does not unpublish existing remote content/iu);
}

test("README publishes the complete agent and script entry points", () => {
    const readme = readRequiredFile("README.md");
    const capabilitiesDefaultPolicy = getParagraphContaining(readme, "Scripts and Publishing");
    const scriptsDisabledPolicy = getParagraphContaining(readme, "Turning Scripts off");
    const orderedAgentList = /`@codex`, `@claude`, `@cursor`, `@gemini`, (?:and|or) `@deepseek`/gu;

    assert.ok(
        [...readme.matchAll(orderedAgentList)].length >= 2,
        "feature and workflow copy must use the complete ordered agent list",
    );
    assert.match(readme, /\[Agents and scripts\]\(\.\/SCRIPTS\.md\)/u);
    assert.match(readme, /\[Advanced features\]\(ADVANCED_FEATURES\.md\)/u);
    assert.match(
        capabilitiesDefaultPolicy,
        /Scripts and Publishing[^.]*optional advanced capabilities[^.]*off by default/iu,
    );
    assert.match(readme, /Ordinary agent replies do not require Scripts/iu);
    assert.equal(readme.includes(SCRIPTS_SETTINGS_PATH), true);
    assert.equal(readme.includes(PUBLISHING_SETTINGS_PATH), true);
    assertUsesGenerateButtonVocabulary(readme, scriptsDisabledPolicy);
    assertPublishingDisabledPolicy(readme);
    for (const command of ["/create-script", "/update-script", "/pdf-to-markdown", "/script-name"]) {
        assert.match(readme, new RegExp(command.replace("/", "\\/"), "u"));
    }
    assert.match(
        readme,
        /The Agent tab is optional and hidden by default; enable \*\*Show agent tab\*\* under Aside settings when you want the focused agent view\./u,
    );
    assert.match(readme, /`@deepseek` requires a configured \[OpenCode CLI\]\(https:\/\/opencode\.ai\/docs\/cli\/\)/u);
});

test("Agents and scripts guide documents setup and everyday workflows", () => {
    const guide = readRequiredFile("SCRIPTS.md");
    const generateActionCopy = getParagraphContaining(guide, "Use **Generate**");
    const scriptsDefaultPolicy = getParagraphContaining(
        guide,
        "Scripts are an optional advanced capability",
    );

    assert.match(guide, /^# Agents and Scripts$/mu);
    assert.match(guide, /desktop Obsidian/iu);
    assert.match(guide, /filesystem-backed vault/iu);
    for (const cli of ["Codex", "Claude Code", "Cursor", "Gemini", "DeepSeek"]) {
        assert.match(guide, new RegExp(cli, "u"));
    }
    assert.match(guide, /bundles none/iu);
    assert.match(guide, /no agent service/iu);
    assert.match(guide, /In a side note,[^\n]*type[^\n]*@codex[^\n]*save/iu);
    assert.match(guide, /Show agent tab/u);
    assert.equal(guide.includes(AGENT_TAB_SETTINGS_PATH), true);
    assert.match(guide, /controls visibility only[^\n]*replies remain[^\n]*List view/iu);
    assert.equal(guide.includes(SCRIPTS_SETTINGS_PATH), true);
    assert.match(scriptsDefaultPolicy, /off by default/iu);
    assert.match(scriptsDefaultPolicy, /Ordinary agent replies do not require Scripts/iu);
    assert.match(guide, /default (?:local )?agent[^\n]*Settings → Aside → Scripts \(advanced\)/iu);
    assert.match(guide, /🛠️ scripts\//u);
    assert.match(guide, /first valid request/iu);
    assert.match(guide, /\/create-script <request>/u);
    assert.match(guide, /\/update-script \/script-name <request>/u);
    assert.match(guide, /\/pdf-to-markdown/u);
    assert.match(guide, /\/clean-citations/u);
    assertUsesGenerateButtonVocabulary(guide, generateActionCopy);
    assert.match(guide, /one vault script per (?:side note|comment)/iu);
    assert.match(guide, /do not (?:combine|mix).*agent/iu);
});

test("Agents and scripts guide documents registration rules and the security boundary", () => {
    const guide = readRequiredFile("SCRIPTS.md");

    assert.match(guide, /^## Security$/mu);
    assert.match(guide, /direct child/iu);
    for (const extension of [".mjs", ".js", ".cjs"]) {
        assert.match(guide, new RegExp(`\\${extension}`, "u"));
    }
    assert.match(guide, /cannot contain spaces/iu);
    assert.match(guide, /case-insensitive/iu);
    assert.match(guide, /duplicate/iu);
    assert.match(guide, /reserved/iu);
    assert.match(guide, /Hidden files[^\n]*ignored/iu);
    assert.match(guide, /\.test/u);
    assert.match(guide, /\.spec/u);
    assert.match(guide, /created, renamed, or deleted/iu);
    assert.match(guide, /not sandboxed/iu);
    assert.match(guide, /local account permissions/iu);
    assert.match(guide, /inherited environment/iu);
    assert.match(guide, /without a shell/iu);
    assert.match(guide, /vault root as (?:its|the) working directory/iu);
    assert.match(guide, /absolute path of the current Markdown note/iu);
    assert.match(guide, /output is bounded/iu);
    assert.match(guide, /60 seconds/iu);
    assert.match(guide, /controls do not prevent.*available to (?:your|the) (?:local )?account/isu);
    assert.match(guide, /review.*trust/isu);
    assert.match(guide, /do not put credentials.*(?:script|side note)/isu);
});

test("Agents and scripts guide explains what disabling Scripts changes and preserves", () => {
    const guide = readRequiredFile("SCRIPTS.md");
    const disabledPolicy = getParagraphContaining(guide, "Turning Scripts off");

    assert.match(disabledPolicy, /blocks new slash and script command execution/iu);
    assert.match(disabledPolicy, /script-oriented Generate actions/iu);
    assert.doesNotMatch(disabledPolicy, /\bretr(?:y|ies)\b/iu);
    assert.match(
        disabledPolicy,
        /does not delete[^.]*registered scripts[^.]*history[^.]*saved replies/iu,
    );
    assert.match(disabledPolicy, /ordinary note or agent text/iu);
    assert.match(guide, /not a sandbox or security boundary/iu);
    assert.doesNotMatch(guide, /requestKind/u);
});

test("Agents and scripts guide explains headless agent access and privacy boundaries", () => {
    const guide = readRequiredFile("SCRIPTS.md");

    assert.match(guide, /configured account and model[^\n]*does not override/iu);
    assert.match(guide, /non-interactive/iu);
    assert.match(guide, /permission-affecting flags/iu);
    assert.doesNotMatch(guide, /honors[^\n]*permissions/iu);
    assert.match(guide, /@deepseek[^\n]*OpenCode[^\n]*selected model/iu);
    assert.match(guide, /saved (?:side-note|side note) request/iu);
    assert.match(guide, /relevant source-note context/iu);
    assert.match(guide, /thread transcript/iu);
    assert.match(guide, /paths needed for the task/iu);
    assert.match(guide, /CLI and its model provider may receive/iu);
    assert.match(guide, /read or change vault files/iu);
    assert.match(guide, /network-capable tools/iu);
    assert.match(guide, /do not rely on[^\n]*interactive approval prompts/iu);
    assert.match(guide, /Review the CLI and provider settings[^\n]*sensitive note context/iu);
    assert.match(guide, /Codex[^\n]*workspace-write/iu);
    assert.match(guide, /Claude[^\n]*WebSearch[^\n]*Bash[^\n]*Read[^\n]*Write[^\n]*Edit[^\n]*Glob[^\n]*Grep/iu);
    assert.match(guide, /Cursor[^\n]*--force[^\n]*--trust[^\n]*sandbox/iu);
    assert.match(guide, /Gemini[^\n]*--skip-trust[^\n]*--sandbox[^\n]*--approval-mode yolo/iu);
    assert.match(guide, /OpenCode[^\n]*run --auto/iu);
});

test("advanced documentation covers the native Scripts and Publishing controls", () => {
    const advanced = readRequiredFile("ADVANCED_FEATURES.md");
    const scriptsDisabledPolicy = getParagraphContaining(advanced, "Turning Scripts off");
    const scriptsRow = getLineContaining(advanced, "| [Agents and Scripts]");
    const publishingRow = getLineContaining(advanced, "| [Cloudflare Pages Publishing]");
    const settingsOrder = getParagraphContaining(advanced, "sections appear in this order");

    assert.equal(existsSync("EXPERIMENTAL_FEATURES.md"), false);
    assert.match(advanced, /^# Advanced Features$/mu);
    assert.match(advanced, /optional advanced capabilities/iu);
    assert.match(scriptsRow, /Scripts off by default/iu);
    assert.match(publishingRow, /off by default/iu);
    assert.equal(settingsOrder.includes(SETTINGS_SECTION_ORDER), true);
    assert.match(advanced, /\[Agents and Scripts\]\(SCRIPTS\.md\)/u);
    assert.equal(advanced.includes(SCRIPTS_SETTINGS_PATH), true);
    assert.match(advanced, /Ordinary agent replies do not require Scripts/iu);
    assert.match(advanced, /\[Cloudflare Pages Publishing\]\(#cloudflare-pages-publishing\)/u);
    assert.match(advanced, /^## Cloudflare Pages Publishing$/mu);
    assert.equal(advanced.includes(PUBLISHING_SETTINGS_PATH), true);
    assertUsesGenerateButtonVocabulary(advanced, scriptsDisabledPolicy);
    assert.match(advanced, /^### Network and Data Access$/mu);
    assert.match(advanced, /^### Setup$/mu);
    assert.match(advanced, /^### Publishing Workflow$/mu);
    assert.doesNotMatch(advanced, /localStorage|aside\.feature\.publish/iu);
    assert.doesNotMatch(advanced, /^# Experimental Features$/mu);
});

test("advanced documentation explains what disabling Publishing preserves", () => {
    const advanced = readRequiredFile("ADVANCED_FEATURES.md");

    assertPublishingDisabledPolicy(advanced);
});

test("Generate vocabulary guard allows unrelated retry guidance", () => {
    const actionCopy = "Use Generate to run this action again.";
    const guide = `${actionCopy}\n\nTroubleshooting may ask you to retry a network request.`;

    assertUsesGenerateButtonVocabulary(guide, actionCopy);
});
