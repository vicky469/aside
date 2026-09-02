# Optimistic Agent Card Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make new and appended `@agent` cards leave edit mode immediately, remain single-instance while persistence runs, and recover cleanly if the save fails.

**Architecture:** `CommentMutationController` owns the optimistic save lifecycle and transactional rollback. `sidebarDraftComment` owns the read-only pending presentation, while `sidebarRenderOrder` owns one shared stable-ID rule that suppresses a pending draft once the same logical entry exists in the in-memory thread state. Existing inline-edit behavior and durable-save-before-agent-dispatch ordering remain unchanged.

**Tech Stack:** TypeScript, Obsidian DOM APIs, Node test runner, esbuild.

---

### Task 1: Centralize the one-card render rule

**Files:**
- Modify: `src/ui/views/sidebarRenderOrder.ts`
- Modify: `src/ui/views/AsideView.ts`
- Test: `tests/sidebarRenderOrder.test.ts`

- [ ] **Step 1: Write failing stable-ID deduplication tests**

Add tests importing `resolveRenderableSavingDraft` and prove that a saving new draft is returned before its thread exists, is omitted once `thread.id === draft.id`, and that a saving append draft is omitted once any `thread.entries[].id === draft.id`. Also assert that non-saving and edit drafts are returned unchanged:

```ts
assert.equal(resolveRenderableSavingDraft([], newDraft, true), newDraft);
assert.equal(resolveRenderableSavingDraft([commentToThread(newDraft)], newDraft, true), null);
assert.equal(resolveRenderableSavingDraft([threadWithReplyId], appendDraft, true), null);
assert.equal(resolveRenderableSavingDraft([commentToThread(newDraft)], newDraft, false), newDraft);
assert.equal(resolveRenderableSavingDraft([commentToThread(editDraft)], editDraft, true), editDraft);
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `npm run typecheck:test --if-present || ./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarRenderOrder.test.js`

Expected: compilation fails because `resolveRenderableSavingDraft` is not exported.

- [ ] **Step 3: Implement the shared render resolver**

Add one exported function in `sidebarRenderOrder.ts`:

```ts
export function resolveRenderableSavingDraft(
    threads: readonly CommentThread[],
    draft: DraftComment | null,
    isSaving: boolean,
): DraftComment | null {
    if (!draft || !isSaving || draft.mode === "edit") return draft;
    const alreadyRepresented = threads.some((thread) => (
        thread.id === draft.id || thread.entries.some((entry) => entry.id === draft.id)
    ));
    return alreadyRepresented ? null : draft;
}
```

In both index and note render paths in `AsideView.ts`, resolve `visibleDraftComment` through this helper using `this.plugin.isSavingDraft(visibleDraftComment.id)` before calculating nested/top-level draft placement. Use the resolved draft consistently for nested IDs and `buildStoredOrderSidebarItems`.

- [ ] **Step 4: Run the focused rendering tests**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarRenderOrder.test.js`

Expected: all sidebar render-order tests pass.

- [ ] **Step 5: Commit the render rule**

```bash
git add src/ui/views/sidebarRenderOrder.ts src/ui/views/AsideView.ts tests/sidebarRenderOrder.test.ts
git commit -m "fix(sidebar): dedupe optimistic draft cards"
```

### Task 2: Render saving drafts as read-only cards

**Files:**
- Modify: `src/ui/views/sidebarDraftComment.ts`
- Modify: `styles.css`
- Test: `tests/sidebarDraftComment.test.ts`

- [ ] **Step 1: Write failing pending-presentation tests**

Extend `DraftCommentPresentation` with `isPending` and test that only saving `new` and `append` drafts become pending; edits remain editable:

```ts
assert.equal(buildDraftCommentPresentation(newDraft, null, true, true).isPending, true);
assert.ok(buildDraftCommentPresentation(newDraft, null, true, true).classes.includes("is-saving"));
assert.equal(buildDraftCommentPresentation(editDraft, null, true, true).isPending, false);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarDraftComment.test.js`

Expected: compilation or assertions fail because pending presentation is absent.

- [ ] **Step 3: Implement the pending card presentation**

Pass `host.isSavingDraft(comment.id)` into `buildDraftCommentPresentation`. For pending non-edit cards, add `is-saving`, render a non-interactive `.aside-comment-content.aside-draft-pending-content` using `renderStyledDraftCommentFragment`, and do not create the textarea, toolbar, Cancel, or Add buttons. Keep `renderInlineEditDraftContent` on the existing editor path.

```ts
if (presentation.isPending) {
    const content = commentEl.createDiv("aside-comment-content aside-draft-pending-content");
    content.appendChild(renderStyledDraftCommentFragment(content.ownerDocument, comment.comment, host.isActionableMention));
    return;
}
```

