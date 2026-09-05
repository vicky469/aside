# Settings Header Soft-Cascade Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Settings header visibly assemble as a smooth Rabbit-first cascade every time Settings opens.

**Architecture:** Keep the current header renderer and DOM unchanged. Adjust only Aside-scoped CSS keyframes and their focused source-contract tests: every conceptual element starts hidden, finite entrance animations reveal them in order, and existing ambient animations begin after assembly without JavaScript state or timers.

**Tech Stack:** CSS keyframes, TypeScript-rendered Obsidian DOM, Node test runner, ESLint, TypeScript, esbuild

---

## File Structure

- Modify `styles.css`: own the five-second soft-cascade entrance, delayed ambient handoff, and reduced-motion final state.
- Modify `tests/asideSettingsHeaderArt.test.mjs`: prove initial visibility, reveal order, finite versus infinite animation ownership, and reduced-motion behavior.
- Modify `docs/superpowers/specs/2026-09-05-settings-header-soft-cascade-design.md`: record verified completion and measured repository checks.

No renderer, settings, persisted data, dependency, asset, or other runtime file changes.

### Task 1: Stage the Existing Header With a CSS-Only Soft Cascade

**Files:**
- Modify: `tests/asideSettingsHeaderArt.test.mjs`
- Modify: `styles.css:1823-2227`

- [ ] **Step 1: Rewrite the focused motion contract around the approved sequence**

Replace the test named `settings header splits one-shot reveal motion from continuous ambient motion` with:

```js
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

    assert.match(styles, /@keyframes aside-settings-hero-rabbit\s*\{\s*0%, 2% \{ opacity: 0;[^}]*\}\s*8% \{ opacity: 1;/);
    assert.match(styles, /@keyframes aside-settings-hero-thought\s*\{\s*0%, 9% \{ opacity: 0;[^}]*\}\s*17%, 100% \{ opacity: 1;/);
    assert.match(styles, /@keyframes aside-settings-hero-signal\s*\{\s*0%, 15% \{ opacity: 0;[^}]*\}\s*23%, 34% \{ opacity: 1;/);
    assert.match(styles, /@keyframes aside-settings-hero-aside-box\s*\{\s*0%, 21% \{ opacity: 0;[^}]*\}\s*30%, 42% \{\s*opacity: 1;/);
    assert.match(styles, /@keyframes aside-settings-hero-action\s*\{\s*0%, 28% \{ opacity: 0;[^}]*\}\s*37%, 100% \{ opacity: 1;/);
    assert.match(styles, /@keyframes aside-settings-hero-graph-reveal\s*\{\s*0%, 35% \{ opacity: 0;[^}]*\}\s*45% \{ opacity: 1; \}\s*64%, 100% \{ opacity: 1;/);
    assert.match(styles, /@keyframes aside-settings-hero-node\s*\{\s*0%, 47% \{ opacity: 0;/);

    assert.match(scene, /transform-style:\s*preserve-3d\s*;/);
    assert.match(scene, /animation-delay:\s*var\(--aside-settings-hero-motion-delay\)\s*;/);
    assert.match(scene, /animation-iteration-count:\s*infinite\s*;/);
    assert.match(scene, /animation-direction:\s*alternate\s*;/);
    assert.match(track, /position:\s*relative\s*;/);
    assert.match(track, /overflow:\s*hidden\s*;/);
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
});
```

In `settings header shows a static completed composition for reduced motion`, replace `visibleSelectors` with:

```js
const visibleSelectors = [
    ".aside-settings-tab .aside-settings-hero-rabbit",
    ".aside-settings-tab .aside-settings-hero-thought",
    ".aside-settings-tab .aside-settings-hero-aside-box",
    ".aside-settings-tab .aside-settings-hero-action-line",
    ".aside-settings-tab .aside-settings-hero-graph-stage",
    ".aside-settings-tab .aside-settings-hero-graph-node",
];
```

Keep the existing separate assertion that reduced-motion signal glyphs settle at `opacity: 0.45`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/asideSettingsHeaderArt.test.mjs
```

Expected: FAIL because the stylesheet still uses a seven-second introduction, exposes Rabbit/Thought/Aside on the first frame, and begins Rabbit idle motion at 1.4 seconds.

- [ ] **Step 3: Add hidden first frames and move the ambient handoff**

In `.aside-settings-tab .aside-settings-hero`, change the timing variables to:

```css
--aside-settings-hero-intro-duration: 5s;
--aside-settings-hero-motion-delay: 3.35s;
```

Add `opacity: 0;` to each of these existing rules without changing their layout declarations:

```css
.aside-settings-tab .aside-settings-hero-rabbit { opacity: 0; }
.aside-settings-tab .aside-settings-hero-thought { opacity: 0; }
.aside-settings-tab .aside-settings-hero-aside-box { opacity: 0; }
```

Change the existing signal-glyph declaration from `opacity: 0.2` to:

```css
opacity: 0;
```

Keep the action line and graph stage's existing `opacity: 0` declarations. Change the Rabbit animation list to delay idle motion until the ambient handoff:

```css
animation:
    aside-settings-hero-rabbit var(--aside-settings-hero-intro-duration) ease-in-out 1 forwards,
    aside-settings-hero-rabbit-idle 3.8s ease-in-out var(--aside-settings-hero-motion-delay) infinite alternate;
```

- [ ] **Step 4: Replace the finite entrance keyframes with the selected soft cascade**

Replace the seven finite entrance keyframes with:

```css
@keyframes aside-settings-hero-rabbit {
    0%, 2% { opacity: 0; transform: translate(0, 4px) rotate(-1deg); }
    8% { opacity: 1; transform: translate(2px, -3px) rotate(1deg); }
    14%, 100% { opacity: 1; transform: translate(5px, 0) rotate(0); }
}

