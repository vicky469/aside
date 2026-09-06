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
        /ASIDE_SETTINGS_HERO_INSTRUCTION\s*=\s*"add comment, @agent reply"/,
    );
    assert.doesNotMatch(source, /ASIDE_SETTINGS_HERO_GRAPH_LABEL/);
    assert.doesNotMatch(source, /aside-settings-hero-graph-label/);
    assert.match(source, /role:\s*"img"/);
    assert.match(source, /"aria-label":\s*ASIDE_SETTINGS_HERO_ARIA_LABEL/);
    assert.match(
        source,
        /ASIDE_SETTINGS_HERO_ARIA_LABEL\s*=\s*"Aside: Add a comment, receive an @agent reply, and grow a thought trail\."/,
    );
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

test("settings header renders the original small GEB scene with six bounded tracks", async () => {
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
    assert.doesNotMatch(source, /GraphNodeShape|GraphFrameNodePosition|frameNodePosition/);
    assert.doesNotMatch(source, /aside-settings-hero-graph-node is-frame/);

    const appendGraphPlaneMatch = source.match(
        /function appendGraphPlane\([\s\S]*?\): void \{([\s\S]*?)\n\}\n\nfunction renderGraph/,
    );
    assert.notEqual(appendGraphPlaneMatch, null);
    const edgeTrackCalls = appendGraphPlaneMatch[1].match(/appendEdgeTrack\(planeEl,/g) ?? [];

    assert.equal(edgeTrackCalls.length, 2);
    assert.doesNotMatch(appendGraphPlaneMatch[1], /appendNode\(planeEl, true\)/);
    assert.match(appendGraphPlaneMatch[1], /appendEdgeTrack\(planeEl, 3, spec\.armTrackClass\);\s*planeEl\.append\("─────"\);/);

    const renderGraphMatch = source.match(
        /function renderGraph\(parentEl: HTMLElement\): void \{([\s\S]*?)\n\}\n\nexport function/,
    );
    assert.notEqual(renderGraphMatch, null);
    const renderGraphBody = renderGraphMatch[1];
    const graphRowClasses = renderGraphBody.match(/aside-settings-hero-graph-row/g) ?? [];
    const stageClasses = renderGraphBody.match(/aside-settings-hero-graph-stage/g) ?? [];
    const sceneClasses = renderGraphBody.match(/aside-settings-hero-graph-scene/g) ?? [];
    const planeLoopIndex = renderGraphBody.indexOf("for (const spec of GRAPH_PLANE_SPECS)");

    assert.equal(graphRowClasses.length, 1);
    assert.equal(stageClasses.length, 1);
    assert.equal(sceneClasses.length, 1);
    assert.notEqual(planeLoopIndex, -1);
    assert.match(
        renderGraphBody,
        /for \(const spec of GRAPH_PLANE_SPECS\) \{\s*appendGraphPlane\(sceneEl, spec\);\s*\}/,
    );
    assert.ok(
        renderGraphBody.indexOf("aside-settings-hero-graph-row")
            < renderGraphBody.indexOf("aside-settings-hero-graph-stage"),
    );
    assert.ok(
        renderGraphBody.indexOf("aside-settings-hero-graph-stage")
            < renderGraphBody.indexOf("aside-settings-hero-graph-scene"),
    );
    assert.ok(renderGraphBody.indexOf("aside-settings-hero-graph-scene") < planeLoopIndex);
    assert.doesNotMatch(renderGraphBody, /aside-settings-hero-graph-label/);
    assert.doesNotMatch(source, /aside-settings-hero-graph-core|●/);
    assert.doesNotMatch(source, /is-square|□/);
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

function getFlatRule(styles, selector, requiredDeclaration = "") {
    const matches = styles.matchAll(
        /(?<selectors>[^{}]+)\{(?<body>[^{}]*)\}/g,
    );
    return [...matches]
        .filter((match) =>
            (match.groups?.selectors ?? "")
                .split(",")
                .map((candidate) => candidate.trim())
                .includes(selector),
        )
        .map((match) => match.groups?.body ?? "")
        .find((body) => body.includes(requiredDeclaration)) ?? "";
}

function getBalancedBlockBody(styles, openingBraceIndex) {
    let depth = 0;
    for (let index = openingBraceIndex; index < styles.length; index += 1) {
        if (styles[index] === "{") depth += 1;
        if (styles[index] !== "}") continue;

        depth -= 1;
        if (depth === 0) {
            return styles.slice(openingBraceIndex + 1, index);
        }
    }

    return "";
}

function getAtRuleBody(styles, atRulePattern, requiredContent = "") {
    const flags = atRulePattern.global
        ? atRulePattern.flags
        : `${atRulePattern.flags}g`;
    const matches = styles.matchAll(new RegExp(atRulePattern.source, flags));

    for (const match of matches) {
        const openingBraceIndex = styles.indexOf(
            "{",
            (match.index ?? 0) + match[0].length,
        );
        if (openingBraceIndex === -1) continue;

        const body = getBalancedBlockBody(styles, openingBraceIndex);
        if (body.includes(requiredContent)) return body;
    }

    return "";
}

test("settings header stages a soft cascade before continuous ambient motion", async () => {
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
    const hiddenOnFirstFrame = [
        ".aside-settings-tab .aside-settings-hero-rabbit",
        ".aside-settings-tab .aside-settings-hero-thought",
        ".aside-settings-tab .aside-settings-hero-signal-glyph",
        ".aside-settings-tab .aside-settings-hero-aside-box",
        ".aside-settings-tab .aside-settings-hero-action-line",
        ".aside-settings-tab .aside-settings-hero-graph-stage",
    ];
    const finiteAnimationSelectors = [
        ".aside-settings-tab .aside-settings-hero-thought",
        ".aside-settings-tab .aside-settings-hero-signal-glyph",
        ".aside-settings-tab .aside-settings-hero-aside-box",
        ".aside-settings-tab .aside-settings-hero-action-line",
        ".aside-settings-tab .aside-settings-hero-graph-stage",
        ".aside-settings-tab .aside-settings-hero-graph-node",
    ];

    assert.match(hero, /--aside-settings-hero-intro-duration:\s*5s\s*;/);
    assert.match(hero, /--aside-settings-hero-motion-delay:\s*3\.35s\s*;/);
    assert.match(hero, /container-type:\s*inline-size\s*;/);
    assert.match(settingRow, /display:\s*block\s*;/);
    assert.match(settingRow, /padding:\s*0\s*;/);
    for (const selector of hiddenOnFirstFrame) {
        assert.match(getRule(styles, selector), /opacity:\s*0\s*;/);
    }
    assert.match(rabbit, /aside-settings-hero-rabbit[^,;]*\s1\s+forwards/);
    assert.match(
        rabbit,
        /aside-settings-hero-rabbit-idle\s+3\.8s\s+ease-in-out\s+var\(--aside-settings-hero-motion-delay\)\s+infinite\s+alternate/,
    );
    for (const selector of finiteAnimationSelectors) {
        const rule = getRule(styles, selector);
        assert.match(rule, /animation:[^;]*\s1\s+forwards\s*;/);
        assert.doesNotMatch(rule, /infinite/);
    }

    assert.match(styles, /@keyframes aside-settings-hero-rabbit\s*\{\s*0%, 2% \{ opacity: 0;[^}]*\}\s*8% \{ opacity: 1;[^}]*\}\s*14%, 100% \{ opacity: 1; transform: translate\(5px, 0\) rotate\(0\); \}/);
    assert.match(styles, /@keyframes aside-settings-hero-thought\s*\{\s*0%, 9% \{ opacity: 0;[^}]*\}\s*17%, 100% \{ opacity: 1;/);
    assert.match(styles, /@keyframes aside-settings-hero-signal\s*\{\s*0%, 15% \{ opacity: 0;[^}]*\}\s*23%, 34% \{ opacity: 1;[^}]*\}\s*35%, 100% \{ opacity: 0\.45; text-shadow: none; \}/);
    assert.match(styles, /@keyframes aside-settings-hero-aside-box\s*\{\s*0%, 21% \{ opacity: 0;[^}]*\}\s*30%, 42% \{\s*opacity: 1;[^}]*\}\s*50%, 100% \{ opacity: 1; transform: scale\(1\); color: inherit; filter: none; \}/);
    assert.match(styles, /@keyframes aside-settings-hero-action\s*\{\s*0%, 28% \{ opacity: 0;[^}]*\}\s*37%, 100% \{ opacity: 1;/);
    assert.match(styles, /@keyframes aside-settings-hero-graph-reveal\s*\{\s*0%, 35% \{ opacity: 0;[^}]*\}\s*45% \{ opacity: 1; \}\s*64%, 100% \{ opacity: 1;/);
    assert.match(styles, /@keyframes aside-settings-hero-node\s*\{\s*0%, 47% \{ opacity: 0;[^}]*\}\s*58% \{ opacity: 1; transform: scale\(1\.25\); text-shadow: 0 0 8px currentColor; \}\s*64%, 100% \{ opacity: 1; transform: scale\(1\); text-shadow: none; \}/);

    assert.match(scene, /transform-style:\s*preserve-3d\s*;/);
    assert.match(scene, /animation-name:\s*aside-settings-hero-graph-turn\s*;/);
    assert.match(scene, /animation-delay:\s*var\(--aside-settings-hero-motion-delay\)\s*;/);
    assert.match(scene, /animation-iteration-count:\s*infinite\s*;/);
    assert.match(scene, /animation-direction:\s*alternate\s*;/);
    assert.match(track, /position:\s*relative\s*;/);
    assert.match(track, /overflow:\s*hidden\s*;/);
    assert.match(runner, /animation-name:\s*aside-settings-hero-edge-flow\s*;/);
    assert.match(runner, /animation-delay:\s*calc\(var\(--aside-settings-hero-motion-delay\)/);
    assert.match(runner, /animation-iteration-count:\s*infinite\s*;/);
    assert.match(runner, /animation-direction:\s*alternate\s*;/);
    const infiniteAnimationSelectors = [
        ...styles.matchAll(
            /(?<selector>\.aside-settings-tab \.aside-settings-hero[^{}]*)\{(?<body>[^{}]*animation[^{}]*)\}/g,
        ),
    ]
        .filter((match) => match.groups?.body.includes("infinite"))
        .map((match) => match.groups?.selector.trim());

    assert.deepEqual(infiniteAnimationSelectors, [
        ".aside-settings-tab .aside-settings-hero-rabbit",
        ".aside-settings-tab .aside-settings-hero-graph-scene",
        ".aside-settings-tab .aside-settings-hero-edge-runner",
    ]);

    assert.match(
        styles,
        /@keyframes aside-settings-hero-rabbit-idle\s*\{\s*0% \{ transform: translate\(5px, 0\) rotate\(0\); \}\s*45% \{ transform: translate\(5px, -1px\) rotate\(-0\.35deg\); \}\s*100% \{ transform: translate\(6px, 0\) rotate\(0\.35deg\); \}\s*\}/,
    );
    assert.match(
        styles,
        /@keyframes aside-settings-hero-graph-turn\s*\{\s*0% \{ transform: rotateX\(-7deg\) rotateY\(-18deg\); \}\s*100% \{ transform: rotateX\(8deg\) rotateY\(20deg\); \}\s*\}/,
    );
    assert.match(
        styles,
        /@keyframes aside-settings-hero-edge-flow\s*\{\s*0% \{ opacity: 0\.72; transform: translateX\(0\); \}\s*12%, 88% \{ opacity: 1; \}\s*100% \{\s*opacity: 0\.72;\s*transform: translateX\(var\(--aside-settings-hero-runner-travel\)\);\s*\}\s*\}/,
    );
});

test("settings header uses the original small GEB planes and narrow-pane layout", async () => {
    const styles = await readFile(stylesUrl, "utf8");
    const hero = getRule(styles, ".aside-settings-tab .aside-settings-hero");
    const stage = getRule(styles, ".aside-settings-tab .aside-settings-hero-graph-stage");
    const scene = getRule(styles, ".aside-settings-tab .aside-settings-hero-graph-scene");
    const runner = getRule(styles, ".aside-settings-tab .aside-settings-hero-edge-runner");
    const plane = getRule(
        styles,
        ".aside-settings-tab .aside-settings-hero-graph-plane",
        "position: absolute",
    );

    assert.match(stage, /perspective:\s*620px\s*;/);
    assert.match(plane, /position:\s*absolute\s*;/);
    assert.match(plane, /transform-style:\s*preserve-3d\s*;/);
    assert.match(hero, /--aside-settings-hero-blue-glow:\s*color-mix\(/);
    assert.match(hero, /--aside-settings-hero-brass-shadow:\s*color-mix\(/);
    assert.match(hero, /--aside-settings-hero-brass-mid:\s*color-mix\(/);
    assert.match(hero, /--aside-settings-hero-brass-light:\s*color-mix\(/);
    assert.match(hero, /--aside-settings-hero-amber-glow:\s*color-mix\(/);
    assert.match(plane, /color:\s*var\(--aside-settings-hero-brass-mid\)\s*;/);
    assert.match(scene, /animation-duration:\s*11s\s*;/);
    assert.match(scene, /animation-timing-function:\s*cubic-bezier\(0\.45,\s*0,\s*0\.55,\s*1\)\s*;/);
    assert.match(runner, /text-shadow:\s*0 0 5px var\(--aside-settings-hero-blue-glow\)\s*;/);
    assert.match(styles, /\.aside-settings-tab \.aside-settings-hero-graph-stage::before\s*\{[^}]*radial-gradient\(circle,[^}]*var\(--aside-settings-hero-amber-glow\)/);
    assert.match(styles, /\.aside-settings-tab \.aside-settings-hero-graph-plane\.is-plane-a\s*\{[^}]*color:\s*var\(--aside-settings-hero-brass-shadow\)[^}]*opacity:\s*0\.72[^}]*rotateX\(66deg\)[^}]*rotateZ\(45deg\)/);
    assert.match(styles, /\.aside-settings-tab \.aside-settings-hero-graph-plane\.is-plane-b\s*\{[^}]*color:\s*var\(--aside-settings-hero-brass-mid\)[^}]*opacity:\s*0\.86[^}]*rotateY\(66deg\)[^}]*rotateZ\(45deg\)/);
    assert.match(styles, /\.aside-settings-tab \.aside-settings-hero-graph-plane\.is-plane-c\s*\{[^}]*color:\s*var\(--aside-settings-hero-brass-light\)[^}]*opacity:\s*0\.98[^}]*rotateX\(-18deg\)[^}]*rotateY\(-18deg\)[^}]*rotateZ\(45deg\)/);
    assert.doesNotMatch(styles, /aside-settings-hero-graph-node\.is-frame/);
    assert.doesNotMatch(styles, /aside-settings-hero-graph-core|aside-settings-hero-core/);
    assert.doesNotMatch(styles, /aside-settings-hero-gold/);
    assert.doesNotMatch(styles, /radial-gradient\(ellipse/);
    assert.match(stage, /width:\s*160px\s*;/);
    assert.match(stage, /max-width:\s*100%\s*;/);
    assert.match(stage, /flex:\s*0\s+0\s+160px\s*;/);
    assert.doesNotMatch(stage, /width:\s*min\(/);
    assert.match(stage, /height:\s*112px\s*;/);
    assert.match(styles, /@container\s*\(max-width:\s*360px\)[\s\S]*?\.aside-settings-tab \.aside-settings-hero-graph-stage[\s\S]*?width:\s*145px\s*;/);
    assert.match(styles, /@container\s*\(max-width:\s*360px\)[\s\S]*?\.aside-settings-tab \.aside-settings-hero-graph-stage[\s\S]*?flex-basis:\s*145px\s*;/);
    assert.match(styles, /@container\s*\(max-width:\s*360px\)[\s\S]*?\.aside-settings-tab \.aside-settings-hero-graph-stage[\s\S]*?height:\s*102px\s*;/);
    assert.doesNotMatch(styles, /(?:^|\})\s*\.aside-settings-hero\s*\{/m);
});

test("settings header shows a static completed composition for reduced motion", async () => {
    const styles = await readFile(stylesUrl, "utf8");
    const reducedMotion = getAtRuleBody(
        styles,
        /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
        ".aside-settings-tab .aside-settings-hero-rabbit",
    );
    const animatedSelectors = [
        ".aside-settings-tab .aside-settings-hero-rabbit",
        ".aside-settings-tab .aside-settings-hero-thought",
        ".aside-settings-tab .aside-settings-hero-signal-glyph",
        ".aside-settings-tab .aside-settings-hero-aside-box",
        ".aside-settings-tab .aside-settings-hero-action-line",
        ".aside-settings-tab .aside-settings-hero-graph-stage",
        ".aside-settings-tab .aside-settings-hero-graph-node",
        ".aside-settings-tab .aside-settings-hero-graph-scene",
        ".aside-settings-tab .aside-settings-hero-edge-runner",
    ];
    const visibleSelectors = [
        ".aside-settings-tab .aside-settings-hero-rabbit",
        ".aside-settings-tab .aside-settings-hero-thought",
        ".aside-settings-tab .aside-settings-hero-aside-box",
        ".aside-settings-tab .aside-settings-hero-action-line",
        ".aside-settings-tab .aside-settings-hero-graph-stage",
        ".aside-settings-tab .aside-settings-hero-graph-node",
    ];
    const transformResetSelectors = [
        ".aside-settings-tab .aside-settings-hero-rabbit",
        ".aside-settings-tab .aside-settings-hero-thought",
        ".aside-settings-tab .aside-settings-hero-aside-box",
        ".aside-settings-tab .aside-settings-hero-action-line",
        ".aside-settings-tab .aside-settings-hero-graph-node",
    ];

    assert.notEqual(reducedMotion, "");

    for (const selector of animatedSelectors) {
        const rule = getFlatRule(reducedMotion, selector, "animation: none");
        assert.match(rule, /animation:\s*none\s*;/);
        assert.match(rule, /text-shadow:\s*none\s*;/);
        assert.match(rule, /filter:\s*none\s*;/);
    }

    for (const selector of visibleSelectors) {
        const rule = getFlatRule(reducedMotion, selector, "opacity: 1");
        assert.match(rule, /opacity:\s*1\s*;/);
    }

    for (const selector of transformResetSelectors) {
        const rule = getFlatRule(reducedMotion, selector, "transform: none");
        assert.match(rule, /transform:\s*none\s*;/);
    }

    const signal = getFlatRule(
        reducedMotion,
        ".aside-settings-tab .aside-settings-hero-signal-glyph",
        "opacity: 0.45",
    );
    assert.match(signal, /opacity:\s*0\.45\s*;/);

    const stage = getFlatRule(
        reducedMotion,
        ".aside-settings-tab .aside-settings-hero-graph-stage",
        "clip-path: none",
    );
    assert.match(stage, /clip-path:\s*none\s*;/);

    const scene = getFlatRule(
        reducedMotion,
        ".aside-settings-tab .aside-settings-hero-graph-scene",
        "will-change: auto",
    );
    assert.match(scene, /transform:\s*rotateX\(2deg\) rotateY\(-12deg\)\s*;/);
    assert.match(scene, /will-change:\s*auto\s*;/);

    const runner = getFlatRule(
        reducedMotion,
        ".aside-settings-tab .aside-settings-hero-edge-runner",
        "will-change: auto",
    );
    assert.match(runner, /opacity:\s*0\.8\s*;/);
    assert.match(runner, /transform:\s*translateX\(0\)\s*;/);
    assert.match(runner, /will-change:\s*auto\s*;/);
});

test("settings header keeps its ASCII and Unicode art directionally isolated", async () => {
    const styles = await readFile(stylesUrl, "utf8");
    const art = getRule(styles, ".aside-settings-tab .aside-settings-hero-art");

    assert.match(art, /direction:\s*ltr\s*;/);
    assert.match(art, /unicode-bidi:\s*isolate\s*;/);
});

test("settings header remains cardless while preserving its layout container", async () => {
    const styles = await readFile(stylesUrl, "utf8");
    const hero = getRule(styles, ".aside-settings-tab .aside-settings-hero");

    assert.match(hero, /border:\s*0\s*;/);
    assert.match(hero, /border-radius:\s*0\s*;/);
    assert.match(hero, /background:\s*transparent\s*;/);
    assert.doesNotMatch(hero, /margin-bottom:/);
    assert.match(hero, /padding:\s*var\(--size-4-3\)\s*;/);
});

test("declarative settings header clears its parent group surface", async () => {
    const [source, styles] = await Promise.all([
        readFile(settingSourceUrl, "utf8"),
        readFile(stylesUrl, "utf8"),
    ]);
    const parentGroup = getRule(
        styles,
        ".aside-settings-tab .setting-items.aside-settings-hero-group",
    );

    assert.match(
        source,
        /setting\.settingEl\.parentElement\?\.addClass\("aside-settings-hero-group"\)/,
    );
    assert.match(parentGroup, /background:\s*transparent\s*;/);
    assert.match(parentGroup, /border:\s*0\s*;/);
    assert.match(parentGroup, /border-radius:\s*0\s*;/);
    assert.match(parentGroup, /box-shadow:\s*none\s*;/);
});

test("settings header keeps the compact GEB graph without a visible caption", async () => {
    const styles = await readFile(stylesUrl, "utf8");
    const art = getRule(styles, ".aside-settings-tab .aside-settings-hero-art");
    const row = getRule(styles, ".aside-settings-tab .aside-settings-hero-graph-row");

    assert.match(row, /display:\s*flex\s*;/);
    assert.match(row, /align-items:\s*center\s*;/);
    assert.match(row, /justify-content:\s*center\s*;/);
    assert.match(row, /flex-wrap:\s*wrap\s*;/);
    assert.match(row, /max-width:\s*100%\s*;/);
    assert.match(art, /gap:\s*var\(--size-4-2\)\s*;/);
    assert.doesNotMatch(styles, /aside-settings-hero-graph-label/);
    assert.doesNotMatch(styles, /aside-settings-hero-label/);
});

test("settings header aligns the action relay beneath the Aside junction without narrow-pane overflow", async () => {
    const [source, styles] = await Promise.all([
        readFile(headerSourceUrl, "utf8"),
        readFile(stylesUrl, "utf8"),
    ]);
    const relay = getRule(styles, ".aside-settings-tab .aside-settings-hero-relay");
    const row = getRule(styles, ".aside-settings-tab .aside-settings-hero-relay-row");
    const rabbit = getRule(styles, ".aside-settings-tab .aside-settings-hero-rabbit");
    const thought = getRule(styles, ".aside-settings-tab .aside-settings-hero-thought");
    const signal = getRule(styles, ".aside-settings-tab .aside-settings-hero-signal");
    const asideBox = getRule(styles, ".aside-settings-tab .aside-settings-hero-aside-box");
    const action = getRule(styles, ".aside-settings-tab .aside-settings-hero-action-line");
    const narrowStart = styles.indexOf("@container (max-width: 360px)");
    const narrowEnd = styles.indexOf("@media (prefers-reduced-motion: reduce)", narrowStart);
    const narrowStyles = styles.slice(narrowStart, narrowEnd);
    const narrowRelay = getRule(narrowStyles, ".aside-settings-tab .aside-settings-hero-relay");
    const narrowAction = getRule(narrowStyles, ".aside-settings-tab .aside-settings-hero-action-line");

    assert.match(source, /text:\s*" \/\)\/\)\\n\( \. \.\)\\n \/づ"/);
    assert.match(
        source,
        /\["┌─────────┐\\n│ ", "Thought", " │\\n└─────────┘"\]\.join\(""\)/,
    );
    assert.match(source, /for \(const glyph of \["·", "─", "─", "▶"\]\)/);
    assert.match(
        source,
        /\["┌─────────┐\\n│ {2}", "ASIDE", " {2}│\\n└────┬────┘"\]\.join\(""\)/,
    );
    assert.match(
        source,
        /text:\s*`╰─ \$\{ASIDE_SETTINGS_HERO_INSTRUCTION\}`/,
    );
    assert.doesNotMatch(source, /ASIDE_SETTINGS_HERO_INSTRUCTION\.split/);
    assert.match(thought, /text-transform:\s*lowercase\s*;/);
    assert.match(action, /text-transform:\s*lowercase\s*;/);

    assert.match(relay, /display:\s*grid\s*;/);
    assert.match(relay, /grid-template-columns:\s*max-content\s+max-content\s+max-content\s+minmax\(11ch,\s*1fr\)\s*;/);
    assert.match(relay, /width:\s*min\(100%,\s*57ch\)\s*;/);
    assert.match(relay, /row-gap:\s*0\s*;/);
    assert.match(row, /display:\s*contents\s*;/);
    assert.match(rabbit, /grid-column:\s*1\s*;/);
    assert.match(thought, /grid-column:\s*2\s*;/);
    assert.match(signal, /grid-column:\s*3\s*;/);
    assert.match(asideBox, /grid-column:\s*4\s*;/);
    assert.match(action, /grid-column:\s*4\s*;/);
    assert.match(action, /grid-row:\s*2\s*;/);
    assert.match(action, /margin-left:\s*5ch\s*;/);
    assert.match(action, /flex-wrap:\s*nowrap\s*;/);
    assert.match(action, /white-space:\s*nowrap\s*;/);
    assert.match(narrowRelay, /grid-template-columns:\s*minmax\(0,\s*6ch\)/);
    assert.match(narrowAction, /grid-column:\s*4\s*;/);
    assert.match(narrowAction, /margin-left:\s*5ch\s*;/);
    assert.doesNotMatch(styles, /aside-settings-hero-action-chunk:not\(:first-child\)/);
    assert.doesNotMatch(narrowAction, /flex-direction:\s*column\s*;/);
});
