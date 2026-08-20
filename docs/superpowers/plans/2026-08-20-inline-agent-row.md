# Inline Default Agent Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the installed vertical Default agent choices with the approved compact layout: inline setting copy above one horizontal, wrapping row of native agent radios.

**Architecture:** Keep the existing settings renderer, native radio markup, diagnostics, persistence, fallback, and fixed agent order unchanged. Refine only the existing scoped CSS selectors, with one source-and-stylesheet regression test locking the two-line left-aligned layout and whole-option wrapping.

**Tech Stack:** CSS, Obsidian settings DOM, Node test runner, TypeScript, ESLint, esbuild

---

### Task 1: Implement the Horizontal Agent Row With TDD

**Files:**
- Modify: `tests/agentRadioSettingsStyles.test.mjs`
- Modify: `styles.css`

- [ ] **Step 1: Rewrite the focused layout assertions to describe Option A**

In `tests/agentRadioSettingsStyles.test.mjs`, replace the first and third tests with these assertions. Keep the existing `default agent settings render a labeled native radio group` test unchanged.

```js
test("agent settings radio choices form a horizontal wrapping row", () => {
    const group = styles.match(
        /\.aside-default-agent-radio-group\s*\{(?<body>[\s\S]*?)\}/,
    );
    const option = styles.match(
        /\.aside-default-agent-option\s*\{(?<body>[\s\S]*?)\}/,
    );
    const radio = styles.match(
        /\.aside-default-agent-option input\[type="radio"\]\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.match(group?.groups?.body ?? "", /display:\s*flex\s*;/);
    assert.match(group?.groups?.body ?? "", /align-items:\s*center\s*;/);
    assert.match(group?.groups?.body ?? "", /flex-wrap:\s*wrap\s*;/);
    assert.match(group?.groups?.body ?? "", /row-gap:\s*var\(--size-2-1\)\s*;/);
    assert.match(
        group?.groups?.body ?? "",
        /column-gap:\s*calc\(var\(--size-4-2\) \* 2\)\s*;/,
    );
    assert.match(option?.groups?.body ?? "", /display:\s*grid\s*;/);
    assert.match(option?.groups?.body ?? "", /grid-template-columns:\s*auto auto auto\s*;/);
    assert.match(option?.groups?.body ?? "", /flex:\s*0 0 auto\s*;/);
    assert.match(option?.groups?.body ?? "", /white-space:\s*nowrap\s*;/);
    assert.match(radio?.groups?.body ?? "", /margin:\s*0\s*;/);
    assert.match(styles, /\.aside-default-agent-option\.is-disabled/);
    assert.match(styles, /var\(--text-muted\)/);
    assert.doesNotMatch(
        styles,
        /\.aside-default-agent-option-status\s*\{[^}]*grid-column:\s*2\s*;/,
    );
});

test("Aside headings and default agent controls use scoped left-aligned spacing", () => {
    assert.match(settingSource, /this\.containerEl\.addClass\("aside-settings-tab"\)/);

    const heading = styles.match(
        /\.aside-settings-tab \.setting-item\.setting-item-heading\s*\{(?<body>[\s\S]*?)\}/,
    );
    const setting = styles.match(
        /\.aside-default-agent-setting\s*\{(?<body>[\s\S]*?)\}/,
    );
    const info = styles.match(
        /\.aside-default-agent-setting \.setting-item-info\s*\{(?<body>[\s\S]*?)\}/,
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
    assert.match(info?.groups?.body ?? "", /display:\s*flex\s*;/);
    assert.match(info?.groups?.body ?? "", /align-items:\s*baseline\s*;/);
    assert.match(info?.groups?.body ?? "", /flex-wrap:\s*wrap\s*;/);
    assert.match(info?.groups?.body ?? "", /max-width:\s*100%\s*;/);
    assert.match(control?.groups?.body ?? "", /flex:\s*none\s*;/);
    assert.match(control?.groups?.body ?? "", /width:\s*fit-content\s*;/);
    assert.match(control?.groups?.body ?? "", /max-width:\s*100%\s*;/);
    assert.match(group?.groups?.body ?? "", /width:\s*fit-content\s*;/);
    assert.match(group?.groups?.body ?? "", /max-width:\s*100%\s*;/);
    assert.match(option?.groups?.body ?? "", /grid-template-columns:\s*auto auto auto\s*;/);
    assert.match(option?.groups?.body ?? "", /padding:\s*var\(--size-2-1\) 0\s*;/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/agentRadioSettingsStyles.test.mjs
```

Expected: FAIL because the group still declares `display: grid`, the setting has no inline `.setting-item-info` rule, and the narrow status-under-name rule still exists.

- [ ] **Step 3: Apply the minimal CSS revision**

