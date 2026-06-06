# Drag-Nested Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anchored top-level side note threads be dragged under another thread while preserving their own source anchors, and let nested entries reorder inside a thread.

**Architecture:** Add optional anchors to `CommentThreadEntry`, make projection prefer entry anchors when present, and extend existing mutation and sidebar drag/drop paths. Keep nesting one level deep; top-level anchored threads become child entries when dropped onto another thread.

**Tech Stack:** TypeScript, Obsidian plugin APIs, Node test runner, existing `CommentManager`, `CommentMutationController`, `AsideView`, sidecar and inline comment storage.

---

## File Structure

- Modify `src/domain/comments/commentThread.ts` to add `CommentThreadEntryAnchor`.
- Modify `src/domain/comments/commentThreadNormalization.ts` to clone entry anchors.
- Modify `src/domain/comments/commentProjection.ts` so `threadEntryToComment` uses child anchors.
- Modify `src/core/storage/noteCommentStorage.ts` so inline managed storage preserves child anchors.
- Modify `src/storage/comments/sideNoteSyncEvents.ts` so sync normalization and diffing preserve child anchors.
- Modify `src/commentManager.ts` to nest top-level anchored threads and expose deterministic child insertion.
- Modify `src/comments/commentMutationController.ts` to call the new nesting/move insertion behavior.
- Modify `src/main.ts` to expose the new mutation path.
- Modify `src/ui/views/sidebarPersistedComment.ts` and `src/ui/views/sidebarCommentActions.ts` so anchored selection threads and child entries have drag handles and child previews.
- Modify `src/ui/views/AsideView.ts` so drag targets support thread nesting, child-to-thread moves, and same-thread child reordering.
- Add tests in `tests/commentManager.idTargeting.test.ts`, `tests/commentMutationController.test.ts`, `tests/noteCommentStorage.test.ts`, `tests/sideNoteSyncEvents.test.ts`, `tests/sidebarPersistedComment.test.ts`, and `tests/editorHighlightRanges.test.ts`.

## Task 1: Child Anchor Model And Projection

**Files:**
- Modify: `src/domain/comments/commentThread.ts`
- Modify: `src/domain/comments/commentThreadNormalization.ts`
- Modify: `src/domain/comments/commentProjection.ts`
- Test: `tests/editorHighlightRanges.test.ts`

- [x] **Step 1: Write failing projection/highlight test**

Add a test that builds a thread with a child entry anchor and asserts `buildEditorHighlightRanges` returns a range for the child entry id.

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/editorHighlightRanges.test.js`

Expected: FAIL because `CommentThreadEntry` has no `anchor` field and child projection still inherits the parent anchor.

- [x] **Step 2: Implement entry anchor types and cloning**

Add `CommentThreadEntryAnchor` and optional `anchor` to `CommentThreadEntry`. Clone anchors in `cloneCommentThreadEntry`.

- [x] **Step 3: Make entry projection prefer child anchors**

Update `threadEntryToComment(thread, entry)` so fields `filePath`, `startLine`, `startChar`, `endLine`, `endChar`, `selectedText`, `selectedTextHash`, `anchorKind`, and `orphaned` come from `entry.anchor` when present; otherwise keep using the parent thread.

- [x] **Step 4: Verify focused test**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/editorHighlightRanges.test.js`

Expected: PASS.

## Task 2: Persistence And Sync Preservation

**Files:**
- Modify: `src/core/storage/noteCommentStorage.ts`
- Modify: `src/storage/comments/sideNoteSyncEvents.ts`
- Test: `tests/noteCommentStorage.test.ts`
- Test: `tests/sideNoteSyncEvents.test.ts`

- [x] **Step 1: Write failing storage and sync tests**

Add tests that:

- serialize and parse a thread whose child entry has `anchor`;
- reduce an `appendEntry` event with an anchored entry;
- diff an entry whose anchor changed and verify an `updateEntry` event is emitted.

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/noteCommentStorage.test.js .test-dist/tests/sideNoteSyncEvents.test.js`

Expected: FAIL because inline storage and sync normalization drop child anchors.

- [x] **Step 2: Preserve child anchors in inline storage**

Extend stored entry parsing and serialization to include optional `anchor`. Normalize only selection anchors with valid string/number fields.

- [x] **Step 3: Preserve child anchors in sync**

Extend sync `normalizeThreadEntry` and entry equality to include optional anchors.

- [x] **Step 4: Verify focused tests**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/noteCommentStorage.test.js .test-dist/tests/sideNoteSyncEvents.test.js`

Expected: PASS.

