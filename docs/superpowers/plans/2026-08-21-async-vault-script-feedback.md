# Async Vault Script Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an immediate spinner reply for accepted vault scripts, then reduce `english-to-chinese` translation latency with four-way bounded concurrency and adjacent bilingual formatting.

**Architecture:** Persist a queued script run with its output entry id before execution, append the empty reply with a pre-persistence sidebar refresh, and detach the existing serial execution queue from saved-entry routing. The translation script will use an asynchronous shell-free child-process adapter and a tested bounded worker pool, preserve batch order, and keep one atomic note write after all batches succeed.

**Tech Stack:** TypeScript 5.9, Obsidian comment persistence, Node test runner, Node ESM, `node:child_process.spawn`, Codex CLI, esbuild.

---

## File Structure

### Aside repository

- Modify: `src/comments/commentMutationController.ts` — add an opt-in refresh immediately after the in-memory append and before persistence.
- Modify: `src/vaultScripts/commentScriptController.ts` — create/associate the empty output reply before execution, detach queue execution, and edit the pending reply on every terminal path.
- Modify: `tests/commentMutationController.test.ts` — prove the pre-persistence refresh ordering.
- Modify: `tests/commentScriptController.test.ts` — prove immediate return, pending association, in-place success/failure, serial execution, and retry behavior.
- Modify: `docs/superpowers/specs/2026-08-21-async-vault-script-feedback-design.md` — record implementation and verification evidence after it passes.

### Active vault

- Modify: `/Users/example/Obsidian/lean-startup/🛠️ scripts/english-to-chinese.mjs` — adjacent bilingual formatting, smaller batches, bounded concurrency, and async Codex processes.
- Modify: `/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/english-to-chinese.test.mjs` — formatting, batching, concurrency, order, and async process tests.

The active vault is not a Git repository. Its script and test changes are verified in place but cannot be included in an Aside Git commit.

## Task 1: Render the pending script reply before persistence completes

**Files:**
- Modify: `src/comments/commentMutationController.ts:18-28,448-493`
- Modify: `tests/commentMutationController.test.ts:48-204,604-694`

- [ ] **Step 1: Add a failing refresh-order test**

Add this test after the existing appended-entry ordering tests in `tests/commentMutationController.test.ts`:

```ts
test("comment mutation controller can refresh an appended entry before persistence settles", async () => {
    const existing = createComment({ id: "thread-1", comment: "Original" });
    let releasePersist = () => {};
    let persistStarted = false;
    const host = createHost({
        knownComments: [existing],
        loadedComments: [existing],
        persistCommentsForFile: async () => {
            persistStarted = true;
            await new Promise<void>((resolve) => {
                releasePersist = resolve;
            });
        },
    });

    const appendPromise = host.controller.appendThreadEntry(existing.id, {
        id: "pending-script-output",
        body: "",
        timestamp: 400,
    }, {
        insertAfterCommentId: existing.id,
        alwaysInsertAfterTarget: true,
        refreshBeforePersist: true,
        skipCommentViewRefresh: true,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(persistStarted, true);
    assert.equal(host.getRefreshCommentViewsCount(), 1);
    assert.equal(
        host.manager.getCommentById("pending-script-output")?.comment,
        "",
    );

    releasePersist();
    assert.equal(await appendPromise, true);
});
```

- [ ] **Step 2: Run the focused test and verify the option is rejected**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because `refreshBeforePersist` is not part of `AppendThreadEntryOptions`.

- [ ] **Step 3: Implement the pre-persistence refresh option**

Extend the option type in `src/comments/commentMutationController.ts`:

```ts
type AppendThreadEntryOptions = PersistOptions & {
    insertAfterCommentId?: string;
    alwaysInsertAfterTarget?: boolean;
    refreshBeforePersist?: boolean;
};
```

Immediately after the in-memory append/reorder block and before `persistCommentsForFile`, add:

```ts
if (options.refreshBeforePersist) {
    await this.host.refreshCommentViews({ skipDataRefresh: true });
}
```

