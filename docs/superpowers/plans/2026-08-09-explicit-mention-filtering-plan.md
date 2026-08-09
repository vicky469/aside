# Explicit Mention Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a nonempty explicit `@` query return only matching built-in directives so `@co` shows and selects `@codex` instead of `@todo`.

**Architecture:** Keep `commentMentionSuggestions.ts` as the single owner of provider scope and textual ranking. Apply its existing exact/prefix/substring score to nonempty explicit `@` queries, while the inline controller continues to activate result index zero without a special-case selection policy.

**Tech Stack:** TypeScript 5.9, Obsidian 1.13 APIs, Node test runner, esbuild.

---

## File Structure

### Modified files

- `src/ui/editor/commentMentionSuggestions.ts` — correct the built-in filtering gate for explicit `@` text.
- `tests/commentMentionSuggestions.test.ts` — pure provider regressions for filtered, case-insensitive explicit mention queries and preserved trigger behavior.
- `tests/sidebarDraftEditor.test.ts` — representative connected-editor regression proving the filtered result is the only active listbox option.
- `docs/superpowers/specs/2026-08-09-explicit-mention-filtering-design.md` — update implementation and verification tracking from evidence.

### Created files

- `docs/superpowers/plans/2026-08-09-explicit-mention-filtering-plan.md` — this execution plan.

## Task 1: Filter and activate explicit built-in mention matches

**Files:**

- Modify: `tests/commentMentionSuggestions.test.ts:67-106`
- Modify: `tests/sidebarDraftEditor.test.ts:33-80,668-715`
- Modify: `src/ui/editor/commentMentionSuggestions.ts:78-143`

- [x] **Step 1: Write the failing pure-provider regression**

In `tests/commentMentionSuggestions.test.ts`, add a focused test after the existing ranking test:

```ts
test("buildMentionSuggestions filters explicit built-in queries case-insensitively", () => {
    assert.deepEqual(
        buildMentionSuggestions([cleanLinksScript], "@co").map((item) => item.mention),
        ["@codex"],
    );
    assert.deepEqual(
        buildMentionSuggestions([cleanLinksScript], "@CO").map((item) => item.mention),
        ["@codex"],
    );
});
```

Update the explicit `@cl` assertion in `buildMentionSuggestions keeps todo and supported agents before live scripts` so it no longer expects all built-ins. Keep the existing bare-query, unprefixed `cl`, and `/cl` assertions intact; together they guard default order, compatibility calls, and script-only filtering.

- [x] **Step 2: Make the fake DOM retain accessibility attributes**

In `createFakeElement()` in `tests/sidebarDraftEditor.test.ts`, replace the no-op attribute methods with a local map:

```ts
attributes: new Map<string, string>(),
setAttribute: function setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
},
removeAttribute: function removeAttribute(name: string) {
    this.attributes.delete(name);
},
```

This is test infrastructure only. Do not change the production renderer or its ARIA behavior.

- [x] **Step 3: Write the failing connected-editor regression**

Add this test after `sidebar draft editor controller renders connected mention suggestions without detail`:

```ts
test("connected mention dropdown activates only the explicit @ query match", () => {
    const controller = new SidebarDraftEditorController({
        getAllIndexedComments: () => [],
        updateDraftCommentText: () => {},
        renderComments: async () => {},
        scheduleDraftFocus: () => {},
        getMentionSuggestions: (query) => buildMentionSuggestions([], query),
        openMentionSuggestModal: () => {},
        openLinkSuggestModal: () => {},
        openTagSuggestModal: () => {},
    });
    const draft = createDraft({ comment: "@co" });
    const { textarea, shell } = createSuggestionTextarea(draft.comment);

    assert.equal(controller.openDraftMentionSuggest(draft, textarea, false), true);
    const container = shell.children[0] as ReturnType<typeof createFakeElement>;
    const list = container.children[0] as ReturnType<typeof createFakeElement>;
    const rows = list.children as ReturnType<typeof createFakeElement>[];

    assert.deepEqual(rows.map((row) => row.children[0]?.text), ["@codex"]);
    assert.match(rows[0]?.className ?? "", /(?:^|\s)is-selected(?:\s|$)/u);
    assert.equal(rows[0]?.attributes.get("aria-selected"), "true");
});
```

- [x] **Step 4: Run the tests and verify RED**

Run:

```bash
npm test
```

Expected: FAIL in the new provider and connected-editor regressions and in the updated `@cl` expectation. `buildMentionSuggestions([], "@co")` still returns `@todo`, `@codex`, `@claude`, and `@gemini`; the connected dropdown therefore still activates the `@todo` row.

