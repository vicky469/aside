# Bounded Index Search Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep exact global index search responsive by retaining only the true top 100 unscoped matches and reconciling index cards through the same keyed DOM boundary as the individual-file sidebar.

**Architecture:** Keep `sidebarContentFilter.ts` as the exact ranking owner and add a bounded result API that is provably equivalent to complete ranking. Extract the existing keyed card reconciler from `AsideView`, then give index card modes a mounted shell that feeds surface-specific descriptors into that shared reconciler. Preserve file-scoped complete results and fall back to file-only search only if the installed performance gate fails.

**Tech Stack:** TypeScript, Obsidian plugin API, Node test runner, fake DOM test harnesses, esbuild.

**Associated spec:** `docs/superpowers/specs/2026-08-09-index-sidebar-bounded-global-search-performance-design.md`

---

## File Structure

- Modify `src/ui/views/sidebarContentFilter.ts` to own complete and bounded exact ranking.
- Modify `tests/sidebarContentFilter.test.ts` to prove bounded ranking is exactly equivalent to complete ranking.
- Create `src/ui/views/sidebarItemReconciler.ts` as the shared keyed DOM reconciliation owner.
- Create `tests/sidebarItemReconciler.test.ts` for node identity, render-call, ordering, removal, and cancellation behavior.
- Modify `src/ui/views/indexSidebarState.ts` to decide when the global result window applies.
- Modify `src/ui/views/indexSidebarListLimit.ts` to produce ordinary-list and global-search notice models.
- Modify `tests/indexSidebarState.test.ts` and `tests/indexSidebarListLimit.test.ts` for scope and notice behavior.
- Modify `src/ui/views/AsideView.ts` to reuse shared descriptors/reconciliation, keep an index card shell mounted, apply the bounded result, and reject stale commits.
- Modify `tests/sidebarPageRenderSignature.test.ts` and `tests/sidebarToolbarComposition.test.mjs` for representative shared wiring contracts.
- Modify the associated spec only after implementation and verification evidence exists.

---

### Task 1: Exact Bounded Ranking

**Files:**
- Modify: `src/ui/views/sidebarContentFilter.ts`
- Modify: `tests/sidebarContentFilter.test.ts`

- [ ] **Step 1: Write failing bounded-ranking tests**

Extend `tests/sidebarContentFilter.test.ts` to import `rankSidebarSearchResults` and add:

```ts
test("bounded sidebar search returns the exact stable top results and complete count", () => {
    const threads = Array.from({ length: 137 }, (_, index) => createThread({
        id: `thread-${index}`,
        selectedText: index % 7 === 0 ? "architecture" : `section ${index}`,
        entries: [{
            id: `entry-${index}`,
            body: index % 3 === 0 ? "architecture" : `architecture note ${index % 11}`,
            timestamp: 100 + index,
        }],
    }));
    const complete = rankThreadsBySidebarSearchQuery(threads, "architecture");

    const bounded = rankSidebarSearchResults(threads, "architecture", { limit: 100 });

    assert.deepEqual(bounded.items.map((thread) => thread.id), complete.slice(0, 100).map((thread) => thread.id));
    assert.equal(bounded.totalMatchCount, complete.length);
    assert.equal(bounded.hiddenMatchCount, complete.length - 100);
});

test("bounded sidebar search preserves input order when scores tie", () => {
    const threads = Array.from({ length: 5 }, (_, index) => createThread({
        id: `thread-${index}`,
        entries: [{
            id: `entry-${index}`,
            body: "same architecture body",
            timestamp: 100 + index,
        }],
    }));

    assert.deepEqual(
        rankSidebarSearchResults(threads, "architecture", { limit: 3 }).items.map((thread) => thread.id),
        ["thread-0", "thread-1", "thread-2"],
    );
});

test("bounded sidebar search handles empty and zero-sized windows", () => {
    const threads = [
        createThread({
            id: "a",
            entries: [{ id: "entry-a", body: "alpha", timestamp: 100 }],
        }),
        createThread({
            id: "b",
            entries: [{ id: "entry-b", body: "beta", timestamp: 101 }],
        }),
    ];

    assert.deepEqual(rankSidebarSearchResults(threads, "", { limit: 1 }), {
        items: [threads[0]],
        totalMatchCount: 2,
        hiddenMatchCount: 1,
    });
    assert.deepEqual(rankSidebarSearchResults(threads, "a", { limit: 0 }), {
        items: [],
        totalMatchCount: 2,
        hiddenMatchCount: 2,
    });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because `rankSidebarSearchResults` is not exported.

- [ ] **Step 3: Implement the bounded result API**

Add beside `rankThreadsBySidebarSearchQuery` in `src/ui/views/sidebarContentFilter.ts`:

```ts
export interface RankedSidebarSearchResult<T> {
    items: T[];
    totalMatchCount: number;
    hiddenMatchCount: number;
}

