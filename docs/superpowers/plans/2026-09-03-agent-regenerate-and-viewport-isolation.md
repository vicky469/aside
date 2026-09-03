# Agent Regenerate And Viewport Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate one existing agent reply without duplicates while preserving concurrent runs for other prompts and preventing agent activity from moving or saving an unrelated draft.

**Architecture:** Add a preserving external reload path to the shared agent-run store, then enforce duplicate exclusion by trigger entry inside the shared agent controller. Keep replacement rendering in the existing stream-card path, remove Generate's unrelated draft-save prerequisite, and place one draft-aware navigation policy at the sidebar interaction boundary used by every provider.

**Tech Stack:** TypeScript, Node test runner, Obsidian plugin API, esbuild.

---

### Task 1: Preserve active runs across external settings reloads

**Files:**
- Modify: `src/agents/agentRunStorePlanner.ts`
- Modify: `src/agents/agentRunStore.ts`
- Modify: `src/main.ts`
- Test: `tests/agentRunStorePlanner.test.ts`

- [ ] **Step 1: Write the failing store regression**

Add a test that loads a queued local run, replaces the host snapshot with older terminal data, calls `await store.reloadPreservingActiveRuns()`, and asserts that the local queued run survives while unrelated persisted records load:

```ts
test("AgentRunStore preserves active local runs across external reloads", async () => {
    let persistedData: PersistedPluginData = {
        agentRuns: [createRun({ id: "local-run", status: "queued" })],
    };
    const store = new AgentRunStore({
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: async (updater) => {
            persistedData = updater({ ...persistedData });
            return { ...persistedData };
        },
    });
    store.load();
    persistedData = {
        agentRuns: [createRun({ id: "remote-run", status: "succeeded", createdAt: 50 })],
    };

    await store.reloadPreservingActiveRuns();

    assert.deepEqual(store.getRuns().map((run) => run.id), ["remote-run", "local-run"]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRunStorePlanner.test.js
```

Expected: compilation fails because `reloadPreservingActiveRuns` does not exist.

- [ ] **Step 3: Implement the preserving merge and reload path**

Export a pure merge helper from `agentRunStorePlanner.ts` that overlays local `queued` and `running` records by id onto the normalized external snapshot and appends active local records absent from it. In `AgentRunStore`, factor persisted normalization/path resolution into one private reader, keep `load()` as startup replacement, and add a mutation-queue-serialized reload:

```ts
public async reloadPreservingActiveRuns(): Promise<void> {
    await this.enqueueMutation(async () => {
        this.runs = mergePersistedAgentRunsPreservingActive(
            this.readPersistedRuns(),
            this.runs,
        );
    });
}
```

Change `onExternalSettingsChange()` in `src/main.ts` to await this preserving reload:

```ts
await this.agentRunStore.reloadPreservingActiveRuns();
```

Leave startup `initialize()` on `load()` so stale runs from a previous process are still reconciled normally.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the two commands from Step 2. Expected: all `agentRunStorePlanner` tests pass.

### Task 2: Reject only duplicate regeneration for the same trigger

**Files:**
- Modify: `src/agents/commentAgentController.ts`
- Test: `tests/commentAgentController.test.ts`

- [ ] **Step 1: Write failing controller regressions**

Add one test that holds a retry runtime open, invokes Generate again through the original and latest run ids, and asserts one retry run and one output id. Add a second assertion to the existing same-thread parallel test proving a different trigger still reaches `running` concurrently.

The duplicate assertion must use trigger identity, not thread identity:

```ts
const sameTriggerRuns = harness.controller.getAgentRuns()
    .filter((run) => run.triggerEntryId === "thread-1");
assert.equal(sameTriggerRuns.length, 2); // original plus one retry
assert.equal(new Set(sameTriggerRuns.map((run) => run.outputEntryId)).size, 1);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentAgentController.test.js
```

Expected: the repeated Generate call starts a competing retry or creates an additional run.

- [ ] **Step 3: Add the same-trigger active-run guard**

In `retryPromptForCommentInternal`, after reloading the latest comment and before runtime selection or output allocation, search the shared store for a `queued` or `running` run whose `triggerEntryId` equals `latestComment.id`. If present, return `false` with `AGENT_REPLY_SAVE_PENDING_NOTICE`.

Do not compare only `threadId`: distinct trigger entries in one thread must continue through the existing concurrency queue independently.

- [ ] **Step 4: Run the focused controller test and verify GREEN**

Run the commands from Step 2. Expected: all controller tests pass, including the existing parallel-across-threads and parallel-within-one-thread regressions.

### Task 3: Keep Generate isolated from unrelated drafts

**Files:**
- Modify: `src/ui/views/sidebarPersistedComment.ts`
- Test: `tests/sidebarPersistedComment.test.ts`

