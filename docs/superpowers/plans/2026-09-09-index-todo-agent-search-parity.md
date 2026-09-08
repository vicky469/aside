# Index Todo and Agent Search Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the existing Index side-note search for global Todo cards and selected-file Agent cards while preserving current mode scopes and bounded rendering.

**Architecture:** `indexSidebarState.ts` owns generic-search availability, scope normalization, and placeholder policy. The shared toolbar consumes that policy, while `AsideView` remains a thin lifecycle adapter over the existing input, debounce, ranking, reconciliation, highlighting, and focus-restoration path. `indexSidebarGlobalSearch.ts` bounds active global Todo queries to the existing 100-card window.

**Tech Stack:** TypeScript, Obsidian DOM APIs, Node test runner, existing Aside sidebar toolbar and search modules.

---

### Task 1: Share the Index card-search policy and lifecycle

**Files:**
- Modify: `tests/indexSidebarState.test.ts`
- Modify: `tests/sidebarToolbarActionState.test.ts`
- Modify: `tests/sidebarToolbarComposition.test.mjs`
- Modify: `src/ui/views/indexSidebarState.ts`
- Modify: `src/ui/views/sidebarToolbarState.ts`
- Modify: `src/ui/views/AsideView.ts`

- [ ] **Step 1: Write failing policy tests**

In `tests/indexSidebarState.test.ts`, replace the List-only visibility, mode-transition, and file-scope tests with:

```ts
test("index generic search is available in List Todo and Agent", () => {
    for (const mode of ["list", "todo", "agent"] as const) {
        assert.equal(shouldShowIndexSidebarSearch(mode), true);
    }
    for (const mode of ["tags", "thought-trail"] as const) {
        assert.equal(shouldShowIndexSidebarSearch(mode), false);
    }
});

test("switching among index card modes preserves generic search", () => {
    const state = { searchInputValue: "odoo", searchQuery: "odoo" };
    for (const mode of ["list", "todo", "agent"] as const) {
        assert.deepEqual(resolveIndexSidebarSearchStateForMode(state, mode), state);
    }
    for (const mode of ["tags", "thought-trail"] as const) {
        assert.deepEqual(resolveIndexSidebarSearchStateForMode(state, mode), {
            searchInputValue: "",
            searchQuery: "",
        });
    }
});

test("global Todo preserves search while unscoped List and Agent clear it", () => {
    const state = { searchInputValue: "odoo", searchQuery: "odoo" };
    assert.deepEqual(resolveIndexSidebarSearchStateForScope(state, "todo", null), state);
    for (const mode of ["list", "agent"] as const) {
        assert.deepEqual(resolveIndexSidebarSearchStateForScope(state, mode, null), {
            searchInputValue: "",
            searchQuery: "",
        });
    }
    assert.deepEqual(resolveIndexSidebarSearchStateForScope(state, "agent", "docs/a.md"), state);
});

test("index generic search copy follows its active scope", () => {
    assert.equal(
        resolveIndexSidebarSearchPlaceholder("global-todo"),
        "Search todo side notes across your vault",
    );
    assert.equal(
        resolveIndexSidebarSearchPlaceholder("file"),
        "Search side notes in selected file",
    );
});
```

Import `resolveIndexSidebarSearchStateForScope` and `resolveIndexSidebarSearchPlaceholder`, and remove the old `resolveIndexSidebarSearchStateForFileScope` import.

- [ ] **Step 2: Write failing toolbar and composition tests**

In `tests/sidebarToolbarActionState.test.ts`, change `showSearch` to `true` for file-scoped Todo and Agent and global Todo. Retain the existing complete assertion that unscoped Agent has `showRow: false` and `showSearch: false`.

In `tests/sidebarToolbarComposition.test.mjs`, replace the selected-file-only options assertion with:

