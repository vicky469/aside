# Aside Settings 3D Thought Trail Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Aside's original settings-page header with a one-shot Rabbit relay and a continuously turning three-plane impossible-junction Thought Trail whose blue dots remain inside their edges until the settings window closes.

**Architecture:** Keep the focused `asideSettingsHeaderArt` renderer and legacy mount point from commit `e9409ed`, add an unsearchable custom-render definition for Obsidian 1.13+, and replace the flat graph scaffold with a perspective stage containing one transform-preserving scene and three explicit graph planes. Aside-scoped CSS owns the one-shot relay, delayed infinite 3D turn, clipped runner motion, responsive layout, and reduced-motion final state; `AsideSetting.hide()` removes the settings DOM so the animations have an explicit settings-window lifetime.

**Tech Stack:** TypeScript, Obsidian DOM helpers, CSS 3D transforms and keyframes, Node test runner, esbuild

---

### Task 1: Build the Three-Plane Graph and Settings Cleanup Boundary

**Files:**
- Modify: `tests/asideSettingsHeaderArt.test.mjs`
- Modify: `src/ui/settings/asideSettingsHeaderArt.ts`
- Modify: `src/ui/settings/AsideSetting.ts:82-105`

- [ ] **Step 1: Extend the source-contract tests for the revised graph and lifecycle**

Append these tests to `tests/asideSettingsHeaderArt.test.mjs`:

```js
test("settings header renders one scene with three graph planes and six bounded tracks", async () => {
    const source = await readFile(headerSourceUrl, "utf8");

    assert.match(source, /aside-settings-hero-graph-stage/);
    assert.match(source, /aside-settings-hero-graph-scene/);
    for (const planeClass of ["is-plane-a", "is-plane-b", "is-plane-c"]) {
        assert.match(source, new RegExp(planeClass));
    }
    for (let trackNumber = 1; trackNumber <= 6; trackNumber += 1) {
        assert.match(source, new RegExp(`is-track-${trackNumber}`));
    }
    assert.match(source, /appendGraphPlane/);
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/asideSettingsHeaderArt.test.mjs
```

Expected: the two existing tests pass; the graph test fails because `aside-settings-hero-graph-stage`, `aside-settings-hero-graph-scene`, and plane classes are absent; the dual-path test fails because the declarative header definition is absent; and the lifecycle test fails because `AsideSetting.hide()` is absent.

- [ ] **Step 3: Replace the flat graph scaffold with the three-plane scene**

Replace `src/ui/settings/asideSettingsHeaderArt.ts` with:

