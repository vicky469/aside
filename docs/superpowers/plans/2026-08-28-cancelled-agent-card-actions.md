# Cancelled Agent Card Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a cancelled agent card's status visible for 30 seconds while immediately restoring its normal persisted actions and reliably clearing the stream overlay when retention expires.

**Architecture:** `StreamedAgentReplyController` will continue borrowing the persisted card, but it will suppress snapshotted actions only while a stream is queued or running. Terminal streams will reattach the exact saved nodes and handlers. `CommentAgentController` will turn terminal-stream pruning into an observable lifecycle transition by emitting the existing null stream update consumed by `AsideView`.

**Tech Stack:** TypeScript, Obsidian DOM APIs, Node test runner, repository fake DOM/test harnesses, npm build pipeline.

---

## File Map

- Modify `src/ui/views/streamedAgentReplyController.ts`: distinguish busy and terminal stream presentation and restore borrowed action nodes for terminal streams.
- Modify `tests/streamedAgentReplyController.test.ts`: reproduce the cancelled-card DOM bug and protect running-card action suppression.
- Modify `src/agents/commentAgentController.ts`: emit a null stream update when retained terminal state expires.
- Modify `tests/commentAgentController.test.ts`: reproduce the silent-prune boundary with a controlled timer.
- Modify `docs/superpowers/specs/2026-08-28-cancelled-agent-card-actions-design.md`: mark implementation and verification items complete only after fresh evidence.

### Task 1: Restore persisted actions for terminal stream cards

**Files:**
- Modify: `tests/streamedAgentReplyController.test.ts`
- Modify: `src/ui/views/streamedAgentReplyController.ts:20-220`
- Modify: `src/ui/views/streamedAgentReplyController.ts:350-380`

- [ ] **Step 1: Add fake action elements to the stream-controller test harness**

Add these focused fakes below `FakeContainerElement` in `tests/streamedAgentReplyController.test.ts`:

```ts
class FakeActionButton extends FakeContainerElement {
    public textContent = "";
    public onclick: ((event: {
        preventDefault(): void;
        stopPropagation(): void;
    }) => void) | null = null;
}

class FakeActionContainer extends FakeContainerElement {
    public createEl(_tagName: "button", options: { cls: string; text: string }): FakeActionButton {
        const button = new FakeActionButton();
        button.className = options.cls;
        button.textContent = options.text;
        this.childNodes.push(button);
        return button;
    }
}
```

Extend `FakeContainerElement` with a no-op-compatible attribute setter already present in the class; `FakeActionButton` inherits it for the Cancel button's `type` attribute.

- [ ] **Step 2: Write the failing cancelled-card action test**

Add a test beside the existing borrowed-footer test. It uses the controller's real action/footer synchronization methods and the same snapshot shape used in production:

```ts
test("streamed agent reply controller restores borrowed actions after cancellation", () => {
    const controller = new StreamedAgentReplyController("thread-1", {
        onCancelRun: () => {},
    }) as any;
    const labelEl = new FakeLabelElement();
    const statusEl = new FakeContainerElement();
    const footerMetaEl = new FakeContainerElement();
    const actionsEl = new FakeActionContainer();
    const editNode = createFakeNode("edit");
    const deleteNode = createFakeNode("delete");
    const footerActionNode = createFakeNode("footer-action");
    actionsEl.childNodes = [editNode, deleteNode];
    footerMetaEl.childNodes = [labelEl, statusEl, footerActionNode];

    controller.ownsCard = false;
    controller.labelEl = labelEl;
    controller.statusEl = statusEl;
    controller.footerMetaEl = footerMetaEl;
    controller.borrowedSnapshot = {
        metaText: "saved meta",
        labelClassName: "saved-label",
        labelText: "Gemini",
        labelHidden: false,
        labelDisplay: "",
        statusClassName: "saved-status",
        statusNodes: [],
        statusAriaLabel: null,
        statusTitle: null,
        footerMetaClassName: "aside-thread-footer-meta",
        footerMetaNodes: [labelEl, statusEl, footerActionNode],
        contentNodes: [],
        actionsClassName: "aside-comment-actions",
        actionsNodes: [editNode, deleteNode],
    };

    const stream = {
        runId: "run-1",
        status: "cancelled",
    };
    controller.syncBorrowedFooterMeta(stream);
    controller.syncActions(actionsEl, stream);

    assert.deepEqual(actionsEl.childNodes, [editNode, deleteNode]);
    assert.deepEqual(footerMetaEl.childNodes, [labelEl, statusEl, footerActionNode]);
});
```