Keep `refreshBeforePersist` out of `buildPersistOptionsForComment`; it controls only the one early local refresh, while `skipCommentViewRefresh` continues to suppress the later persistence-driven refresh.

- [ ] **Step 4: Run the comment-mutation test**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentMutationController.test.js
```

Expected: PASS, including the new test while its persistence promise is held open.

- [ ] **Step 5: Commit the isolated persistence slice**

```bash
git add src/comments/commentMutationController.ts tests/commentMutationController.test.ts
git commit -m "feat(comments): allow early append refresh"
```

## Task 2: Create and complete script replies asynchronously

**Files:**
- Modify: `src/vaultScripts/commentScriptController.ts:16-31,135-411`
- Modify: `tests/commentScriptController.test.ts:39-177,179-686`
- Test: `tests/sidebarPersistedComment.test.ts:1361-1372`

- [ ] **Step 1: Add deterministic async-test helpers**

Add these helpers above `createHarness` in `tests/commentScriptController.test.ts`:

```ts
function createDeferred<T>() {
    let resolve = (_value: T) => {};
    let reject = (_error: unknown) => {};
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error("Timed out waiting for script controller state.");
}

async function waitForRunStatus(
    harness: ReturnType<typeof createHarness>,
    triggerEntryId: string,
    status: ScriptRunRecord["status"],
): Promise<void> {
    await waitForCondition(() => harness.store.getRuns().some((run) => (
        run.triggerEntryId === triggerEntryId && run.status === status
    )));
}
```

Extend the harness's appended-entry record with the two relevant options:

```ts
const appendedEntries: Array<{
    threadId: string;
    entryId: string;
    body: string;
    insertAfterCommentId?: string;
    alwaysInsertAfterTarget?: boolean;
    refreshBeforePersist?: boolean;
}> = [];
```

Record those options in the host adapter and make the harness mirror production ordering:

```ts
appendedEntries.push({
    threadId,
    entryId: entry.id,
    body: entry.body,
    ...(appendOptions?.insertAfterCommentId
        ? { insertAfterCommentId: appendOptions.insertAfterCommentId }
        : {}),
    ...(appendOptions?.alwaysInsertAfterTarget !== undefined
        ? { alwaysInsertAfterTarget: appendOptions.alwaysInsertAfterTarget }
        : {}),
    ...(appendOptions?.refreshBeforePersist !== undefined
        ? { refreshBeforePersist: appendOptions.refreshBeforePersist }
        : {}),
});
```

Change the harness reorder condition to:

```ts
if (
    appendOptions?.insertAfterCommentId
    && (appendOptions.alwaysInsertAfterTarget
        || appendOptions.insertAfterCommentId !== threadId)
) {
    commentManager.reorderThreadEntries(
        threadId,
        entry.id,
        appendOptions.insertAfterCommentId,
        "after",
    );
}
```

- [ ] **Step 2: Add failing pending-success and pending-failure tests**

Add these tests before the existing first-save test:

```ts
test("accepted script appends a spinner reply and returns before runtime completion", async () => {
    const runtime = createDeferred<VaultScriptRuntimeResult>();
    const harness = createHarness({ runVaultScript: async () => runtime.promise });
    let handled: boolean | undefined;
    const handling = harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    }).then((value) => {
        handled = value;
        return value;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
        assert.equal(handled, true);
        assert.equal(harness.appendedEntries.length, 1);
        assert.equal(harness.appendedEntries[0]?.body, "");
        assert.equal(harness.appendedEntries[0]?.alwaysInsertAfterTarget, true);
        assert.equal(harness.appendedEntries[0]?.refreshBeforePersist, true);
        assert.equal(harness.editedEntries.length, 0);
        const pending = harness.store.getRuns()[0];
        assert.ok(pending?.outputEntryId);
        assert.equal(pending.outputEntryId, harness.appendedEntries[0]?.entryId);
        assert.ok(pending.status === "queued" || pending.status === "running");
    } finally {
        runtime.resolve({ stdout: "cleaned", stderr: "" });
    }

    assert.equal(await handling, true);
    await waitForRunStatus(harness, "thread-1", "succeeded");
    assert.deepEqual(harness.editedEntries, [{
        id: harness.appendedEntries[0]!.entryId,
        body: "Script /clean:\n\ncleaned",
    }]);
    assert.equal(harness.appendedEntries.length, 1);
});