```ts
export const ASIDE_SETTINGS_HERO_INSTRUCTION = "Save highlight, add comment, ask @agent";
export const ASIDE_SETTINGS_HERO_GRAPH_LABEL = "Thought trail";

const ASIDE_SETTINGS_HERO_ARIA_LABEL =
    "Aside: Save a highlight, add a comment, ask an agent, and connect ideas in a thought trail.";

interface GraphPlaneSpec {
    modifierClass: string;
    topTrackClass: string;
    armTrackClass: string;
}

const GRAPH_PLANE_SPECS: readonly GraphPlaneSpec[] = [
    {
        modifierClass: "is-plane-a",
        topTrackClass: "is-track-1",
        armTrackClass: "is-track-2",
    },
    {
        modifierClass: "is-plane-b",
        topTrackClass: "is-track-3",
        armTrackClass: "is-track-4",
    },
    {
        modifierClass: "is-plane-c",
        topTrackClass: "is-track-5",
        armTrackClass: "is-track-6",
    },
];

function appendNode(parentEl: HTMLElement, core = false): void {
    parentEl.createSpan({
        cls: core
            ? "aside-settings-hero-graph-core"
            : "aside-settings-hero-graph-node",
        text: core ? "●" : "·",
    });
}

function appendEdgeTrack(
    parentEl: HTMLElement,
    width: number,
    modifierClass: string,
): void {
    const trackEl = parentEl.createSpan({
        cls: `aside-settings-hero-edge-track ${modifierClass}`,
    });
    trackEl.append("─".repeat(width));
    trackEl.createSpan({
        cls: "aside-settings-hero-edge-runner",
        text: "·",
    });
}

function renderRelay(parentEl: HTMLElement): void {
    const relayEl = parentEl.createDiv({ cls: "aside-settings-hero-relay" });
    const rowEl = relayEl.createDiv({ cls: "aside-settings-hero-relay-row" });

    rowEl.createEl("pre", {
        cls: "aside-settings-hero-rabbit",
        text: " /)/)\n( . .)\n /づ",
    });
    rowEl.createEl("pre", {
        cls: "aside-settings-hero-thought",
        text: ["┌─────────┐\n│ ", "Thought", " │\n└─────────┘"].join(""),
    });

    const signalEl = rowEl.createSpan({ cls: "aside-settings-hero-signal" });
    for (const glyph of ["·", "─", "─", "▶"]) {
        signalEl.createSpan({
            cls: "aside-settings-hero-signal-glyph",
            text: glyph,
        });
    }

    rowEl.createEl("pre", {
        cls: "aside-settings-hero-aside-box",
        text: ["┌─────────┐\n│  ", "ASIDE", "  │\n└────┬────┘"].join(""),
    });

    const actionLineEl = relayEl.createDiv({ cls: "aside-settings-hero-action-line" });
    const actions = ASIDE_SETTINGS_HERO_INSTRUCTION.split(", ");
    for (const [index, action] of actions.entries()) {
        actionLineEl.createSpan({
            cls: "aside-settings-hero-action-chunk",
            text: `${index === 0 ? "╰─ " : ""}${action}${index < actions.length - 1 ? ", " : ""}`,
        });
    }
}

function appendGraphPlane(parentEl: HTMLElement, spec: GraphPlaneSpec): void {
    const planeEl = parentEl.createEl("pre", {
        cls: `aside-settings-hero-graph-plane ${spec.modifierClass}`,
    });

    planeEl.append("    ");
    appendNode(planeEl);
    appendEdgeTrack(planeEl, 4, spec.topTrackClass);
    appendNode(planeEl);
    planeEl.append("\n    │    │\n");
    appendNode(planeEl);
    appendEdgeTrack(planeEl, 3, spec.armTrackClass);
    appendNode(planeEl, true);
    planeEl.append("────");
    appendNode(planeEl);
    planeEl.append("\n    │\n    ");
    appendNode(planeEl);
}

function renderGraph(parentEl: HTMLElement): void {
    const stageEl = parentEl.createDiv({ cls: "aside-settings-hero-graph-stage" });
    const sceneEl = stageEl.createDiv({ cls: "aside-settings-hero-graph-scene" });

    for (const spec of GRAPH_PLANE_SPECS) {
        appendGraphPlane(sceneEl, spec);
    }

    parentEl.createDiv({
        cls: "aside-settings-hero-graph-label",
        text: ASIDE_SETTINGS_HERO_GRAPH_LABEL,
    });
}

export function renderAsideSettingsHeaderArt(containerEl: HTMLElement): HTMLElement {
    const heroEl = containerEl.createDiv({
        cls: "aside-settings-hero",
        attr: {
            role: "img",
            "aria-label": ASIDE_SETTINGS_HERO_ARIA_LABEL,
        },
    });
    const artEl = heroEl.createDiv({
        cls: "aside-settings-hero-art",
        attr: {
            "aria-hidden": "true",
        },
    });

    renderRelay(artEl);
    renderGraph(artEl);
    return heroEl;
}
```

- [ ] **Step 4: Mount the header in the declarative path and add explicit cleanup**

In `src/ui/settings/AsideSetting.ts`, replace `getSettingDefinitions()` and add `hide()` immediately after `display()`:

```ts
getSettingDefinitions(): SettingDefinitionItem[] {
    return [
        {
            name: "Aside workflow",
            searchable: false,
            render: (setting) => {
                setting.settingEl.addClass("aside-settings-hero-setting");
                setting.settingEl.empty();
                renderAsideSettingsHeaderArt(setting.settingEl);
            },
        },
        ...getAsideSettingDefinitions(this.getCatalogContext()),
    ];
}

display(): void {
    this.renderLegacySettings();
}

hide(): void {
    this.agentStatusRefreshToken += 1;
    this.unloadSetupGuideMarkdownComponent();
    this.containerEl.empty();
}
```