- [ ] **Step 3: Strengthen the running-state characterization**

Update the existing `hides borrowed footer actions while streaming` test to pass a running stream into `syncBorrowedFooterMeta`, and add this header-action assertion:

```ts
const actionsEl = new FakeActionContainer();
actionsEl.childNodes = [createFakeNode("delete")];
controller.syncBorrowedFooterMeta({ runId: "run-1", status: "running" });
controller.syncActions(actionsEl, { runId: "run-1", status: "running" });

assert.deepEqual(footerMetaEl.childNodes, [labelEl, statusEl]);
assert.equal(actionsEl.childNodes.length, 1);
assert.equal((actionsEl.childNodes[0] as FakeActionButton).textContent, "Cancel");
```

- [ ] **Step 4: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/streamedAgentReplyController.test.js
```

Expected: the new cancelled-card test fails because `syncBorrowedFooterMeta` removes the footer action and `syncActions` removes the edit/delete nodes. The running characterization remains green.

- [ ] **Step 5: Implement busy-versus-terminal action synchronization**

Add a narrow predicate near the controller options:

```ts
function isAgentStreamBusy(stream: Pick<AgentRunStreamState, "status">): boolean {
    return stream.status === "queued" || stream.status === "running";
}
```

Pass the stream into footer synchronization from `sync`:

```ts
this.syncBorrowedFooterMeta(stream);
```

Replace `syncActions` with terminal-aware behavior:

```ts
private syncActions(actionsEl: HTMLDivElement, stream: AgentRunStreamState): void {
    actionsEl.replaceChildren();
    if (!isAgentStreamBusy(stream)) {
        if (!this.ownsCard && this.borrowedSnapshot) {
            actionsEl.replaceChildren(...this.borrowedSnapshot.actionsNodes);
        }
        return;
    }

    if (!this.options.onCancelRun) {
        return;
    }

    const cancelButton = actionsEl.createEl("button", {
        cls: "aside-agent-stream-cancel-button",
        text: "Cancel",
    });
    cancelButton.setAttribute("type", "button");
    cancelButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.options.onCancelRun?.(stream.runId);
    };
}
```

Replace `syncBorrowedFooterMeta` with:

```ts
private syncBorrowedFooterMeta(stream: AgentRunStreamState): void {
    if (this.ownsCard || !this.footerMetaEl || !this.labelEl || !this.statusEl) {
        return;
    }

    if (!isAgentStreamBusy(stream) && this.borrowedSnapshot) {
        this.footerMetaEl.replaceChildren(...this.borrowedSnapshot.footerMetaNodes);
        return;
    }

    this.footerMetaEl.replaceChildren(this.labelEl, this.statusEl);
}
```

Do not recreate persisted controls or handlers.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/streamedAgentReplyController.test.js .test-dist/tests/sidebarCardActionState.test.js .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: all selected tests pass, including immediate restoration for cancelled cards and Cancel-only behavior for running cards.

- [ ] **Step 7: Commit the renderer fix**

```bash
git add src/ui/views/streamedAgentReplyController.ts tests/streamedAgentReplyController.test.ts
git commit -m "fix(agents): restore cancelled card actions"
```

### Task 2: Notify the view when retained stream state expires

**Files:**
- Modify: `tests/commentAgentController.test.ts`
- Modify: `src/agents/commentAgentController.ts:1628-1665`

- [ ] **Step 1: Write the failing retention-expiry test**

Add this test near the existing cancellation stream tests. It controls the browser timer without waiting 30 seconds and restores the global descriptor afterward:

```ts
test("comment agent controller emits a clear update when terminal retention expires", () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    let scheduledCallback: (() => void) | null = null;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout(callback: () => void) {
                scheduledCallback = callback;
                return 1;
            },
            clearTimeout() {},
        },
    });

    try {
        const harness = createHarness();
        const updates: Array<{ threadId: string; stream: unknown }> = [];
        const unsubscribe = harness.controller.subscribeToStreamUpdates((update) => {
            updates.push(update);
        });
        const controller = harness.controller as any;
        controller.setRunStream({
            runId: "retained-run",
            threadId: "thread-1",
            requestedAgent: "codex",
            runtime: "direct-cli",
            status: "cancelled",
            statusText: "Cancelled",
            partialText: "",
            startedAt: 100,
            updatedAt: 101,
        });
        updates.length = 0;

        assert.ok(scheduledCallback);
        scheduledCallback();

        assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1"), null);
        assert.deepEqual(updates, [{ threadId: "thread-1", stream: null }]);
        unsubscribe();
        harness.controller.dispose();
    } finally {
        if (previousWindow) {
            Object.defineProperty(globalThis, "window", previousWindow);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});
