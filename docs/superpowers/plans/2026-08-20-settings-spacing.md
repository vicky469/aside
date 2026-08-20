# Aside Settings Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove padding from every Aside settings heading and make the Default agent controls compact, stacked, and left aligned.

**Architecture:** Add one scope class to the existing Aside settings-tab container, then keep all layout behavior in `styles.css`. Reuse the current Default agent markup and native radio controls; no selection, persistence, diagnostics, fallback, catalog, or routing code changes.

**Tech Stack:** TypeScript, Obsidian Plugin API, CSS, Node test runner, esbuild

---

### Task 1: Lock the Scoped Settings Layout

**Files:**
- Modify: `tests/agentRadioSettingsStyles.test.mjs`
- Modify: `src/ui/settings/AsideSetting.ts`
- Modify: `styles.css`

- [ ] **Step 1: Write the failing source-and-stylesheet regression test**

Append a test that reads the already-loaded `settingSource` and `styles` fixtures:

```js
test("Aside headings and default agent controls use scoped left-aligned spacing", () => {
    assert.match(settingSource, /this\.containerEl\.addClass\("aside-settings-tab"\)/);

    const heading = styles.match(
        /\.aside-settings-tab \.setting-item\.setting-item-heading\s*\{(?<body>[\s\S]*?)\}/,
    );
    const setting = styles.match(
        /\.aside-default-agent-setting\s*\{(?<body>[\s\S]*?)\}/,
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
    assert.match(control?.groups?.body ?? "", /flex:\s*none\s*;/);
    assert.match(control?.groups?.body ?? "", /width:\s*fit-content\s*;/);
    assert.match(control?.groups?.body ?? "", /max-width:\s*100%\s*;/);
    assert.match(group?.groups?.body ?? "", /width:\s*fit-content\s*;/);
    assert.match(group?.groups?.body ?? "", /max-width:\s*100%\s*;/);
    assert.match(option?.groups?.body ?? "", /grid-template-columns:\s*auto auto auto\s*;/);
    assert.match(option?.groups?.body ?? "", /padding:\s*var\(--size-2-1\) 0\s*;/);
});
```

This test proves the override is Aside-scoped, the heading padding is exactly zero, and the Default agent layout is stacked and compact rather than merely shifted.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/agentRadioSettingsStyles.test.mjs
```

Expected: FAIL because `AsideSetting` does not add `aside-settings-tab`, the heading rule is absent, and the current control remains a fixed 19rem horizontal layout.

- [ ] **Step 3: Attach the settings-tab scope class**

In the existing `AsideSetting` constructor, add the class immediately after assigning the plugin:

```ts
constructor(app: App, plugin: Aside) {
    super(app, plugin);
    this.plugin = plugin;
    this.containerEl.addClass("aside-settings-tab");
}
```

Do not add classes to individual headings or settings catalog entries.

- [ ] **Step 4: Implement the scoped heading and Default agent CSS**

Add the scoped heading rule and replace the existing ordinary-width layout declarations with:

```css
.aside-settings-tab .setting-item.setting-item-heading {
    padding: 0;
}

.aside-default-agent-setting {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--size-4-2);
}

.aside-default-agent-setting .setting-item-control {
    flex: none;
    width: fit-content;
    max-width: 100%;
    margin: 0;
}

.aside-default-agent-radio-group {
    display: grid;
    gap: var(--size-2-1);
    width: fit-content;
    max-width: 100%;
}

.aside-default-agent-option {
    display: grid;
    grid-template-columns: auto auto auto;
    align-items: center;
    gap: var(--size-4-2);
    min-height: var(--input-height);
    padding: var(--size-2-1) 0;
    border-radius: var(--radius-s);
    cursor: pointer;
}
```

Remove the narrow-width rules that stretch `.aside-default-agent-setting` and its `.setting-item-control`. Keep the existing narrow two-column option grid and wrapped status so small settings panes remain readable.

- [ ] **Step 5: Run focused tests, typecheck, and lint and verify GREEN**

Run:

```bash
node --test tests/agentRadioSettingsStyles.test.mjs
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeSettings.test.js .test-dist/tests/asideSettingCatalog.test.js
npx eslint src/ui/settings/AsideSetting.ts tests/agentRadioSettingsStyles.test.mjs --max-warnings 0
npm run typecheck
```

Expected: the settings layout test, behavioral settings tests, lint, and typecheck all pass.

- [ ] **Step 6: Commit the isolated layout change**

```bash
git add src/ui/settings/AsideSetting.ts styles.css tests/agentRadioSettingsStyles.test.mjs
git commit -m "style(settings): compact section layout"
```

### Task 2: Verify, Inspect, and Install

**Files:**
- Modify: `docs/superpowers/specs/2026-08-20-settings-spacing-design.md`
- Generated: `main.js`
- Verify: `manifest.json`
- Verify: `styles.css`

- [ ] **Step 1: Audit the final scope**

Run:

```bash
rg -n "aside-settings-tab|setting-item-heading|aside-default-agent-setting|aside-default-agent-radio-group|aside-default-agent-option" src styles.css tests
```

Expected: one tab scope owner in `AsideSetting`, scoped CSS, existing renderer hooks, and intentional tests; no unscoped `.setting-item-heading` rule.

- [ ] **Step 2: Run the complete repository gate**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run check:obsidian
npm run bundle
npm run release:artifacts:check
```

Expected: zero test failures, zero lint warnings, successful typecheck and Obsidian compliance, a successful production bundle, and exact allowlisted release artifacts.

- [ ] **Step 3: Inspect the exact generated assets**

Inspect `main.js`, `manifest.json`, and `styles.css`. Fail if `main.js.map` exists or if any shipped asset contains `sourceMappingURL`, `sourcesContent`, obvious private-key material, or obvious access-key markers.

- [ ] **Step 4: Install and byte-compare the verified build**

Run:

```bash
npm run dev:install-built -- --vault /Users/example/Obsidian/lean-startup
cmp -s main.js /Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/main.js
cmp -s manifest.json /Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json
cmp -s styles.css /Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css
```

Expected: the installer copies exactly three files and every comparison exits zero.

- [ ] **Step 5: Record automated verification**

Set the spec status to `Implemented; frontend acceptance pending`. Mark the implementation and automated verification items complete, but leave the normal/narrow installed-plugin visual check pending until the user accepts the layout.

- [ ] **Step 6: Commit verification tracking**

```bash
git add -f docs/superpowers/specs/2026-08-20-settings-spacing-design.md
git commit -m "docs(settings): track spacing verification"
```
