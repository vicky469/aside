# Index Sidebar Shared Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the generated index sidebar a shared capability-driven toolbar, List-only search, canonical Pin/Edit/Delete card actions, and same-source-file top-level drag reorder in List, Todo, and Agent.

**Architecture:** Keep search matching, comment mutations, and canonical thread storage unchanged. Add pure toolbar/card/reorder capability planners, let one shared secondary-row renderer consume those plans, extend the aggregate index only enough to query deleted records, and make index ordering preserve canonical per-file order while retaining deterministic file grouping. `AsideView` remains the DOM and lifecycle adapter.

**Tech Stack:** TypeScript, Obsidian plugin API, Node test runner, fake DOM test harnesses, CSS, esbuild.

**Associated spec:** `docs/superpowers/specs/2026-08-09-index-sidebar-list-search-design.md`

---

## File Structure

- Create `src/ui/views/sidebarCardActionState.ts` for pure note/index card-action capability decisions.
- Create `src/ui/views/sidebarIndexReorder.ts` for pure same-source-file drop eligibility.
- Modify `src/ui/views/sidebarToolbarState.ts` to own secondary-toolbar capability decisions for both surfaces.
- Modify `src/ui/views/sidebarToolbarRenderer.ts` to render one shared secondary toolbar row from optional controls.
- Modify `src/ui/views/indexSidebarState.ts` to own List-only index search visibility and mode-exit clearing.
- Modify `src/index/AggregateCommentIndex.ts` and `src/main.ts` to support opt-in deleted aggregate queries.
- Modify `src/ui/views/sidebarPersistedComment.ts` to decouple source redirects from valid header mutations.
- Modify `src/ui/views/sidebarRenderOrder.ts` so file grouping preserves canonical/search order within each source file.
- Modify `src/ui/views/AsideView.ts` to wire transient index search, shared toolbar plans, aggregate pin/deleted filters, card capabilities, and same-file drag.
- Modify `styles.css` to make the shared index secondary row compact and responsive.
- Extend focused tests under `tests/` for every pure boundary and one representative renderer/integration caller.

---

### Task 1: Shared Secondary Toolbar Plan and Renderer

**Files:**
- Modify: `src/ui/views/sidebarToolbarState.ts`
- Modify: `src/ui/views/sidebarToolbarRenderer.ts`
- Modify: `tests/sidebarToolbarActionState.test.ts`

- [ ] **Step 1: Write failing toolbar capability tests**

Extend `tests/sidebarToolbarActionState.test.ts` to import `resolveSidebarSecondaryToolbarPlan` and add this matrix:

```ts
test("secondary toolbar plan shares valid controls across note and index surfaces", () => {
    const base = {
        hasNestedComments: true,
        hasFileFilterOptions: true,
        hasAddPageCommentAction: true,
    };

    assert.deepEqual(resolveSidebarSecondaryToolbarPlan({
        ...base,
        surface: "index",
        mode: "list",
    }), {
        showRow: true,
        showFileFilter: true,
        showSearch: true,
        showPinned: true,
        showNested: true,
        showDeleted: true,
        showAddPageComment: false,
    });
    for (const mode of ["todo", "agent"] as const) {
        assert.deepEqual(resolveSidebarSecondaryToolbarPlan({
            ...base,
            surface: "index",
            mode,
        }), {
            showRow: true,
            showFileFilter: true,
            showSearch: false,
            showPinned: true,
            showNested: true,
            showDeleted: true,
            showAddPageComment: false,
        });
    }
    assert.deepEqual(resolveSidebarSecondaryToolbarPlan({
        ...base,
        surface: "index",
        mode: "thought-trail",
    }), {
        showRow: true,
        showFileFilter: true,
        showSearch: false,
        showPinned: false,
        showNested: false,
        showDeleted: false,
        showAddPageComment: false,
    });
    assert.equal(resolveSidebarSecondaryToolbarPlan({
        ...base,
        surface: "note",
        mode: "list",
    }).showAddPageComment, true);
});
```

- [ ] **Step 2: Run the toolbar state test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because `resolveSidebarSecondaryToolbarPlan` is not exported.

- [ ] **Step 3: Implement the pure toolbar plan**

Add to `src/ui/views/sidebarToolbarState.ts`:

```ts
export interface SidebarSecondaryToolbarPlanOptions {
    surface: "note" | "index";
    mode: SidebarPrimaryMode;
    hasNestedComments: boolean;
    hasFileFilterOptions: boolean;
    hasAddPageCommentAction: boolean;
}

export interface SidebarSecondaryToolbarPlan {
    showRow: boolean;
    showFileFilter: boolean;
    showSearch: boolean;
    showPinned: boolean;
    showNested: boolean;
    showDeleted: boolean;
    showAddPageComment: boolean;
}

export function resolveSidebarSecondaryToolbarPlan(
    options: SidebarSecondaryToolbarPlanOptions,
): SidebarSecondaryToolbarPlan {
    const isIndexCardMode = options.surface === "index"
        && (options.mode === "list" || options.mode === "todo" || options.mode === "agent");
    const isNoteListMode = options.surface === "note" && options.mode === "list";
    const showSearch = options.surface === "index"
        ? options.mode === "list"
        : isSidebarListLikeMode(options.mode);

    return {
        showRow: options.surface === "index" || showSearch || isNoteListMode,
        showFileFilter: options.surface === "index",
        showSearch,
        showPinned: isIndexCardMode || isNoteListMode,
        showNested: options.hasNestedComments && (isIndexCardMode || options.surface === "note"),
        showDeleted: isIndexCardMode || isNoteListMode,
        showAddPageComment: isNoteListMode && options.hasAddPageCommentAction,
    };
}
```

Import and reuse `isSidebarListLikeMode`. Preserve `resolveNoteToolbarActionState` so note-only disabled-state behavior remains covered. The index file-filter button stays present in every index mode and uses `hasFileFilterOptions` only for its disabled state; this keeps Thought Trail's scope control visible even when the option list is empty.

- [ ] **Step 4: Add the shared secondary row renderer**

Add to `src/ui/views/sidebarToolbarRenderer.ts`:

```ts
export interface SidebarSecondaryToolbarOptions {
    surface: "note" | "index";
    fileFilter?: ToolbarIconButtonOptions;
    search?: SidebarSearchInputOptions;
    pinned?: ToolbarIconButtonOptions;
    nested?: ToolbarIconButtonOptions;
    deleted?: ToolbarIconButtonOptions;
    addPageComment?: ToolbarIconButtonOptions;
}

export function renderSidebarSecondaryToolbar(
    toolbarEl: HTMLElement,
    options: SidebarSecondaryToolbarOptions,
    guard: ToolbarActionGuard,
): HTMLDivElement {
    const row = toolbarEl.createDiv(
        `aside-sidebar-toolbar-row is-${options.surface}-secondary-row${options.search ? " is-search-row" : ""}`,
    );
    const filterGroup = row.createDiv("aside-sidebar-toolbar-group is-filter-group");
    if (options.fileFilter) {
        renderToolbarIconButton(filterGroup, options.fileFilter, guard);
    }
    if (options.search) {
        renderSidebarSearchInput(filterGroup, options.search);
    }

    const actionOptions = [
        options.pinned,
        options.nested,
        options.deleted,
        options.addPageComment,
    ].filter((action): action is ToolbarIconButtonOptions => !!action);
    if (actionOptions.length) {
        const actionGroup = row.createDiv("aside-sidebar-toolbar-group is-action-group");
        for (const action of actionOptions) {
            renderToolbarIconButton(actionGroup, action, guard);
        }
    }
    return row;
}
```

Do not add surface-specific matching or mutation logic to the renderer.

- [ ] **Step 5: Run the focused toolbar tests and typecheck**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarToolbarActionState.test.js
npm run typecheck
```

Expected: toolbar tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit the shared toolbar boundary**

```bash
git add src/ui/views/sidebarToolbarState.ts src/ui/views/sidebarToolbarRenderer.ts tests/sidebarToolbarActionState.test.ts
git commit -m "refactor: share sidebar secondary toolbar"
```

---

### Task 2: List-Only Index Search State and Input

**Files:**
- Modify: `src/ui/views/indexSidebarState.ts`
- Modify: `src/ui/views/AsideView.ts`
- Modify: `tests/indexSidebarState.test.ts`

- [ ] **Step 1: Write failing search visibility and clearing tests**

Add imports and tests to `tests/indexSidebarState.test.ts`:

```ts
test("index search is visible only in List", () => {
    assert.equal(shouldShowIndexSidebarSearch("list"), true);
    for (const mode of ["todo", "agent", "tags", "thought-trail"] as const) {
        assert.equal(shouldShowIndexSidebarSearch(mode), false);
    }
});

