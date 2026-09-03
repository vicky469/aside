# Optimistic Agent Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show `✅ <agent>` as soon as a valid runtime answer exists, replace retry output with one background write, and keep the same visible answer as `❌ <agent> · Couldn’t save reply` if persistence fails.

**Architecture:** `CommentAgentController` owns a provider-neutral runtime-complete/persistence-pending phase without adding it to durable `AgentRunStatus`. A retained optimistic stream is the visible source of truth while the durable run stays `running`; retry persistence replaces the prior output once, then a successful refresh hands the same card back to persisted rendering. `CommentMutationController` remains the sole canonical mutation adapter.

**Tech Stack:** TypeScript, Node test runner, Obsidian plugin DOM, existing agent run store and sidecar persistence.

---

### Task 1: Lock down optimistic completion and atomic retry persistence

**Files:**
- Modify: `tests/commentAgentController.test.ts`
- Modify: `src/agents/commentAgentController.ts`

- [ ] **Step 1: Replace the delayed-clear regression with a final-write gate**

Build the first run normally, then block only the retry edit whose body is `"Second reply"`. Resolve the second runtime independently and subscribe to streams. Before releasing the edit, assert:

```ts
assert.equal(secondRuntimeFinished, true);
assert.equal(stream?.status, "succeeded");
assert.equal(stream?.partialText, "Second reply");
assert.equal(stream?.statusHintText, undefined);
assert.deepEqual(
    harness.editedEntries.filter((entry) => entry.commentId === "generated-2"),
    [{ commentId: "generated-2", body: "Second reply" }],
);
```

The test must also assert that no edit with an empty body occurred and that the durable retry run remains `running` while the final edit is blocked.

- [ ] **Step 2: Run the atomic retry test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "shows success before one retry replacement finishes" .test-dist/tests/commentAgentController.test.js
```

Expected: FAIL because retry still clears the old output first and completion remains `running` until final persistence returns.

- [ ] **Step 3: Remove the retry-clear persistence barrier**

Delete `runOutputReady`, `clearRetryOutputEntry`, and their disposal/cleanup branches. In `retryPromptForCommentInternal`, keep assigning the prior `outputEntryId`, then call `enqueueRun(run)` directly. Preserve the prompt-context filter that removes `run.outputEntryId` from a retry transcript.

The queued stream emitted by `enqueueRun` remains responsible for immediately blanking the borrowed card in memory; no empty canonical edit is needed.

- [ ] **Step 4: Add explicit retained-stream and persistence-phase ownership**

Add controller-owned sets:

```ts
private readonly persistingReplyRunIds = new Set<string>();
private readonly retainedRunStreamIds = new Set<string>();
```

Clear both in `dispose`. Change terminal scheduling in `setRunStreamState` to:

```ts
if (
    (stream.status === "succeeded" || stream.status === "failed" || stream.status === "cancelled")
    && !this.retainedRunStreamIds.has(stream.runId)
) {
    this.scheduleRunStreamPrune(stream.runId);
}
```

Add focused helpers that add/remove retention before publishing or clearing a stream. Do not put this transient phase in `AgentRunRecord` or persisted plugin data.

- [ ] **Step 5: Publish optimistic success before waiting for output persistence**

Split reply preparation from canonical completion. After runtime validation and annotation-proposal handling produce a non-empty final `replyText`:

```ts
this.persistingReplyRunIds.add(options.run.id);
this.retainedRunStreamIds.add(options.run.id);
this.updateRunStream(options.run.id, this.buildRunStreamState({
    ...options.run,
    ...mergeAgentRunMetadata(options.run, options.replyMetadata ?? {}),
}, {
    status: "succeeded",
    statusHintText: undefined,
    processLogLines: this.runStreams.get(options.run.id)?.processLogLines,
    partialText: replyText,
    startedAt: options.startedAt,
    updatedAt: this.host.now(),
    outputEntryId: options.outputEntryId,
}));
```

Only after this stream update should execution await `outputReady` and call the canonical final edit. Keep the durable run `running` until both operations succeed.

- [ ] **Step 6: Finalize persistence and handoff without a visual transition**

After the final edit succeeds, update the durable run to `succeeded`, refresh views, then remove the persistence/retention markers and clear the stream. Keep the visible stream in place throughout slow edit, run-store update, duplicate cleanup, and refresh.

If refresh rejects, retain the optimistic stream instead of restoring a stale borrowed-card snapshot. Change `refreshStatusViews` to return a success boolean while preserving its contained warning log.

- [ ] **Step 7: Run the atomic retry test and controller suite**

Run the focused command from Step 2, then:

```bash
node --test .test-dist/tests/commentAgentController.test.js
```

Expected: the retry performs no empty edit, displays optimistic success while the one final edit is blocked, and all controller tests pass.

### Task 2: Keep persistence failure visible in the same card

**Files:**
- Modify: `tests/commentAgentController.test.ts`
- Modify: `src/agents/commentAgentController.ts`

- [ ] **Step 1: Write a failing final-edit rejection test**

Make the retry runtime return `"Second reply"` and make only the final edit reject with `new Error("Sidecar write failed")`. Assert after the queue drains:

```ts
const stream = harness.controller.getActiveAgentStreamForThread("thread-1");
assert.equal(stream?.status, "failed");
assert.equal(stream?.statusHintText, "Couldn’t save reply");
assert.equal(stream?.partialText, "Second reply");
assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "First reply");
assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.status, "failed");
```

Call the stream-prune test hook or advance the fake timer past `FINAL_STREAM_RETENTION_MS` and assert the failed stream is still present.

- [ ] **Step 2: Run the persistence-failure test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "keeps an unsaved completed reply visible" .test-dist/tests/commentAgentController.test.js
```