```js
test("index card search reuses scope-aware shared options", () => {
    const methodSource = asideViewSource.match(
        /private getIndexSearchInputOptions\([\s\S]*?\): SidebarSearchInputOptions \{[\s\S]*?\n {4}private getIndexTagSearchInputOptions\(/,
    )?.[0];

    assert.ok(methodSource, "missing index search options method");
    assert.match(methodSource, /resolveIndexSidebarSearchPlaceholder\(scopeKind\)/);
    assert.doesNotMatch(methodSource, /disabled:/);
    assert.doesNotMatch(methodSource, /ariaLabel:/);
    assert.match(asideViewSource, /this\.getIndexSearchInputOptions\(options\.indexModeScope\?\.kind\)/);
});
```

- [ ] **Step 3: Compile to verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json`

Expected: FAIL because the requested scope and placeholder helpers do not exist and the toolbar still returns `showSearch: false` for Todo and Agent.

- [ ] **Step 4: Implement the pure search policy**

In `src/ui/views/indexSidebarState.ts`, add and use:

```ts
export const INDEX_SIDEBAR_SCOPED_SEARCH_PLACEHOLDER = "Search side notes in selected file";
export const INDEX_SIDEBAR_GLOBAL_TODO_SEARCH_PLACEHOLDER = "Search todo side notes across your vault";

export function shouldShowIndexSidebarSearch(mode: IndexSidebarMode): boolean {
    return mode === "list" || mode === "todo" || mode === "agent";
}

export function resolveIndexSidebarSearchStateForScope(
    state: IndexSidebarSearchState,
    mode: IndexSidebarMode,
    rootFilePath: string | null | undefined,
): IndexSidebarSearchState {
    const scope = resolveIndexSidebarModeScope(mode, rootFilePath);
    return shouldShowIndexSidebarSearch(mode)
        && (scope.kind === "file" || scope.kind === "global-todo")
        ? { ...state }
        : { searchInputValue: "", searchQuery: "" };
}

export function resolveIndexSidebarSearchPlaceholder(
    scopeKind: IndexSidebarModeScope["kind"] | undefined,
): string {
    return scopeKind === "global-todo"
        ? INDEX_SIDEBAR_GLOBAL_TODO_SEARCH_PLACEHOLDER
        : INDEX_SIDEBAR_SCOPED_SEARCH_PLACEHOLDER;
}
```

Keep `resolveIndexSidebarSearchStateForMode` delegating to `shouldShowIndexSidebarSearch`. Remove `resolveIndexSidebarSearchStateForFileScope` after its caller is migrated in Step 6.

- [ ] **Step 5: Make the shared toolbar consume the policy**

In `src/ui/views/sidebarToolbarState.ts`, import `shouldShowIndexSidebarSearch` beside `IndexSidebarModeScope` and replace the duplicated mode condition with:

```ts
const showSearch = options.surface === "index"
    ? isIndexTagsMode || shouldShowIndexSidebarSearch(options.mode)
    : isSidebarListLikeMode(options.mode);
```

Keep the existing unavailable-scope early return so unscoped List and Agent still render no secondary row.

- [ ] **Step 6: Migrate the existing AsideView adapter**

In `src/ui/views/AsideView.ts`, import `resolveIndexSidebarSearchStateForScope` and `resolveIndexSidebarSearchPlaceholder`. Remove the old scope-state helper import.

Keep the lifecycle adapter name, but change its pure-policy call to:

```ts
const nextState = resolveIndexSidebarSearchStateForScope({
    searchInputValue: this.indexSidebarSearchInputValue,
    searchQuery: this.indexSidebarSearchQuery,
}, this.indexSidebarMode, rootFilePath);
```

Pass scope through the existing shared toolbar options:

```ts
: this.getIndexSearchInputOptions(options.indexModeScope?.kind)
```

Replace the Index options method with the same existing callbacks and scope-aware copy:

```ts
private getIndexSearchInputOptions(
    scopeKind: IndexSidebarModeScope["kind"] | undefined,
): SidebarSearchInputOptions {
    return {
        value: this.indexSidebarSearchInputValue,
        placeholder: resolveIndexSidebarSearchPlaceholder(scopeKind),
        onFocus: (inputEl) => {
            this.interactionController.claimSidebarInteractionOwnership(inputEl);
        },
        onClear: () => {
            this.clearIndexSidebarSearchDebounceTimer();
            const requestVersion = ++this.indexSidebarSearchRequestVersion;
            this.indexSidebarSearchInputValue = "";
            void this.applyIndexSidebarSearchQuery("", requestVersion, {
                selectionStart: 0,
                selectionEnd: 0,
            });
        },
        onInput: (value, selection) => {
            this.scheduleIndexSidebarSearchQuery(value, selection);
        },
    };
}
```

Do not add another timer, query field, renderer, DOM class, or CSS rule.

- [ ] **Step 7: Run focused tests to verify GREEN**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json`

