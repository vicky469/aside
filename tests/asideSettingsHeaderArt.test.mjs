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