Expected: FAIL because the current generic failure path either retries persistence with the reply body or loses the requested status hint/retention contract.

- [ ] **Step 3: Add a dedicated reply-persistence failure path**

Catch output preparation, final edit, durable run update, duplicate cleanup, and handoff failures after optimistic success separately from runtime failures. Immediately publish:

```ts
this.retainedRunStreamIds.add(run.id);
this.setRunStream(this.buildRunStreamState(run, {
    status: "failed",
    statusHintText: "Couldn’t save reply",
    processLogLines: existingStream?.processLogLines,
    partialText: replyText,
    startedAt,
    updatedAt: this.host.now(),
    outputEntryId,
    error: summarizeError(error),
}));
```

Do not call the ordinary `failRun` reply-write fallback for this case: a retry must preserve the previous durable reply as rollback protection. Attempt to mark the durable run failed, contain/log any store error, remove only `persistingReplyRunIds`, and retain the stream until a later retry or controller disposal.

- [ ] **Step 4: Prevent overlapping cancel and regenerate**

At the start of `cancelRun`, return `false` when `persistingReplyRunIds` contains the run. At the start of `retryRun`, do the same and show a concise notice such as `"That agent reply is still being saved."`. When a later retry of a retained failed run is accepted, clear the previous retained stream so it cannot remain as stale in-memory state.

- [ ] **Step 5: Run failure, cancellation, and retry tests**

Run:

```bash
node --test --test-name-pattern "unsaved completed reply|cancel|retry" .test-dist/tests/commentAgentController.test.js
node --test .test-dist/tests/commentAgentController.test.js
```

Expected: failed persistence keeps the answer and ❌ hint visible, overlapping mutations are rejected, and existing runtime-failure behavior remains unchanged.

### Task 3: Verify one-card rendering and provider-neutral presentation

**Files:**
- Modify: `tests/streamedAgentReplyController.test.ts`
- Modify: `tests/sidebarPersistedComment.test.ts` only if the shared status policy needs characterization coverage

- [ ] **Step 1: Add optimistic state identity coverage**

Sync one owned or borrowed card through `running → succeeded → failed`, retaining its reference after each call. Assert:

```ts
assert.equal(controller.cardEl, originalCard);
assert.equal(controller.statusMarkEl, originalStatusMark);
assert.equal(contentEl.textContent, "Second reply");
assert.equal(statusHintEl.textContent, "Couldn’t save reply");
```

Also assert exactly one card with the run/output identifiers exists throughout the transition.

- [ ] **Step 2: Add representative peer-provider coverage**

Run the same optimistic-success controller path with `@gemini` (or another supported peer) and assert its stream becomes `succeeded` before persistence resolves and uses the shared actor label. Do not add provider-specific completion branches.

- [ ] **Step 3: Run rendering and controller suites**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentAgentController.test.js .test-dist/tests/streamedAgentReplyController.test.js .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: all focused suites pass with stable card/marker identity and provider-neutral completion behavior.

### Task 4: Verify, review, track, and sync

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-optimistic-agent-completion-design.md`

- [ ] **Step 1: Run the complete build**

Run `npm run build` and require zero test, lint, typecheck, compliance, bundle, or artifact-guard failures.

- [ ] **Step 2: Inspect the exact public artifacts**

Run `node scripts/check-release-artifacts.mjs`. Require exactly `main.js`, `manifest.json`, and `styles.css`, with no source maps, `sourceMappingURL`, embedded `sourcesContent`, raw TypeScript/JSX-family source, secrets, or local-only files.

- [ ] **Step 3: Request an independent scoped code review**

Review only the optimistic-completion diff against the approved spec. Resolve every Critical or Important finding, then rerun focused tests and the complete build.

- [ ] **Step 4: Update tracked spec state**

Mark only freshly implemented and verified checklist items `[x]`. Run a placeholder, contradiction, and ambiguity scan plus `git diff --check`.

- [ ] **Step 5: Install and reload the verified build**

Run:

```bash
node scripts/install-built-plugin.mjs --vault /path/to/vault
obsidian plugin:reload id=aside vault=lean-startup
```

Compare installed `main.js`, `manifest.json`, and `styles.css` byte-for-byte with the repository build.

- [ ] **Step 6: Validate the original experience**

Retry a representative agent reply in `lean-startup` with persistence delayed or instrumented. Confirm the card shows `✅ <agent>` when the runtime returns, performs no empty retry edit, stays visually stable during persistence, and ends as the canonical persisted card. If a safe live persistence-failure injection is unavailable, rely on the deterministic controller rejection test and report that limitation.