interface RankedSidebarSearchCandidate<T> {
    thread: T;
    index: number;
    score: number;
}

function compareRankedSidebarSearchCandidates<T>(
    left: RankedSidebarSearchCandidate<T>,
    right: RankedSidebarSearchCandidate<T>,
): number {
    return right.score - left.score || left.index - right.index;
}

function findSidebarSearchInsertionIndex<T>(
    candidates: readonly RankedSidebarSearchCandidate<T>[],
    candidate: RankedSidebarSearchCandidate<T>,
): number {
    let low = 0;
    let high = candidates.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (compareRankedSidebarSearchCandidates(candidate, candidates[middle]) < 0) {
            high = middle;
        } else {
            low = middle + 1;
        }
    }
    return low;
}

export function rankSidebarSearchResults<
    T extends Pick<CommentThread, "selectedText" | "entries">
>(
    threads: readonly T[],
    query: string,
    options: { limit?: number } = {},
): RankedSidebarSearchResult<T> {
    const normalizedQuery = normalizeSidebarSearchText(query);
    const limit = options.limit === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Math.floor(options.limit));
    if (!normalizedQuery) {
        const items = Number.isFinite(limit) ? threads.slice(0, limit) : threads.slice();
        return {
            items,
            totalMatchCount: threads.length,
            hiddenMatchCount: threads.length - items.length,
        };
    }

    const candidates: Array<RankedSidebarSearchCandidate<T>> = [];
    let totalMatchCount = 0;
    threads.forEach((thread, index) => {
        const score = getSidebarThreadSearchScore(thread, normalizedQuery);
        if (score <= 0) {
            return;
        }
        totalMatchCount += 1;
        const candidate = { thread, index, score };
        if (!Number.isFinite(limit)) {
            candidates.push(candidate);
            return;
        }
        const insertionIndex = findSidebarSearchInsertionIndex(candidates, candidate);
        if (insertionIndex >= limit) {
            return;
        }
        candidates.splice(insertionIndex, 0, candidate);
        if (candidates.length > limit) {
            candidates.pop();
        }
    });
    if (!Number.isFinite(limit)) {
        candidates.sort(compareRankedSidebarSearchCandidates);
    }
    return {
        items: candidates.map((candidate) => candidate.thread),
        totalMatchCount,
        hiddenMatchCount: Math.max(0, totalMatchCount - candidates.length),
    };
}
```

Change the existing wrapper to consume the shared owner:

```ts
export function rankThreadsBySidebarSearchQuery<
    T extends Pick<CommentThread, "selectedText" | "entries">
>(threads: readonly T[], query: string): T[] {
    return rankSidebarSearchResults(threads, query).items;
}
```

- [ ] **Step 4: Run RED-to-GREEN verification**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarContentFilter.test.js
```

Expected: all sidebar content-filter tests PASS.

- [ ] **Step 5: Commit bounded exact ranking**

```bash
git add src/ui/views/sidebarContentFilter.ts tests/sidebarContentFilter.test.ts
git commit -m "perf: bound exact sidebar search results"
```