test("leaving index List clears visible and applied search", () => {
    const state = { searchInputValue: "odoo", searchQuery: "odoo" };
    assert.deepEqual(resolveIndexSidebarSearchStateForMode(state, "todo"), {
        searchInputValue: "",
        searchQuery: "",
    });
    assert.deepEqual(resolveIndexSidebarSearchStateForMode(state, "list"), state);
});
```

- [ ] **Step 2: Run the index state test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because both helpers are missing.

- [ ] **Step 3: Implement pure index search state helpers**

Add to `src/ui/views/indexSidebarState.ts`:

```ts
export interface IndexSidebarSearchState {
    searchInputValue: string;
    searchQuery: string;
}

export function shouldShowIndexSidebarSearch(mode: IndexSidebarMode): boolean {
    return mode === "list";
}

export function resolveIndexSidebarSearchStateForMode(
    state: IndexSidebarSearchState,
    mode: IndexSidebarMode,
): IndexSidebarSearchState {
    return shouldShowIndexSidebarSearch(mode)
        ? { ...state }
        : { searchInputValue: "", searchQuery: "" };
}
```

- [ ] **Step 4: Add transient index input state and lifecycle**

In `src/ui/views/AsideView.ts`, add fields beside note search state:

```ts
private indexSidebarSearchInputValue = "";
private indexSidebarSearchDebounceTimer: number | null = null;
private indexSidebarSearchRequestVersion = 0;
```

Add `clearIndexSidebarSearchDebounceTimer`, `scheduleIndexSidebarSearchQuery`, `applyIndexSidebarSearchQuery`, and `renderIndexSearchInput` by following the existing note-search lifecycle while using:

```ts
placeholder: "Search side notes in index",
ariaLabel: "Search index side notes",
```

`applyIndexSidebarSearchQuery` must rerender with `skipDataRefresh: true`, restore focus only while the generated index is still active, and retain the input selection when its request version is current.

Use one `clearIndexSidebarSearchState()` helper for Escape, file changes, view close, and mode changes away from List:

```ts
private clearIndexSidebarSearchState(): void {
    this.clearIndexSidebarSearchDebounceTimer();
    this.indexSidebarSearchRequestVersion += 1;
    this.indexSidebarSearchInputValue = "";
    this.indexSidebarSearchQuery = "";
}
```

- [ ] **Step 5: Wire List-only search through the shared toolbar plan**

In `renderSidebarToolbar`, resolve `resolveSidebarSecondaryToolbarPlan(...)`, pass `search: this.renderIndexSearchInput` options only when `showSearch` is true, and remove the manually assembled index secondary-row search path. When index mode changes, call `resolveIndexSidebarSearchStateForMode` and clear the timer before assigning its result.

Keep the existing filtering pipeline unchanged:

```ts
const searchMatchedVisibleThreads = rankThreadsBySidebarSearchQuery(
    tagFilteredScopedVisibleThreads,
    this.indexSidebarSearchQuery,
);
```

- [ ] **Step 6: Run focused search tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/indexSidebarState.test.js .test-dist/tests/sidebarContentFilter.test.js .test-dist/tests/indexFileFilter.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 7: Commit index search restoration**

```bash
git add src/ui/views/indexSidebarState.ts src/ui/views/AsideView.ts tests/indexSidebarState.test.ts
git commit -m "feat: restore index List search"
```

---

### Task 3: Aggregate Deleted Visibility and Global Index Pin Filter

**Files:**
- Modify: `src/index/AggregateCommentIndex.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/views/AsideView.ts`
- Modify: `tests/commentIndexes.test.ts`
- Modify: `tests/sidebarContentFilter.test.ts`

- [ ] **Step 1: Write failing aggregate deleted-query tests**

Extend the deleted test in `tests/commentIndexes.test.ts`:

```ts
assert.deepEqual(
    index.getThreadsForFile("a.md", { includeDeleted: true }).map((thread) => ({
        id: thread.id,
        entryIds: thread.entries.map((entry) => entry.id),
    })),
    [
        { id: "thread-1", entryIds: ["thread-1", "entry-2"] },
        { id: "thread-2", entryIds: ["thread-2"] },
    ],
);
assert.equal(index.getAllThreads({ includeDeleted: true }).length, 2);
```

- [ ] **Step 2: Run the aggregate test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because aggregate query methods accept no options.

- [ ] **Step 3: Add opt-in deleted aggregate queries**

In `src/index/AggregateCommentIndex.ts`, import `CommentQueryOptions`, accept it in `getAllThreads` and `getThreadsForFile`, and mirror the canonical visibility clone:

```ts
getAllThreads(options: CommentQueryOptions = {}): CommentThread[] {
    return Array.from(this.threadsByFile.values())
        .flatMap((threads) => threads)
        .map((thread) => cloneThreadForVisibility(thread, options))
        .filter((thread): thread is CommentThread => thread !== null);
}
```

Change the local clone helper to preserve deleted threads/entries only when `options.includeDeleted` is true. In `src/main.ts`, expose:

```ts
public getAllIndexedThreads(options: { includeDeleted?: boolean } = {}): CommentThread[] {
    return this.aggregateCommentIndex.getAllThreads(options);
}
```

- [ ] **Step 4: Compose index pinned and deleted filters**

In `AsideView.renderComments`, load aggregate threads with `{ includeDeleted: showDeleted }`, apply `matchesPageSidebarVisibility` to index and note surfaces, and compute deleted counts from the include-deleted aggregate set.

Replace the index-only empty pin set:

```ts
const pinnedSidebarThreadIds = this.pinnedSidebarThreadIds;
```

Use `filterThreadsByPinnedSidebarViewState` before Todo/Agent grouping for both surfaces. Let index List/Todo/Agent call the existing `togglePinnedSidebarMode` and a surface-aware `toggleDeletedSidebarMode`; entering deleted mode clears index search and pinned-only state through `toggleDeletedSidebarViewState`.

- [ ] **Step 5: Extend filter tests for canonical global pins**

Add to `tests/sidebarContentFilter.test.ts`:

```ts
test("pinned filtering composes with an aggregate cross-file thread list", () => {
    const threads = [
        createThread("a", ["first"], { filePath: "a.md" }),
        createThread("b", ["second"], { filePath: "b.md" }),
    ];
    assert.deepEqual(
        filterThreadsByPinnedSidebarViewState(threads, new Set(["b"]), true).map((thread) => thread.id),
        ["b"],
    );
});
```

- [ ] **Step 6: Run aggregate and filter tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentIndexes.test.js .test-dist/tests/sidebarContentFilter.test.js .test-dist/tests/sidebarToolbarActionState.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 7: Commit aggregate pin/deleted support**

```bash
git add src/index/AggregateCommentIndex.ts src/main.ts src/ui/views/AsideView.ts tests/commentIndexes.test.ts tests/sidebarContentFilter.test.ts
git commit -m "feat: filter pinned and deleted index cards"
```

---

### Task 4: Shared Index Card Action Capabilities

**Files:**
- Create: `src/ui/views/sidebarCardActionState.ts`
- Modify: `src/ui/views/sidebarPersistedComment.ts`
- Modify: `src/ui/views/AsideView.ts`
- Create: `tests/sidebarCardActionState.test.ts`
- Modify: `tests/sidebarPersistedComment.test.ts`

- [ ] **Step 1: Write failing card capability tests**

Create `tests/sidebarCardActionState.test.ts`:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import { resolveSidebarCardActionState } from "../src/ui/views/sidebarCardActionState";

test("index card tabs expose only valid top-level mutations", () => {
    for (const mode of ["list", "todo", "agent"] as const) {
        assert.deepEqual(resolveSidebarCardActionState("index", mode), {
            showPin: true,
            canEditParent: true,
            canDeleteParent: true,
            enableTopLevelReorder: true,
            enableChildEntryMove: false,
        });
    }
    assert.deepEqual(resolveSidebarCardActionState("index", "thought-trail"), {
        showPin: false,
        canEditParent: false,
        canDeleteParent: false,
        enableTopLevelReorder: false,
        enableChildEntryMove: false,
    });
});

test("note cards retain their current mutation capabilities", () => {
    assert.deepEqual(resolveSidebarCardActionState("note", "list"), {
        showPin: true,
        canEditParent: true,
        canDeleteParent: true,
        enableTopLevelReorder: true,
        enableChildEntryMove: true,
    });
});
```

