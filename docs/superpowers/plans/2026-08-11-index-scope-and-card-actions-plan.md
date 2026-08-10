# Index Scope and Card Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate unscoped Index List and Agent, preserve global Todo until a file is selected, give file-scoped child cards mutation parity, and move every Index source redirect to the bottom-right footer.

**Architecture:** `indexSidebarState.ts` owns one explicit mode/file scope result consumed by thread selection, toolbar planning, and card policy. `sidebarCardActionState.ts` converts surface, mode, and scope into mutation capabilities, while `sidebarPersistedComment.ts` remains the single shared parent/child renderer and moves source navigation into its existing footer action row. `AsideView.ts` is the thin adapter that computes the effective mode once and passes the shared scope result to each owner.

**Tech Stack:** TypeScript, Obsidian DOM APIs, Node test runner, ESLint, esbuild, CSS contract tests.

---

### Task 1: Define the explicit Index mode scope

**Files:**
- Modify: `tests/indexSidebarState.test.ts`
- Modify: `src/ui/views/indexSidebarState.ts`

- [ ] **Step 1: Write fail-first scope matrix and thread-selection tests**

Replace the disabled-search availability import/test with `resolveIndexSidebarModeScope` and `scopeIndexThreadsByMode`, then add:

```typescript
test("index card modes resolve global todo and gated local modes without a file", () => {
    assert.deepEqual(resolveIndexSidebarModeScope("list", null), {
        kind: "unavailable",
        rootFilePath: null,
    });
    assert.deepEqual(resolveIndexSidebarModeScope("agent", "   "), {
        kind: "unavailable",
        rootFilePath: null,
    });
    assert.deepEqual(resolveIndexSidebarModeScope("todo", null), {
        kind: "global-todo",
        rootFilePath: null,
    });
});

test("a selected file scopes every index card mode", () => {
    for (const mode of ["list", "todo", "agent"] as const) {
        assert.deepEqual(resolveIndexSidebarModeScope(mode, " docs\\b.md "), {
            kind: "file",
            rootFilePath: "docs/b.md",
        });
    }
});

test("index mode scope selects empty, global, or file threads", () => {
    const visibleThreads = [
        commentToThread(createComment({ id: "todo-a", filePath: "docs/a.md", comment: "@todo A" })),
        commentToThread(createComment({ id: "agent-b", filePath: "docs/b.md", comment: "@codex B" })),
    ];
    const allThreads = visibleThreads.concat([
        commentToThread(createComment({ id: "todo-b", filePath: "docs/b.md", comment: "@todo B" })),
    ]);

    assert.deepEqual(
        scopeIndexThreadsByMode(visibleThreads, allThreads, resolveIndexSidebarModeScope("list", null))
            .scopedVisibleThreads,
        [],
    );
    assert.deepEqual(
        scopeIndexThreadsByMode(visibleThreads, allThreads, resolveIndexSidebarModeScope("todo", null))
            .scopedAllThreads.map((thread) => thread.id),
        ["todo-a", "agent-b", "todo-b"],
    );
    assert.deepEqual(
        scopeIndexThreadsByMode(visibleThreads, allThreads, resolveIndexSidebarModeScope("todo", "docs/b.md"))
            .scopedAllThreads.map((thread) => thread.id),
        ["agent-b", "todo-b"],
    );
});
```

- [ ] **Step 2: Compile and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because `resolveIndexSidebarModeScope` and `scopeIndexThreadsByMode` are not exported.

- [ ] **Step 3: Implement the pure scope owner**

In `src/ui/views/indexSidebarState.ts`, retain the existing search presentation until Task 5 rewires its last production caller, and add:

```typescript
export type IndexSidebarModeScope =
    | { kind: "unavailable"; rootFilePath: null }
    | { kind: "global-todo"; rootFilePath: null }
    | { kind: "file"; rootFilePath: string };

export function resolveIndexSidebarModeScope(
    mode: IndexSidebarMode,
    rootFilePath: string | null | undefined,
): IndexSidebarModeScope {
    const normalizedRootPath = getNormalizedFilterPath(rootFilePath ?? "");
    if (normalizedRootPath) {
        return { kind: "file", rootFilePath: normalizedRootPath };
    }
    return mode === "todo"
        ? { kind: "global-todo", rootFilePath: null }
        : { kind: "unavailable", rootFilePath: null };
}

export function scopeIndexThreadsByMode(
    visibleThreads: CommentThread[],
    allThreads: CommentThread[],
    scope: IndexSidebarModeScope,
): { scopedVisibleThreads: CommentThread[]; scopedAllThreads: CommentThread[] } {
    if (scope.kind === "unavailable") {
        return { scopedVisibleThreads: [], scopedAllThreads: [] };
    }
    if (scope.kind === "global-todo") {
        return {
            scopedVisibleThreads: visibleThreads.slice(),
            scopedAllThreads: allThreads.slice(),
        };
    }
    return scopeIndexThreadsByFilePaths(
        visibleThreads,
        allThreads,
        [scope.rootFilePath],
    );
}
```

- [ ] **Step 4: Run the focused state tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/indexSidebarState.test.js
```

Expected: all `indexSidebarState` tests PASS.

- [ ] **Step 5: Commit the scope policy**

```bash
git add src/ui/views/indexSidebarState.ts tests/indexSidebarState.test.ts
git commit -m "feat: define index mode scope policy"
```

### Task 2: Gate the secondary-toolbar plan with scope

**Files:**
- Modify: `tests/sidebarToolbarActionState.test.ts`
- Modify: `src/ui/views/sidebarToolbarState.ts`

- [ ] **Step 1: Write fail-first toolbar-plan tests**

Add `indexScopeKind` to the Index fixtures and assert the gated states:

```typescript
for (const mode of ["list", "agent"] as const) {
    assert.deepEqual(resolveSidebarSecondaryToolbarPlan({
        ...base,
        surface: "index",
        mode,
        indexScopeKind: "unavailable",
    }), {
        showRow: false,
        showFileFilter: false,
        showSearch: false,
        showPinned: false,
        showNested: false,
        showDeleted: false,
        showAddPageComment: false,
    });
}

assert.equal(resolveSidebarSecondaryToolbarPlan({
    ...base,
    surface: "index",
    mode: "todo",
    indexScopeKind: "global-todo",
}).showRow, true);

assert.equal(resolveSidebarSecondaryToolbarPlan({
    ...base,
    surface: "index",
    mode: "list",
    indexScopeKind: "file",
}).showSearch, true);
```

- [ ] **Step 2: Run toolbar tests and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarToolbarActionState.test.js
```

Expected: compilation or assertions FAIL because the toolbar plan has no `indexScopeKind`.

- [ ] **Step 3: Implement the scope-aware toolbar plan**

Import `IndexSidebarModeScope` as a type and extend `SidebarSecondaryToolbarPlanOptions` with an optional adapter field so existing callers compile until Task 5 wires the resolved scope:

```typescript
indexScopeKind?: IndexSidebarModeScope["kind"];
```

At the start of `resolveSidebarSecondaryToolbarPlan`, add:

```typescript
const isGatedIndexMode = options.surface === "index"
    && options.indexScopeKind === "unavailable"
    && (options.mode === "list" || options.mode === "agent");
if (isGatedIndexMode) {
    return {
        showRow: false,
        showFileFilter: false,
        showSearch: false,
        showPinned: false,
        showNested: false,
        showDeleted: false,
        showAddPageComment: false,
    };
}
```

- [ ] **Step 4: Run toolbar tests and verify GREEN**

Run the Step 2 commands again.

Expected: all toolbar action-state and composition tests PASS.

- [ ] **Step 5: Commit the toolbar slice**

```bash
git add src/ui/views/sidebarToolbarState.ts tests/sidebarToolbarActionState.test.ts
git commit -m "feat: gate unscoped index toolbars"
```

### Task 3: Make card mutation policy scope-aware

**Files:**
- Modify: `tests/sidebarCardActionState.test.ts`
- Modify: `tests/sidebarPersistedComment.test.ts`
- Modify: `src/ui/views/sidebarCardActionState.ts`
- Modify: `src/ui/views/sidebarPersistedComment.ts`
- Modify: `src/ui/views/AsideView.ts`

- [ ] **Step 1: Write fail-first card-policy tests**

