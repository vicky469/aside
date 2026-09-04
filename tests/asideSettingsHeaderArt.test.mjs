import * as assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const headerSourceUrl = new URL(
    "../src/ui/settings/asideSettingsHeaderArt.ts",
    import.meta.url,
);
const settingSourceUrl = new URL(
    "../src/ui/settings/AsideSetting.ts",
    import.meta.url,
);

test("settings header owns the approved copy and accessible art structure", async () => {
    const source = await readFile(headerSourceUrl, "utf8");

    assert.match(
        source,
        /ASIDE_SETTINGS_HERO_INSTRUCTION\s*=\s*"Save highlight, add comment, ask @agent"/,
    );
    assert.match(
        source,
        /ASIDE_SETTINGS_HERO_GRAPH_LABEL\s*=\s*"Thought trail"/,
    );
    assert.match(source, /role:\s*"img"/);
    assert.match(source, /"aria-label":\s*ASIDE_SETTINGS_HERO_ARIA_LABEL/);
    assert.match(source, /"aria-hidden":\s*"true"/);
    assert.match(source, /aside-settings-hero-edge-track/);
    assert.match(source, /aside-settings-hero-edge-runner/);
    assert.doesNotMatch(source, /innerHTML/);
    assert.doesNotMatch(source, /setInterval|requestAnimationFrame/);
});

test("settings tab mounts the header before the settings catalog", async () => {
    const source = await readFile(settingSourceUrl, "utf8");

    assert.match(
        source,
        /import \{ renderAsideSettingsHeaderArt \} from "\.\/asideSettingsHeaderArt";/,
    );
    const headerIndex = source.indexOf("renderAsideSettingsHeaderArt(this.containerEl)");
    const settingsIndex = source.indexOf("renderLegacyAsideSettings(");

    assert.notEqual(headerIndex, -1);
    assert.notEqual(settingsIndex, -1);
    assert.ok(headerIndex < settingsIndex);
});

test("settings header renders one scene with three graph planes and six bounded tracks", async () => {
    const source = await readFile(headerSourceUrl, "utf8");
    const graphPlaneSpecsMatch = source.match(
        /const GRAPH_PLANE_SPECS: readonly GraphPlaneSpec\[\] = \[([\s\S]*?)\n\];/,
    );

    assert.notEqual(graphPlaneSpecsMatch, null);
    const graphPlaneSpecs = graphPlaneSpecsMatch[1];
    const modifierClasses = Array.from(
        graphPlaneSpecs.matchAll(/modifierClass:\s*"([^"]+)"/g),
        (match) => match[1],
    );
    const trackClasses = Array.from(
        graphPlaneSpecs.matchAll(/(?:topTrackClass|armTrackClass):\s*"([^"]+)"/g),
        (match) => match[1],
    );

    assert.deepEqual(modifierClasses, ["is-plane-a", "is-plane-b", "is-plane-c"]);
    assert.deepEqual(trackClasses, [
        "is-track-1",
        "is-track-2",
        "is-track-3",
        "is-track-4",
        "is-track-5",
        "is-track-6",
    ]);

    const appendGraphPlaneMatch = source.match(
        /function appendGraphPlane\([\s\S]*?\): void \{([\s\S]*?)\n\}\n\nfunction renderGraph/,
    );
    assert.notEqual(appendGraphPlaneMatch, null);
    const edgeTrackCalls = appendGraphPlaneMatch[1].match(/appendEdgeTrack\(planeEl,/g) ?? [];

    assert.equal(edgeTrackCalls.length, 2);

    const renderGraphMatch = source.match(
        /function renderGraph\(parentEl: HTMLElement\): void \{([\s\S]*?)\n\}\n\nexport function/,
    );
    assert.notEqual(renderGraphMatch, null);
    const renderGraphBody = renderGraphMatch[1];
    const stageClasses = renderGraphBody.match(/aside-settings-hero-graph-stage/g) ?? [];
    const sceneClasses = renderGraphBody.match(/aside-settings-hero-graph-scene/g) ?? [];
    const planeLoopIndex = renderGraphBody.indexOf("for (const spec of GRAPH_PLANE_SPECS)");

    assert.equal(stageClasses.length, 1);
    assert.equal(sceneClasses.length, 1);
    assert.notEqual(planeLoopIndex, -1);
    assert.match(
        renderGraphBody,
        /for \(const spec of GRAPH_PLANE_SPECS\) \{\s*appendGraphPlane\(sceneEl, spec\);\s*\}/,
    );
    assert.ok(
        renderGraphBody.indexOf("aside-settings-hero-graph-stage")
            < renderGraphBody.indexOf("aside-settings-hero-graph-scene"),
    );
    assert.ok(renderGraphBody.indexOf("aside-settings-hero-graph-scene") < planeLoopIndex);
    assert.doesNotMatch(source, /\b(?:brain|face|wikilink)\b/i);
});