## Task 3: Thread Nesting And Child Placement Mutations

**Files:**
- Modify: `src/commentManager.ts`
- Modify: `src/comments/commentMutationController.ts`
- Modify: `src/main.ts`
- Test: `tests/commentManager.idTargeting.test.ts`
- Test: `tests/commentMutationController.test.ts`

- [x] **Step 1: Write failing mutation tests**

Add tests for:

- converting a top-level selection thread into anchored child entries under another same-file thread;
- rejecting page-note thread nesting;
- moving a child to another thread after a target child;
- reordering a child within the same thread.

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentManager.idTargeting.test.js .test-dist/tests/commentMutationController.test.js`

Expected: FAIL because root-thread nesting and placement-aware child moves do not exist.

- [x] **Step 2: Add manager helpers**

Add methods that:

- convert a top-level selection thread into one or more child entries with anchors;
- insert moved children after a target child or at the end of a target parent;
- keep root entries at index 0;
- reject page notes, self moves, deleted targets, and cross-file moves.

- [x] **Step 3: Add controller/main entrypoints**

Add `nestCommentThreadUnderThread(...)` and extend `moveCommentEntryToThread(...)` options with `insertAfterCommentId`.

- [x] **Step 4: Verify focused tests**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentManager.idTargeting.test.js .test-dist/tests/commentMutationController.test.js`

Expected: PASS.

## Task 4: Sidebar Drag/Drop And Child Rendering

**Files:**
- Modify: `src/ui/views/sidebarCommentActions.ts`
- Modify: `src/ui/views/sidebarPersistedComment.ts`
- Modify: `src/ui/views/AsideView.ts`
- Test: `tests/sidebarPersistedComment.test.ts`

- [x] **Step 1: Write failing sidebar tests**

Add tests that:

- a top-level anchored selection thread renders a drag handle;
- anchored child entries render the selected-text preview;
- deleted/page/index cards do not expose thread nesting drag handles.

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarPersistedComment.test.js`

Expected: FAIL because anchored thread drag handles and child previews are not rendered.

- [x] **Step 2: Render drag handles and child anchor previews**

Render thread drag handles for active top-level selection threads. Render the existing selected-text preview for child entries when `entry.anchor` exists.

- [x] **Step 3: Extend drag target resolution**

Update `AsideView` drag state and drop target logic:

- thread drag onto parent card appends nested thread;
- thread drag onto child card inserts after that child;
- child drag onto same-thread child reorders before/after using midpoint;
- child drag onto another thread moves after target child or appends to parent.

- [x] **Step 4: Verify focused sidebar tests**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarPersistedComment.test.js`

Expected: PASS.

## Task 5: Full Verification And Artifact Sync

**Files:**
- No new files expected beyond the implementation/test files above.

- [x] **Step 1: Run full build**

Run: `npm run build`

Expected: PASS with tests, lint, typecheck, and production bundle.

- [x] **Step 2: Inspect release artifacts**

Run: `node scripts/check-release-artifacts.mjs`

Expected: PASS for `main.js`, `manifest.json`, and `styles.css`.

- [x] **Step 3: Sync built plugin to public and PM vaults**

Run:

```bash
node scripts/install-built-plugin.mjs --vault "/Users/wenqingli/Obsidian/public/public"
node scripts/install-built-plugin.mjs --vault "/Users/wenqingli/Obsidian/PM"
```

Expected: both commands copy `main.js`, `manifest.json`, and `styles.css`.

- [x] **Step 4: Hash verify synced artifacts**

Run: `shasum -a 256 main.js manifest.json styles.css /Users/wenqingli/Obsidian/public/public/.obsidian/plugins/aside/main.js /Users/wenqingli/Obsidian/public/public/.obsidian/plugins/aside/manifest.json /Users/wenqingli/Obsidian/public/public/.obsidian/plugins/aside/styles.css /Users/wenqingli/Obsidian/PM/.obsidian/plugins/aside/main.js /Users/wenqingli/Obsidian/PM/.obsidian/plugins/aside/manifest.json /Users/wenqingli/Obsidian/PM/.obsidian/plugins/aside/styles.css`

Expected: each vault artifact hash matches its repo artifact hash.

## Self-Review

- Spec coverage: model, drag behavior, conversion, rendering/navigation, persistence/sync, and tests are covered.
- Placeholder scan: no TBD/TODO/placeholders remain.
- Type consistency: `CommentThreadEntryAnchor`, `entry.anchor`, `nestCommentThreadUnderThread`, and `insertAfterCommentId` are used consistently across tasks.
