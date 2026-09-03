# Immediate Agent Start Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show `Starting <agent>…` immediately and launch the runtime without waiting for a full sidebar refresh.

**Architecture:** `CommentAgentController.enqueueRun` will publish provider-neutral queued stream state as soon as the run is stored, start queue processing, and detach comment-view refresh from the launch path. `executeRun` will preserve that hint while moving the same stream to running and will likewise avoid blocking runtime launch on view reconciliation. The existing stream renderer continues to display only the latest hint and reconcile transient/persisted cards by run and output identifiers.

**Tech Stack:** TypeScript, Node test runner, Obsidian plugin DOM, existing agent run store and stream controller.

---

### Task 1: Lock down immediate feedback and launch

**Files:**
- Modify: `tests/commentAgentController.test.ts`
- Modify: `src/agents/commentAgentController.ts`

- [ ] **Step 1: Extend the controller harness with a controllable refresh**

Add an optional asynchronous refresh hook:

```ts
onRefreshCommentViews?: (controller: CommentAgentController) => void | Promise<void>;
```

Await it in the harness host so a test can hold the real refresh promise open:

```ts
refreshCommentViews: async () => {
    refreshCount += 1;
    await options.onRefreshCommentViews?.(controller);
},
```

- [ ] **Step 2: Write the failing delayed-refresh regression test**

Add a test that blocks every refresh, subscribes before saving, and records runtime launch:

```ts
test("comment agent controller shows starting status and launches while refresh is blocked", async () => {
    let releaseRefresh!: () => void;
    const blockedRefresh = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
    });
    let runtimeStarted = false;
    const updates: AgentRunStreamState[] = [];
    const harness = createHarness({
        onRefreshCommentViews: async () => blockedRefresh,
        customRunAgentRuntime: async () => {
            runtimeStarted = true;
            return { runtime: "direct-cli", replyText: "Done" };
        },
    });
    const unsubscribe = harness.controller.subscribeToStreamUpdates((update) => {
        if (update.stream) updates.push(update.stream);
    });

    const savePromise = harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex answer this",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(runtimeStarted, true);
    assert.equal(updates[0]?.status, "queued");
    assert.equal(updates[0]?.statusHintText, "Starting Codex…");

    releaseRefresh();
    await savePromise;
    await waitForAgentQueueToDrain(harness.controller);
    unsubscribe();
});
```

Import `AgentRunStreamState` from `src/core/agents/agentRuns` for the typed update list.