test("failed background script replaces the pending reply in place", async () => {
    const runtime = createDeferred<VaultScriptRuntimeResult>();
    const harness = createHarness({ runVaultScript: async () => runtime.promise });

    assert.equal(await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    }), true);
    assert.equal(harness.appendedEntries[0]?.body, "");

    runtime.reject(Object.assign(new Error("Command failed"), {
        stderr: "bad input",
    }));
    await waitForRunStatus(harness, "thread-1", "failed");

    assert.equal(harness.appendedEntries.length, 1);
    assert.deepEqual(harness.editedEntries, [{
        id: harness.appendedEntries[0]!.entryId,
        body: "Script /clean:\n\nbad input",
    }]);
});
```

- [ ] **Step 3: Run the controller test and verify the old lifecycle fails**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentScriptController.test.js
```

Expected: FAIL because `handleSavedUserEntry` still awaits execution and no empty output entry exists while the runtime is pending.

- [ ] **Step 4: Extend the script host append contract**

Change `CommentScriptHost.appendThreadEntry` options to:

```ts
options?: {
    insertAfterCommentId?: string;
    alwaysInsertAfterTarget?: boolean;
    refreshBeforePersist?: boolean;
    skipCommentViewRefresh?: boolean;
},
```

No `src/main.ts` logic change is required: its adapter already forwards the options object to `CommentMutationController.appendThreadEntry`.

- [ ] **Step 5: Allocate the output id with the queued run**

In `buildQueuedRun`, allocate both ids before the run is stored:

```ts
private buildQueuedRun(
    event: SavedUserEntryEvent,
    resolution: Extract<ScriptDirectiveResolution, { kind: "script" }>,
): ScriptRunRecord {
    return {
        id: this.host.createRunId(),
        threadId: event.threadId,
        triggerEntryId: event.entryId,
        filePath: event.filePath,
        scriptPath: resolution.script.path,
        mentionName: resolution.script.mentionName,
        status: "queued",
        promptText: event.body,
        createdAt: this.host.now(),
        outputEntryId: this.host.createRunId(),
    };
}
```

Add a dedicated pending append method so `writeOutput` remains the edit-or-final-append helper:

```ts
private async appendPendingOutput(run: ScriptRunRecord): Promise<void> {
    if (!run.outputEntryId) {
        throw new Error("Unable to prepare the vault script result.");
    }
    const appended = await this.host.appendThreadEntry(
        run.threadId,
        {
            id: run.outputEntryId,
            body: "",
            timestamp: this.host.now(),
        },
        {
            insertAfterCommentId: run.triggerEntryId,
            alwaysInsertAfterTarget: true,
            refreshBeforePersist: true,
            skipCommentViewRefresh: true,
        },
    );
    if (!appended) {
        throw new Error("Unable to save the vault script result.");
    }
}
```

- [ ] **Step 6: Detach execution after the durable pending state**

Replace the accepted-run branch in `handleSavedUserEntry` with:

```ts
const run = this.buildQueuedRun(event, resolution);
await this.store.addRun(run);
try {
    await this.appendPendingOutput(run);
} catch (error) {
    const message = summarizeScriptError(error);
    await this.terminalizeFailedRun(run.id, message);
    this.host.showNotice(message);
    await this.host.refreshCommentViews();
    return true;
}
await this.host.refreshCommentViews();
this.enqueue(run);
return true;
```

Change `enqueue` to recover unexpected execution errors without poisoning the serial queue, while still returning a completion promise for explicit retries:

```ts
private enqueue(run: ScriptRunRecord): Promise<void> {
    const execution = this.executionQueue.then(() => this.execute(run));
    const recovered = execution.catch(async (error) => {
        if (this.disposed) return;
        const message = summarizeScriptError(error);
        await this.finishRun(
            run,
            "failed",
            formatScriptResult(run.mentionName, message),
            message,
        );
    });
    this.executionQueue = recovered.then(
        () => undefined,
        () => undefined,
    );
    return recovered;
}
```

Detach only automatic saved-entry execution:

```ts
void this.enqueue(run);
```

Keep explicit retries awaited so `retryingRunIds` continues to guard the full retry lifecycle:

```ts
await this.enqueue(next);
```

- [ ] **Step 7: Make every terminal path edit the pending reply**

Add this helper next to `terminalizeFailedRun`:

```ts
private async finishRun(
    run: ScriptRunRecord,
    status: "succeeded" | "failed",
    body: string,
    error?: string,
): Promise<void> {
    try {
        const outputEntryId = await this.writeOutput(run, body);
        if (this.disposed) return;
        await this.store.updateRun(run.id, (current) => ({
            ...current,
            status,
            endedAt: this.host.now(),
            outputEntryId,
            error,
        }));
    } catch (outputError) {
        const message = summarizeScriptError(outputError);
        await this.terminalizeFailedRun(run.id, message);
        this.host.showNotice(message);
    }
    await this.host.refreshCommentViews();
}
```

Use it for both registry revalidation failures:

```ts
await this.finishRun(
    run,
    "failed",
    formatScriptResult(run.mentionName, SCRIPT_CHANGED_BEFORE_EXECUTION_ERROR),
    SCRIPT_CHANGED_BEFORE_EXECUTION_ERROR,
);
return;
```

Capture the stored running record and pass it through later completion:

```ts
const runningRun = await this.store.updateRun(run.id, (current) => ({
    ...current,
    status: "running",
    startedAt: this.host.now(),
}));
if (!runningRun) return;
await this.host.refreshCommentViews();
```

Replace the old final `writeOutput`/`updateRun` block with:

```ts
await this.finishRun(runningRun, status, body, runtimeError);
```

- [ ] **Step 8: Update existing controller assertions for detached completion**

For every test that inspects a terminal automatic run, add an explicit wait after `handleSavedUserEntry`:

```ts
await waitForRunStatus(harness, "thread-1", "succeeded");
```

or, for expected failures:

```ts
await waitForRunStatus(harness, "thread-1", "failed");
```

Update output assertions from the initial append to the terminal edit:

```ts
assert.equal(harness.appendedEntries[0]?.body, "");
assert.equal(harness.editedEntries.at(-1)?.body, "Script /clean:\n\ncleaned");
```

Update the append-failure regression to prove execution is prevented:

```ts
assert.equal(harness.runtimeCalls.length, 0);
assert.equal(harness.appendedEntries.length, 1);
assert.equal(run?.status, "failed");
```

In serial-queue tests, stop awaiting the already-detached handler promises. Wait for statuses instead:

```ts
await harness.controller.handleSavedUserEntry(firstEvent);
await waitForRunStatus(harness, "thread-1", "running");
await harness.controller.handleSavedUserEntry(secondEvent);
await waitForRunStatus(harness, "thread-2", "queued");
releaseFirst();
await waitForRunStatus(harness, "thread-1", "succeeded");
await waitForRunStatus(harness, "thread-2", "succeeded");
```

Select runs by `triggerEntryId` instead of generated ids because automatic runs now allocate one id for the run and one for its output entry.

- [ ] **Step 9: Run focused controller and presentation tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test \
  .test-dist/tests/commentMutationController.test.js \
  .test-dist/tests/commentScriptController.test.js \
  .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: PASS. The existing sidebar test must still report `markerKind: "spinner"` for queued and running script runs.

- [ ] **Step 10: Commit the Aside lifecycle change**

```bash
git add src/vaultScripts/commentScriptController.ts tests/commentScriptController.test.ts
git commit -m "feat(scripts): show pending replies"
```