Expected: PASS.

Run: `node --test .test-dist/tests/indexSidebarState.test.js .test-dist/tests/sidebarToolbarActionState.test.js`

Expected: PASS.

Run: `node --test tests/sidebarToolbarComposition.test.mjs`

Expected: PASS.

- [ ] **Step 8: Re-run the change-surface audit**

Run:

```bash
rg -n "visible only in List|leaving index List|mode === \"list\" \|\| isIndexTagsMode|resolveIndexSidebarSearchStateForFileScope" src tests
```

Expected: no stale List-only policy or old helper remains.

- [ ] **Step 9: Commit the shared card-search path**

```bash
git add src/ui/views/indexSidebarState.ts src/ui/views/sidebarToolbarState.ts src/ui/views/AsideView.ts tests/indexSidebarState.test.ts tests/sidebarToolbarActionState.test.ts tests/sidebarToolbarComposition.test.mjs
git commit -m "feat(index): share search across card tabs"
```

### Task 2: Bound global Todo results

**Files:**
- Modify: `tests/indexSidebarGlobalSearch.test.ts`
- Modify: `tests/indexSidebarSearchWindow.test.ts`
- Delete: `tests/indexSidebarGlobalSearchSource.test.mjs`
- Modify: `src/ui/views/indexSidebarGlobalSearch.ts`

- [ ] **Step 1: Write failing global Todo limit tests**

In `tests/indexSidebarGlobalSearch.test.ts`, replace the dormant List-only limit test with:

```ts
test("global search bounds active Todo and defensive List queries", () => {
    for (const mode of ["todo", "list"] as const) {
        assert.equal(resolveIndexSidebarGlobalSearchResultLimit({
            mode,
            rootFilePath: null,
            query: "design",
        }), 100);
    }
    assert.equal(resolveIndexSidebarGlobalSearchResultLimit({
        mode: "todo",
        rootFilePath: "docs/a.md",
        query: "design",
    }), undefined);
    assert.equal(resolveIndexSidebarGlobalSearchResultLimit({
        mode: "agent",
        rootFilePath: null,
        query: "design",
    }), undefined);
});
```

In `tests/indexSidebarSearchWindow.test.ts`, add:

```ts
test("global Todo search returns the exact top 100 and a complete match notice", () => {
    const threads = Array.from({ length: 137 }, (_, index) => createThread(index));
    const complete = rankThreadsBySidebarSearchQuery(threads, "architecture");
    const window = buildIndexSidebarSearchWindow({
        threads,
        query: "architecture",
        mode: "todo",
        rootFilePath: null,
    });

    assert.deepEqual(
        window.items.map((thread) => thread.id),
        complete.slice(0, 100).map((thread) => thread.id),
    );
    assert.equal(window.hiddenMatchCount, 37);
    assert.equal(window.notice?.primary, "100 of 137 matches shown.");
});

test("file-scoped Todo and Agent search keep every exact result", () => {
    const threads = Array.from({ length: 137 }, (_, index) => createThread(index));
    for (const mode of ["todo", "agent"] as const) {
        const window = buildIndexSidebarSearchWindow({
            threads,
            query: "architecture",
            mode,
            rootFilePath: "docs/a.md",
        });

        assert.equal(window.items.length, 137);
        assert.equal(window.hiddenMatchCount, 0);
        assert.equal(window.notice, null);
    }
});
```