Obsidian 1.13 bypasses `display()` when definitions are non-empty, so the unsearchable custom-render row mounts the header before the existing groups and removes the row's unused name/control chrome. Obsidian 1.12.7 continues to use the existing `display()` fallback. The documented `PluginSettingTab.hide()` lifecycle runs when the tab changes or settings modal closes; emptying the container removes either rendering path's animated DOM. No separate animation handle exists.

- [ ] **Step 5: Run focused verification and verify GREEN**

Run:

```bash
node --test tests/asideSettingsHeaderArt.test.mjs
npm run typecheck
npx eslint src/ui/settings/asideSettingsHeaderArt.ts src/ui/settings/AsideSetting.ts tests/asideSettingsHeaderArt.test.mjs --max-warnings 0
```

Expected: five focused tests pass, TypeScript reports no errors, and ESLint reports no warnings or errors.

- [ ] **Step 6: Commit the revised structure**

```bash
git add src/ui/settings/asideSettingsHeaderArt.ts src/ui/settings/AsideSetting.ts tests/asideSettingsHeaderArt.test.mjs
git commit -m "refactor(settings): build 3d thought trail scene"
```

### Task 2: Animate the One-Shot Relay and Continuous Spatial Graph

**Files:**
- Modify: `tests/asideSettingsHeaderArt.test.mjs`
- Modify: `styles.css:1810`

- [ ] **Step 1: Add failing stylesheet contracts**

Append this code to `tests/asideSettingsHeaderArt.test.mjs`:

```js
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

    assert.match(hero, /--aside-settings-hero-intro-duration:\s*7s\s*;/);
    assert.match(hero, /container-type:\s*inline-size\s*;/);
    assert.match(settingRow, /display:\s*block\s*;/);
    assert.match(settingRow, /padding:\s*0\s*;/);
    assert.match(rabbit, /animation:[^;]*\s1\s+forwards\s*;/);
    assert.doesNotMatch(rabbit, /infinite/);
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
    assert.match(styles, /@container\s*\(max-width:\s*360px\)[\s\S]*?\.aside-settings-tab \.aside-settings-hero-graph-stage[\s\S]*?width:\s*190px\s*;/);
    assert.doesNotMatch(styles, /(?:^|\})\s*\.aside-settings-hero\s*\{/m);
});

test("settings header shows a static completed composition for reduced motion", async () => {
    const styles = await readFile(stylesUrl, "utf8");

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
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/asideSettingsHeaderArt.test.mjs
```

Expected: the five renderer/integration/lifecycle tests pass and the three new style tests fail because no settings-hero stylesheet or keyframes exist.

- [ ] **Step 3: Add the complete scoped stylesheet**

Insert this block immediately before `.aside-settings-tab .setting-item.setting-item-heading` in `styles.css`:

```css
.aside-settings-tab .setting-item.aside-settings-hero-setting {
    display: block;
    padding: 0;
    border: 0;
}

.aside-settings-tab .aside-settings-hero {
    --aside-settings-hero-intro-duration: 7s;
    --aside-settings-hero-blue: var(--color-blue, var(--interactive-accent));
    container-type: inline-size;
    margin-bottom: var(--size-4-5);
    padding: var(--size-4-4);
    overflow: hidden;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-l);
    background: var(--background-secondary);
    color: var(--text-normal);
}

.aside-settings-tab .aside-settings-hero-art {
    display: grid;
    justify-items: center;
    gap: var(--size-4-3);
    width: 100%;
    font-family: var(--font-monospace);
    font-size: var(--font-ui-smaller);
    line-height: 1.3;
}

.aside-settings-tab .aside-settings-hero-relay {
    display: grid;
    justify-items: center;
    gap: var(--size-4-2);
    max-width: 100%;
}

.aside-settings-tab .aside-settings-hero-relay-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1ch;
    max-width: 100%;
}

.aside-settings-tab .aside-settings-hero-relay-row pre,
.aside-settings-tab .aside-settings-hero-graph-plane {
    margin: 0;
    font: inherit;
    white-space: pre;
}

.aside-settings-tab .aside-settings-hero-rabbit {
    transform-origin: bottom center;
    animation: aside-settings-hero-rabbit var(--aside-settings-hero-intro-duration) ease-in-out 1 forwards;
}

.aside-settings-tab .aside-settings-hero-thought {
    text-transform: lowercase;
    animation: aside-settings-hero-thought var(--aside-settings-hero-intro-duration) ease-in-out 1 forwards;
}

.aside-settings-tab .aside-settings-hero-signal {
    display: inline-flex;
    color: var(--aside-settings-hero-blue);
}

.aside-settings-tab .aside-settings-hero-signal-glyph {
    opacity: 0.2;
    animation: aside-settings-hero-signal calc(var(--aside-settings-hero-intro-duration) - 600ms) steps(1, end) 1 forwards;
}

.aside-settings-tab .aside-settings-hero-signal-glyph:nth-child(2) {
    animation-delay: 120ms;
}

.aside-settings-tab .aside-settings-hero-signal-glyph:nth-child(3) {
    animation-delay: 240ms;
}

.aside-settings-tab .aside-settings-hero-signal-glyph:nth-child(4) {
    animation-delay: 360ms;
}

.aside-settings-tab .aside-settings-hero-aside-box {
    animation: aside-settings-hero-aside-box var(--aside-settings-hero-intro-duration) ease-in-out 1 forwards;
}

.aside-settings-tab .aside-settings-hero-action-line {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    max-width: 100%;
    color: var(--text-muted);
    text-transform: lowercase;
    opacity: 0;
    animation: aside-settings-hero-action var(--aside-settings-hero-intro-duration) ease-in-out 1 forwards;
}

.aside-settings-tab .aside-settings-hero-action-chunk {
    white-space: pre;
}

.aside-settings-tab .aside-settings-hero-graph-stage {
    position: relative;
    width: min(232px, 100%);
    height: 164px;
    perspective: 620px;
    opacity: 0;
    clip-path: inset(100% 0 0 0);
    animation: aside-settings-hero-graph-reveal var(--aside-settings-hero-intro-duration) ease-in-out 1 forwards;
}

.aside-settings-tab .aside-settings-hero-graph-scene {
    position: absolute;
    inset: 0;
    transform: rotateX(-7deg) rotateY(-18deg);
    transform-style: preserve-3d;
    will-change: transform;
    animation-name: aside-settings-hero-graph-turn;
    animation-duration: 9s;
    animation-delay: var(--aside-settings-hero-intro-duration);
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
    animation-direction: alternate;
}

.aside-settings-tab .aside-settings-hero-graph-plane {
    position: absolute;
    top: 50%;
    left: 50%;
    color: var(--text-muted);
    transform-origin: center;
    transform-style: preserve-3d;
    backface-visibility: visible;
}

.aside-settings-tab .aside-settings-hero-graph-plane.is-plane-a {
    transform: translate(-50%, -50%) rotateX(66deg) rotateZ(45deg);
}

.aside-settings-tab .aside-settings-hero-graph-plane.is-plane-b {
    transform: translate(-50%, -50%) rotateY(66deg) rotateZ(45deg);
}

.aside-settings-tab .aside-settings-hero-graph-plane.is-plane-c {
    transform: translate(-50%, -50%) rotateX(-18deg) rotateY(-18deg) rotateZ(45deg);
}

.aside-settings-tab .aside-settings-hero-graph-node,
.aside-settings-tab .aside-settings-hero-graph-core {
    display: inline-block;
    color: var(--aside-settings-hero-blue);
    transform-origin: center;
    animation: aside-settings-hero-node var(--aside-settings-hero-intro-duration) ease-out 1 forwards;
}

.aside-settings-tab .aside-settings-hero-graph-core {
    color: var(--text-normal);
    animation-name: aside-settings-hero-core;
}

.aside-settings-tab .aside-settings-hero-edge-track {
    position: relative;
    display: inline-block;
    overflow: hidden;
    vertical-align: bottom;
}

.aside-settings-tab .aside-settings-hero-edge-track.is-track-1,
.aside-settings-tab .aside-settings-hero-edge-track.is-track-3,
.aside-settings-tab .aside-settings-hero-edge-track.is-track-5 {
    --aside-settings-hero-runner-travel: 3ch;
}

.aside-settings-tab .aside-settings-hero-edge-track.is-track-2,
.aside-settings-tab .aside-settings-hero-edge-track.is-track-4,
.aside-settings-tab .aside-settings-hero-edge-track.is-track-6 {
    --aside-settings-hero-runner-travel: 2ch;
}

.aside-settings-tab .aside-settings-hero-edge-runner {
    position: absolute;
    top: 0;
    left: 0;
    width: 1ch;
    overflow: hidden;
    color: var(--aside-settings-hero-blue);
    text-align: center;
    opacity: 0;
    transform: translateX(0);
    will-change: transform;
    animation-name: aside-settings-hero-edge-flow;
    animation-duration: var(--aside-settings-hero-runner-duration, 3.2s);
    animation-delay: calc(var(--aside-settings-hero-intro-duration) + var(--aside-settings-hero-runner-delay, 0s));
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
    animation-direction: alternate;
}

.aside-settings-tab .aside-settings-hero-edge-track.is-track-2 {
    --aside-settings-hero-runner-duration: 2.7s;
    --aside-settings-hero-runner-delay: 0.35s;
}

.aside-settings-tab .aside-settings-hero-edge-track.is-track-3 {
    --aside-settings-hero-runner-duration: 3.6s;
    --aside-settings-hero-runner-delay: 0.7s;
}

.aside-settings-tab .aside-settings-hero-edge-track.is-track-4 {
    --aside-settings-hero-runner-duration: 2.9s;
    --aside-settings-hero-runner-delay: 0.15s;
}

.aside-settings-tab .aside-settings-hero-edge-track.is-track-5 {
    --aside-settings-hero-runner-duration: 3.8s;
    --aside-settings-hero-runner-delay: 0.55s;
}

.aside-settings-tab .aside-settings-hero-edge-track.is-track-6 {
    --aside-settings-hero-runner-duration: 3.1s;
    --aside-settings-hero-runner-delay: 0.9s;
}

.aside-settings-tab .aside-settings-hero-graph-label {
    color: var(--text-muted);
    font-weight: var(--font-semibold);
    letter-spacing: 0.12em;
    text-transform: lowercase;
    opacity: 0;
    animation: aside-settings-hero-label var(--aside-settings-hero-intro-duration) ease-out 1 forwards;
}

@keyframes aside-settings-hero-rabbit {
    0%, 8% {
        transform: translate(0, 0) rotate(-1deg);
    }
    14% {
        transform: translate(2px, -3px) rotate(1deg);
    }
    20%, 100% {
        transform: translate(5px, 0) rotate(0);
    }
}

@keyframes aside-settings-hero-thought {
    0%, 16% {
        transform: translateX(0);
    }
    23% {
        transform: translateX(3px);
    }
    30%, 100% {
        transform: translateX(0);
    }
}

@keyframes aside-settings-hero-signal {
    0%, 23% {
        opacity: 0.2;
        text-shadow: none;
    }
    24%, 38% {
        opacity: 1;
        text-shadow: 0 0 8px currentColor;
    }
    39%, 100% {
        opacity: 0.45;
        text-shadow: none;
    }
}

@keyframes aside-settings-hero-aside-box {
    0%, 34% {
        color: inherit;
        filter: none;
    }
    42%, 56% {
        color: var(--aside-settings-hero-blue);
        filter: drop-shadow(0 0 4px var(--aside-settings-hero-blue));
    }
    64%, 100% {
        color: inherit;
        filter: none;
    }
}

@keyframes aside-settings-hero-action {
    0%, 43% {
        opacity: 0;
        transform: translateY(-3px);
    }
    52%, 100% {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes aside-settings-hero-graph-reveal {
    0%, 49% {
        opacity: 0;
        clip-path: inset(100% 0 0 0);
    }
    56% {
        opacity: 1;
    }
    82%, 100% {
        opacity: 1;
        clip-path: inset(0);
    }
}

@keyframes aside-settings-hero-node {
    0%, 68% {
        opacity: 0.15;
        transform: scale(0.8);
        text-shadow: none;
    }
    84% {
        opacity: 1;
        transform: scale(1.25);
        text-shadow: 0 0 8px currentColor;
    }
    100% {
        opacity: 1;
        transform: scale(1);
        text-shadow: none;
    }
}

@keyframes aside-settings-hero-core {
    0%, 50% {
        opacity: 0;
        transform: scale(0.75);
        text-shadow: none;
    }
    64%, 78% {
        opacity: 1;
        transform: scale(1.15);
        text-shadow: 0 0 10px var(--aside-settings-hero-blue);
    }
    90%, 100% {
        opacity: 1;
        transform: scale(1);
        text-shadow: none;
    }
}

@keyframes aside-settings-hero-label {
    0%, 83% {
        opacity: 0;
        transform: translateY(-3px);
    }
    94%, 100% {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes aside-settings-hero-graph-turn {
    0% {
        transform: rotateX(-7deg) rotateY(-18deg);
    }
    100% {
        transform: rotateX(8deg) rotateY(20deg);
    }
}

@keyframes aside-settings-hero-edge-flow {
    0% {
        opacity: 0.72;
        transform: translateX(0);
    }
    12%, 88% {
        opacity: 1;
    }
    100% {
        opacity: 0.72;
        transform: translateX(var(--aside-settings-hero-runner-travel));
    }
}

@container (max-width: 360px) {
    .aside-settings-tab .aside-settings-hero-art {
        gap: var(--size-4-2);
        font-size: 9px;
    }

    .aside-settings-tab .aside-settings-hero-relay-row {
        gap: 0.5ch;
    }

    .aside-settings-tab .aside-settings-hero-graph-stage {
        width: 190px;
        height: 138px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .aside-settings-tab .aside-settings-hero-rabbit,
    .aside-settings-tab .aside-settings-hero-thought,
    .aside-settings-tab .aside-settings-hero-signal-glyph,
    .aside-settings-tab .aside-settings-hero-aside-box,
    .aside-settings-tab .aside-settings-hero-action-line,
    .aside-settings-tab .aside-settings-hero-graph-stage,
    .aside-settings-tab .aside-settings-hero-graph-node,
    .aside-settings-tab .aside-settings-hero-graph-core,
    .aside-settings-tab .aside-settings-hero-graph-label,
    .aside-settings-tab .aside-settings-hero-graph-scene,
    .aside-settings-tab .aside-settings-hero-edge-runner {
        animation: none;
        text-shadow: none;
        filter: none;
    }

    .aside-settings-tab .aside-settings-hero-rabbit,
    .aside-settings-tab .aside-settings-hero-thought,
    .aside-settings-tab .aside-settings-hero-aside-box,
    .aside-settings-tab .aside-settings-hero-action-line,
    .aside-settings-tab .aside-settings-hero-graph-node,
    .aside-settings-tab .aside-settings-hero-graph-core,
    .aside-settings-tab .aside-settings-hero-graph-label {
        transform: none;
    }

    .aside-settings-tab .aside-settings-hero-action-line,
    .aside-settings-tab .aside-settings-hero-graph-stage,
    .aside-settings-tab .aside-settings-hero-graph-node,
    .aside-settings-tab .aside-settings-hero-graph-core,
    .aside-settings-tab .aside-settings-hero-graph-label {
        opacity: 1;
    }

    .aside-settings-tab .aside-settings-hero-signal-glyph {
        opacity: 0.45;
    }

    .aside-settings-tab .aside-settings-hero-graph-stage {
        clip-path: none;
    }

    .aside-settings-tab .aside-settings-hero-graph-scene {
        transform: rotateX(2deg) rotateY(-12deg);
    }

    .aside-settings-tab .aside-settings-hero-edge-runner {
        opacity: 0.8;
        transform: translateX(0);
    }
}
```

