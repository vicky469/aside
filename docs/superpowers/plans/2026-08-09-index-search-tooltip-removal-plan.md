# Index Search Tooltip Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Aside Index search field and its placeholder while removing the redundant black hover tooltip produced by its explicit `aria-label`.

**Architecture:** Preserve the shared search renderer and all index search state. Add a source-contract regression around the index-specific options adapter, then remove only the adapter's `ariaLabel` property so the note and index search surfaces follow the same tooltip behavior.

**Tech Stack:** TypeScript, Obsidian plugin UI, Node.js built-in test runner, ESLint, esbuild

---

### Task 1: Remove the Index-Only Hover Label Test-First

**Files:**
- Modify: `tests/sidebarToolbarComposition.test.mjs`
- Modify: `src/ui/views/AsideView.ts:3754-3759`

- [ ] **Step 1: Write the failing source-contract test**

Append this test to `tests/sidebarToolbarComposition.test.mjs`:

```javascript
test("index search keeps its placeholder without a tooltip-producing label", () => {
    const methodSource = asideViewSource.match(
        /private getIndexSearchInputOptions\(\): SidebarSearchInputOptions \{[\s\S]*?\n {4}private renderPrimarySidebarModeControl\(/,
    )?.[0];

    assert.ok(methodSource, "missing index search options method");
    assert.match(methodSource, /placeholder:\s*"Search side notes in index"/);
    assert.doesNotMatch(methodSource, /ariaLabel:\s*"Search index side notes"/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/sidebarToolbarComposition.test.mjs
```

Expected: FAIL in `index search keeps its placeholder without a tooltip-producing label` because the current method still contains `ariaLabel: "Search index side notes"`.

- [ ] **Step 3: Remove only the tooltip-producing option**

Change `getIndexSearchInputOptions()` in `src/ui/views/AsideView.ts` from:

```typescript
return {
    value: this.indexSidebarSearchInputValue,
    placeholder: "Search side notes in index",
    ariaLabel: "Search index side notes",
```

to:

```typescript
return {
    value: this.indexSidebarSearchInputValue,
    placeholder: "Search side notes in index",
```

Do not change `renderSidebarSearchInput()`, search state, event handlers, CSS, or note-sidebar options.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test tests/sidebarToolbarComposition.test.mjs
```

Expected: all tests in the file PASS.

- [ ] **Step 5: Audit the changed copy surface**

Run:

```bash
rg -n 'Search index side notes|Search side notes in index' src tests
```

Expected: `Search index side notes` appears only in the negative regression assertion; `Search side notes in index` remains in the production options and positive regression assertion.

- [ ] **Step 6: Commit the tested behavior change**

```bash
git add src/ui/views/AsideView.ts tests/sidebarToolbarComposition.test.mjs
git commit -m "fix: remove index search hover label"
```

### Task 2: Verify the Plugin and Exact Shipped Artifacts

**Files:**
- Verify: `tests/indexSidebarState.test.ts`
- Verify: `tests/sidebarToolbarComposition.test.mjs`
- Verify: `tests/sidebarToolbarLayout.test.mjs`
- Verify: `tests/toolbarDisabledStyles.test.mjs`
- Verify: `main.js`
- Verify: `manifest.json`
- Verify: `styles.css`

- [ ] **Step 1: Run the related index and toolbar regression tests**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/indexSidebarState.test.js tests/sidebarToolbarComposition.test.mjs tests/sidebarToolbarLayout.test.mjs tests/toolbarDisabledStyles.test.mjs
```

Expected: all selected tests PASS with zero failures.

- [ ] **Step 2: Run the full build**

Run:

```bash
npm run build
```

Expected: full tests, lint, typecheck, Obsidian compliance, production bundle, and `Release artifact inspection passed for main.js, manifest.json, styles.css` all succeed.

- [ ] **Step 3: Inspect the exact public artifact set for source exposure**

Run each command separately:

```bash
test ! -e main.js.map
rg -n "sourceMappingURL|sourcesContent|/Users/|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}" main.js manifest.json styles.css
shasum -a 256 main.js manifest.json styles.css
```

Expected: no `main.js.map`; `rg` exits with no matches; hashes are printed for the three allowlisted public assets. The release guard must also confirm no raw TypeScript/JSX-family files, `.env*`, `.npmrc`, keys, or certificates are included in the shipped set.

### Task 3: Install and Live-Smoke-Test the Verified Build

**Files:**
- Install: `main.js`
- Install: `manifest.json`
- Install: `styles.css`
- Modify after verification: `docs/superpowers/specs/2026-08-09-index-search-tooltip-removal-design.md`

- [ ] **Step 1: Install the verified three-file build into the target vault**

Run:

```bash
node scripts/install-built-plugin.mjs --vault /Users/wenqingli/Obsidian/lean-startup
```

Expected: the installer reports copying only `main.js`, `manifest.json`, and `styles.css` into `/Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside`.

- [ ] **Step 2: Verify installed hashes match the built files**

Run:

```bash
shasum -a 256 main.js manifest.json styles.css /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/main.js /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css
```

Expected: each installed file has the same hash as its repository counterpart.

- [ ] **Step 3: Reload Aside in the correct vault**

Run:

```bash
obsidian vault=lean-startup plugin:reload id=aside
```

Expected: command exits successfully.

- [ ] **Step 4: Confirm the live Index search retains its placeholder without the tooltip label**

Open the generated index note:

```bash
obsidian vault=lean-startup open path="🐰 Aside Index.md"
```

Inspect the active index search input:

```bash
obsidian vault=lean-startup eval code='(() => { const input = document.querySelector(".workspace-leaf-content[data-type=aside-view] .is-index-secondary-row .aside-note-search-input"); return input ? { placeholder: input.getAttribute("placeholder"), ariaLabel: input.getAttribute("aria-label"), type: input.getAttribute("type") } : null; })()'
```

The returned object must show:

```javascript
{
    placeholder: "Search side notes in index",
    ariaLabel: null,
    type: "search"
}
```

Exercise and clear the transient query:

```bash
obsidian vault=lean-startup eval code='(async () => { const input = document.querySelector(".workspace-leaf-content[data-type=aside-view] .is-index-secondary-row .aside-note-search-input"); if (!input) return null; input.value = "tooltip-smoke-no-match"; input.dispatchEvent(new Event("input", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 350)); const filtered = { value: input.value, emptyState: document.querySelector(".workspace-leaf-content[data-type=aside-view] .aside-empty-state")?.textContent?.trim() ?? null }; input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 350)); return { filtered, clearedValue: input.value }; })()'
```

Expected: `filtered.value` is `tooltip-smoke-no-match`, the index reports no matching side notes, and `clearedValue` is empty. The search state is transient; no note or comment write action is invoked.

- [ ] **Step 5: Update the tracked spec only after verification passes**

In `docs/superpowers/specs/2026-08-09-index-search-tooltip-removal-design.md`, change every applicable unchecked implementation and verification checkbox to `[x]`. Leave nothing checked without evidence from the preceding steps.

- [ ] **Step 6: Run final diff and repository checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the verified spec-tracking update is uncommitted.

- [ ] **Step 7: Commit completed tracking**

```bash
git add -f docs/superpowers/specs/2026-08-09-index-search-tooltip-removal-design.md
git commit -m "docs: record index search tooltip verification"
```

- [ ] **Step 8: Confirm final repository state**

Run:

```bash
git status --short
git log -3 --oneline
```

Expected: clean worktree with the behavior commit and verification-tracking commit above the design and plan commits.
