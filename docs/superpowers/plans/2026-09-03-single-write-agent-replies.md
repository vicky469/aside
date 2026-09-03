# Single-Write Agent Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the persisted blank-placeholder/final-edit lifecycle with one canonical reply commit and monotonic save status.

**Architecture:** `CommentPersistenceController` owns an idempotent per-note entry commit that reads canonical state and writes an explicit snapshot under the existing keyed queue. `CommentAgentController` continues to create the live card immediately, but waits until completion to call either the new canonical append path or the existing durable-entry edit path. Reply persistence is the sole owner of the save verdict; later bookkeeping is best-effort.

**Tech Stack:** TypeScript, Obsidian plugin APIs, Node test runner, esbuild.

---

### Task 1: Canonical per-note entry commit

**Files:**
- Modify: `src/comments/commentPersistenceController.ts`
- Modify: `src/main.ts`
- Test: `tests/commentPersistenceConcurrency.test.ts`

- [ ] **Step 1: Write the failing canonical-commit tests**

Add tests that pause a same-note save/reload boundary, commit two distinct output ids through the new API, and assert the stored source/path sidecars contain both complete bodies exactly once. Add an idempotency assertion that a repeated commit for one output id updates rather than duplicates it.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentPersistenceConcurrency.test.js`

Expected: compilation or assertion failure because the canonical commit API does not exist.

- [ ] **Step 3: Implement the minimal canonical commit**

Add a provider-neutral `commitThreadEntry(filePath, threadId, entry, options)` host path. Inside `CommentPersistenceController`, resolve the current file, enter the existing keyed persistence queue, read canonical threads, upsert the output id under the stable parent thread, and pass that explicit snapshot to the existing source/path sidecar, sync-event, and snapshot pipeline. Return `false` only when the file or parent thread cannot be committed. Schedule aggregate refresh instead of awaiting it.

- [ ] **Step 4: Run the focused persistence tests and verify GREEN**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentPersistenceConcurrency.test.js .test-dist/tests/commentPersistenceExternalSync.test.js`

Expected: all focused persistence tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/comments/commentPersistenceController.ts src/main.ts tests/commentPersistenceConcurrency.test.ts
git commit -m "fix(persistence): commit complete agent replies"
```

### Task 2: One-write agent lifecycle

**Files:**
- Modify: `src/agents/commentAgentController.ts`
- Modify: `src/main.ts`
- Test: `tests/commentAgentController.test.ts`
- Test: `tests/sidebarPersistedComment.test.ts`
- Test: `tests/streamedAgentReplyController.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Assert that a run shows `Starting Agent…` with a reserved output id before any comment append, then appends the complete response once when the runtime finishes. Assert a regenerate with a durable output id edits it once. Assert no successful path writes an empty body.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentAgentController.test.js .test-dist/tests/sidebarPersistedComment.test.js .test-dist/tests/streamedAgentReplyController.test.js`

Expected: assertions fail because the current controller appends an empty placeholder and edits it later.

- [ ] **Step 3: Implement the minimal one-write lifecycle**

Remove `outputReady` and the start-time blank append. Keep the reserved output id in the live stream and run record. At completion, call canonical commit for a missing output, or edit once for a durable regenerate target. Use the stable thread id and full reply body. Preserve all provider-neutral runtime routing.

- [ ] **Step 4: Run the focused lifecycle tests and verify GREEN**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentAgentController.test.js .test-dist/tests/sidebarPersistedComment.test.js .test-dist/tests/streamedAgentReplyController.test.js`

Expected: all focused lifecycle tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agents/commentAgentController.ts src/main.ts tests/commentAgentController.test.ts tests/sidebarPersistedComment.test.ts tests/streamedAgentReplyController.test.ts
git commit -m "fix(agents): persist completed replies once"
```

### Task 3: Monotonic save verdict

**Files:**
- Modify: `src/agents/commentAgentController.ts`
- Test: `tests/commentAgentController.test.ts`

- [ ] **Step 1: Write failing verdict tests**

Add one test where canonical commit returns `false` and assert the retained card becomes `failed` with `Couldn’t save reply`. Add one test where canonical commit succeeds but the final run-store update throws and assert the card remains succeeded and no `agents.reply.persist_failed` event is logged.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/commentAgentController.test.js`

Expected: the post-commit bookkeeping case is mislabeled as reply persistence failure.

- [ ] **Step 3: Narrow error ownership**

Catch only canonical commit failure with `failReplyPersistence`. After a successful commit, isolate run-store finalization, duplicate cleanup, and view refresh in separate best-effort blocks with specific warning events. Keep the succeeded live card retained when handoff cannot be proven.

- [ ] **Step 4: Run focused and full verification**

Run: `npm run build`

Expected: all TypeScript and script/style tests, lint, typecheck, Obsidian compliance, bundle, and release artifact inspection pass.

- [ ] **Step 5: Commit**

```bash
git add src/agents/commentAgentController.ts tests/commentAgentController.test.ts docs/superpowers/specs/2026-09-03-single-write-agent-replies-design.md docs/superpowers/plans/2026-09-03-single-write-agent-replies.md
git commit -m "fix(agents): keep saved reply status monotonic"
```

### Task 4: Live install verification

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-single-write-agent-replies-design.md`

- [ ] **Step 1: Install and reload**

Run: `npm run dev:install-built -- --vault /path/to/vault`

Run: `obsidian plugin:reload id=aside vault=lean-startup`

- [ ] **Step 2: Compare shipped assets**

Compare repository and installed `main.js`, `manifest.json`, and `styles.css` with `cmp -s`; all must match.

- [ ] **Step 3: Mark verified tracking items and commit**

Update the associated spec only after evidence exists, then commit the checklist update.
