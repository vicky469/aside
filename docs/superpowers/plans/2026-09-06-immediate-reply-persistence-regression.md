# Immediate Reply Persistence Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved agent and vault-script prompts show one turning reply card immediately without blocking on aggregate refreshes or racing same-note external synchronization.

**Architecture:** Restore non-blocking persistence intent at `CommentMutationController`, keep `CommentScriptController` as a thin caller, and route source-file modification writes through the existing keyed queue in `CommentPersistenceController`. The renderer, run stores, sidecar schema, and concurrent runtime model stay unchanged.

**Tech Stack:** TypeScript 5.9, Obsidian API, Node test runner, existing sidecar persistence and run controllers.

---

### Task 1: Make appended prompt and reply persistence non-blocking

**Files:**
- Modify: `tests/commentMutationController.test.ts`
- Modify: `src/comments/commentMutationController.ts`

- [ ] **Step 1: Add failing append persistence assertions**

Extend the saved-append test to assert that the default save records:

```ts
{
    path: draft.filePath,
    immediateAggregateRefresh: false,
    skipCommentViewRefresh: true,
}
```

Extend the pending-entry test to pass `immediateAggregateRefresh: false`, `refreshEditorDecorations: false`, and `refreshMarkdownPreviews: false`, then assert all options reach `persistCommentsForFile`.

- [ ] **Step 2: Run the mutation test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentMutationController.test.js
```

Expected: the append-save assertion reports synchronous aggregate refresh, and the pending-entry assertion reports that its explicit option is ignored.

- [ ] **Step 3: Implement the shared append options**

Apply non-edit defaults to both `new` and `append` drafts in `normalizeSaveDraftOptions`. Pass the normalized persistence intent from `saveDraft` into `appendEntry`. Make `appendEntry` default to immediate refresh only when its caller did not specify otherwise. Make `appendThreadEntry` forward every existing `PersistOptions` field and default `immediateAggregateRefresh` to `true` for callers that do not opt out.

- [ ] **Step 4: Run the mutation test and verify GREEN**

Run the commands from Step 2. Expected: all mutation-controller tests pass.

### Task 2: Wire vault scripts to the non-blocking shared path

**Files:**
- Modify: `tests/commentScriptController.test.ts`
- Modify: `src/vaultScripts/commentScriptController.ts`

- [ ] **Step 1: Add failing caller-wiring assertions**

Record append and edit persistence options in the script-controller harness. Assert the pending output passes:

```ts
{
    immediateAggregateRefresh: false,
    skipCommentViewRefresh: true,
    refreshEditorDecorations: false,
    refreshMarkdownPreviews: false,
}
```

Assert the terminal in-place edit passes `deferAggregateRefresh: true` with the same three refresh suppressions.

- [ ] **Step 2: Run the script test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentScriptController.test.js
```

Expected: the new option assertions receive missing values.

- [ ] **Step 3: Implement thin script adapters**

Extend `CommentScriptHost.editComment` with the existing mutation behavior options. Pass the non-blocking options from `appendPendingOutput`, from the append fallback in `writeOutput`, and from the terminal in-place edit in `writeOutput`.

- [ ] **Step 4: Run the script test and verify GREEN**

Run the commands from Step 2. Expected: all script-controller tests pass.

### Task 3: Serialize source-file synchronization with reply writes

**Files:**
- Modify: `tests/commentPersistenceConcurrency.test.ts`
- Modify: `src/comments/commentPersistenceController.ts`

- [ ] **Step 1: Add a failing same-note boundary test**

Hold `persistCommentsForFile(file)` inside its first current-content read. Start `handleMarkdownFileModified(file)` for the same path and assert its content read cannot begin before the first save is released. Then release the first save, await both operations, and verify the sidecar remains readable.

- [ ] **Step 2: Run the concurrency test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentPersistenceConcurrency.test.js
```

Expected: the modification handler enters its read while the ordinary save is still held, proving it bypasses the queue.

- [ ] **Step 3: Queue the complete modification transaction**

Capture `file.path`, resolve the existing rename-aware queue keys with `getCommentPersistenceQueueKeys`, and execute the full current `handleMarkdownFileModified` body inside `enqueueCommentPersistence`. Preserve the current contained error logging so a filesystem event does not reject Obsidian's event callback.

- [ ] **Step 4: Run the concurrency test and verify GREEN**

Run the commands from Step 2. Expected: all persistence-concurrency tests pass, including cross-note concurrency and rejection recovery.

### Task 4: Verify, install, and record completion

**Files:**
- Modify: `docs/superpowers/specs/2026-09-06-immediate-reply-persistence-regression-design.md`

- [ ] **Step 1: Run focused regression tests**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentMutationController.test.js .test-dist/tests/commentScriptController.test.js .test-dist/tests/commentPersistenceConcurrency.test.js .test-dist/tests/commentPersistenceExternalSync.test.js
```

Expected: zero failures.

- [ ] **Step 2: Re-run the change-surface search**

```bash
rg -n "immediateAggregateRefresh|handleMarkdownFileModified|appendPendingOutput|writeOutput" src tests
```

Expected: normal agent commits, saved append prompts, and vault-script writes consume shared persistence controls; no second same-note lock exists.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: tests, lint, typecheck, Obsidian compliance, bundle-size check, bundle, and release-artifact guard pass. The guard inspects `main.js`, `manifest.json`, and `styles.css` and rejects source maps, embedded `sourcesContent`, raw TypeScript/JSX-family source files, and secret-bearing files.

- [ ] **Step 4: Mark verified tracking items complete**

Update the associated spec using `[x]` only for changes and checks supported by the preceding output.

- [ ] **Step 5: Integrate the feature branch into local `main`**

Commit the regression tests, implementation, and tracking documentation, then merge the feature branch without rewriting the existing local history.

- [ ] **Step 6: Install and reload the verified build**

Run:

```bash
npm run dev:install-built -- --vault ../../../../lean-startup
obsidian plugin:reload id=aside vault=lean-startup
```

Expected: the plugin installs and reloads successfully.

- [ ] **Step 7: Verify the exact installed artifacts**

Compare `main.js`, `manifest.json`, and `styles.css` byte-for-byte with the installed plugin directory. Expected: all three match.