Replace the old parent-only expectations with:

```typescript
for (const mode of ["list", "todo", "agent"] as const) {
    assert.deepEqual(resolveSidebarCardActionState("index", mode, "file"), {
        showPin: true,
        canEditEntries: true,
        canDeleteEntries: true,
        enableTopLevelReorder: true,
        enableChildEntryMove: true,
    });
}

assert.deepEqual(resolveSidebarCardActionState("index", "todo", "global-todo"), {
    showPin: true,
    canEditEntries: true,
    canDeleteEntries: true,
    enableTopLevelReorder: false,
    enableChildEntryMove: false,
});

assert.deepEqual(resolveSidebarCardActionState("index", "list", "unavailable"), {
    showPin: false,
    canEditEntries: false,
    canDeleteEntries: false,
    enableTopLevelReorder: false,
    enableChildEntryMove: false,
});
```

Change the child-move helper test to prove source navigation no longer suppresses a file-scoped drag handle:

```typescript
assert.equal(shouldRenderChildEntryMoveHandle({
    enableChildEntryMove: true,
    entryDeleted: false,
    threadDeleted: false,
}), true);
```

- [ ] **Step 2: Run card-policy tests and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarCardActionState.test.js
node --test .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: FAIL because the policy has parent-only fields, no scope argument, and the move helper still hides Index handles.

- [ ] **Step 3: Implement scoped entry capabilities**

Change `SidebarCardActionState` fields to `canEditEntries` and `canDeleteEntries`, accept `indexScopeKind: IndexSidebarModeScope["kind"] | null`, and compute:

```typescript
const canMutateEntries = isCardMode
    && (surface === "note" || indexScopeKind !== "unavailable");
const canReorder = canMutateEntries
    && (surface === "note" || indexScopeKind === "file");
return {
    showPin: canMutateEntries,
    canEditEntries: canMutateEntries,
    canDeleteEntries: canMutateEntries,
    enableTopLevelReorder: canReorder,
    enableChildEntryMove: canReorder,
};
```

Remove `showSourceRedirectAction` from `shouldRenderChildEntryMoveHandle` and its call sites so only capability and deletion state govern the handle.

In `AsideView.renderPersistedComment`, add an optional `indexModeScopeKind` argument. For Index callers that have not yet supplied it, resolve a temporary fallback through `resolveIndexSidebarModeScope` using the current mode and selected root; note callers use `null`. Pass that kind to `resolveSidebarCardActionState` and wire:

```typescript
canEditEntryInline: () => cardActions.canEditEntries,
canDeleteEntryInline: () => cardActions.canDeleteEntries,
```

Keep `shouldForceRenderEntry` limited to matching Todo entries in effective Todo mode so enabling edits does not auto-expand every collapsed child.

- [ ] **Step 4: Run card-policy tests and verify GREEN**

Run the Step 2 commands again.

Expected: all card-policy and persisted-card tests PASS.

- [ ] **Step 5: Commit the card-policy slice**

```bash
git add src/ui/views/sidebarCardActionState.ts src/ui/views/sidebarPersistedComment.ts src/ui/views/AsideView.ts tests/sidebarCardActionState.test.ts tests/sidebarPersistedComment.test.ts
git commit -m "feat: align scoped index card actions"
```

### Task 4: Move Open source into the shared footer

**Files:**
- Modify: `tests/sidebarPersistedComment.test.ts`
- Modify: `src/ui/views/sidebarPersistedComment.ts`

- [ ] **Step 1: Write fail-first footer ownership and navigation tests**

Update the nested Index redirect test to assert both parent and child buttons belong to footer action rows and are the final children:

```typescript
const redirectButtons = root.findAllByClass("aside-comment-action-redirect");
assert.equal(redirectButtons.length, 2);
for (const redirectButton of redirectButtons) {
    const actions = redirectButton.parentElement;
    assert.ok(actions?.classList.contains("aside-thread-footer-actions"));
    assert.equal(actions.children.at(-1), redirectButton);
}
for (const header of root.findAllByClass("aside-comment-header")) {
    assert.equal(header.findAllByClass("aside-comment-action-redirect").length, 0);
}
```

Click both redirects and assert `openCommentInEditor` receives `comment-1` and `entry-2` respectively.