- [ ] **Step 4: Run focused verification and verify GREEN**

Run:

```bash
node --test tests/asideSettingsHeaderArt.test.mjs
npm run typecheck
npx eslint src/ui/settings/asideSettingsHeaderArt.ts src/ui/settings/AsideSetting.ts tests/asideSettingsHeaderArt.test.mjs --max-warnings 0
```

Expected: eight focused tests pass, TypeScript reports no errors, and ESLint reports no warnings or errors.

- [ ] **Step 5: Commit the continuous-motion slice**

```bash
git add styles.css tests/asideSettingsHeaderArt.test.mjs
git commit -m "style(settings): animate 3d thought trail"
```

### Task 3: Verify, Install, and Finish Tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-settings-ascii-thought-trail-header-design.md`
- Generated: `main.js`
- Verify: `manifest.json`
- Verify: `styles.css`

- [ ] **Step 1: Run the full repository gate**

Run:

```bash
npm run build
```

Expected: all tests pass, lint has zero warnings, typecheck and Obsidian compliance succeed, the production bundle stays within the size policy, and the release-artifact guard passes.

- [ ] **Step 2: Inspect the exact generated public plugin assets**

Run:

```bash
test ! -e main.js.map
if rg -n "sourceMappingURL|sourcesContent|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}" main.js manifest.json styles.css; then
    exit 1
fi
find . -maxdepth 1 -type f \( -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' \) -print
```