- [ ] **Step 2: Run the card state test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because `sidebarCardActionState.ts` is missing.

- [ ] **Step 3: Implement the card capability planner**

Create `src/ui/views/sidebarCardActionState.ts` with:

```ts
import type { SidebarPrimaryMode } from "./viewState";

export type SidebarCardSurface = "note" | "index";

export interface SidebarCardActionState {
    showPin: boolean;
    canEditParent: boolean;
    canDeleteParent: boolean;
    enableTopLevelReorder: boolean;
    enableChildEntryMove: boolean;
}

export function resolveSidebarCardActionState(
    surface: SidebarCardSurface,
    mode: SidebarPrimaryMode,
): SidebarCardActionState {
    const isCardMode = mode === "list" || mode === "todo" || mode === "agent" || (surface === "note" && mode === "tags");
    if (!isCardMode) {
        return {
            showPin: false,
            canEditParent: false,
            canDeleteParent: false,
            enableTopLevelReorder: false,
            enableChildEntryMove: false,
        };
    }
    return {
        showPin: true,
        canEditParent: true,
        canDeleteParent: true,
        enableTopLevelReorder: true,
        enableChildEntryMove: surface === "note",
    };
}
```

- [ ] **Step 4: Decouple source redirects from mutation buttons**

Extend `SidebarPersistedCommentHost` with:

