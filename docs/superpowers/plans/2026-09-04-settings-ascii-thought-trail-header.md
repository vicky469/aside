# Aside Settings ASCII Thought Trail Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an original animated ASCII/Unicode header above Aside's settings that teaches the anchored-note workflow and resolves into a brain-shaped Thought Trail graph with contained idle edge motion.

**Architecture:** A focused `asideSettingsHeaderArt` module constructs static DOM with stable class hooks; `AsideSetting` mounts it before the existing settings catalog. Aside-scoped CSS owns the one-shot entrance, delayed edge runners, responsive layout, and reduced-motion final state, with no timers, stored state, external assets, or third-party runtime code.

**Tech Stack:** TypeScript, Obsidian DOM helpers, CSS keyframes, Node test runner, esbuild

---

### Task 1: Render and Mount the Accessible Header Structure

**Files:**
- Create: `src/ui/settings/asideSettingsHeaderArt.ts`
- Create: `tests/asideSettingsHeaderArt.test.mjs`
- Modify: `src/ui/settings/AsideSetting.ts:39-43,88-99`

- [ ] **Step 1: Write the failing renderer and wiring tests**

Create `tests/asideSettingsHeaderArt.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/asideSettingsHeaderArt.test.mjs
```

Expected: FAIL with `ENOENT` for `src/ui/settings/asideSettingsHeaderArt.ts`.

- [ ] **Step 3: Add the focused header renderer**

Create `src/ui/settings/asideSettingsHeaderArt.ts`:

```ts
export const ASIDE_SETTINGS_HERO_INSTRUCTION = "Save highlight, add comment, ask @agent";
export const ASIDE_SETTINGS_HERO_GRAPH_LABEL = "Thought trail";

const ASIDE_SETTINGS_HERO_ARIA_LABEL =
    "Aside: Save a highlight, add a comment, ask an agent, and connect ideas in a thought trail.";

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
        text: "┌─────────┐\n│ Thought │\n└─────────┘",
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
        text: "┌─────────┐\n│  ASIDE  │\n└────┬────┘",
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

function renderGraph(parentEl: HTMLElement): void {
    const graphEl = parentEl.createEl("pre", { cls: "aside-settings-hero-graph" });

    graphEl.append("          ╭──");
    appendEdgeTrack(graphEl, 5, "is-track-1");
    graphEl.append("──╮\n      ╭──");
    appendNode(graphEl);
    graphEl.append("   ╭──");
    appendEdgeTrack(graphEl, 3, "is-track-2");
    graphEl.append("╮   ");
    appendNode(graphEl);
    graphEl.append("──╮\n   ╭──");
    appendNode(graphEl);
    graphEl.append("   ╰──");
    appendNode(graphEl);
    graphEl.append("    ");
    appendNode(graphEl);
    graphEl.append("──╯   ");
    appendNode(graphEl);
    graphEl.append("──╮\n   ");
    appendNode(graphEl);
    graphEl.append("     ╭──");
    appendEdgeTrack(graphEl, 3, "is-track-3");
    graphEl.append("╮  ╭──");
    appendEdgeTrack(graphEl, 3, "is-track-4");
    graphEl.append("╮     ");
    appendNode(graphEl);
    graphEl.append("\n   ╰──");
    appendNode(graphEl);
    graphEl.append("──╯     ╰──╯     ╰──");
    appendNode(graphEl);
    graphEl.append("──╯\n      ╰──");
    appendEdgeTrack(graphEl, 5, "is-track-5");
    graphEl.append("╮   │   ╭");
    appendEdgeTrack(graphEl, 5, "is-track-6");
    graphEl.append("──╯\n              ╰──");
    appendNode(graphEl, true);
    graphEl.append("──╯");

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

- [ ] **Step 4: Mount the renderer before legacy settings**

In `src/ui/settings/AsideSetting.ts`, add this import with the other settings UI imports:

```ts
import { renderAsideSettingsHeaderArt } from "./asideSettingsHeaderArt";
```

Then update `renderLegacySettings()` so the header is created immediately after the container is cleared:

```ts
private renderLegacySettings(): void {
    this.agentStatusRefreshToken += 1;
    this.unloadSetupGuideMarkdownComponent();
    this.containerEl.empty();
    renderAsideSettingsHeaderArt(this.containerEl);
    renderLegacyAsideSettings(
        this.containerEl,
        this.getCatalogContext(),
        (container) => new Setting(container),
    );
}
```

- [ ] **Step 5: Run focused verification and verify GREEN**

Run:

```bash
node --test tests/asideSettingsHeaderArt.test.mjs
npm run typecheck
npx eslint src/ui/settings/asideSettingsHeaderArt.ts src/ui/settings/AsideSetting.ts tests/asideSettingsHeaderArt.test.mjs --max-warnings 0
```

Expected: the two focused tests pass, TypeScript reports no errors, and ESLint reports no warnings or errors.

- [ ] **Step 6: Commit the renderer slice**

```bash
git add src/ui/settings/asideSettingsHeaderArt.ts src/ui/settings/AsideSetting.ts tests/asideSettingsHeaderArt.test.mjs
git commit -m "feat(settings): add ascii header structure"
```

### Task 2: Style the One-Shot Reveal and Contained Idle Motion

**Files:**
- Modify: `tests/asideSettingsHeaderArt.test.mjs`
- Modify: `styles.css:1810`

- [ ] **Step 1: Extend the focused test with failing style contracts**

Append to `tests/asideSettingsHeaderArt.test.mjs`:

```js
const stylesUrl = new URL("../styles.css", import.meta.url);

