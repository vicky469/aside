# Instant Anchored Card Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render anchored cards and drag moves immediately while preventing processed snapshots from resurrecting moved threads.

**Architecture:** Draft presentation reuses the shared selected-text formatter. Comment mutations apply and render reversible in-memory moves before awaiting the existing keyed persistence queue. Sync hydration consults current-device watermark coverage, and one domain reconciliation helper removes structurally duplicated roots before sidecars or snapshots become canonical.

**Tech Stack:** TypeScript, Obsidian DOM APIs, Node test runner, existing comment manager, sidecar storage, sync event store, esbuild.

---

## File Structure

- Create `src/domain/comments/commentThreadReconciliation.ts`: pure stable-ID repair for roots already converted into anchored nested entries.
- Modify `src/ui/views/sidebarDraftComment.ts`: render the shared selection preview in draft headers.
- Modify `src/comments/commentMutationController.ts`: own optimistic move refresh and rollback.
- Modify `src/main.ts`: forward mutation behavior options used by sidebar drag operations.
- Modify `src/ui/views/AsideView.ts`: opt drag operations into optimistic rendering, expand destinations first, and avoid delayed smooth scrolling.
- Modify `src/sync/sideNoteSyncEventStore.ts`: expose current-device snapshot coverage checks and atomically merge sync state at queued write time.
- Modify `src/comments/commentPersistenceController.ts`: filter processed snapshots and reconcile normalized thread state.
- Modify focused tests under `tests/` for each boundary.

### Task 1: Render anchored draft previews immediately

**Files:**
- Modify: `tests/sidebarDraftComment.test.ts`
- Modify: `src/ui/views/sidebarDraftComment.ts`

- [ ] **Step 1: Write the failing DOM test**

Render a selection draft through `renderDraftCommentCard` in both editable and saving states and assert:

```ts
assert.equal(
    root.querySelector(".aside-comment-meta-preview")?.textContent,
    "Selected source text",
);
```

Also assert a page-note draft does not render `.aside-comment-meta-preview`.

- [ ] **Step 2: Verify the red state**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarDraftComment.test.js`

Expected: FAIL because draft headers contain only the timestamp.

- [ ] **Step 3: Implement the shared header presentation**

Import `formatSidebarCommentSelectedTextPreview` beside `formatSidebarCommentMeta`, add `metaPreviewText` to `DraftCommentPresentation`, and render the same two-span structure used by persisted cards:

```ts
const metaEl = headerEl.createEl("small", {
    cls: "aside-timestamp aside-comment-meta",
});
if (presentation.metaPreviewText) {
    metaEl.createSpan({
        cls: "aside-comment-meta-preview",
        text: presentation.metaPreviewText,
    });
}
metaEl.createSpan({
    cls: "aside-comment-meta-value",
    text: presentation.metaText,
});
```

- [ ] **Step 4: Verify green**

Run the Task 1 command and expect all tests to pass.

### Task 2: Make drag mutations visually optimistic and reversible

**Files:**
- Modify: `tests/commentMutationController.test.ts`
- Modify: `src/comments/commentMutationController.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/views/AsideView.ts`
- Modify: `tests/sidebarIndexReorderComposition.test.mjs`

- [ ] **Step 1: Write failing deferred-persistence tests**

Add an `optimisticViewRefresh?: boolean` mutation option. In tests, hold `persistCommentsForFile` behind a deferred promise, invoke nesting/reordering with this option, wait one microtask, and assert the manager order and one lightweight refresh are visible before persistence resolves.

Add a rejection test that captures the original threads, rejects persistence, and asserts exact restoration plus:

```ts
assert.deepEqual(host.notices, [
    "Unable to save this side note move. The card was restored.",
]);
```

- [ ] **Step 2: Verify the red state**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentMutationController.test.js`

Expected: FAIL because move options do not request pre-persistence refresh and failed moves remain mutated.

- [ ] **Step 3: Implement one mutation transaction helper**

Extend `CommentMutationPersistBehaviorOptions` with `optimisticViewRefresh?: boolean`. Add a private helper that receives the file, cloned previous threads, options, and persist options:

```ts
private async persistOptimisticFileMutation(
    file: TFile,
    previousThreads: CommentThread[],
    options: CommentMutationPersistBehaviorOptions,
    persistOptions: PersistOptions,
): Promise<void> {
    if (options.optimisticViewRefresh) {
        await this.host.refreshCommentViews({ skipDataRefresh: true });
    }
    try {
        await this.host.persistCommentsForFile(file, persistOptions);
    } catch (error) {
        this.host.getCommentManager().replaceThreadsForFile(file.path, previousThreads);
        if (options.optimisticViewRefresh) {
            await this.host.refreshCommentViews({ skipDataRefresh: true });
        }
        this.host.showNotice("Unable to save this side note move. The card was restored.");
        throw error;
    }
}
```

Use the helper for root reorder, child reorder, nesting, and cross-parent child movement. Capture previous threads after canonical loading and before mutation.

- [ ] **Step 4: Wire the sidebar**

Forward the options through `main.ts`. Every drag/drop call supplies:

```ts
{
    optimisticViewRefresh: true,
    deferAggregateRefresh: true,
    skipPersistedViewRefresh: true,
    refreshEditorDecorations: false,
    refreshMarkdownPreviews: false,
}
```

For nesting and cross-parent movement, set the destination's nested visibility before invoking the mutation, set active state without scrolling, and remove the post-persistence `highlightComment(...)` call.

- [ ] **Step 5: Verify green**

Run the Task 2 command plus `node --test tests/sidebarIndexReorderComposition.test.mjs` and expect all tests to pass.

### Task 3: Reject processed snapshots and serialize sync-state merging