```ts
canDeleteEntryInline(entry: CommentThreadEntry): boolean;
enableTopLevelThreadReorder: boolean;
```

In `renderPersistedCommentCard`:

- render the source redirect independently from the pin instead of using `else if`;
- render delete when `host.canDeleteEntryInline(entry)` rather than when source redirects are absent;
- compute top-level drag from `enableTopLevelThreadReorder`, without tying it to source redirects or child-entry movement;
- retain `shouldRenderChildEntryMoveHandle` unchanged so index replies never receive move handles;
- keep footer share/add/retry/move actions suppressed when `showSourceRedirectAction` is true.

The parent action block should follow this structure:

```ts
if (canShowHeaderPinAction) {
    renderPinActionButton(actionsEl, thread.id, host.isPinnedThread(thread.id), host);
}
if (host.showSourceRedirectAction && !comment.deletedAt && !thread.deletedAt) {
    renderSourceRedirectButton(actionsEl, comment, presentation.redirectHint.ariaLabel, presentation.redirectHint.icon, host);
}
if (host.canEditEntryInline(entries[0])) {
    renderEditButton(actionsEl, comment.id, host, "Edit side note");
}
if (host.enableSoftDeleteActions && host.canDeleteEntryInline(entries[0])) {
    renderDeleteButton(actionsEl, comment.id, host, "Delete side note thread");
}
```

- [ ] **Step 5: Add fail-first renderer assertions before adjusting the host**

In `tests/sidebarPersistedComment.test.ts`, add an index host test that expects exactly one pin, redirect, edit, delete, and top-level drag button, then asserts zero child drag and delete buttons. Run it once against the old renderer and confirm missing pin/delete/drag assertions fail.

Use host overrides:

```ts
{
    currentFilePath: "Aside index.md",
    showSourceRedirectAction: true,
    showBookmarkAndPinControls: true,
    enableTopLevelThreadReorder: true,
    enableChildEntryMove: false,
    canEditEntryInline: (entry) => entry.id === "comment-1",
    canDeleteEntryInline: (entry) => entry.id === "comment-1",
}
```

- [ ] **Step 6: Wire capabilities from `AsideView`**

Resolve `SidebarCardActionState` from `isIndexView` and the effective mode. Pass:

```ts
showBookmarkAndPinControls: cardActions.showPin,
enableTopLevelThreadReorder: cardActions.enableTopLevelReorder,
enableChildEntryMove: cardActions.enableChildEntryMove,
canEditEntryInline: (entry) => (
    cardActions.canEditParent && entry.id === thread.id
) || (
    isIndexView && canInlineEditTodoEntries && entryMatchesSidebarTodo(entry)
),
canDeleteEntryInline: (entry) => cardActions.canDeleteParent && entry.id === thread.id,
```

This preserves the previously shipped exact-entry Todo edit exception while adding parent edit to all three card modes.

- [ ] **Step 7: Run card tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarCardActionState.test.js .test-dist/tests/sidebarPersistedComment.test.js .test-dist/tests/commentMutationController.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 8: Commit shared card actions**

```bash
git add src/ui/views/sidebarCardActionState.ts src/ui/views/sidebarPersistedComment.ts src/ui/views/AsideView.ts tests/sidebarCardActionState.test.ts tests/sidebarPersistedComment.test.ts
git commit -m "feat: expose valid index card actions"
```

---

### Task 5: Canonical Per-File Index Order and Same-File Drag

**Files:**
- Create: `src/ui/views/sidebarIndexReorder.ts`
- Modify: `src/ui/views/sidebarRenderOrder.ts`
- Modify: `src/ui/views/AsideView.ts`
- Create: `tests/sidebarIndexReorder.test.ts`
- Modify: `tests/sidebarRenderOrder.test.ts`

- [ ] **Step 1: Write failing same-file drop tests**

Create `tests/sidebarIndexReorder.test.ts`:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import { canDropIndexThreadOnThread } from "../src/ui/views/sidebarIndexReorder";

test("index thread drag accepts only a different thread from the same source file", () => {
    const source = { id: "a", filePath: "docs/source.md" };
    assert.equal(canDropIndexThreadOnThread(source, { id: "b", filePath: "docs/source.md" }), true);
    assert.equal(canDropIndexThreadOnThread(source, { id: "a", filePath: "docs/source.md" }), false);
    assert.equal(canDropIndexThreadOnThread(source, { id: "c", filePath: "docs/other.md" }), false);
});
```

- [ ] **Step 2: Write failing stored-order rendering test**

Add to `tests/sidebarRenderOrder.test.ts`:

```ts
test("index order groups files while preserving canonical order within each file", () => {
    const items: SidebarRenderableItem[] = [
        { kind: "thread", thread: commentToThread(createComment({ id: "b-2", filePath: "b.md", timestamp: 200 })) },
        { kind: "thread", thread: commentToThread(createComment({ id: "a-2", filePath: "a.md", timestamp: 200 })) },
        { kind: "thread", thread: commentToThread(createComment({ id: "a-1", filePath: "a.md", timestamp: 100 })) },
        { kind: "thread", thread: commentToThread(createComment({ id: "b-1", filePath: "b.md", timestamp: 100 })) },
    ];

    assert.deepEqual(sortSidebarRenderableItems(items).map((item) => (
        item.kind === "thread" ? item.thread.id : item.draft.id
    )), ["a-2", "a-1", "b-2", "b-1"]);
});
```

Update the older same-file timestamp-order assertion to state that the aggregate's input order is canonical and must remain stable.

- [ ] **Step 3: Run reorder tests and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because `sidebarIndexReorder.ts` is missing.

- [ ] **Step 4: Implement pure eligibility and stable per-file order**

Create `src/ui/views/sidebarIndexReorder.ts`:

```ts
export interface IndexReorderThreadIdentity {
    id: string;
    filePath: string;
}