---

### Task 2: Shared Keyed Card Reconciler

**Files:**
- Create: `src/ui/views/sidebarItemReconciler.ts`
- Create: `tests/sidebarItemReconciler.test.ts`

- [ ] **Step 1: Write failing shared-reconciler tests**

Create `tests/sidebarItemReconciler.test.ts` with a small fake element implementing `children`, `dataset`, `classList.contains`, `insertBefore`, and `remove`. Import `reconcileSidebarItems` and prove these behaviors in separate tests:

```ts
test("reconcileSidebarItems reuses unchanged keyed nodes and renders only changed nodes", async () => {
    const existing = createNode("thread:a", "same");
    const changed = createNode("thread:b", "old");
    const container = createContainer([existing, changed]);
    let renderCount = 0;

    const completed = await reconcileSidebarItems(container, [
        descriptor("thread:a", "same", async () => createNode("unused", "unused")),
        descriptor("thread:b", "new", async () => {
            renderCount += 1;
            return createNode("thread:b", "new");
        }),
    ]);

    assert.equal(completed, true);
    assert.equal(container.children[0], existing);
    assert.equal(renderCount, 1);
});

test("reconcileSidebarItems reorders retained nodes and removes obsolete nodes", async () => {
    const first = createNode("thread:a", "same");
    const second = createNode("thread:b", "same");
    const obsolete = createNode("thread:c", "same");
    const container = createContainer([first, second, obsolete]);
    const removedThreadIds: string[] = [];

    await reconcileSidebarItems(container, [
        descriptor("thread:b", "same"),
        descriptor("thread:a", "same"),
    ], {
        onRemoveThread: (threadId) => removedThreadIds.push(threadId),
    });

    assert.deepEqual(container.children, [second, first]);
    assert.equal(obsolete.isConnected, false);
    assert.deepEqual(removedThreadIds, ["c"]);
});

test("reconcileSidebarItems leaves mounted nodes untouched when superseded", async () => {
    const existing = createNode("thread:a", "old");
    const container = createContainer([existing]);
    let current = true;

    const completed = await reconcileSidebarItems(container, [
        descriptor("thread:a", "new", async () => {
            current = false;
            return createNode("thread:a", "new");
        }),
    ], { isCurrent: () => current });

    assert.equal(completed, false);
    assert.deepEqual(container.children, [existing]);
});
```

The fake must keep `parentElement` and `isConnected` current so the tests exercise real reconciliation decisions rather than mocks of callback counts alone.

- [ ] **Step 2: Run the focused compile and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because `src/ui/views/sidebarItemReconciler.ts` does not exist.

- [ ] **Step 3: Implement the generic reconciler**

Create `src/ui/views/sidebarItemReconciler.ts`:

```ts
export interface SidebarItemRenderDescriptor {
    key: string;
    signature: string;
    threadId: string | null;
    render(): Promise<HTMLElement>;
}

export interface SidebarItemReconcilerOptions {
    isCurrent?(): boolean;
    onRemoveThread?(threadId: string): void;
}

export async function reconcileSidebarItems(
    container: HTMLElement,
    descriptors: readonly SidebarItemRenderDescriptor[],
    options: SidebarItemReconcilerOptions = {},
): Promise<boolean> {
    const isCurrent = options.isCurrent ?? (() => true);
    const existingByKey = new Map<string, HTMLElement>();
    for (const child of Array.from(container.children) as HTMLElement[]) {
        const key = child.dataset.asideRenderKey;
        if (key) {
            existingByKey.set(key, child);
        }
    }

    const desiredNodes: HTMLElement[] = [];
    const replacedThreadIds: string[] = [];
    for (const descriptor of descriptors) {
        if (!isCurrent()) {
            return false;
        }
        const existing = existingByKey.get(descriptor.key) ?? null;
        existingByKey.delete(descriptor.key);
        if (existing?.dataset.asideRenderSignature === descriptor.signature) {
            desiredNodes.push(existing);
            continue;
        }
        const nextNode = await descriptor.render();
        if (!isCurrent()) {
            return false;
        }
        nextNode.dataset.asideRenderKey = descriptor.key;
        nextNode.dataset.asideRenderSignature = descriptor.signature;
        desiredNodes.push(nextNode);
        if (descriptor.threadId && existing) {
            replacedThreadIds.push(descriptor.threadId);
        }
    }
    if (!isCurrent()) {
        return false;
    }

    for (const threadId of replacedThreadIds) {
        options.onRemoveThread?.(threadId);
    }
    for (const [key, element] of existingByKey) {
        if (key.startsWith("thread:")) {
            options.onRemoveThread?.(key.slice("thread:".length));
        }
        element.remove();
    }
    desiredNodes.forEach((node, index) => {
        const currentNode = container.children.item(index);
        if (currentNode !== node) {
            container.insertBefore(node, currentNode ?? null);
        }
    });
    const desiredNodeSet = new Set(desiredNodes);
    for (const child of Array.from(container.children) as HTMLElement[]) {
        if (!desiredNodeSet.has(child)) {
            child.remove();
        }
    }
    return true;
}
```