Add restrained pending styling (reduced opacity plus default cursor) without a spinner or duplicate progress copy; agent streaming remains the later grey-step experience.

- [ ] **Step 4: Run the focused draft tests**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarDraftComment.test.js`

Expected: all draft presentation tests pass.

- [ ] **Step 5: Commit the pending UI**

```bash
git add src/ui/views/sidebarDraftComment.ts styles.css tests/sidebarDraftComment.test.ts
git commit -m "feat(sidebar): show read-only saving cards"
```

### Task 3: Make new and append persistence transactional

**Files:**
- Modify: `src/comments/commentMutationController.ts`
- Test: `tests/commentMutationController.test.ts`

- [ ] **Step 1: Write failing async-transition and rollback tests**

Use deferred promises in the host harness. Assert a default new save performs one lightweight refresh and sets the saving ID before anchor loading settles. Add rejection tests for both new and append saves that snapshot `getThreadsForFile(filePath, { includeDeleted: true })`, reject `persistCommentsForFile`, await `assert.rejects(savePromise)`, then verify exact thread restoration, exact trimmed draft restoration, cleared saving ID, and this notice:

```ts
"Unable to save this side note. Your draft was restored."
```

Add a dispatch gate test where persistence is deferred and assert `savedUserEntryEvents` is empty until persistence resolves, then contains exactly one event.

- [ ] **Step 2: Run the focused mutation tests and verify failure**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentMutationController.test.js`

Expected: pre-save refresh count is zero and failed persistence leaves an optimistic thread or entry in the manager.

- [ ] **Step 3: Enable the immediate non-edit transition**

Change the new-draft default in `normalizeSaveDraftOptions` so `skipPreSaveRefresh` defaults to `false`. Retain the explicit option for internal callers that intentionally opt out. Await the lightweight `refreshCommentViews({ skipDataRefresh: true })` before slow preparation.

- [ ] **Step 4: Roll back only the optimistic mutation**

Immediately after canonical loading and before manager mutation, capture cloned file threads via `getThreadsForFile(file.path, { includeDeleted: true })`. Wrap each new/append mutate-plus-persist section in `try/catch`; on failure call `replaceThreadsForFile(file.path, previousThreads)` and rethrow. Do not change `editComment`.

For `addComment`, preserve duplicate-window behavior and set the fingerprint only for an attempted mutation. For `appendEntry`, snapshot after `loadLatestCommentTarget` and before `appendEntry`/reorder.

- [ ] **Step 5: Restore the editor and notify on non-edit save errors**

In `saveDraft`'s catch, keep the draft session intact, log the underlying error, and for `new`/`append` call:

```ts
this.host.showNotice("Unable to save this side note. Your draft was restored.");
```

Let `finally` clear the saving ID and refresh the UI. Preparation paths that already show a precise validation notice remain unchanged, so the generic recovery notice is limited to thrown save failures.

- [ ] **Step 6: Run the focused mutation tests**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentMutationController.test.js`

Expected: all mutation tests pass, including immediate pending refresh, rollback, and durable-before-dispatch assertions.

- [ ] **Step 7: Commit transactional saving**

```bash
git add src/comments/commentMutationController.ts tests/commentMutationController.test.ts
git commit -m "fix(comments): restore drafts after save failure"
```

### Task 4: Verify the complete experience

**Files:**
- Modify: `docs/superpowers/specs/2026-09-02-optimistic-agent-card-save-design.md`

- [ ] **Step 1: Run all focused tests together**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarRenderOrder.test.js .test-dist/tests/sidebarDraftComment.test.js .test-dist/tests/commentMutationController.test.js`

Expected: all focused tests pass.

- [ ] **Step 2: Run the full production verification**

Run: `npm run build`

Expected: full tests, lint, typecheck, Obsidian compliance, production bundle, and release artifact guard all pass.

- [ ] **Step 3: Inspect the exact shipped assets**

Run: `ls -l main.js manifest.json styles.css && ! test -e main.js.map && ! rg -n "sourceMappingURL|sourcesContent" main.js && ! find . -maxdepth 1 -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' -o -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' \) -print -quit | grep .`

Expected: the three shipped assets exist; no source map, embedded-source markers, raw source files at the artifact root, or obvious secret-bearing files are reported.

- [ ] **Step 4: Mark the tracked spec complete**

Change each verified item under `### To Implement` and `### Verification` from `[ ]` to `[x]`. Do not mark an item complete without matching test/build evidence.

- [ ] **Step 5: Commit verification tracking**

```bash
git add docs/superpowers/specs/2026-09-02-optimistic-agent-card-save-design.md
git commit -m "docs(comments): complete optimistic save tracking"
```