test("declarative and legacy settings paths both mount the header before the catalog", async () => {
    const source = await readFile(settingSourceUrl, "utf8");
    const definitionIndex = source.indexOf('name: "Aside workflow"');
    const definitionHeaderIndex = source.indexOf(
        "renderAsideSettingsHeaderArt(setting.settingEl)",
        definitionIndex,
    );
    const definitionCatalogIndex = source.indexOf("...getAsideSettingDefinitions(");

    assert.notEqual(definitionIndex, -1);
    assert.match(source, /searchable:\s*false/);
    assert.notEqual(definitionHeaderIndex, -1);
    assert.notEqual(definitionCatalogIndex, -1);
    assert.ok(definitionHeaderIndex < definitionCatalogIndex);
    assert.match(source, /setting\.settingEl\.empty\(\)/);
    assert.match(source, /renderAsideSettingsHeaderArt\(this\.containerEl\)/);
});

test("settings tab removes the animated header when hidden", async () => {
    const source = await readFile(settingSourceUrl, "utf8");

    assert.match(
        source,
        /hide\(\): void \{[\s\S]*?this\.agentStatusRefreshToken \+= 1;[\s\S]*?this\.unloadSetupGuideMarkdownComponent\(\);[\s\S]*?this\.containerEl\.empty\(\);[\s\S]*?\}/,
    );
});

const stylesUrl = new URL("../styles.css", import.meta.url);

function getRule(styles, selector, requiredDeclaration = "") {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = styles.matchAll(
        new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "g"),
    );
    return [...matches]
        .map((match) => match.groups?.body ?? "")
        .find((body) => body.includes(requiredDeclaration)) ?? "";
}

test("settings header splits one-shot relay motion from continuous graph motion", async () => {
    const styles = await readFile(stylesUrl, "utf8");
    const hero = getRule(styles, ".aside-settings-tab .aside-settings-hero");
    const settingRow = getRule(
        styles,
        ".aside-settings-tab .setting-item.aside-settings-hero-setting",
    );
    const rabbit = getRule(styles, ".aside-settings-tab .aside-settings-hero-rabbit");
    const scene = getRule(styles, ".aside-settings-tab .aside-settings-hero-graph-scene");
    const track = getRule(styles, ".aside-settings-tab .aside-settings-hero-edge-track");
    const runner = getRule(styles, ".aside-settings-tab .aside-settings-hero-edge-runner");
    const introSelectors = [
        ".aside-settings-tab .aside-settings-hero-rabbit",
        ".aside-settings-tab .aside-settings-hero-thought",
        ".aside-settings-tab .aside-settings-hero-signal-glyph",
        ".aside-settings-tab .aside-settings-hero-aside-box",
        ".aside-settings-tab .aside-settings-hero-action-line",
        ".aside-settings-tab .aside-settings-hero-graph-stage",
        ".aside-settings-tab .aside-settings-hero-graph-node",
        ".aside-settings-tab .aside-settings-hero-graph-core",
        ".aside-settings-tab .aside-settings-hero-graph-label",
    ];

    assert.match(hero, /--aside-settings-hero-intro-duration:\s*7s\s*;/);
    assert.match(hero, /container-type:\s*inline-size\s*;/);
    assert.match(settingRow, /display:\s*block\s*;/);
    assert.match(settingRow, /padding:\s*0\s*;/);
    assert.match(rabbit, /animation:[^;]*\s1\s+forwards\s*;/);
    assert.doesNotMatch(rabbit, /infinite/);
    for (const selector of introSelectors) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const rulePattern = new RegExp(`${escaped}[^{}]*\\{(?<body>[^{}]*)\\}`);
        const rule = styles.match(rulePattern)?.groups?.body ?? "";

        assert.match(rule, /animation:[^;]*\s1\s+forwards\s*;/);
        assert.doesNotMatch(rule, /infinite/);
    }
    assert.match(scene, /transform-style:\s*preserve-3d\s*;/);
    assert.match(scene, /animation-name:\s*aside-settings-hero-graph-turn\s*;/);
    assert.match(scene, /animation-delay:\s*var\(--aside-settings-hero-intro-duration\)\s*;/);
    assert.match(scene, /animation-iteration-count:\s*infinite\s*;/);
    assert.match(scene, /animation-direction:\s*alternate\s*;/);
    assert.match(track, /position:\s*relative\s*;/);
    assert.match(track, /overflow:\s*hidden\s*;/);
    assert.match(runner, /animation-delay:\s*calc\(/);
    assert.match(runner, /animation-iteration-count:\s*infinite\s*;/);
    assert.match(runner, /animation-direction:\s*alternate\s*;/);
    assert.match(styles, /@keyframes aside-settings-hero-graph-turn/);
    assert.match(styles, /@keyframes aside-settings-hero-edge-flow/);

    const infiniteAnimationSelectors = [
        ...styles.matchAll(
            /(?<selector>\.aside-settings-tab \.aside-settings-hero[^{}]*)\{(?<body>[^{}]*animation[^{}]*)\}/g,
        ),
    ]
        .filter((match) => match.groups?.body.includes("infinite"))
        .map((match) => match.groups?.selector.trim());

    assert.deepEqual(infiniteAnimationSelectors, [
        ".aside-settings-tab .aside-settings-hero-graph-scene",
        ".aside-settings-tab .aside-settings-hero-edge-runner",
    ]);
});