**Files:**
- Modify: `tests/sideNoteSyncEvents.test.ts`
- Modify: `src/sync/sideNoteSyncEventStore.ts`
- Modify: `src/comments/commentPersistenceController.ts`
- Modify: `src/main.ts`
- Modify: `tests/commentPersistenceExternalSync.test.ts`

- [ ] **Step 1: Write the failing coverage tests**

Create a state whose current processor watermark already equals a snapshot's covered watermark and assert:

```ts
assert.equal(store.hasUnprocessedSnapshotCoverage({ "device-a": 4 }), false);
assert.equal(store.hasUnprocessedSnapshotCoverage({ "device-a": 5 }), true);
assert.equal(store.hasUnprocessedSnapshotCoverage({ "device-b": 1 }), true);
```

Add a persistence regression where an existing sidecar contains the moved nested entry while an already-processed snapshot contains its old root. Replaying sync must not hydrate the stale root. Keep the existing fresh-device remote snapshot test green.

- [ ] **Step 2: Verify the red state**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sideNoteSyncEvents.test.js .test-dist/tests/commentPersistenceExternalSync.test.js`

Expected: FAIL because no coverage query exists and hydration unions the stale root.

- [ ] **Step 3: Implement the coverage gate**

Add `hasUnprocessedSnapshotCoverage(coveredWatermarks)` to `SideNoteSyncEventStore`. Compare each covered clock with the maximum of the current processor watermark and compacted watermark. In hydration, skip merging into an existing sidecar when the snapshot has no unseen coverage. Missing sidecars still hydrate for recovery.

- [ ] **Step 4: Make sync-state writes atomic**

Add an optional `updatePersistedPluginData(updater)` host method. When present, `writeState` executes `mergeSideNoteSyncEventStates` inside that queued updater so a stale whole-state patch cannot overwrite a newer snapshot. Keep the existing full-write fallback for isolated tests. Wire the updater through `CommentPersistenceController` and `main.ts`.

- [ ] **Step 5: Verify green**

Run the Task 3 command and expect all tests to pass.

### Task 4: Reconcile and persist existing nested/root duplicates

**Files:**
- Create: `src/domain/comments/commentThreadReconciliation.ts`
- Create: `tests/commentThreadReconciliation.test.ts`
- Modify: `src/comments/commentPersistenceController.ts`
- Modify: `tests/commentPersistenceExternalSync.test.ts`

- [ ] **Step 1: Write the failing pure reconciliation test**

Build a destination containing an anchored nested entry whose ID equals another top-level root. Assert the helper removes the redundant root, preserves the destination entry order and anchor, carries any missing source replies after that entry, and is idempotent.

- [ ] **Step 2: Verify the red state**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentThreadReconciliation.test.js`

Expected: FAIL because the reconciliation module does not exist.

- [ ] **Step 3: Implement stable-ID reconciliation**

Export:

```ts
export interface ReconciledCommentThreads {
    threads: CommentThread[];
    removedRootThreadIds: string[];
}

export function reconcileAnchoredNestedThreadDuplicates(
    threads: readonly CommentThread[],
): ReconciledCommentThreads;
```

Clone input threads. For each top-level root ID already present as an anchored entry in a different thread, retain the nested placement, insert any source replies absent from that destination immediately after the converted root block, then remove the redundant top-level root. Use IDs only; never compare private content.

- [ ] **Step 4: Apply reconciliation at canonical boundaries**

Run reconciliation after thread normalization, after snapshot/sidecar merge, and before snapshot compaction. When a loaded sidecar loses a redundant root, write the repaired source/path sidecars and compact the repaired snapshot through the existing per-note persistence flow.

- [ ] **Step 5: Verify green**

Run Tasks 3 and 4 focused commands and expect all tests to pass.

### Task 5: Verify, document, build, and sync

**Files:**
- Modify: `docs/superpowers/specs/2026-09-07-instant-anchored-card-convergence-design.md`
- Modify: this plan

- [ ] **Step 1: Run focused verification**

Run all four focused test groups from Tasks 1–4. Expected: zero failures.

- [ ] **Step 2: Run complete verification**

Run: `npm run build`

Expected: tests, type checking, lint/compliance checks, production bundle, and artifact guard pass.

- [ ] **Step 3: Inspect shipped artifacts**

Run: `node scripts/check-release-artifacts.mjs`

Expected: `main.js`, `manifest.json`, and `styles.css` pass; no source map, embedded source, raw TypeScript/JSX-family source, secret-bearing file, or local-only fixture is included.

- [ ] **Step 4: Sync and compare `lean-startup`**

Run: `node scripts/install-built-plugin.mjs --vault /Users/wenqingli/Obsidian/lean-startup`, reload Aside, and compare SHA-256 hashes for the three shipped assets.

- [ ] **Step 5: Verify and repair the reported thread through the installed build**

Open the supplied Aside URI after reload. Inspect only stable IDs/counts in both sidecars and confirm the affected ID has one occurrence at the nested placement. Do not print note bodies or selected text.

- [ ] **Step 6: Complete tracking and commit**

Mark only verified checklist items complete in the spec and plan, run `git diff --check`, inspect `git status --short`, and commit the implementation with terse conventional messages.

## Self-Review

- Spec coverage: all seven implementation items and six verification items map to Tasks 1–5.
- Placeholder scan: no TBD, TODO, deferred implementation, or unspecified test step remains.
- Type consistency: the mutation option, sync coverage method, atomic updater, and reconciliation result keep one spelling throughout.
- Scope: the plan changes only anchored-card rendering, drag responsiveness, snapshot convergence, and repair of the diagnosed duplicate shape.
- Privacy: every planned fixture uses synthetic paths, IDs, and content.