- [ ] **Step 3: Run the regression test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "shows starting status and launches while refresh is blocked" .test-dist/tests/commentAgentController.test.js
```

Expected: FAIL because no queued stream is emitted and `handleSavedUserEntry` remains behind refresh.

- [ ] **Step 4: Publish queued state before background reconciliation**

Import the actor label from the core registry:

```ts
import {
    getAgentActorLabel,
    resolveUnsupportedAgentNotice,
} from "../core/agents/agentActorRegistry";
```

Add a focused formatter beside the agent constants:

```ts
function formatAgentStartingHint(target: AsideAgentTarget): string {
    return `Starting ${getAgentActorLabel(target)}…`;
}
```

Change `enqueueRun` so storage remains durable but UI reconciliation is detached:

```ts
private async enqueueRun(run: AgentRunRecord): Promise<void> {
    await this.store.addRun(run);
    this.setRunStream(this.buildRunStreamState(run, {
        status: "queued",
        statusHintText: formatAgentStartingHint(run.requestedAgent),
        partialText: "",
        startedAt: run.createdAt,
        updatedAt: this.host.now(),
        outputEntryId: run.outputEntryId,
    }));
    void this.refreshStatusViews();
    void this.host.log?.("info", "agents", "agents.run.queued", {
        runId: run.id,
        threadId: run.threadId,
        requestedAgent: run.requestedAgent,
        runtime: run.runtime,
    });
    void this.processQueue();
}
```

- [ ] **Step 5: Preserve the starting hint and remove the second refresh barrier**

When building `initialStream` in `executeRun`, carry forward the queued hint:

```ts
const queuedStream = this.runStreams.get(runId);
const initialStream = this.buildRunStreamState(runningRun, {
    status: "running",
    statusHintText: queuedStream?.statusHintText
        ?? formatAgentStartingHint(runningRun.requestedAgent),
    partialText: queuedStream?.partialText ?? "",
    startedAt: runningRun.startedAt ?? startedAt,
    updatedAt: this.host.now(),
    outputEntryId,
});
this.setRunStream(initialStream);
void this.refreshStatusViews();
```

Remove the existing `await this.refreshStatusViews()` and redundant later `emitStreamUpdate`, because `setRunStream` stores and emits atomically. Continue directly to logging and `executeLocalRun`.

- [ ] **Step 6: Run the regression test and verify GREEN**

Run the command from Step 3.

Expected: PASS; `runtimeStarted` becomes true while refresh is unresolved and the first update is queued with `Starting Codex…`.

- [ ] **Step 7: Run focused controller tests**

Run:

```bash
node --test .test-dist/tests/commentAgentController.test.js
```

Expected: all controller tests pass with no unhandled rejection or duplicate stream update.

- [ ] **Step 8: Commit the controller slice**

```bash
git add src/agents/commentAgentController.ts tests/commentAgentController.test.ts
git commit -m "fix(agents): show start status without blocking"
```

### Task 2: Lock down single-line stream presentation

**Files:**
- Modify: `tests/streamedAgentReplyController.test.ts`

- [ ] **Step 1: Add a queued-start rendering test**

Exercise the real `syncStatus` seam with queued state:

```ts
test("streamed agent reply controller shows starting hint on one grey status line", () => {
    const controller = new StreamedAgentReplyController("thread-1") as any;
    const statusEl = new FakeStatusElement();

    controller.syncStatus(statusEl, "Codex", {
        runId: "run-1",
        threadId: "thread-1",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "queued",
        statusHintText: "Starting Codex…",
        partialText: "",
        startedAt: 100,
        updatedAt: 100,
    });

    assert.equal(statusEl.childNodes.length, 2);
    assert.equal((statusEl.childNodes[1] as FakeStatusChildElement).textContent, "Starting Codex…");
});
```

- [ ] **Step 2: Run the focused rendering test**

Run:

```bash
node --test --test-name-pattern "shows starting hint on one grey status line" .test-dist/tests/streamedAgentReplyController.test.js
```

Expected: PASS because the existing renderer already places the spinner/queued mark and latest hint in one status element. This is characterization coverage; if it fails, make the smallest renderer correction needed to keep both nodes inside `.aside-agent-run-status`.

- [ ] **Step 3: Run both focused suites**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentAgentController.test.js .test-dist/tests/streamedAgentReplyController.test.js
```

Expected: both suites pass.

- [ ] **Step 4: Commit characterization coverage**

```bash
git add tests/streamedAgentReplyController.test.ts
git commit -m "test(agents): cover immediate start status"
```

### Task 3: Verify and close tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-immediate-agent-start-status-design.md`

- [ ] **Step 1: Run the complete build**

Run:

```bash
npm run build
```

Expected: all tests, lint, typecheck, Obsidian compliance, production bundle, and release artifact checks pass.

- [ ] **Step 2: Inspect the shipped artifacts**

Run:

```bash
node scripts/check-release-artifacts.mjs
```

Expected: `main.js`, `manifest.json`, and `styles.css` pass with no source map, embedded source, raw TypeScript/JSX, or secret-bearing artifact.

- [ ] **Step 3: Update the tracked specification**

Mark every implemented and freshly verified item in `## Implementation Tracking` as `[x]`. Do not change the user-experience or scope decisions.

- [ ] **Step 4: Commit verification tracking**

```bash
git add docs/superpowers/specs/2026-09-03-immediate-agent-start-status-design.md
git commit -m "docs(agents): complete immediate start status"
```