export function canDropIndexThreadOnThread(
    source: IndexReorderThreadIdentity,
    target: IndexReorderThreadIdentity,
): boolean {
    return source.id !== target.id && source.filePath === target.filePath;
}
```

In `sidebarRenderOrder.ts`, keep folder/file comparison but return `0` for two items from the same file. Modern JavaScript sort is stable, so canonical/search order within the file remains intact:

```ts
if (left.filePath !== right.filePath) {
    return left.filePath.localeCompare(right.filePath);
}
return 0;
```

Build index renderable items with `buildStoredOrderSidebarItems(...)` before file grouping so an inline edit draft replaces its thread in place.

- [ ] **Step 5: Add the index-specific DOM drop adapter**

In `AsideView`, add `resolveIndexThreadDropTarget(event)` that:

1. requires a top-level thread drag state;
2. resolves the target `.aside-thread-stack[data-thread-id]`;
3. loads both canonical threads;
4. calls `canDropIndexThreadOnThread`;
5. returns the target element, target id, and before/after placement only when allowed.

Update `setupPageThreadReorderInteractions` to accept a surface:

```ts
private setupPageThreadReorderInteractions(
    commentsBody: HTMLDivElement,
    filePath: string,
    surface: "note" | "index" = "note",
): void
```

For the index surface, dragover/drop consult only `resolveIndexThreadDropTarget`; they never call thread nesting or child-entry target resolution. On drop, call existing canonical persistence:

```ts
void this.plugin.reorderThreadsForFile(
    dragState.filePath,
    dragState.threadId,
    target.targetId,
    target.placement,
);
```

- [ ] **Step 6: Run reorder and persistence tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarIndexReorder.test.js .test-dist/tests/sidebarRenderOrder.test.js .test-dist/tests/commentManager.idTargeting.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 7: Commit same-file index reorder**

```bash
git add src/ui/views/sidebarIndexReorder.ts src/ui/views/sidebarRenderOrder.ts src/ui/views/AsideView.ts tests/sidebarIndexReorder.test.ts tests/sidebarRenderOrder.test.ts
git commit -m "feat: reorder index cards within source files"
```

---

### Task 6: Complete Toolbar Wiring and Responsive Styling

**Files:**
- Modify: `src/ui/views/AsideView.ts`
- Modify: `styles.css`
- Modify: `tests/sidebarToolbarActionState.test.ts`
- Modify: `tests/toolbarDisabledStyles.test.mjs`

- [ ] **Step 1: Write failing CSS and action-state checks**

Extend `tests/toolbarDisabledStyles.test.mjs` with assertions that:

```js
assert.match(styles, /\.aside-sidebar-toolbar-row\.is-index-secondary-row[^}]*flex-wrap:\s*nowrap/s);
assert.match(styles, /\.aside-sidebar-toolbar-row\.is-index-secondary-row[^}]*min-width:\s*0/s);
assert.match(styles, /\.aside-sidebar-toolbar-row\.is-index-secondary-row[\s\S]*\.is-search-group/);
```

Extend the toolbar state test so pinned/deleted exclusivity applies to index card modes while Add page note remains absent.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test tests/toolbarDisabledStyles.test.mjs
```

Expected: FAIL because the index shared-row contract is not present.

- [ ] **Step 3: Replace manual toolbar row assembly in `AsideView`**

Import and call `renderSidebarSecondaryToolbar`. Build optional control models from `SidebarSecondaryToolbarPlan`:

```ts
const secondaryPlan = resolveSidebarSecondaryToolbarPlan({
    surface: options.isAllCommentsView ? "index" : "note",
    mode: activePrimaryMode,
    hasNestedComments: options.hasNestedComments,
    hasFileFilterOptions: options.indexFileFilterOptions.length > 0,
    hasAddPageCommentAction: !!options.addPageCommentAction,
});
```

Use the existing icon names and labels:

- file filter: `list-filter`, `Filter index by files`;
- pinned: `pin`, `Show pinned side notes` / `Show all side notes`;
- nested: `chevrons-down` / `chevrons-up`;
- deleted: `trash-2`, `Show deleted notes` / `Hide deleted notes`;
- add page note: existing callback and label.

Do not render Add page note for an index plan. Preserve tag-filter and batch-tag rows after the shared secondary row.

- [ ] **Step 4: Add compact shared index CSS**

Adjust `styles.css` so `.is-index-secondary-row` matches the note search row's flex behavior:

```css
.aside-sidebar-toolbar-row.is-index-secondary-row {
    justify-content: flex-start;
    flex-wrap: nowrap;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    gap: 6px;
    align-items: center;
}

.aside-sidebar-toolbar-row.is-index-secondary-row .aside-sidebar-toolbar-group.is-filter-group {
    flex: 1 1 0;
    min-width: 0;
}

.aside-sidebar-toolbar-row.is-index-secondary-row .aside-sidebar-toolbar-group.is-action-group {
    flex: 0 0 auto;
    margin-left: auto;
}
```

