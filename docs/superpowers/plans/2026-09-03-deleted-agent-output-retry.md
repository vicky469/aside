# Deleted Agent Output Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure regenerating an agent run whose prior output was soft-deleted creates and hands off to a fresh visible reply entry.

**Architecture:** Keep the rule in `CommentAgentController`, the provider-neutral owner of retry output selection. Reuse a prior output only when the loaded entry exists and has no `deletedAt`; otherwise leave the retry without an output ID so the existing append path allocates a fresh entry. Preserve the deleted entry unchanged.

**Tech Stack:** TypeScript, Node test runner, existing `CommentManager`, agent run store, and canonical comment mutation host.

---

### Task 1: Reproduce the disappearing retry

**Files:**
- Modify: `tests/commentAgentController.test.ts`

- [ ] **Step 1: Add the failing regression test**

Create a successful run, soft-delete its output through `CommentManager`, then retry it. Assert that the retry gets a different output ID, the old entry retains `deletedAt`, the new entry contains `Second reply` without `deletedAt`, and the active optimistic stream clears after persisted handoff.

```ts
const firstRun = harness.controller.getLatestAgentRunForThread("thread-1");
const deletedOutputEntryId = firstRun?.outputEntryId ?? "";
harness.commentManager.deleteComment(deletedOutputEntryId, 500);

assert.equal(await harness.controller.retryRun(firstRun?.id ?? ""), true);
await waitForAgentQueueToDrain(harness.controller);

const retry = harness.controller.getLatestAgentRunForThread("thread-1");
assert.notEqual(retry?.outputEntryId, deletedOutputEntryId);
assert.equal(harness.commentManager.getCommentById(deletedOutputEntryId)?.deletedAt, 500);
assert.equal(harness.commentManager.getCommentById(retry?.outputEntryId ?? "")?.comment, "Second reply");
assert.equal(harness.commentManager.getCommentById(retry?.outputEntryId ?? "")?.deletedAt, undefined);
assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1"), null);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "creates a fresh reply when the prior output was deleted" .test-dist/tests/commentAgentController.test.js
```

Expected: FAIL because the retry reuses the deleted output ID.

### Task 2: Reject deleted retry outputs

**Files:**
- Modify: `src/agents/commentAgentController.ts`
- Test: `tests/commentAgentController.test.ts`

- [ ] **Step 1: Make retry output eligibility explicit**

Resolve the stored output once and retain its ID only when it is visible:

```ts
const storedRetryOutput = storedRetryOutputEntryId
    ? this.host.getCommentManager().getCommentById(storedRetryOutputEntryId)
    : null;
const retryOutputEntryId = storedRetryOutput && storedRetryOutput.deletedAt === undefined
    ? storedRetryOutput.id
    : undefined;
```

Do not restore, edit, or purge the deleted output.

- [ ] **Step 2: Run the focused test and verify GREEN**

Run the focused command from Task 1. Expected: PASS with a fresh visible output entry and the deleted entry unchanged.

- [ ] **Step 3: Run the controller and rendering regression suites**

Run:

```bash
node --test .test-dist/tests/commentAgentController.test.js .test-dist/tests/streamedAgentReplyController.test.js .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: all tests pass.

### Task 3: Verify and sync

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-optimistic-agent-completion-design.md`

- [ ] **Step 1: Run the complete build and artifact guard**

Run `npm run build`. Require all tests, lint, typecheck, Obsidian compliance, bundling, and inspection of `main.js`, `manifest.json`, and `styles.css` to pass.

- [ ] **Step 2: Mark the tracked regression items complete**

Mark only the deleted-output implementation and verification checklist items `[x]`, then run `git diff --check` and scan the spec for placeholders or contradictions.

- [ ] **Step 3: Install and reload the verified build**

```bash
node scripts/install-built-plugin.mjs --vault /path/to/vault
obsidian plugin:reload id=aside vault=lean-startup
```

Compare installed `main.js`, `manifest.json`, and `styles.css` byte-for-byte with the repository build.

- [ ] **Step 4: Record the result in the original Aside thread**

Append a concise implementation and verification result to comment `630ce20f-c966-4f4f-8245-f37facd1c79b` in `clippings/Omarchy Quattro.md` using `scripts/append-note-comment-entry.mjs`.
