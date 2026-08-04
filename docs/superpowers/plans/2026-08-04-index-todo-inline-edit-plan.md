# Index Todo Inline Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow exact `@todo` parent and child entries to be edited inline from the generated index sidebar's effective Todo mode while keeping source navigation and immediately re-filtering canonical Todo results after save.

**Architecture:** Centralize entry-level Todo matching in `sidebarThreadGroups.ts` and make thread matching delegate to it. Extend the shared persisted-card host with an entry predicate that independently authorizes inline editing; the same predicate forces matching collapsed replies to render without writing collapse state. `AsideView` supplies that predicate only for the generated index after mode fallbacks resolve to `todo`; normal note sidebars continue authorizing all entry edits, and other index modes authorize none.

**Tech Stack:** TypeScript, Node's built-in test runner, Obsidian plugin UI helpers, ESLint, `tsc`, esbuild.

---

### Task 1: Centralize exact Todo entry matching

**Files:**
- Modify: `src/ui/views/sidebarThreadGroups.ts`
- Test: `tests/sidebarThreadGroups.test.ts`

- [ ] **Step 1: Write focused failing matcher tests**

Import `entryMatchesSidebarTodo` and add tests that exercise parent/child bodies, case-insensitivity, and the existing token boundary:

```ts
test("entryMatchesSidebarTodo matches exact todo mentions case-insensitively", () => {
    assert.equal(entryMatchesSidebarTodo({ id: "one", body: "Ship @TODO", timestamp: 1 }), true);
    assert.equal(entryMatchesSidebarTodo({ id: "two", body: "Ship @todo-now", timestamp: 2 }), true);
    assert.equal(entryMatchesSidebarTodo({ id: "three", body: "Ship @todos", timestamp: 3 }), false);
    assert.equal(entryMatchesSidebarTodo({ id: "four", body: "No marker", timestamp: 4 }), false);
});

test("threadMatchesSidebarGroup delegates Todo membership to current entries", () => {
    const childTodoThread = createThread("child-todo", ["Parent", "Reply @ToDo"]);
    assert.equal(threadMatchesSidebarGroup(childTodoThread, "todo"), true);
});
```

- [ ] **Step 2: Run the matcher test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarThreadGroups.test.js
```

Expected: compilation fails because `entryMatchesSidebarTodo` is not exported.

- [ ] **Step 3: Add the entry-level matcher and delegate thread matching**

In `src/ui/views/sidebarThreadGroups.ts`, import `CommentThreadEntry`, export the matcher, and remove joined-body Todo matching:

```ts
export function entryMatchesSidebarTodo(entry: Pick<CommentThreadEntry, "body">): boolean {
    return TODO_MENTION_PATTERN.test(entry.body);
}

export function threadMatchesSidebarGroup(
    thread: CommentThread,
    groupMode: SidebarThreadGroupMode,
): boolean {
    return groupMode === "todo"
        ? thread.entries.some((entry) => entryMatchesSidebarTodo(entry))
        : AGENT_MENTION_PATTERN.test(getThreadBodyText(thread));
}
```

Keep `getThreadBodyText` for agent matching only.

- [ ] **Step 4: Run the matcher test and verify GREEN**

Run the Step 2 command again.

Expected: all `sidebarThreadGroups` tests pass.

- [ ] **Step 5: Commit the matcher slice**

```bash
git add src/ui/views/sidebarThreadGroups.ts tests/sidebarThreadGroups.test.ts
git commit -m "feat: centralize todo entry matching"
```

### Task 2: Separate source navigation from exact-entry inline editing

**Files:**
- Modify: `src/ui/views/sidebarPersistedComment.ts`
- Test: `tests/sidebarPersistedComment.test.ts`

- [ ] **Step 1: Write failing renderer tests for independent actions**

Extend `createRenderHost` with a default predicate that preserves note-sidebar editing:

```ts
canEditEntryInline: () => true,
```

Add a test with an index-style host (`showSourceRedirectAction: true`) and a parent plus child where only the child predicate matches. Assert there are two redirect buttons, one edit button, and clicking edit calls `startEditDraft("entry-2", "Aside index.md")`.

Add a second test with `canEditEntryInline: () => false` and assert an index card has redirects but no edit buttons. Keep an existing/default note-sidebar assertion that edit buttons remain available when source redirects are off.

- [ ] **Step 2: Write a failing collapsed-reply test**

Render a thread with two children using:

```ts
const host = createRenderHost({
    showSourceRedirectAction: true,
    showNestedComments: false,
    showNestedCommentsByDefault: false,
    canEditEntryInline: (entry) => entry.id === "todo-child",
});
```

Assert the matching child body is rendered, the nonmatching child body is absent, and `setShowNestedCommentsForThread` is never called during render.

- [ ] **Step 3: Run renderer tests and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: compilation fails because `SidebarPersistedCommentHost` has no `canEditEntryInline` capability, or assertions fail because index actions remain redirect-only.

- [ ] **Step 4: Add the entry-level capability to the shared renderer**

Add this required host member:

```ts
canEditEntryInline(entry: CommentThreadEntry): boolean;
```

For both parent and child entries, render the pencil when `host.canEditEntryInline(entry)` returns true, independently of `host.showSourceRedirectAction`. Keep delete, append, share, pin, move, and other mutation controls behind their existing index restrictions.

Compute forced child visibility without mutating stored state:

```ts
const forcedVisibleChildEntryIds = new Set(
    entries.slice(1)
        .filter((entry) => host.canEditEntryInline(entry))
        .map((entry) => entry.id),
);
const shouldRenderStoredChildren = host.showNestedComments
    || hasChildEditDraft
    || host.agentStream !== null
    || !!host.appendDraftComment
    || forcedVisibleChildEntryIds.size > 0;