function getRule(styles, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return styles.match(new RegExp(`${escaped}\\s*\\{(?<body>[\\s\\S]*?)\\}`))
        ?.groups?.body ?? "";
}

test("settings header animations settle before contained edge motion begins", async () => {
    const styles = await readFile(stylesUrl, "utf8");
    const hero = getRule(styles, ".aside-settings-tab .aside-settings-hero");
    const actionLine = getRule(styles, ".aside-settings-tab .aside-settings-hero-action-line");
    const track = getRule(styles, ".aside-settings-tab .aside-settings-hero-edge-track");
    const runner = getRule(styles, ".aside-settings-tab .aside-settings-hero-edge-runner");

    assert.match(hero, /--aside-settings-hero-intro-duration:\s*7s\s*;/);
    assert.match(hero, /container-type:\s*inline-size\s*;/);
    assert.match(hero, /overflow:\s*hidden\s*;/);
    assert.match(actionLine, /flex-wrap:\s*wrap\s*;/);
    assert.match(actionLine, /text-transform:\s*lowercase\s*;/);
    assert.match(track, /position:\s*relative\s*;/);
    assert.match(track, /overflow:\s*hidden\s*;/);
    assert.match(runner, /position:\s*absolute\s*;/);
    assert.match(runner, /animation-delay:\s*calc\(/);
    assert.match(runner, /animation-iteration-count:\s*infinite\s*;/);
    assert.match(runner, /animation-direction:\s*alternate\s*;/);
    assert.match(
        styles,
        /\.aside-settings-tab \.aside-settings-hero-rabbit\s*\{[\s\S]*?animation:[^;]*\s1\s+forwards\s*;/,
    );
    assert.match(
        styles,
        /\.aside-settings-tab \.aside-settings-hero-graph\s*\{[\s\S]*?animation:[^;]*\s1\s+forwards\s*;/,
    );
    assert.match(styles, /@keyframes aside-settings-hero-edge-flow/);
    assert.match(
        styles,
        /@container\s*\(max-width:\s*360px\)[\s\S]*?\.aside-settings-tab \.aside-settings-hero-art[\s\S]*?font-size:\s*9px\s*;/,
    );
    assert.doesNotMatch(styles, /(?:^|\})\s*\.aside-settings-hero\s*\{/m);
});

test("settings header becomes a static final composition for reduced motion", async () => {
    const styles = await readFile(stylesUrl, "utf8");

    assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(
        styles,
        /prefers-reduced-motion:[\s\S]*?\.aside-settings-tab \.aside-settings-hero-edge-runner[\s\S]*?animation:\s*none\s*;/,
    );
    assert.match(
        styles,
        /prefers-reduced-motion:[\s\S]*?\.aside-settings-tab \.aside-settings-hero-graph[\s\S]*?clip-path:\s*none\s*;/,
    );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/asideSettingsHeaderArt.test.mjs
```

Expected: the renderer tests pass and both new stylesheet tests fail because the hero rules and keyframes do not exist.

- [ ] **Step 3: Add the complete Aside-scoped header stylesheet**

Insert the following block immediately before the existing `.aside-settings-tab .setting-item.setting-item-heading` rule in `styles.css`:

```css
.aside-settings-tab .aside-settings-hero {
    --aside-settings-hero-intro-duration: 7s;
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
.aside-settings-tab .aside-settings-hero-graph {
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
    color: var(--interactive-accent);
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

.aside-settings-tab .aside-settings-hero-graph {
    color: var(--text-muted);
    clip-path: inset(100% 0 0 0);
    animation: aside-settings-hero-graph var(--aside-settings-hero-intro-duration) ease-in-out 1 forwards;
}

.aside-settings-tab .aside-settings-hero-graph-node,
.aside-settings-tab .aside-settings-hero-graph-core {
    display: inline-block;
    color: var(--interactive-accent);
    transform-origin: center;
    animation: aside-settings-hero-node var(--aside-settings-hero-intro-duration) ease-out 1 forwards;
}

.aside-settings-tab .aside-settings-hero-graph-core {
    animation-name: aside-settings-hero-core;
}

.aside-settings-tab .aside-settings-hero-edge-track {
    position: relative;
    display: inline-block;
    overflow: hidden;
    vertical-align: bottom;
}

.aside-settings-tab .aside-settings-hero-edge-runner {
    position: absolute;
    top: 0;
    left: 0;
    width: 1ch;
    overflow: hidden;
    color: var(--interactive-accent);
    text-align: center;
    opacity: 0;
    animation-name: aside-settings-hero-edge-flow;
    animation-duration: var(--aside-settings-hero-runner-duration, 3.2s);
    animation-delay: calc(var(--aside-settings-hero-intro-duration) + var(--aside-settings-hero-runner-delay, 0s));
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
    animation-direction: alternate;
    animation-fill-mode: both;
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
        color: var(--interactive-accent);
        filter: drop-shadow(0 0 4px var(--interactive-accent));
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

@keyframes aside-settings-hero-graph {
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
        text-shadow: 0 0 10px currentColor;
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

@keyframes aside-settings-hero-edge-flow {
    0% {
        left: 0;
        opacity: 0.72;
    }
    12%, 88% {
        opacity: 1;
    }
    100% {
        left: calc(100% - 1ch);
        opacity: 0.72;
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
}

@media (prefers-reduced-motion: reduce) {
    .aside-settings-tab .aside-settings-hero-rabbit,
    .aside-settings-tab .aside-settings-hero-thought,
    .aside-settings-tab .aside-settings-hero-signal-glyph,
    .aside-settings-tab .aside-settings-hero-aside-box,
    .aside-settings-tab .aside-settings-hero-action-line,
    .aside-settings-tab .aside-settings-hero-graph,
    .aside-settings-tab .aside-settings-hero-graph-node,
    .aside-settings-tab .aside-settings-hero-graph-core,
    .aside-settings-tab .aside-settings-hero-graph-label,
    .aside-settings-tab .aside-settings-hero-edge-runner {
        animation: none;
        transform: none;
        text-shadow: none;
        filter: none;
    }

    .aside-settings-tab .aside-settings-hero-action-line,
    .aside-settings-tab .aside-settings-hero-graph,
    .aside-settings-tab .aside-settings-hero-graph-node,
    .aside-settings-tab .aside-settings-hero-graph-core,
    .aside-settings-tab .aside-settings-hero-graph-label {
        opacity: 1;
    }

    .aside-settings-tab .aside-settings-hero-graph {
        clip-path: none;
    }

    .aside-settings-tab .aside-settings-hero-edge-runner {
        left: 50%;
        opacity: 0.8;
    }
}
```

- [ ] **Step 4: Run the focused tests, typecheck, and lint and verify GREEN**

Run:

```bash
node --test tests/asideSettingsHeaderArt.test.mjs
npm run typecheck
npx eslint src/ui/settings/asideSettingsHeaderArt.ts src/ui/settings/AsideSetting.ts tests/asideSettingsHeaderArt.test.mjs --max-warnings 0
```

Expected: all focused tests pass, TypeScript reports no errors, and ESLint reports no warnings or errors.

- [ ] **Step 5: Commit the animation slice**

```bash
git add styles.css tests/asideSettingsHeaderArt.test.mjs
git commit -m "style(settings): animate thought trail header"
```

### Task 3: Verify, Install, and Update Tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-settings-ascii-thought-trail-header-design.md`
- Generated: `main.js`
- Verify: `manifest.json`
- Verify: `styles.css`

- [ ] **Step 1: Run the complete repository gate**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run check:obsidian
npm run bundle
npm run release:artifacts:check
```

Expected: zero test failures, zero lint warnings, successful typecheck and Obsidian compliance, a successful production bundle, and a passing release-artifact guard.

- [ ] **Step 2: Inspect the exact generated release assets**

Run:

```bash
test ! -e main.js.map
if rg -n "sourceMappingURL|sourcesContent|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}" main.js manifest.json styles.css; then
    exit 1
fi
find . -maxdepth 1 -type f \( -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' \) -print
```

Expected: no `main.js.map`; no source-map markers, embedded source, private-key material, or access-key markers in the shipped assets; and no secret-bearing file printed at the package root.

- [ ] **Step 3: Install the verified build into the development vault**

Run:

```bash
npm run dev:install-built -- --vault ..
obsidian plugin:reload id=aside vault=dev
```

Expected: the installer copies `main.js`, `manifest.json`, and `styles.css`, and Obsidian reports that the `aside` plugin reloaded.

- [ ] **Step 4: Perform visual acceptance checks**

Open **Settings → Aside** and verify all of the following:

- the header appears before the Agents heading;
- the rabbit relay plays once;
- the visible copy reads `save highlight, add comment, ask @agent`;
- the brain-shaped graph reveals after the action line;
- `thought trail` appears below the graph;
- after the reveal, each blue runner stays inside its own edge and reverses at the endpoint;
- the settings controls do not shift while the settled animation idles;
- light and dark themes preserve sufficient contrast;
- a narrow and mobile-like pane wraps the instructional chunks without horizontal page overflow;
- reduced-motion mode immediately shows the final composition with stationary runners.

Expected: every item passes. If an item fails, keep the corresponding spec verification checkbox unchecked, fix the implementation, and rerun the focused and full gates.

- [ ] **Step 5: Record verified completion in the tracked spec**

In `docs/superpowers/specs/2026-09-04-settings-ascii-thought-trail-header-design.md`:

- change the status to `Implemented; frontend acceptance pending` if automated checks pass but any manual visual check remains;
- change the status to `Implemented and verified` only if all automated and manual checks pass;
- mark each `To Implement` item `[x]` only after the corresponding source and focused tests pass;
- mark each `Verification` item `[x]` only after its listed automated or manual evidence exists.

- [ ] **Step 6: Commit verification tracking**

```bash
git add -f docs/superpowers/specs/2026-09-04-settings-ascii-thought-trail-header-design.md
git commit -m "docs(settings): track ascii header verification"
```