- [ ] **Step 4: Run reconciler tests and typecheck**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarItemReconciler.test.js
npm run typecheck
```

Expected: all reconciler tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the shared owner**

```bash
git add src/ui/views/sidebarItemReconciler.ts tests/sidebarItemReconciler.test.ts
git commit -m "refactor: share sidebar item reconciliation"
```

---

### Task 3: Global Window and Notice Policy

**Files:**
- Modify: `src/ui/views/indexSidebarState.ts`
- Modify: `src/ui/views/indexSidebarListLimit.ts`
- Modify: `tests/indexSidebarState.test.ts`
- Modify: `tests/indexSidebarListLimit.test.ts`

- [ ] **Step 1: Write failing scope and notice tests**

Add to `tests/indexSidebarState.test.ts`:

```ts
test("global search uses the index list limit only for nonempty unscoped List queries", () => {
    assert.equal(resolveIndexSidebarSearchResultLimit({ mode: "list", rootFilePath: null, query: "design" }), 100);
    assert.equal(resolveIndexSidebarSearchResultLimit({ mode: "list", rootFilePath: "docs/a.md", query: "design" }), undefined);
    assert.equal(resolveIndexSidebarSearchResultLimit({ mode: "list", rootFilePath: null, query: "   " }), undefined);
    assert.equal(resolveIndexSidebarSearchResultLimit({ mode: "todo", rootFilePath: null, query: "design" }), undefined);
});
```

Add to `tests/indexSidebarListLimit.test.ts`:

```ts
test("buildIndexSidebarLimitNotice distinguishes global search from the ordinary list window", () => {
    assert.deepEqual(buildIndexSidebarLimitNotice({
        visibleCount: 100,
        hiddenCount: 37,
        totalCount: 137,
        hasSearchQuery: true,
        hasFileScope: false,
    }), {
        primary: "100 of 137 matches shown.",
        secondary: "Refine your search or select a file.",
    });
    assert.deepEqual(buildIndexSidebarLimitNotice({
        visibleCount: 100,
        hiddenCount: 37,
        totalCount: 137,
        hasSearchQuery: false,
        hasFileScope: false,
    }), {
        primary: "100 shown, 37 hidden.",
        secondary: "Use files to filter the index to see more.",
    });
});
```

- [ ] **Step 2: Run the focused compile and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because both new policy helpers are missing.

- [ ] **Step 3: Implement the pure policies**

In `src/ui/views/indexSidebarState.ts`, import `INDEX_SIDEBAR_LIST_LIMIT` and add:

```ts
export function resolveIndexSidebarSearchResultLimit(options: {
    mode: IndexSidebarMode;
    rootFilePath: string | null | undefined;
    query: string;
}): number | undefined {
    return options.mode === "list"
        && !getNormalizedFilterPath(options.rootFilePath ?? "")
        && !!options.query.trim()
        ? INDEX_SIDEBAR_LIST_LIMIT
        : undefined;
}
```

In `src/ui/views/indexSidebarListLimit.ts`, add:

```ts
export interface IndexSidebarLimitNotice {
    primary: string;
    secondary: string;
}