In `styles.css`, keep the scoped zero-padding heading rule and the outer `.aside-default-agent-setting` rule. Insert the information rules after the outer setting rule:

```css
.aside-default-agent-setting .setting-item-info {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--size-2-1) var(--size-4-2);
    max-width: 100%;
}

.aside-default-agent-setting .setting-item-description {
    min-width: 0;
}
```

Replace the radio-group and option rules with:

```css
.aside-default-agent-radio-group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    row-gap: var(--size-2-1);
    column-gap: calc(var(--size-4-2) * 2);
    width: fit-content;
    max-width: 100%;
}

.aside-default-agent-option {
    display: grid;
    grid-template-columns: auto auto auto;
    align-items: center;
    flex: 0 0 auto;
    gap: var(--size-4-2);
    min-height: var(--input-height);
    padding: var(--size-2-1) 0;
    border-radius: var(--radius-s);
    cursor: pointer;
    white-space: nowrap;
}
```

Delete the complete `@media (max-width: 600px)` block that changes agent options to two columns and puts status in grid column 2. The flex group now handles narrow panes by moving complete options to the next line.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test tests/agentRadioSettingsStyles.test.mjs
```

Expected: all three tests pass.

- [ ] **Step 5: Run the settings compilation and behavior checks**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeSettings.test.js .test-dist/tests/asideSettingCatalog.test.js
npx eslint tests/agentRadioSettingsStyles.test.mjs --max-warnings 0
```

Expected: compilation succeeds; agent order, availability, disabled selection, persistence, fallback, and catalog tests pass; ESLint reports zero warnings.

- [ ] **Step 6: Commit the isolated layout revision**

```bash
git add styles.css tests/agentRadioSettingsStyles.test.mjs
git commit -m "style(settings): inline agent choices"
```

### Task 2: Verify, Install, and Track Acceptance

**Files:**
- Modify: `docs/superpowers/specs/2026-08-20-settings-spacing-design.md`
- Generated: `main.js`
- Verify: `manifest.json`
- Verify: `styles.css`

- [ ] **Step 1: Audit the final ownership surface**

Run:

```bash
rg -n "aside-settings-tab|setting-item-heading|aside-default-agent-setting|aside-default-agent-radio-group|aside-default-agent-option" src styles.css tests
```

Expected: one settings-tab scope owner, the existing renderer hooks, one scoped heading rule, one CSS owner for the inline information and horizontal radio layout, and focused regression assertions. No unscoped `.setting-item-heading` rule appears.

- [ ] **Step 2: Run the complete repository gate**

Run:

```bash
npm run build
```

Expected: zero test failures, zero lint warnings, successful typecheck and Obsidian compliance, a successful production bundle, and a passing release-artifact guard.

- [ ] **Step 3: Inspect the exact generated release assets**

Run:

```bash
test ! -e main.js.map
rg -n "sourceMappingURL|sourcesContent|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}" main.js manifest.json styles.css
node scripts/check-release-artifacts.mjs
```

Expected: `main.js.map` is absent; the search exits 1 with no matches; the artifact guard confirms that only the intended `main.js`, `manifest.json`, and `styles.css` assets ship without embedded sources, source maps, raw TypeScript/JSX-family files, or obvious secret-bearing files.

- [ ] **Step 4: Install and byte-compare the verified build**

Run:

```bash
npm run dev:install-built -- --vault /Users/example/Obsidian/lean-startup
cmp -s main.js /Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/main.js
cmp -s manifest.json /Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json
cmp -s styles.css /Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css
```

Expected: the installer copies exactly three assets and every comparison exits zero.

- [ ] **Step 5: Record implementation and automated verification**

In `docs/superpowers/specs/2026-08-20-settings-spacing-design.md`:

- set status to `Implemented; frontend acceptance pending`;
- mark all four `To Implement` items complete;
- mark the focused regression, unchanged behavior, and full automated verification items complete;
- leave the installed normal/narrow visual check pending until the user accepts the frontend result.

- [ ] **Step 6: Commit verification tracking**

```bash
git add -f docs/superpowers/specs/2026-08-20-settings-spacing-design.md
git commit -m "docs(settings): track inline row verification"
```

## Completion Criteria

- The Agents heading retains the accepted zero-padding treatment scoped to Aside.
- Default agent name and normal description share one wrapping information line above the controls.
- Codex, Claude Code, and Gemini appear in fixed order in one horizontal row at normal width.
- Each complete radio, name, and textual status moves together when the row wraps.
- Unavailable agents remain visible and disabled; saved unavailable choices, fallback routing, persistence, and `/create-script` behavior remain unchanged.
- The focused test, full repository gate, exact release-asset inspection, installation, and byte comparison pass.
- Frontend acceptance remains open until the user tests the installed normal and narrow layouts.
