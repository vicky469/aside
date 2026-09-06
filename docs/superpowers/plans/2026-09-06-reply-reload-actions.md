# Reply Reload And Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent post-unload agent dispatch, persist a visible failure card for interrupted runs, expose `+` on vault-script reply cards, and keep manual continuations chronological.

**Architecture:** `CommentAgentController` remains the owner of agent lifecycle and restart reconciliation. It gains one disposed-state gate shared by saved-entry, retry, queue, execution, and completion paths, while restart reconciliation revalidates active status and uses a conditional canonical reply commit. `sidebarPersistedComment.ts` removes its script-only action exception; manual append rendering and persistence both resolve to the end of the selected thread, while automatic script outputs retain direct-after-trigger placement.

**Tech Stack:** TypeScript, Obsidian plugin APIs, Node test runner, esbuild.

---

### Task 1: Gate disposed agent controllers

**Files:**
- Modify: `src/agents/commentAgentController.ts`
- Test: `tests/commentAgentController.test.ts`

- [x] **Step 1: Write the failing late-callback test**

Add a test that blocks `resolveDefaultAgentRuntimeSelection`, starts `handleUpdateScriptRequest`, disposes the controller, releases selection, and asserts that no run is stored and no runtime invocation occurs.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "does not dispatch update-script after disposal" .test-dist/tests/commentAgentController.test.js
```

Expected: FAIL because the current controller queues and launches after disposal.

- [x] **Step 3: Implement the lifecycle gate**

Add a private `disposed` boolean, reset it during `initialize`, set it before cleanup in `dispose`, and check it at saved-entry/retry entry points, after asynchronous selection boundaries, in `enqueueRun`, in `processQueue`, and before `executeRun` begins. Do not add provider-specific branches.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 commands. Expected: PASS with zero queued runs and zero runtime calls.

- [x] **Step 5: Commit**

```bash
git add src/agents/commentAgentController.ts tests/commentAgentController.test.ts
git commit -m "fix(agents): stop dispatch after unload"
```

### Task 2: Recover interrupted agent outputs visibly

**Files:**
- Modify: `src/agents/commentAgentController.ts`
- Test: `tests/commentAgentController.test.ts`

- [x] **Step 1: Write failing restart tests**

Extend the existing restart test with a persisted running run and reserved output ID whose thread has no matching output. Require reconciliation to commit exactly one failure entry after the trigger and mark the run failed. Add a second case with a non-empty existing output entry and require zero commits plus the original body unchanged.

- [x] **Step 2: Run the restart tests and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "persisted in-flight runs" .test-dist/tests/commentAgentController.test.js
```

Expected: FAIL because reconciliation currently updates only run metadata.

- [x] **Step 3: Implement bounded interruption recovery**

For each queued/running run during startup reconciliation, resolve and load its page-note-capable file, inspect the reserved output entry including deletion state, and use the existing canonical `commitRunReply` only when the output is absent or blank. Preserve non-empty and deleted entries. Mark the run failed once whether or not the card commit succeeds, and refresh views once after the batch.

- [x] **Step 4: Run the restart tests and verify GREEN**

Run the Step 2 commands. Expected: both missing-output and preserved-output cases pass.

- [x] **Step 5: Commit**

```bash
git add src/agents/commentAgentController.ts tests/commentAgentController.test.ts
git commit -m "fix(agents): show interrupted reply cards"
```

### Task 3: Give script replies the shared add action without reordering history

**Files:**
- Modify: `src/ui/views/sidebarPersistedComment.ts`
- Test: `tests/sidebarPersistedComment.test.ts`

- [x] **Step 1: Write the failing action test**

Render a thread with one persisted script output, find its footer `+`, invoke it, and assert `startAppendEntryDraft` receives the script output ID rather than the parent prompt ID.

- [x] **Step 2: Run the sidebar test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "script reply renders add-to-thread" .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: FAIL because script replies currently suppress the action.

- [x] **Step 3: Remove the author-specific exception and append chronologically**

Derive `showAddEntryAction` only from the shared redirect/deleted/thread-deleted policy already used by other entries. Keep the clicked entry for thread resolution, but render and persist every manual continuation at the end of that thread. Keep automatic reply insertion after its own trigger.

- [x] **Step 4: Run the sidebar test and verify GREEN**

Run the Step 2 commands. Expected: PASS and the clicked script reply ID is recorded.

- [x] **Step 5: Commit**

```bash
git add src/ui/views/sidebarPersistedComment.ts tests/sidebarPersistedComment.test.ts
git commit -m "fix(sidebar): add replies after script cards"
```

### Task 4: Verify, integrate, and install

**Files:**
- Modify: `docs/superpowers/specs/2026-09-06-reply-reload-actions-design.md`

- [x] **Step 1: Run focused regression tests**

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentAgentController.test.js .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: all focused tests pass.

- [x] **Step 2: Run the complete verification**

```bash
npm run build
```

Expected: all tests, lint, typecheck, compliance, bundle-size, and exact release-artifact inspection pass.

- [x] **Step 3: Review privacy and artifacts**

Run `git diff --check`, inspect the staged diff for vault paths, comment IDs, tokens, credentials, and private URLs, and confirm the release guard ships only `main.js`, `manifest.json`, and `styles.css` without source maps or embedded sources.

- [x] **Step 4: Merge locally and verify the merged tree**

Use the branch-finishing workflow to merge into `main`, then run `npm run build` again from the merged tree.

- [x] **Step 5: Install and reload**

```bash
npm run dev:install-built -- --vault <test-vault-path>
obsidian plugin:reload id=aside vault=<test-vault-name>
```

Compare repository and installed `main.js`, `manifest.json`, and `styles.css` byte-for-byte.

- [x] **Step 6: Complete tracking**

Mark the associated spec items complete only after their verification evidence exists, then commit the tracking update.