Expected: no `main.js.map`; no source-map marker, embedded source, private-key material, or access-key marker in `main.js`, `manifest.json`, or `styles.css`; and no secret-bearing root file printed. This is inspection only, not a release or publish.

- [ ] **Step 3: Install the verified worktree build into the development vault**

From the isolated Aside feature worktree, run:

```bash
npm run dev:install-built -- --vault ../../..
obsidian plugin:reload id=aside vault=dev
```

Expected: the installer copies only `main.js`, `manifest.json`, and `styles.css` into the development vault plugin folder, and Obsidian reports that the `aside` plugin reloaded.

- [ ] **Step 4: Perform visual and lifecycle acceptance checks**

Open **Settings → Aside** and verify:

- the header appears before the Agents heading on the current declarative settings path, with no empty setting-row chrome and no divider between its two beats;
- the Rabbit relay plays once and holds still;
- the visible copy reads `save highlight, add comment, ask @agent`;
- the impossible-junction graph assembles only after the relay;
- `thought trail` remains stationary below the graph;
- after the reveal, the three-plane graph keeps rocking in 3D without a full revolution;
- every blue runner moves with its plane, stays inside its own edge, and reverses at its endpoint;
- no Rabbit, signal, instruction, caption, or settings control continues moving;
- light and dark themes preserve sufficient contrast;
- narrow and mobile-like panes wrap the instruction without horizontal page overflow;
- reduced-motion mode immediately shows the final static composition;
- closing the settings window removes `.aside-settings-hero` from the document, and reopening recreates it and replays the entrance.

Expected: every item passes. If any item fails, keep its spec verification checkbox unchecked, add a focused failing regression where possible, fix the implementation, and rerun the focused and full gates.

- [ ] **Step 5: Record verified completion in the tracked spec**

Update `docs/superpowers/specs/2026-09-04-settings-ascii-thought-trail-header-design.md`:

- set status to `Implemented; frontend acceptance pending` if automated checks pass but any manual item remains;
- set status to `Implemented and verified` only after all automated and manual checks pass;
- mark every `To Implement` item `[x]` only after its source and focused tests pass;
- mark every `Verification` item `[x]` only after its listed automated or manual evidence exists.

- [ ] **Step 6: Commit verification tracking**

```bash
git add -f docs/superpowers/specs/2026-09-04-settings-ascii-thought-trail-header-design.md
git commit -m "docs(settings): verify 3d thought trail header"
```
