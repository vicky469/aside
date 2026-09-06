# Ghosty Bunny Float Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the settings rabbit's restrained idle drift with the approved seamless, weightless float after its reveal.

**Architecture:** Keep the existing HTML and lifecycle intact. Express the entire behavior as a second CSS animation whose delay matches the five-second intro, and protect its exact timing and transforms with the existing source-level settings-header test.

**Tech Stack:** CSS keyframes, Node.js built-in test runner, Obsidian plugin build tooling

---

### Task 1: Lock the float contract with a failing test

**Files:**
- Modify: `tests/asideSettingsHeaderArt.test.mjs`
- Test: `tests/asideSettingsHeaderArt.test.mjs`

- [ ] **Step 1: Replace the old idle-animation assertions**

In `settings header stages a soft cascade before continuous ambient motion`, require the approved animation name, timing, and delayed start:

```js
assert.match(
    rabbit,
    /aside-settings-hero-rabbit-float\s+3\.2s\s+ease-in-out\s+var\(--aside-settings-hero-intro-duration\)\s+infinite/,
);
```

Replace the old idle-keyframe assertion with a seamless float contract:

```js
assert.match(
    styles,
    /@keyframes aside-settings-hero-rabbit-float\s*\{\s*0%, 100% \{ transform: translate\(5px, 0\) rotate\(0\); \}\s*50% \{ transform: translate\(5px, -5px\) rotate\(0\.5deg\); \}\s*\}/,
);
assert.doesNotMatch(styles, /aside-settings-hero-rabbit-idle/);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --test tests/asideSettingsHeaderArt.test.mjs
```

Expected: FAIL because `styles.css` still declares `aside-settings-hero-rabbit-idle 3.8s` and its one-pixel keyframes.

- [ ] **Step 3: Commit the test contract after GREEN in Task 2**

Keep the test and implementation in one behavior commit so the branch never records a permanently failing test.

### Task 2: Implement the CSS-only float

**Files:**
- Modify: `styles.css`
- Test: `tests/asideSettingsHeaderArt.test.mjs`

- [ ] **Step 1: Replace the ambient animation declaration**

Keep the one-shot reveal as the first animation and replace only the second animation:

```css
animation:
    aside-settings-hero-rabbit var(--aside-settings-hero-intro-duration) ease-in-out 1 forwards,
    aside-settings-hero-rabbit-float 3.2s ease-in-out var(--aside-settings-hero-intro-duration) infinite;
```

- [ ] **Step 2: Replace the idle keyframes**

Use matching endpoints and a single five-pixel apex:

```css
@keyframes aside-settings-hero-rabbit-float {
    0%, 100% { transform: translate(5px, 0) rotate(0); }
    50% { transform: translate(5px, -5px) rotate(0.5deg); }
}
```

- [ ] **Step 3: Run the focused test and confirm GREEN**

Run:

```bash
node --test tests/asideSettingsHeaderArt.test.mjs
```

Expected: all 13 settings-header tests pass.

- [ ] **Step 4: Commit the tested behavior**

```bash
git add styles.css tests/asideSettingsHeaderArt.test.mjs
git commit -m "feat(settings): float header bunny"
```

### Task 3: Verify and close tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-09-06-ghosty-bunny-float-design.md`

- [ ] **Step 1: Run complete repository verification**

Run:

```bash
npm run build
```

Expected: compiled tests, direct tests, lint, typecheck, Obsidian compliance, and bundle-size checks all pass.

- [ ] **Step 2: Inspect the change surface**

Run:

```bash
git diff 407992e...HEAD --check
git diff 407992e...HEAD -- styles.css tests/asideSettingsHeaderArt.test.mjs docs/superpowers/specs/2026-09-06-ghosty-bunny-float-design.md docs/superpowers/plans/2026-09-06-ghosty-bunny-float.md
git status --short
```

Expected: only the approved CSS, test, spec, and plan changes; no whitespace errors or generated artifacts.

- [ ] **Step 3: Mark the tracked spec complete**

Change each applicable unchecked item in `## Implementation Tracking` to `[x]` only after the preceding commands pass.

- [ ] **Step 4: Commit the verification record**

```bash
git add -f docs/superpowers/specs/2026-09-06-ghosty-bunny-float-design.md docs/superpowers/plans/2026-09-06-ghosty-bunny-float.md
git commit -m "docs: complete bunny float tracking"
```