At the existing narrow container breakpoint, hide the index `.is-search-group` before hiding valid action buttons, exactly as the note row does.

- [ ] **Step 5: Run toolbar, renderer, and CSS tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarToolbarActionState.test.js .test-dist/tests/sidebarPersistedComment.test.js
node --test tests/toolbarDisabledStyles.test.mjs
npm run lint
npm run typecheck
```

Expected: all checks PASS with zero lint warnings.

- [ ] **Step 6: Commit complete shared toolbar wiring**

```bash
git add src/ui/views/AsideView.ts styles.css tests/sidebarToolbarActionState.test.ts tests/toolbarDisabledStyles.test.mjs
git commit -m "feat: share index toolbar controls"
```

---

### Task 7: Full Verification, Spec Tracking, and Installed Smoke Check

**Files:**
- Modify: `docs/superpowers/specs/2026-08-09-index-sidebar-list-search-design.md`

- [ ] **Step 1: Run change-surface and whitespace audits**

Run:

```bash
git diff --check main...HEAD
rg -n "is-index-secondary-row|is-note-secondary-row|showSourceRedirectAction|enableTopLevelThreadReorder|indexSidebarSearch" src tests styles.css
```

Expected: no whitespace errors; row composition has one shared renderer; remaining surface branches are capability adapters or tests.

- [ ] **Step 2: Run the complete production build**

Run:

```bash
npm run build
```

Expected: all TypeScript and repository tests pass, ESLint and typecheck pass, Obsidian compliance passes, production bundling succeeds, and `release:artifacts:check` reports only `main.js`, `manifest.json`, and `styles.css`.

- [ ] **Step 3: Inspect the exact shipping artifacts**

Run:

```bash
find . -maxdepth 1 -type f \( -name 'main.js' -o -name 'manifest.json' -o -name 'styles.css' -o -name 'main.js.map' \) -print | sort
test ! -e main.js.map
rg -n "sourceMappingURL|sourcesContent|/Users/|[A-Za-z]:\\\\Users\\\\|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY" main.js manifest.json styles.css
shasum -a 256 main.js manifest.json styles.css
```

Expected: exactly the three public assets; all exposure searches return no matches; hashes are recorded for the handoff.

- [ ] **Step 4: Install and compare the verified build**

Run:

```bash
node scripts/install-built-plugin.mjs --vault /Users/wenqingli/Obsidian/lean-startup
cmp -s main.js /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/main.js
cmp -s manifest.json /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json
cmp -s styles.css /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css
obsidian vault=lean-startup plugin:disable id=aside
obsidian vault=lean-startup plugin:enable id=aside
```

Expected: all comparisons exit 0 and Aside is enabled again.

- [ ] **Step 5: Smoke-check the real index sidebar**

In `lean-startup`, confirm:

1. List shows file filter, search, pin filter, nested, and deleted controls in one compact row.
2. Todo and Agent omit search but retain valid action controls.
3. Thought Trail omits card actions.
4. List search filters, ranks, highlights, reveals nested matches, clears on Escape, and clears when leaving List.
5. Parent cards in List/Todo/Agent show Pin, source redirect, Edit, Delete, and Drag.
6. Pin and deleted filters update the aggregate view.
7. Same-file drag persists after rerender; a cross-file drag has no indicator and does nothing.
8. Child entries have no index drag handle.

- [ ] **Step 6: Update tracked spec checkboxes using evidence**

Mark implemented `### To Implement` items `[x]` only after their focused/full verification passes. Mark the installed smoke item `[x]` only after all eight observations above pass. Leave any blocked manual observation unchecked with a dated explanation.

- [ ] **Step 7: Commit verification tracking**

```bash
git add -f docs/superpowers/specs/2026-08-09-index-sidebar-list-search-design.md
git commit -m "docs: record index shared controls verification"
```

- [ ] **Step 8: Review the complete branch**

Run:

```bash
git diff --stat main...HEAD
git diff --check main...HEAD
git status --short
```

Review for critical, important, and minor findings across toolbar capability ownership, hidden search state, canonical mutation routing, deleted visibility, same-file drop validation, stable ordering, responsive layout, and release artifact exposure. Fix every critical or important finding with a regression test before declaring completion.