- [x] **Step 5: Implement the minimal provider fix**

In `buildMentionSuggestions()` in `src/ui/editor/commentMentionSuggestions.ts`, replace:

```ts
const shouldFilterBuiltInsByQuery = normalizedRawQuery !== "" && !normalizedRawQuery.startsWith("@");
```

with:

```ts
const shouldFilterBuiltInsByQuery = query.length > 0;
```

Do not change `score()`, controller selection state, fallback modal behavior, or script candidate filtering.

- [x] **Step 6: Run the tests and verify GREEN**

Run:

```bash
npm test
```

Expected: PASS with 1,093 TypeScript tests and 78 repository checks. The two added regressions pass, and all existing bare `@`, unprefixed query, `/` script, keyboard, mouse, lifecycle, and ARIA tests remain green.

- [x] **Step 7: Review the change surface**

Run:

```bash
rg -n "shouldFilterBuiltInsByQuery|buildMentionSuggestions\(|aria-selected" src tests
```

Expected: filtering remains owned by `commentMentionSuggestions.ts`; `SidebarDraftEditorController` only renders provider order; the fallback modal and `AsideView` remain thin consumers with no copied matching condition.

- [x] **Step 8: Commit the tested fix**

```bash
git add src/ui/editor/commentMentionSuggestions.ts tests/commentMentionSuggestions.test.ts tests/sidebarDraftEditor.test.ts
git commit -m "fix(editor): filter explicit mention queries"
```

## Task 2: Verify, install, smoke-test, and close tracking

**Files:**

- Modify: `docs/superpowers/specs/2026-08-09-explicit-mention-filtering-design.md`

- [x] **Step 1: Run the complete repository build**

Run:

```bash
npm run build
```

Expected: TypeScript tests, repository checks, lint, typecheck, Obsidian compliance, production bundling, and `release:artifacts:check` all pass.

- [x] **Step 2: Inspect the exact release artifacts**

Run each command separately:

```bash
node scripts/check-release-artifacts.mjs
```

```bash
find . -maxdepth 1 -type f \( -name 'main.js.map' -o -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' -o -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' \) -print
```

```bash
rg -n "sourceMappingURL|sourcesContent|/Users/|[A-Za-z]:\\\\Users\\\\|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|BEGIN CERTIFICATE" main.js manifest.json styles.css
```

Expected: the guard passes; the two searches produce no shipped source map, raw source, embedded source, local path, secret-bearing file, private key, or certificate finding. The only shipped public plugin assets remain `main.js`, `manifest.json`, and `styles.css`.

- [x] **Step 3: Install and compare the verified build**

Run:

```bash
npm run dev:install-built -- --vault /Users/wenqingli/Obsidian/lean-startup
```

Then run each comparison separately:

```bash
cmp main.js /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/main.js
```

```bash
cmp manifest.json /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json
```

```bash
cmp styles.css /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css
```

Expected: installation succeeds and all three comparisons exit zero.

- [x] **Step 4: Reload Aside and smoke-test the real dropdown**

Reload the installed plugin in `lean-startup`, open an Aside draft editor, and type `@co` at a valid token boundary.

Verify all of the following before closing the draft:

- the inline dropdown contains exactly one row, `@codex`;
- the `@codex` row has the selected highlight and `aria-selected="true"`;
- pressing Enter inserts `@codex` rather than `@todo`;
- bare `@` still displays every built-in;
- typing `/` still displays only registered vault scripts.

If reliable plugin reload or draft automation is unavailable, leave the installed-smoke checkbox open and report the limitation instead of inferring success from unit tests.

- [x] **Step 5: Update the tracked spec from evidence**

In `docs/superpowers/specs/2026-08-09-explicit-mention-filtering-design.md`, mark each implementation and verification checkbox complete only when its corresponding test, build, artifact inspection, installation comparison, or live smoke observation has passed. Add one dated evidence paragraph that distinguishes automated checks from the live Obsidian smoke test.

- [x] **Step 6: Run the final branch audit**

Run each command separately:

```bash
git diff --check main...HEAD
```

```bash
git diff --stat main...HEAD
```

```bash
git status --short --branch
```

Expected: no whitespace errors, only the planned source/test/spec/plan changes, and a clean feature branch after the tracking commit.

- [x] **Step 7: Commit verified tracking**

```bash
git add -f docs/superpowers/plans/2026-08-09-explicit-mention-filtering-plan.md docs/superpowers/specs/2026-08-09-explicit-mention-filtering-design.md
git commit -m "docs: verify explicit mention filtering"
```