## Task 3: Pair English and Chinese without an internal blank line

**Files:**
- Modify: `/Users/example/Obsidian/lean-startup/🛠️ scripts/english-to-chinese.mjs:63-94,215-235`
- Modify: `/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/english-to-chinese.test.mjs:4-76`

- [ ] **Step 1: Change the formatting expectations first**

Update the LF expected value in `english-to-chinese.test.mjs` to:

```js
assert.equal(
  translated,
  `---
title: Sample
---

First paragraph.
第一段。

Second paragraph.
第二段。
`,
);
```

Update the CRLF expected value to:

```js
assert.equal(
  translated,
  "First paragraph.\r\n第一段。\r\n\r\nSecond paragraph.\r\n第二段。\r\n",
);
```

- [ ] **Step 2: Add failing batch-boundary tests**

Export and import `makeBatches`, then add:

```js
test("makeBatches caps batches by paragraph count and source characters", () => {
  const sevenParagraphs = Array.from(
    { length: 7 },
    (_, index) => `Paragraph ${index + 1}.`,
  );
  assert.deepEqual(
    makeBatches(sevenParagraphs).map((batch) => batch.length),
    [6, 1],
  );

  assert.deepEqual(
    makeBatches(["a".repeat(2_000), "b".repeat(1_001)]).map((batch) => batch.length),
    [1, 1],
  );
});
```

- [ ] **Step 3: Run the vault test and verify both expectations fail**

Run:

```bash
node --test "/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/english-to-chinese.test.mjs"
```

Expected: FAIL because formatting still inserts two newlines and `makeBatches` is not exported with the new limits.

- [ ] **Step 4: Implement adjacent formatting and smaller batches**

Change the limits and export the batch planner:

```js
const maxBatchCharacters = 3_000;
const maxBatchParagraphs = 6;
```

```js
export function makeBatches(paragraphs) {
```

Change the translation insertion to one line break inside each bilingual pair:

```js
segments[segmentIndex] =
  `${paragraph}${plan.newline}${translation}${trailingNewline}`;
```

The existing separator segment remains untouched, so bilingual pairs still have one normal blank line between them.

- [ ] **Step 5: Run the vault test**

Run:

```bash
node --test "/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/english-to-chinese.test.mjs"
```

Expected: PASS for adjacent LF/CRLF formatting, repeat-run detection, parsing, and both batch limits.

## Task 4: Run translation batches concurrently with async child processes

**Files:**
- Modify: `/Users/example/Obsidian/lean-startup/🛠️ scripts/english-to-chinese.mjs:7,121-147,237-310`
- Modify: `/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/english-to-chinese.test.mjs`

- [ ] **Step 1: Add a child-process integration test**

Import `runChildProcess` and add:

```js
test("runChildProcess sends stdin and captures output without a shell", async () => {
  const result = await runChildProcess(
    process.execPath,
    [
      "-e",
      "process.stdin.setEncoding('utf8'); let text=''; process.stdin.on('data', chunk => text += chunk); process.stdin.on('end', () => process.stdout.write(text.toUpperCase()));",
    ],
    {
      cwd: process.cwd(),
      input: "translate me",
      maxBuffer: 1_024,
    },
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "TRANSLATE ME");
  assert.equal(result.stderr, "");
});
```

- [ ] **Step 2: Add a bounded-concurrency and ordering test**

Import `translateBatches` and add:

```js
test("translateBatches runs four workers and preserves input order", async () => {
  const batches = Array.from({ length: 5 }, (_, index) => [`paragraph-${index}`]);
  const releases = new Map();
  let active = 0;
  let maxActive = 0;
  let releaseFourStarted = () => {};
  const fourStarted = new Promise((resolve) => {
    releaseFourStarted = resolve;
  });

  const translationPromise = translateBatches(batches, async (_batch, index) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (maxActive === 4) releaseFourStarted();
    await new Promise((resolve) => releases.set(index, resolve));
    active -= 1;
    return [`translation-${index}`];
  });

  await fourStarted;
  assert.equal(maxActive, 4);
  assert.deepEqual([...releases.keys()], [0, 1, 2, 3]);

  releases.get(3)();
  while (!releases.has(4)) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (const index of [0, 1, 2, 4]) releases.get(index)();

  assert.deepEqual(await translationPromise, [
    "translation-0",
    "translation-1",
    "translation-2",
    "translation-3",
    "translation-4",
  ]);
  assert.equal(maxActive, 4);
});
```

