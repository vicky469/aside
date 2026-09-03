# Immediate Agent Start Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show `Starting <agent>…` immediately, launch without waiting for sidebar refresh, and keep the spinner and card visually stable through queued-to-running handoff.

**Architecture:** `CommentAgentController` publishes provider-neutral queued stream state as soon as the run is stored and keeps refresh off the launch path. The shared agent-status presentation maps both active states to one spinner. `StreamedAgentReplyController` reconciles status children in place and keeps an owned run card when its output entry id becomes known, so neither animation nor card identity resets during handoff.

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

### Task 4: Keep the active marker and card stable

**Files:**
- Modify: `tests/sidebarPersistedComment.test.ts`
- Modify: `tests/streamedAgentReplyController.test.ts`
- Modify: `src/ui/views/sidebarPersistedComment.ts`
- Modify: `src/ui/views/streamedAgentReplyController.ts`

- [ ] **Step 1: Change the marker-policy test to require one spinner for both active states**

Replace the queued/running distinction assertion with:

```ts
test("getAgentRunStatusPresentation uses one spinner for queued and running", () => {
    for (const status of ["queued", "running"] as const) {
        assert.deepEqual(getAgentRunStatusPresentation(status), {
            marker: null,
            markerKind: "spinner",
        });
    }
});
```

- [ ] **Step 2: Add failing DOM-identity coverage**

Extend the streamed-card fakes with stable parent, connection, attribute, `closest`, `querySelector`, `appendChild`, `insertBefore`, and `remove` behavior. Add one test that calls `syncStatus` first with queued `Starting Codex…`, then with running progress, and asserts:

```ts
const queuedMark = statusEl.childNodes[0];
controller.syncStatus(statusEl, "Codex", runningStream);
assert.equal(statusEl.childNodes[0], queuedMark);
assert.equal((statusEl.childNodes[1] as FakeStatusChildElement).textContent, "Reading note context");
```

Add a second test that seeds an owned connected card with `data-agent-run-id="run-1"`, calls `ensureCard(threadEl, repliesEl, "entry-1")`, and asserts the returned object is the original card rather than a replacement.

- [ ] **Step 3: Run both tests and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "one spinner for queued and running|reuses the spinner node|adopts an output entry id" .test-dist/tests/sidebarPersistedComment.test.js .test-dist/tests/streamedAgentReplyController.test.js
```

Expected: FAIL because queued maps to `…`, `syncStatus` replaces every child, and `ensureCard` clears the owned card when `outputEntryId` first appears.

- [ ] **Step 4: Unify queued and running marker policy**

In `getAgentRunStatusPresentation`, make queued use the same presentation as running:

```ts
case "queued":
case "running":
    return { marker: null, markerKind: "spinner" };
```

Keep this function as the single policy owner consumed by persisted and streamed agent cards.

- [ ] **Step 5: Reconcile the status subtree without recreating it**

Add cached fields to `StreamedAgentReplyController`:

```ts
private statusMarkEl: HTMLSpanElement | null = null;
private statusTextEl: HTMLSpanElement | null = null;
private statusHintEl: HTMLSpanElement | null = null;
```

Populate them when borrowing or recovering a card, initialize `statusMarkEl` when creating a card, and clear all three references in `clear`. Rewrite `syncStatus` so it:

- reuses `statusMarkEl` while updating its class and text;
- creates/removes `statusTextEl` only when terminal status text appears/disappears;
- reuses `statusHintEl` and changes only `textContent` for new progress;
- preserves child order as marker, terminal text, hint.

Do not call `statusEl.replaceChildren()` during ordinary stream updates.

- [ ] **Step 6: Reuse the owned card when output identity arrives**

Inside the connected-card branch of `ensureCard`, treat the current owned card as matching when its run id still equals `this.runId`, even if the new `outputEntryId` is not yet its persisted `data-comment-id`:

```ts
const ownsMatchingRunCard = this.ownsCard
    && cardRunId !== null
    && cardRunId === this.runId;
const targetMatches = outputEntryId
    ? cardCommentId === outputEntryId || ownsMatchingRunCard
    : cardRunId === this.runId;
```

The normal `sync` tail then assigns `data-agent-output-entry-id`. A later full refresh may hand off to the canonical persisted card, but queued-to-running no longer removes the visible transient card.

- [ ] **Step 7: Run the identity tests and focused suites**

Run the command from Step 3, then:

```bash
node --test .test-dist/tests/sidebarPersistedComment.test.js .test-dist/tests/streamedAgentReplyController.test.js .test-dist/tests/commentAgentController.test.js
```

Expected: all focused tests pass and the same marker/card objects survive active-state updates.

- [ ] **Step 8: Commit the smooth transition**

```bash
git add src/ui/views/sidebarPersistedComment.ts src/ui/views/streamedAgentReplyController.ts tests/sidebarPersistedComment.test.ts tests/streamedAgentReplyController.test.ts
git commit -m "fix(agents): smooth active status transitions"
```

### Task 5: Verify, install, and close smoothness tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-immediate-agent-start-status-design.md`

- [ ] **Step 1: Run the complete build**

Run `npm run build` and expect all tests, lint, typecheck, Obsidian compliance, bundle, and artifact checks to pass.

- [ ] **Step 2: Re-run the exact artifact guard**

Run `node scripts/check-release-artifacts.mjs` and expect only `main.js`, `manifest.json`, and `styles.css`, with no maps, embedded sources, raw TypeScript/JSX, or secret-bearing files.

- [ ] **Step 3: Complete and commit the tracked spec**

Mark the smoothness implementation and verification items `[x]`, then commit only the spec with:

```bash
git add -f docs/superpowers/specs/2026-09-03-immediate-agent-start-status-design.md
git commit -m "docs(agents): complete smooth start transition"
```

- [ ] **Step 4: Merge locally and sync `lean-startup`**

Fast-forward the verified branch into local `main`, rebuild the combined dirty tree, install with:

```bash
node scripts/install-built-plugin.mjs --vault /path/to/vault
obsidian plugin:reload id=aside vault=lean-startup
```

Then compare all three installed assets byte-for-byte with the repository build.