- [ ] **Step 2: Run focused global search tests to verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json`

Expected: PASS.

Run: `node --test .test-dist/tests/indexSidebarGlobalSearch.test.js .test-dist/tests/indexSidebarSearchWindow.test.js`

Expected: FAIL because global Todo currently has no result limit.

- [ ] **Step 3: Activate the bounded Todo policy**

In `src/ui/views/indexSidebarGlobalSearch.ts`, remove the stale dormant-policy comments and implement:

```ts
const isBoundedGlobalMode = options.mode === "todo" || options.mode === "list";
return isBoundedGlobalMode
    && !getNormalizedFilterPath(options.rootFilePath ?? "")
    && !!options.query.trim()
    ? INDEX_SIDEBAR_LIST_LIMIT
    : undefined;
```

Delete `tests/indexSidebarGlobalSearchSource.test.mjs`; its only assertion preserves the superseded dormant comment. Behavioral tests remain the policy contract.

- [ ] **Step 4: Run focused global search tests to verify GREEN**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json`

Expected: PASS.

Run: `node --test .test-dist/tests/indexSidebarGlobalSearch.test.js .test-dist/tests/indexSidebarSearchWindow.test.js`

Expected: PASS.

- [ ] **Step 5: Confirm stale dormant policy is gone**

Run:

```bash
rg -n "defensive fallback only|dormant global search|Revisit unscoped global Index search" src tests
```

Expected: no matches.

- [ ] **Step 6: Commit bounded global Todo search**

```bash
git add src/ui/views/indexSidebarGlobalSearch.ts tests/indexSidebarGlobalSearch.test.ts tests/indexSidebarSearchWindow.test.ts
git add -u tests/indexSidebarGlobalSearchSource.test.mjs
git commit -m "perf(index): bound global Todo search"
```

### Task 3: Verify and close tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-09-08-index-todo-agent-search-parity-design.md`
- Add: `docs/superpowers/plans/2026-09-09-index-todo-agent-search-parity.md`

- [ ] **Step 1: Run complete project verification**

Run: `npm run build`

Expected: all compiled and direct tests pass, followed by lint, typecheck, Obsidian compliance, production bundling, bundle-size enforcement, and release-artifact inspection.

- [ ] **Step 2: Inspect the exact public artifact set**

Run: `npm run release:artifacts:check`

Expected: PASS for `main.js`, `manifest.json`, and `styles.css`.

Run: `test ! -e main.js.map`

Expected: PASS.

Run:

```bash
rg -n "sourceMappingURL|sourcesContent|/Users/wenqingli/|BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|AKIA[0-9A-Z]{16}" main.js manifest.json styles.css
```

Expected: no matches. The ship set contains no raw TypeScript or JSX-family files because it is exactly the three allowed plugin assets.

- [ ] **Step 3: Check final source and working-tree state**

Run: `git diff --check`

Expected: PASS.

Run: `git status --short --branch`

Expected: only the plan and spec tracking changes remain after implementation commits.

- [ ] **Step 4: Mark verified spec items complete**

After Steps 1-3 pass, change every applicable unchecked item in `docs/superpowers/specs/2026-09-08-index-todo-agent-search-parity-design.md` to `[x]`. Do not check any item without evidence.

- [ ] **Step 5: Commit plan and verification tracking**

```bash
git add -f docs/superpowers/plans/2026-09-09-index-todo-agent-search-parity.md docs/superpowers/specs/2026-09-08-index-todo-agent-search-parity-design.md
git commit -m "docs(index): record search parity checks"
```