- [ ] **Step 3: Run the vault test and verify the missing exports fail**

Run:

```bash
node --test "/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/english-to-chinese.test.mjs"
```

Expected: FAIL because `runChildProcess` and `translateBatches` do not exist.

- [ ] **Step 4: Implement the asynchronous shell-free process adapter**

Replace the import with:

```js
import { spawn } from "node:child_process";
```

Add this exported adapter before `translateBatch`:

```js
export function runChildProcess(executable, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    const collect = (chunks, byteCounter, chunk, label) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const nextBytes = byteCounter() + buffer.byteLength;
      if (nextBytes > options.maxBuffer) {
        const error = new Error(`${label} exceeded ${options.maxBuffer} bytes.`);
        error.code = "ENOBUFS";
        fail(error);
        return;
      }
      chunks.push(buffer);
      return nextBytes;
    };

    child.stdout.on("data", (chunk) => {
      const nextBytes = collect(stdoutChunks, () => stdoutBytes, chunk, "stdout");
      if (nextBytes !== undefined) stdoutBytes = nextBytes;
    });
    child.stderr.on("data", (chunk) => {
      const nextBytes = collect(stderrChunks, () => stderrBytes, chunk, "stderr");
      if (nextBytes !== undefined) stderrBytes = nextBytes;
    });
    child.once("error", fail);
    child.once("close", (status, signal) => {
      if (settled) return;
      settled = true;
      if (signal) {
        reject(new Error(`Codex translation stopped with signal ${signal}.`));
        return;
      }
      resolve({
        status: status ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") fail(error);
    });
    child.stdin.end(options.input);
  });
}
```

- [ ] **Step 5: Implement the ordered four-worker pool**

Add:

```js
export async function translateBatches(
  batches,
  translate = translateBatch,
  concurrency = 4,
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Translation concurrency must be a positive integer.");
  }
  const results = new Array(batches.length);
  let nextIndex = 0;

  async function work() {
    while (nextIndex < batches.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await translate(batches[index], index);
    }
  }

  const workerCount = Math.min(concurrency, batches.length);
  await Promise.all(Array.from({ length: workerCount }, () => work()));
  return results.flat();
}
```

In `main`, replace the serial loop with:

```js
const batches = makeBatches(plan.paragraphs.map((paragraph) => paragraph.source));
const translations = await translateBatches(batches);
```

- [ ] **Step 6: Wire `translateBatch` to the async adapter**

Replace `spawnSync` with:

```js
let result;
try {
  result = await runChildProcess(
    process.env.ASIDE_TRANSLATOR_CODEX_BIN || "codex",
    [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--cd",
      tempDir,
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "-",
    ],
    {
      cwd: vaultRoot,
      input: prompt,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
} catch (error) {
  if (error?.code === "ENOENT") {
    throw new Error("Codex CLI was not found in PATH.");
  }
  throw error;
}
if (result.status !== 0) {
  const detail = result.stderr.trim().split(/\r?\n/u).at(-1);
  throw new Error(`Codex translation failed${detail ? `: ${detail}` : "."}`);
}
```

Keep the existing per-batch temporary directory, schema validation, response parsing, `finally` cleanup, note-change check, and atomic rename unchanged.

- [ ] **Step 7: Run all vault-script tests from their required folder**

Run:

```bash
find "/Users/example/Obsidian/lean-startup/🛠️ scripts/tests" \
  -type f -name '*.test.mjs' -exec node --test {} +
```