```

- [ ] **Step 2: Run the focused lifecycle test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "terminal retention expires" .test-dist/tests/commentAgentController.test.js
```

Expected: FAIL because the stream disappears but `updates` remains empty.

- [ ] **Step 3: Make terminal pruning observable**

Rename `scheduleSilentRunStreamPrune` to `scheduleRunStreamPrune` at its definition and call site. Implement the timer callback as:

```ts
const timer = timerWindow.setTimeout(() => {
    this.runStreamPruneTimers.delete(runId);
    const stream = this.runStreams.get(runId);
    if (!stream) {
        return;
    }

    this.runStreams.delete(runId);
    this.emitStreamUpdate(stream.threadId, null);
}, FINAL_STREAM_RETENTION_MS);
```

This uses the current retained stream as the source of the thread id and emits nothing if the run was already cleared.

- [ ] **Step 4: Run cancellation and stream lifecycle tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentAgentController.test.js .test-dist/tests/streamedAgentReplyController.test.js
```

Expected: all selected tests pass, including cancellation-before-text, cancellation-after-partial-text, and retention expiry.

- [ ] **Step 5: Commit the lifecycle fix**

```bash
git add src/agents/commentAgentController.ts tests/commentAgentController.test.ts
git commit -m "fix(agents): clear retained stream views"
```

### Task 3: Complete tracking and repository verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-28-cancelled-agent-card-actions-design.md`
- Verify: `main.js`
- Verify: `manifest.json`
- Verify: `styles.css`

- [ ] **Step 1: Run the complete build**

Run:

```bash
npm run build
```

Expected: TypeScript and `.mjs` tests pass with zero failures, followed by lint, typecheck, Obsidian compliance, production bundling, and `Release artifact inspection passed for main.js, manifest.json, styles.css`.

- [ ] **Step 2: Inspect the exact shipped assets independently**

Run:

```bash
rg -n -F \
  -e sourceMappingURL \
  -e sourcesContent \
  -e '-----BEGIN PRIVATE KEY-----' \
  -e '-----BEGIN RSA PRIVATE KEY-----' \
  -e '-----BEGIN EC PRIVATE KEY-----' \
  -e '-----BEGIN OPENSSH PRIVATE KEY-----' \
  main.js manifest.json styles.css
```

Expected: exit 1 with no matches.

Run:

```bash
rg -n "AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[0-9A-Za-z]{30,}|sk-[0-9A-Za-z]{20,}" \
  main.js manifest.json styles.css
```

Expected: exit 1 with no matches.

- [ ] **Step 3: Mark the tracked spec complete**

In `docs/superpowers/specs/2026-08-28-cancelled-agent-card-actions-design.md`, change every pending implementation and verification checkbox to `[x]` only after Steps 1-2 pass.

- [ ] **Step 4: Review the final diff and working tree**

Run:

```bash
git diff --check
git status --short
git diff --stat 07bb452..HEAD
```

Expected: no whitespace errors; only the two controllers, their focused tests, and tracking documents are changed by this bug fix.

- [ ] **Step 5: Commit verification tracking**

```bash
git add docs/superpowers/specs/2026-08-28-cancelled-agent-card-actions-design.md
git commit -m "docs: verify cancelled card actions"
```