- [ ] **Step 2: Run the renderer test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: FAIL because redirect buttons are children of `.aside-comment-actions` in each header.

- [ ] **Step 3: Add one optional footer source action**

Extend `renderThreadFooterActions` options with:

```typescript
sourceRedirectAction?: {
    ariaLabel: string;
    icon: string;
} | null;
```

Include `options.sourceRedirectAction` in both footer-action existence predicates. After the metadata toggle, append:

```typescript
if (options.sourceRedirectAction) {
    renderSourceRedirectButton(
        footerActionsEl,
        comment,
        options.sourceRedirectAction.ariaLabel,
        options.sourceRedirectAction.icon,
        host,
    );
}
```

Remove the parent and child header redirect branches. Pass `presentation.redirectHint` or `entryPresentation.redirectHint` as `sourceRedirectAction` only for active Index entries. Keep deleted-entry restore/permanent-delete behavior unchanged.

- [ ] **Step 4: Run the renderer test and verify GREEN**

Run the Step 2 commands again.

Expected: all `sidebarPersistedComment` tests PASS, with both redirects last in their footer rows.

- [ ] **Step 5: Commit the footer slice**

```bash
git add src/ui/views/sidebarPersistedComment.ts tests/sidebarPersistedComment.test.ts
git commit -m "feat: move index source links to card footers"
```

### Task 5: Wire one mode scope through Index rendering and toolbar composition

**Files:**
- Modify: `tests/sidebarToolbarComposition.test.mjs`
- Modify: `src/ui/views/indexSidebarState.ts`
- Modify: `src/ui/views/AsideView.ts`

- [ ] **Step 1: Write a fail-first wiring contract**

Add a source contract proving one resolved scope drives thread selection, toolbar options, and card descriptors:

```javascript
test("one index mode scope drives cards, toolbar, and action policy", () => {
    const renderSource = asideViewSource.match(
        /public async renderComments\([\s\S]*?\n {4}private async renderPageSidebar\(/,
    )?.[0];
    assert.ok(renderSource, "missing renderComments method");
    assert.match(renderSource, /const indexModeScope = resolveIndexSidebarModeScope\(/);
    assert.match(renderSource, /scopeIndexThreadsByMode\([\s\S]*?indexModeScope/);
    assert.match(renderSource, /indexModeScope,\s*\n/);
});
```

Update the existing Index search composition assertions so they expect `getIndexSearchInputOptions()` with no mode/scope arguments, the fixed placeholder `Search side notes in selected file`, no disabled option in that method, and `indexScopeKind` flowing into `resolveSidebarSecondaryToolbarPlan`.

- [ ] **Step 2: Run the wiring contract and verify RED**

Run:

```bash
node --test tests/sidebarToolbarComposition.test.mjs
```

Expected: FAIL because `AsideView` does not yet resolve or pass `indexModeScope`.

- [ ] **Step 3: Apply the scope after effective-mode resolution**

In `renderComments`, keep the pre-mode file-scoped/global set for tab availability counts. After `effectiveIndexSidebarMode` is finalized, add:

```typescript
const indexModeScope = isAllCommentsView
    ? resolveIndexSidebarModeScope(effectiveIndexSidebarMode, selectedIndexFileFilterRootPath)
    : null;
const modeScopedThreads = isAllCommentsView && indexModeScope
    ? scopeIndexThreadsByMode(
        pinnedScopedVisibleThreads,
        pinnedScopedAllThreads,
        indexModeScope,
    )
    : {
        scopedVisibleThreads: pinnedScopedVisibleThreads,
        scopedAllThreads: pinnedScopedAllThreads,
    };
```

Use `modeScopedThreads.scopedVisibleThreads` and `.scopedAllThreads` for group filtering, search, active-draft host inclusion, totals, and rendered descriptors. This yields no cards for unscoped List/Agent, aggregate candidates for unscoped Todo, and selected-file candidates for every scoped mode.

Pass `indexModeScope` to `renderSidebarToolbar` and `buildSidebarRenderDescriptors`; pass its kind through the descriptor to `renderPersistedComment` and `resolveSidebarCardActionState`. Remove the temporary fallback resolution added in Task 3 once every Index descriptor supplies the value. The cached empty List path passes `{ kind: "unavailable", rootFilePath: null }`.