- [ ] **Step 1: Write the failing Generate action regression**

Render an agent prompt card with a successful stored run, provide a `saveVisibleDraftIfPresent` spy that returns `false`, click Generate, and assert the retry still starts while the save spy remains untouched:

```ts
assert.equal(saveVisibleDraftCalls, 0);
assert.deepEqual(retriedAgentRunIds, ["run-1"]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: Generate calls `saveVisibleDraftIfPresent` and does not start the retry.

- [ ] **Step 3: Remove the generic save-first hook from Generate only**

Delete this block from the Generate click handler:

```ts
if (!(await host.saveVisibleDraftIfPresent())) {
    retryButton.disabled = options.disableRetryAction === true;
    return;
}
```

Keep save-first behavior for editing, deleting, moving, inserting, and script actions unchanged.

- [ ] **Step 4: Run the focused sidebar test and verify GREEN**

Run the commands from Step 2. Expected: all `sidebarPersistedComment` tests pass.

### Task 4: Block source reveal while another draft is active

**Files:**
- Modify: `src/ui/views/sidebarInteractionController.ts`
- Modify: `src/ui/views/AsideView.ts`
- Test: `tests/sidebarInteractionController.test.ts`

- [ ] **Step 1: Write failing navigation-policy regressions**

Extend the interaction harness so `getCurrentFile` and `getDraftForView` can expose a draft. Assert that `openCommentInEditor(comment-1)` neither changes the active comment nor calls `revealComment` when draft `draft-2` is visible. Assert normal reveal without a draft and allow the same persisted id when the draft id equals the target id.

```ts
assert.equal(harness.controller.getActiveCommentId(), null);
assert.deepEqual(harness.revealedComments, []);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarInteractionController.test.js
```

Expected: the unrelated target becomes active and is revealed.

- [ ] **Step 3: Implement one shared draft-aware navigation policy**

Add an exported pure policy and a public controller guard:

```ts
export function shouldRevealPersistedComment(
    activeDraft: Pick<DraftComment, "id"> | null,
    targetCommentId: string,
): boolean {
    return !activeDraft || activeDraft.id === targetCommentId;
}

public canNavigateToComment(commentId: string): boolean {
    const currentFile = this.host.getCurrentFile();
    const activeDraft = currentFile ? this.host.getDraftForView(currentFile.path) : null;
    return shouldRevealPersistedComment(activeDraft, commentId);
}
```

Call the guard at the start of `openCommentInEditor`. Also call it at the start of `AsideView`'s `openCommentFromCard` adapter so the index-reveal branch cannot bypass the policy. A blocked navigation must not call `setActiveComment`, reveal, focus, or save.

- [ ] **Step 4: Run the focused navigation test and verify GREEN**

Run the commands from Step 2. Expected: all `sidebarInteractionController` tests pass.

### Task 5: Verify, track, commit, and install

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-agent-regenerate-and-viewport-isolation-design.md`
- Generated: `main.js`
- Inspect: `main.js`, `manifest.json`, `styles.css`

- [ ] **Step 1: Run change-surface and diff checks**

Run:

```bash
rg -n "agentRunStore\.load|reloadPreservingActiveRuns|saveVisibleDraftIfPresent|canNavigateToComment" src tests
git diff --check
```

Expected: startup alone uses replacement `load`, external settings uses preserving reload, Generate has no save-first call, navigation routes through the shared guard, and no whitespace errors exist.

- [ ] **Step 2: Run the full build**

Run:

```bash
npm run build
```

Expected: all tests, lint, typecheck, Obsidian compliance, bundle, and release artifact guard pass.

- [ ] **Step 3: Inspect the exact shipped artifacts**

Run:

```bash
ls -lh main.js manifest.json styles.css
rg -n "sourceMappingURL|sourcesContent" main.js manifest.json styles.css
find . -maxdepth 1 -type f \( -name '*.map' -o -name '*.ts' -o -name '*.tsx' -o -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' \)
```

Expected: only the three intended plugin assets are installed, no source-map references or embedded sources are found, and no secret-bearing release files are present.

- [ ] **Step 4: Update the tracked spec**

Mark every implemented and freshly verified checklist item `[x]`; leave any item unchecked if its evidence did not pass.

- [ ] **Step 5: Commit the implementation**

Stage only the plan, spec, source, tests, and generated bundle, then commit with:

```text
fix(agents): isolate concurrent regeneration
```

- [ ] **Step 6: Install and reload in `lean-startup`**

Run:

```bash
npm run dev:install-built -- --vault /path/to/vault
obsidian plugin:reload id=aside vault=lean-startup
```

Then compare `main.js`, `manifest.json`, and `styles.css` byte-for-byte with the installed plugin directory. Expected: all three match.