@keyframes aside-settings-hero-thought {
    0%, 9% { opacity: 0; transform: translateX(-4px); }
    17%, 100% { opacity: 1; transform: translateX(0); }
}

@keyframes aside-settings-hero-signal {
    0%, 15% { opacity: 0; text-shadow: none; }
    23%, 34% { opacity: 1; text-shadow: 0 0 8px currentColor; }
    35%, 100% { opacity: 0.45; text-shadow: none; }
}

@keyframes aside-settings-hero-aside-box {
    0%, 21% { opacity: 0; transform: scale(0.96); color: inherit; filter: none; }
    30%, 42% {
        opacity: 1;
        transform: scale(1);
        color: var(--aside-settings-hero-blue);
        filter: drop-shadow(0 0 4px var(--aside-settings-hero-blue));
    }
    50%, 100% { opacity: 1; transform: scale(1); color: inherit; filter: none; }
}

@keyframes aside-settings-hero-action {
    0%, 28% { opacity: 0; transform: translateY(-3px); }
    37%, 100% { opacity: 1; transform: translateY(0); }
}

@keyframes aside-settings-hero-graph-reveal {
    0%, 35% { opacity: 0; clip-path: inset(100% 0 0 0); }
    45% { opacity: 1; }
    64%, 100% { opacity: 1; clip-path: inset(0); }
}

@keyframes aside-settings-hero-node {
    0%, 47% { opacity: 0; transform: scale(0.8); text-shadow: none; }
    58% { opacity: 1; transform: scale(1.25); text-shadow: 0 0 8px currentColor; }
    64%, 100% { opacity: 1; transform: scale(1); text-shadow: none; }
}
```

Do not change `aside-settings-hero-rabbit-idle`, `aside-settings-hero-graph-turn`, or `aside-settings-hero-edge-flow` keyframe bodies.

- [ ] **Step 5: Expose every finite element in the reduced-motion final state**

Expand the existing reduced-motion opacity override to:

```css
.aside-settings-tab .aside-settings-hero-rabbit,
.aside-settings-tab .aside-settings-hero-thought,
.aside-settings-tab .aside-settings-hero-aside-box,
.aside-settings-tab .aside-settings-hero-action-line,
.aside-settings-tab .aside-settings-hero-graph-stage,
.aside-settings-tab .aside-settings-hero-graph-node { opacity: 1; }
```

Retain `opacity: 0.45` for `.aside-settings-hero-signal-glyph`, `clip-path: none` for the graph stage, and all existing reduced-motion transform, filter, shadow, and `will-change` resets.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
node --test tests/asideSettingsHeaderArt.test.mjs
```

Expected: PASS with all Settings-header structure, lifecycle, motion, responsive, and reduced-motion tests successful.

- [ ] **Step 7: Inspect the focused diff and commit**

Run:

```bash
git diff --check
git diff -- styles.css tests/asideSettingsHeaderArt.test.mjs
git add styles.css tests/asideSettingsHeaderArt.test.mjs
git commit -m "style(settings): stage header reveal"
```

Expected: the diff contains only the timing, visibility, keyframe, reduced-motion, and focused-test changes described above.

### Task 2: Verify the Animation and Record Completion

**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-settings-header-soft-cascade-design.md`

- [ ] **Step 1: Verify first-frame layout stability from the implementation diff**

Run:

```bash
git diff HEAD^..HEAD -- styles.css src/ui/settings/asideSettingsHeaderArt.ts
```

Expected: only `styles.css` changed; the renderer, grid, dimensions, copy, graph geometry, and DOM order are unchanged. Hidden elements use opacity and transforms while retaining their final layout cells.

- [ ] **Step 2: Run the complete repository pipeline**

Run:

```bash
npm run build
```

Expected: all compiled and direct tests pass, followed by lint, typecheck, Obsidian compliance, production bundle, bundle-size guard, and release-artifact inspection.

- [ ] **Step 3: Inspect the exact public release artifact set**

Run:

```bash
npm run release:artifacts:check
```

Expected: PASS for exactly `main.js`, `manifest.json`, and `styles.css`, with no source map, embedded source content, local path, or obvious secret material reported.

- [ ] **Step 4: Record measured verification in the tracked spec**

In `docs/superpowers/specs/2026-09-05-settings-header-soft-cascade-design.md`:

- change `**Status:** Approved design; pending implementation plan` to `**Status:** Implemented and verified`;
- mark every item under `### To Implement` and `### Verification` as `[x]`; and
- add a concise evidence paragraph containing the measured test counts, bundle bytes, focused animation result, and exact three-file artifact inspection result.

Do not add local absolute paths, vault names, usernames, tokens, screenshots containing private note content, or any other private information.

- [ ] **Step 5: Re-run documentation compliance and inspect the final diff**

Run:

```bash
node --test tests/checkObsidianCompliance.test.mjs
git diff --check
git status --short
```

Expected: documentation compliance passes; only the tracked spec remains uncommitted after Task 1.

- [ ] **Step 6: Commit verification tracking**

Run:

```bash
git add -f docs/superpowers/specs/2026-09-05-settings-header-soft-cascade-design.md
git commit -m "docs(settings): record cascade verification"
```

- [ ] **Step 7: Review the whole branch**

Review the diff from the branch point through `HEAD` against the approved spec. Confirm there are no Critical or Important findings, no out-of-scope renderer changes, no private information, and no regression to reduced-motion behavior before integrating the branch.