In `renderSidebarToolbar`, pass `indexModeScope?.kind` into `resolveSidebarSecondaryToolbarPlan` and replace the Index search branch with `this.getIndexSearchInputOptions()`.

Replace the Index search adapter signature/body prefix with:

```typescript
private getIndexSearchInputOptions(): SidebarSearchInputOptions {
    return {
        value: this.indexSidebarSearchInputValue,
        placeholder: INDEX_SIDEBAR_SCOPED_SEARCH_PLACEHOLDER,
```

Keep its focus, clear, and input callbacks unchanged. The shared renderer's generic disabled-input capability remains available to other callers, but the active Index path no longer supplies it.

After the caller is migrated, remove `INDEX_SIDEBAR_UNSCOPED_SEARCH_PLACEHOLDER`, `IndexSidebarSearchAvailability`, and `resolveIndexSidebarSearchAvailability` from `indexSidebarState.ts`; retain `INDEX_SIDEBAR_SCOPED_SEARCH_PLACEHOLDER` and all search-state cancellation helpers.

Do not change the pre-mode group-count input: without a file it remains aggregate so Todo and Agent tabs can still be selected; with a file it remains file-scoped.

- [ ] **Step 4: Run all focused tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/indexSidebarState.test.js
node --test .test-dist/tests/sidebarToolbarActionState.test.js
node --test .test-dist/tests/sidebarCardActionState.test.js
node --test .test-dist/tests/sidebarPersistedComment.test.js
node --test tests/sidebarToolbarComposition.test.mjs
```

Expected: all focused tests PASS.

- [ ] **Step 5: Re-run the change-surface searches**

Run:

```bash
rg -n "resolveIndexSidebarSearchAvailability|INDEX_SIDEBAR_UNSCOPED_SEARCH_PLACEHOLDER|canEditParent|canDeleteParent|showSourceRedirectAction.*renderSourceRedirectButton" src tests --glob '!main.js'
```

Expected: no stale policy owners; remaining `showSourceRedirectAction` hits only control Index presentation and non-source footer actions.

- [ ] **Step 6: Commit the render wiring**

```bash
git add src/ui/views/indexSidebarState.ts src/ui/views/AsideView.ts tests/sidebarToolbarComposition.test.mjs
git commit -m "feat: apply index scope across card tabs"
```

### Task 6: Verify, inspect the artifact, and close tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-index-mode-scope-gate-design.md`
- Modify: `docs/superpowers/specs/2026-08-11-index-card-action-parity-design.md`

- [ ] **Step 1: Run the complete repository pipeline**

Run:

```bash
npm run build
```

Expected: tests, lint, typecheck, Obsidian compliance, production bundle, and release-artifact guard all PASS.

- [ ] **Step 2: Inspect the exact public Aside assets**

Run:

```bash
npm run release:artifacts:check
rg -n "sourceMappingURL|sourcesContent|/Users/|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}" main.js manifest.json styles.css
rg --files | rg "(^|/)(main\.js\.map|\.env[^/]*|\.npmrc|.*\.(?:pem|key|p12|pfx))$"
```

Expected: the guard passes; the content scan and forbidden-file scan return no source maps, embedded sources, local paths, or obvious secret-bearing material in the shipped assets.

- [ ] **Step 3: Mark both tracked specifications complete**

Change every implemented and freshly verified checkbox in both 2026-08-11 specifications from `[ ]` to `[x]`. Do not change historical superseded specs beyond their existing supersession note.

- [ ] **Step 4: Commit verified documentation and generated assets**

```bash
git add -f docs/superpowers/specs/2026-08-11-index-mode-scope-gate-design.md docs/superpowers/specs/2026-08-11-index-card-action-parity-design.md
git add main.js manifest.json styles.css
git commit -m "docs: verify index scope and card actions"
```

- [ ] **Step 5: Confirm the final worktree and commit range**

Run:

```bash
git status --short
git log --oneline bf93ca6..HEAD
```

Expected: clean worktree and a reviewable sequence containing the approved design, implementation plan, test-driven slices, and verification checkpoint.