Expected: all vault script tests PASS, including the async process and four-worker order tests.

## Task 5: Verify the integrated behavior and close tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-08-21-async-vault-script-feedback-design.md`
- Inspect: `main.js`, `manifest.json`, `styles.css`
- Install into: `/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/`

- [ ] **Step 1: Run the complete Aside test suite**

Run:

```bash
npm test
```

Expected: all compiled TypeScript and `.test.mjs` tests PASS.

- [ ] **Step 2: Build and inspect the exact shipped assets**

Run:

```bash
npm run build
```

Expected: lint, typecheck, Obsidian compliance, bundle, tests, and `release:artifacts:check` all PASS.

Then run:

```bash
find . -maxdepth 1 -type f \
  \( -name 'main.js' -o -name 'manifest.json' -o -name 'styles.css' -o -name 'main.js.map' \) \
  -print
rg -n "sourceMappingURL|sourcesContent" main.js manifest.json styles.css || true
```

Expected: only `main.js`, `manifest.json`, and `styles.css` are shippable; no `main.js.map`, `sourceMappingURL`, `sourcesContent`, raw TypeScript/JSX-family source, `.env*`, `.npmrc`, private key, or certificate is present in the artifact set.

- [ ] **Step 3: Install the built plugin and reload Aside**

Run:

```bash
npm run dev:install-built -- --vault "/Users/example/Obsidian/lean-startup"
obsidian plugin:reload id=aside vault=lean-startup
```

Expected: the installer reports copying `main.js`, `manifest.json`, and `styles.css`, and Obsidian reloads plugin id `aside`.

- [ ] **Step 4: Smoke-test the user-visible lifecycle**

In the `lean-startup` vault, use a disposable Markdown note containing at least seven untranslated English prose paragraphs and save a side note containing:

```text
/english-to-chinese
```

Verify all of the following:

1. An empty `Script` reply with the turning icon appears on the first sidebar refresh, targeting approximately 0.2 seconds under normal local conditions.
2. The editor remains responsive while translation runs.
3. At most four Codex translation processes run concurrently.
4. The same pending reply becomes the final `translated N paragraph(s)` response; no duplicate result reply appears.
5. Every Chinese translation is directly beneath its English source with no blank line inside the bilingual pair.
6. Bilingual pairs retain normal blank-line paragraph separation.
7. The disposable note is removed after verification.

- [ ] **Step 5: Mark the tracked spec complete with evidence**

In `docs/superpowers/specs/2026-08-21-async-vault-script-feedback-design.md`, mark each implemented item `[x]` only after its focused tests pass. Mark the build and smoke-test verification items `[x]` only after Steps 1-4 succeed.

Add a short evidence block at the end:

```markdown
## Verification Evidence

- `npm test` — passed on 2026-08-21.
- `npm run build` — passed on 2026-08-21, including the release artifact guard.
- Vault script tests under `🛠️ scripts/tests/` — passed on 2026-08-21.
- Built-plugin smoke test — pending reply appeared on the first refresh and was replaced in place; bilingual output used adjacent English/Chinese lines.
```

- [ ] **Step 6: Commit the verified tracking update**

```bash
git add docs/superpowers/specs/2026-08-21-async-vault-script-feedback-design.md
git commit -m "docs: verify async script feedback"
```

- [ ] **Step 7: Reply to the originating Aside thread**

Write a concise completion note to a temporary file, then append it through the canonical helper:

```bash
node scripts/append-note-comment-entry.mjs \
  --uri "obsidian://aside-comment?vault=lean-startup&file=Raw%2FWhy%20to%20Start%20a%20Startup%20in%20a%20Bad%20Economy.md&commentId=759a517e-f76f-48ff-92b7-cd6b434011a2" \
  --comment-file "/tmp/aside-async-script-feedback-reply.md"
```

The reply must state that script runs now show an immediate spinner reply, translation batches run with a four-process ceiling, English/Chinese lines are adjacent, and the relevant tests/build passed. Keep it under 250 words.