test("settings header uses three fixed 3d planes and a narrow-pane layout", async () => {
    const styles = await readFile(stylesUrl, "utf8");
    const stage = getRule(styles, ".aside-settings-tab .aside-settings-hero-graph-stage");
    const plane = getRule(
        styles,
        ".aside-settings-tab .aside-settings-hero-graph-plane",
        "position: absolute",
    );

    assert.match(stage, /perspective:\s*620px\s*;/);
    assert.match(plane, /position:\s*absolute\s*;/);
    assert.match(plane, /transform-style:\s*preserve-3d\s*;/);
    assert.match(styles, /\.aside-settings-tab \.aside-settings-hero-graph-plane\.is-plane-a\s*\{[^}]*rotateX\(66deg\)[^}]*rotateZ\(45deg\)/);
    assert.match(styles, /\.aside-settings-tab \.aside-settings-hero-graph-plane\.is-plane-b\s*\{[^}]*rotateY\(66deg\)[^}]*rotateZ\(45deg\)/);
    assert.match(styles, /\.aside-settings-tab \.aside-settings-hero-graph-plane\.is-plane-c\s*\{[^}]*rotateX\(-18deg\)[^}]*rotateY\(-18deg\)[^}]*rotateZ\(45deg\)/);
    assert.match(styles, /@container\s*\(max-width:\s*360px\)[\s\S]*?\.aside-settings-tab \.aside-settings-hero-graph-stage[\s\S]*?width:\s*min\(190px,\s*100%\)\s*;/);
    assert.doesNotMatch(styles, /(?:^|\})\s*\.aside-settings-hero\s*\{/m);
});

test("settings header shows a static completed composition for reduced motion", async () => {
    const styles = await readFile(stylesUrl, "utf8");
    const animatedSelectors = [
        ".aside-settings-tab .aside-settings-hero-rabbit",
        ".aside-settings-tab .aside-settings-hero-thought",
        ".aside-settings-tab .aside-settings-hero-signal-glyph",
        ".aside-settings-tab .aside-settings-hero-aside-box",
        ".aside-settings-tab .aside-settings-hero-action-line",
        ".aside-settings-tab .aside-settings-hero-graph-stage",
        ".aside-settings-tab .aside-settings-hero-graph-node",
        ".aside-settings-tab .aside-settings-hero-graph-core",
        ".aside-settings-tab .aside-settings-hero-graph-label",
        ".aside-settings-tab .aside-settings-hero-graph-scene",
        ".aside-settings-tab .aside-settings-hero-edge-runner",
    ];
    const visibleSelectors = [
        ".aside-settings-tab .aside-settings-hero-action-line",
        ".aside-settings-tab .aside-settings-hero-graph-stage",
        ".aside-settings-tab .aside-settings-hero-graph-node",
        ".aside-settings-tab .aside-settings-hero-graph-core",
        ".aside-settings-tab .aside-settings-hero-graph-label",
    ];

    for (const selector of animatedSelectors) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        assert.match(
            styles,
            new RegExp(
                `@media\\s*\\(prefers-reduced-motion:\\s*reduce\\)[\\s\\S]*?${escaped}[^{}]*\\{[^{}]*animation:\\s*none\\s*;`,
            ),
        );
    }

    for (const selector of visibleSelectors) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        assert.match(
            styles,
            new RegExp(
                `@media\\s*\\(prefers-reduced-motion:\\s*reduce\\)[\\s\\S]*?${escaped}[^{}]*\\{[^{}]*opacity:\\s*1\\s*;`,
            ),
        );
    }

    assert.match(
        styles,
        /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.aside-settings-tab \.aside-settings-hero-graph-scene[\s\S]*?animation:\s*none\s*;/,
    );
    assert.match(
        styles,
        /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.aside-settings-tab \.aside-settings-hero-edge-runner[\s\S]*?animation:\s*none\s*;/,
    );
    assert.match(
        styles,
        /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.aside-settings-tab \.aside-settings-hero-graph-stage[\s\S]*?clip-path:\s*none\s*;/,
    );
    assert.match(
        styles,
        /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.aside-settings-tab \.aside-settings-hero-graph-scene[\s\S]*?will-change:\s*auto\s*;/,
    );
    assert.match(
        styles,
        /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.aside-settings-tab \.aside-settings-hero-edge-runner[\s\S]*?will-change:\s*auto\s*;/,
    );
});

test("settings header keeps its ASCII and Unicode art directionally isolated", async () => {
    const styles = await readFile(stylesUrl, "utf8");
    const art = getRule(styles, ".aside-settings-tab .aside-settings-hero-art");

    assert.match(art, /direction:\s*ltr\s*;/);
    assert.match(art, /unicode-bidi:\s*isolate\s*;/);
});