```

Pass a `hasForcedVisibleChildEntries` flag into `shouldRenderNestedThreadEntries`. When normal nested rendering is off, filter the child loop to `forcedVisibleChildEntryIds`; when it is on, preserve the existing full child list.

- [ ] **Step 5: Run renderer tests and verify GREEN**

Run the Step 3 command again.

Expected: all `sidebarPersistedComment` tests pass.

- [ ] **Step 6: Commit the renderer slice**

```bash
git add src/ui/views/sidebarPersistedComment.ts tests/sidebarPersistedComment.test.ts
git commit -m "feat: edit todo entries beside source links"
```

### Task 3: Wire effective Todo mode and prove canonical save re-filtering

**Files:**
- Modify: `src/ui/views/AsideView.ts`
- Modify: `src/ui/views/sidebarThreadGroups.ts`
- Test: `tests/commentMutationController.test.ts`
- Test: `tests/sidebarThreadGroups.test.ts`
- Test: `tests/sidebarPersistedComment.test.ts`

- [ ] **Step 1: Write a failing mutation-flow regression test**

Import `threadMatchesSidebarGroup` into `tests/commentMutationController.test.ts`. Start an edit draft with an explicit index host path, remove the final Todo marker, save, and assert the original source file was persisted while canonical membership changed:

```ts
const parent = createComment({ id: "thread-1", filePath: "docs/source.md", comment: "Parent @todo" });
const host = createHost({ knownComments: [parent], loadedComments: [parent] });

assert.equal(await host.controller.startEditDraft(parent.id, "Aside index.md"), true);
assert.equal(host.getDraftHostFilePath(), "Aside index.md");
assert.equal(host.getDraftComment()?.filePath, "docs/source.md");
host.getDraftComment()!.comment = "Parent complete";
await host.controller.saveDraft(parent.id);

assert.equal(threadMatchesSidebarGroup(host.manager.getThreadById(parent.id)!, "todo"), false);
assert.equal(host.persistedFiles.at(-1)?.path, "docs/source.md");
assert.equal(host.getRefreshCommentViewsCount(), 1);
```

Add a companion child-entry case where removing one `@todo` leaves another entry matching and the thread remains in Todo membership. Existing controller tests cover cancel/no-save and failed-save draft retention; do not duplicate production behavior.

- [ ] **Step 2: Run the mutation-flow test and establish current behavior**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentMutationController.test.js
```

Expected: the new regression assertions pass against the existing canonical mutation path. If any assertion fails, keep the test failing and make only the smallest mutation-path correction needed by the approved design.

- [ ] **Step 3: Write and run a failing effective-mode capability test**

In `tests/sidebarThreadGroups.test.ts`, import the new wished-for helper and add:

```ts
test("canInlineEditIndexTodoEntries enables only effective index Todo mode", () => {
    assert.equal(canInlineEditIndexTodoEntries(true, "todo"), true);
    assert.equal(canInlineEditIndexTodoEntries(true, "list"), false);
    assert.equal(canInlineEditIndexTodoEntries(true, "agent"), false);
    assert.equal(canInlineEditIndexTodoEntries(true, "thought-trail"), false);
    assert.equal(canInlineEditIndexTodoEntries(false, "todo"), false);
});
```

Run the focused test command from Task 1.

Expected: compilation fails because `canInlineEditIndexTodoEntries` is not exported.

- [ ] **Step 4: Supply the Todo capability only after index mode fallbacks**

In `sidebarThreadGroups.ts`, add the pure view-policy helper:

```ts
export function canInlineEditIndexTodoEntries(
    isAllCommentsView: boolean,
    effectiveMode: SidebarPrimaryMode,
): boolean {
    return isAllCommentsView && effectiveMode === "todo";
}
```

Import `canInlineEditIndexTodoEntries` and `entryMatchesSidebarTodo` in `AsideView.ts`. After computing `effectiveIndexSidebarMode`, derive:

```ts
const canInlineEditTodoEntries = canInlineEditIndexTodoEntries(
    isAllCommentsView,
    effectiveIndexSidebarMode,
);
```

Extend `renderPersistedComment` with a final boolean parameter defaulting to `false`. At the generated-index call site pass `canInlineEditTodoEntries`; leave note-sidebar call sites on the default. Build the renderer predicate as:

```ts
canEditEntryInline: (entry) => isIndexView
    ? canInlineEditTodoEntries && entryMatchesSidebarTodo(entry)
    : true,
```

This keeps List, Agent, Thought Trail, and effective-mode fallbacks redirect-only even when their entries contain `@todo`; the index search query does not affect capability.

- [ ] **Step 5: Add a view-policy renderer regression**

In `tests/sidebarPersistedComment.test.ts`, add table-driven coverage that an index host predicate enables edit only in the effective Todo case and that note-sidebar hosts still edit entries normally. The renderer test should assert behavior through visible action counts, not private `AsideView` fields.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarThreadGroups.test.js .test-dist/tests/sidebarPersistedComment.test.js .test-dist/tests/commentMutationController.test.js
```

Expected: all matcher, renderer, nested-entry, and mutation-flow tests pass.

- [ ] **Step 7: Commit the view and mutation-flow slice**

```bash
git add src/ui/views/AsideView.ts src/ui/views/sidebarThreadGroups.ts tests/sidebarThreadGroups.test.ts tests/sidebarPersistedComment.test.ts tests/commentMutationController.test.ts
git commit -m "feat: enable inline editing in index todo mode"
```

### Task 4: Full project and release-artifact verification

**Files:**
- Inspect: `docs/superpowers/specs/2026-08-04-index-todo-inline-edit-design.md`
- Inspect: `main.js`
- Inspect: `manifest.json`
- Inspect: `styles.css`

- [ ] **Step 1: Run the complete verification matrix**

Run each command independently and retain its exit status:

```bash
npm test
npm run lint
npm run typecheck
npm run check:obsidian
npm run bundle
npm run release:artifacts:check
```

Expected: every command exits 0.

- [ ] **Step 2: Inspect the exact shipping asset set for source exposure**

Run:

```bash
git status --short
find . -maxdepth 1 -type f \( -name 'main.js' -o -name 'manifest.json' -o -name 'styles.css' -o -name 'main.js.map' \) -print
rg -n "sourceMappingURL|sourcesContent" main.js manifest.json styles.css
find . -maxdepth 2 -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' -o -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' \) -not -path './node_modules/*' -print
```

Expected: the exact shippable allowlist is `main.js`, `manifest.json`, and `styles.css`; no `main.js.map`, embedded-source marker, source-map URL, secret-bearing file, or raw source file is included by the release artifact guard. Repository source files may exist locally but must not be part of the three-asset release allowlist.

- [ ] **Step 3: Review the approved design line by line**

Confirm that exact-entry matching, effective Todo-only capability, source navigation plus pencil, selective child reveal, canonical save targeting, post-save re-filtering, non-Todo index restrictions, and unchanged note-sidebar editing each have implementation and regression evidence. Do not mark the design's implementation checklist merged while the work remains only on the feature branch.

- [ ] **Step 4: Review the branch diff**

Run:

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git log --oneline main..HEAD
```

Expected: no whitespace errors, only scoped files changed, and task commits are present.