export function buildIndexSidebarLimitNotice(options: {
    visibleCount: number;
    hiddenCount: number;
    totalCount: number;
    hasSearchQuery: boolean;
    hasFileScope: boolean;
}): IndexSidebarLimitNotice | null {
    if (options.hiddenCount <= 0) {
        return null;
    }
    if (options.hasSearchQuery && !options.hasFileScope) {
        return {
            primary: `${options.visibleCount} of ${options.totalCount} matches shown.`,
            secondary: "Refine your search or select a file.",
        };
    }
    return {
        primary: `${options.visibleCount} shown, ${options.hiddenCount} hidden.`,
        secondary: "Use files to filter the index to see more.",
    };
}
```

- [ ] **Step 4: Run policy tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/indexSidebarState.test.js .test-dist/tests/indexSidebarListLimit.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 5: Commit global-window policy**

```bash
git add src/ui/views/indexSidebarState.ts src/ui/views/indexSidebarListLimit.ts tests/indexSidebarState.test.ts tests/indexSidebarListLimit.test.ts
git commit -m "perf: bound unscoped index search"
```

---

### Task 4: Move the Note Sidebar onto the Shared Reconciler

**Files:**
- Modify: `src/ui/views/AsideView.ts`
- Modify: `tests/sidebarPageRenderSignature.test.ts`
- Modify: `tests/sidebarToolbarComposition.test.mjs`

- [ ] **Step 1: Write a failing representative wiring assertion**

Extend `tests/sidebarToolbarComposition.test.mjs`:

```js
test("note and index card lists consume the shared item reconciler", () => {
    assert.match(asideViewSource, /reconcileSidebarItems\(/u);
    assert.doesNotMatch(asideViewSource, /private async reconcileNoteSidebarItems\(/u);
});
```

Add a render-signature assertion proving search text itself does not invalidate a card when nested visibility is already unchanged; retain the existing test that a false-to-true nested visibility change does invalidate it.

- [ ] **Step 2: Run the wiring test and verify RED**

Run:

```bash
node --test tests/sidebarToolbarComposition.test.mjs
```

Expected: FAIL because `AsideView` still owns `reconcileNoteSidebarItems`.

- [ ] **Step 3: Generalize descriptors and use the shared reconciler**

In `src/ui/views/AsideView.ts`:

1. Import `reconcileSidebarItems` and `SidebarItemRenderDescriptor`.
2. Delete the local `NoteSidebarRenderDescriptor` type.
3. Rename `buildNoteSidebarRenderDescriptors` to `buildSidebarRenderDescriptors` and return `SidebarItemRenderDescriptor[]`.
4. Add `sidebarMode: SidebarPrimaryMode` to its options and pass it as the final argument to `renderPersistedComment`.
5. Replace the note call with:

```ts
const completed = await reconcileSidebarItems(shell.commentsBodyEl, renderDescriptors, {
    isCurrent: () => renderVersion === this.renderVersion && this.file?.path === file.path,
    onRemoveThread: (threadId) => this.removeStreamedReplyController(threadId),
});
if (!completed) {
    return;
}
```

6. Delete `reconcileNoteSidebarItems` from `AsideView`.

Keep empty-state cleanup outside the reconciler: `renderPageSidebarEmptyState` remains responsible for removing and recreating `.aside-empty-state` after card reconciliation.

- [ ] **Step 4: Run note-sidebar regression tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarPageRenderSignature.test.js .test-dist/tests/sidebarRenderOrder.test.js .test-dist/tests/sidebarPersistedComment.test.js
node --test tests/sidebarToolbarComposition.test.mjs
npm run typecheck
```

Expected: all focused tests PASS.

- [ ] **Step 5: Commit note migration**

```bash
git add src/ui/views/AsideView.ts tests/sidebarPageRenderSignature.test.ts tests/sidebarToolbarComposition.test.mjs
git commit -m "refactor: reconcile note cards through shared path"
```

---

### Task 5: Mounted Index Card Shell and Bounded Search Wiring

**Files:**
- Modify: `src/ui/views/AsideView.ts`
- Modify: `tests/sidebarToolbarComposition.test.mjs`
- Modify: `tests/indexSidebarState.test.ts`

- [ ] **Step 1: Add failing index wiring assertions**

Extend `tests/sidebarToolbarComposition.test.mjs`:

```js
test("index card search uses bounded ranking and shared reconciliation", () => {
    assert.match(asideViewSource, /resolveIndexSidebarSearchResultLimit\(/u);
    assert.match(asideViewSource, /rankSidebarSearchResults\(/u);
    assert.match(asideViewSource, /ensureIndexSidebarShell\(/u);
    assert.doesNotMatch(asideViewSource, /const renderPromises = renderedItems\.map/u);
});
```

Run it before production edits and confirm the missing bounded/shell assertions fail.

- [ ] **Step 2: Add a stable index shell**

Add beside `NoteSidebarShell`:

```ts
type IndexSidebarShell = {
    filePath: string;
    commentsContainerEl: HTMLDivElement;
    toolbarSlotEl: HTMLDivElement;
    activeFiltersSlotEl: HTMLDivElement;
    commentsBodyEl: HTMLDivElement;
    limitNoticeSlotEl: HTMLDivElement;
    supportSlotEl: HTMLDivElement;
};
```

Add `private indexSidebarShell: IndexSidebarShell | null = null;` and implement:

```ts
private ensureIndexSidebarShell(filePath: string): IndexSidebarShell {
    if (
        this.indexSidebarShell?.filePath === filePath
        && this.indexSidebarShell.commentsContainerEl.isConnected
        && this.indexSidebarShell.commentsBodyEl.isConnected
    ) {
        this.syncViewContainerClasses();
        return this.indexSidebarShell;
    }
    this.indexSidebarShell = null;
    this.resetStreamedReplyControllers();
    this.containerEl.empty();
    this.syncViewContainerClasses();
    const commentsContainerEl = this.containerEl.createDiv("aside-comments-container is-index-sidebar");
    const toolbarSlotEl = commentsContainerEl.createDiv("aside-index-sidebar-toolbar-slot");
    const activeFiltersSlotEl = commentsContainerEl.createDiv("aside-index-sidebar-active-filters-slot");
    const commentsBodyEl = this.renderCommentsList(commentsContainerEl);
    this.setupPageThreadReorderInteractions(commentsBodyEl, filePath, "index");
    const limitNoticeSlotEl = commentsContainerEl.createDiv("aside-index-sidebar-limit-notice-slot");
    const supportSlotEl = this.containerEl.createDiv("aside-support-button-slot");
    this.indexSidebarShell = {
        filePath,
        commentsContainerEl,
        toolbarSlotEl,
        activeFiltersSlotEl,
        commentsBodyEl,
        limitNoticeSlotEl,
        supportSlotEl,
    };
    return this.indexSidebarShell;
}
```

Reset `indexSidebarShell` on file changes, teardown, no-file rendering, and before Thought Trail's distinct full render. Reset it when entering a normal note, just as entering the index resets `noteSidebarShell`.

- [ ] **Step 3: Apply bounded exact ranking**

Replace the two index `rankThreadsBySidebarSearchQuery` calls with:

```ts
const indexSearchResultLimit = resolveIndexSidebarSearchResultLimit({
    mode: effectiveIndexSidebarMode,
    rootFilePath: selectedIndexFileFilterRootPath,
    query: this.indexSidebarSearchQuery,
});
const searchMatchedVisibleResult = rankSidebarSearchResults(
    tagFilteredScopedVisibleThreads,
    this.indexSidebarSearchQuery,
    { limit: indexSearchResultLimit },
);
const searchMatchedAllResult = rankSidebarSearchResults(
    tagFilteredScopedAllThreads,
    this.indexSidebarSearchQuery,
    { limit: indexSearchResultLimit },
);
const searchMatchedVisibleThreads = searchMatchedVisibleResult.items;
const searchMatchedAllThreads = searchMatchedAllResult.items;
```

Set `totalScopedCount` from `searchMatchedAllResult.totalMatchCount`. Carry `searchMatchedVisibleResult.hiddenMatchCount` into the final notice model. File-scoped search receives `limit: undefined` and remains complete.

- [ ] **Step 4: Reconcile index card descriptors instead of rebuilding cards**

After the Thought Trail early-return branch, call `ensureIndexSidebarShell(file.path)`, empty only its toolbar/active-filter/notice slots, and render toolbar/filter chrome into those slots. Build descriptors with:

```ts
const renderDescriptors = this.buildSidebarRenderDescriptors(renderedItems, {
    allAgentRuns,
    allScriptRuns,
    enablePageThreadReorder: true,
    nestedEditDraftThreadId,
    nestedAppendDraftThreadId,
    visibleDraftComment,
    enableTagSelection: false,
    searchQuery: this.indexSidebarSearchQuery,
    sidebarMode: effectiveIndexSidebarMode,
});
const indexSearchRequestVersion = this.indexSidebarSearchRequestVersion;
const completed = await reconcileSidebarItems(shell.commentsBodyEl, renderDescriptors, {
    isCurrent: () => (
        renderVersion === this.renderVersion
        && this.file?.path === file.path
        && indexSearchRequestVersion === this.indexSidebarSearchRequestVersion
    ),
    onRemoveThread: (threadId) => this.removeStreamedReplyController(threadId),
});
if (!completed) {
    return;
}
```

Delete the direct `renderedItems.map(...renderPersistedComment...)` and its `Promise.all`. Run highlights and empty-state rendering only after reconciliation returns `true`.

- [ ] **Step 5: Render the correct result-window notice**

Combine the ordinary empty-query window and the bounded search window into one notice call:

```ts
const notice = buildIndexSidebarLimitNotice({
    visibleCount: renderedItems.length,
    hiddenCount: searchMatchedVisibleResult.hiddenMatchCount || limitedComments.hiddenCount,
    totalCount: searchMatchedVisibleResult.totalMatchCount,
    hasSearchQuery: !!this.indexSidebarSearchQuery.trim(),
    hasFileScope: !!selectedIndexFileFilterRootPath,
});
if (notice) {
    shell.limitNoticeSlotEl.createEl("p", { text: notice.primary });
    shell.limitNoticeSlotEl.createEl("p", { text: notice.secondary });
}
```

Give the notice slot the existing `aside-list-limit-notice` class only while a notice exists. Render support UI into `shell.supportSlotEl` with `renderSupportButtonIn` so the stable root does not accumulate duplicate buttons.

- [ ] **Step 6: Run focused index tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarContentFilter.test.js .test-dist/tests/indexSidebarState.test.js .test-dist/tests/indexSidebarListLimit.test.js .test-dist/tests/sidebarPageRenderSignature.test.js .test-dist/tests/sidebarRenderOrder.test.js
node --test tests/sidebarToolbarComposition.test.mjs
npm run lint
npm run typecheck
```

Expected: all focused tests, lint, and typecheck PASS.

- [ ] **Step 7: Commit index incremental rendering**

```bash
git add src/ui/views/AsideView.ts tests/sidebarToolbarComposition.test.mjs tests/indexSidebarState.test.ts
git commit -m "perf: reconcile bounded index search cards"
```

---

### Task 6: Benchmark, Full Verification, and Spec Tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-08-09-index-sidebar-bounded-global-search-performance-design.md`

- [ ] **Step 1: Run the exact-ranking benchmark**

Compile tests, then run 20 warmed iterations against 10,000 representative threads using `rankSidebarSearchResults(..., { limit: 100 })`. Record median and p95:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node -e 'const {performance}=require("node:perf_hooks"); const {rankSidebarSearchResults}=require("./.test-dist/src/ui/views/sidebarContentFilter.js"); const threads=Array.from({length:10000},(_,i)=>({selectedText:`architecture design ${i}`,entries:[{body:`api cleanup architecture ${i}`},{body:"nested reply body"},{body:"final architecture note"}]})); for(let i=0;i<5;i++) rankSidebarSearchResults(threads,"architecture",{limit:100}); const runs=[]; for(let i=0;i<20;i++){const start=performance.now(); const result=rankSidebarSearchResults(threads,"architecture",{limit:100}); if(result.items.length!==100||result.totalMatchCount!==10000) throw new Error("unexpected result window"); runs.push(performance.now()-start)} runs.sort((a,b)=>a-b); console.log(JSON.stringify({medianMs:runs[10],p95Ms:runs[19]}));'
```

Expected: median no higher than 25 ms and exactly 100 retained items from 10,000 matches.

- [ ] **Step 2: Re-run the change-surface audit**

Run:

```bash
rg -n "reconcileNoteSidebarItems|reconcileSidebarItems|rankSidebarSearchResults|rankThreadsBySidebarSearchQuery|INDEX_SIDEBAR_LIST_LIMIT" src tests
git diff --check main...HEAD
```

Expected: one shared reconciler owner; the complete ranking wrapper remains for individual-file callers; the index limit decision is centralized; no whitespace errors.

- [ ] **Step 3: Run the complete production build**

Run:

```bash
npm run build
```

Expected: all tests, ESLint, typecheck, Obsidian compliance, production bundle, and release artifact guard PASS. The artifact guard must inspect `main.js`, `manifest.json`, and `styles.css` and find no source maps, embedded source, raw TypeScript/JSX, secret-bearing files, or local paths.

- [ ] **Step 4: Install and smoke-test the verified build**

Run:

```bash
node scripts/install-built-plugin.mjs --vault /Users/wenqingli/Obsidian/lean-startup
cmp -s main.js /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/main.js
cmp -s manifest.json /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json
cmp -s styles.css /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css
obsidian vault=lean-startup plugin:reload id=aside
```

In `lean-startup`, verify:

1. A broad unscoped query shows no more than 100 exact matches and the `100 of N` notice.
2. Typing multiple characters across separate debounce intervals keeps input focus and does not flash unchanged cards.
3. A narrow query returns the same exact matches and highlights as before.
4. A nested-entry match reveals the matching thread.
5. Escape clears the query and restores the ordinary unscoped list notice.
6. Selecting a file removes the global window and searches every exact match in that file.

If any broad query still visibly stalls, stop and implement the documented fallback before completing: make the index search capability require a selected file and show `Select a file to search side notes.` while unscoped.

- [ ] **Step 5: Update the tracked spec from evidence**

Mark each implemented and verified checkbox in `docs/superpowers/specs/2026-08-09-index-sidebar-bounded-global-search-performance-design.md` as `[x]`. Keep the installed-performance or fallback item unchecked if the smoke check is not completed, and add a dated explanation directly beneath it.

- [ ] **Step 6: Commit verification tracking**

```bash
git add -f docs/superpowers/specs/2026-08-09-index-sidebar-bounded-global-search-performance-design.md
git commit -m "docs: record bounded index search verification"
```

- [ ] **Step 7: Review the completed branch**

Run:

```bash
git diff --stat main...HEAD
git diff --check main...HEAD
git status --short
```

Review bounded-ranking equivalence, stable ties, file-scope exceptions, shared reconciler ownership, stale-render guards, streamed-reply cleanup, focus restoration, empty states, notices, and release-artifact exposure. Fix every critical or important finding with a failing regression test before completion.
