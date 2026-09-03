# Agent Preflight Failure Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a retryable `❌ Failed` agent reply card whenever a supported local-agent preflight is blocked, showing a sanitized actionable diagnostic when possible and the existing provider-aware generic message otherwise.

**Architecture:** Runtime probes retain their existing short settings message and add bounded diagnostic detail from the failed process. Runtime selection carries the intended local runtime and diagnostic through a blocked result. The comment agent controller converts that result into the same persisted run/output-entry model used by executed agents, without starting a process, while `agentFailurePolicy.ts` remains the shared presentation-policy owner.

**Tech Stack:** TypeScript, Node test runner, Obsidian plugin persistence, local CLI child-process diagnostics.

---

### Task 1: Sanitize preflight diagnostics and preserve probe detail

**Files:**
- Modify: `src/agents/agentFailurePolicy.ts`
- Modify: `src/agents/agentRuntimeAdapter.ts:82-91,379-407,893-1103`
- Test: `tests/agentFailurePolicy.test.ts`
- Test: `tests/agentRuntimeAdapter.test.ts`

- [ ] **Step 1: Write failing presentation-policy tests**

Add tests that require actionable first-line errors, duplicate/stack removal, secret redaction, and provider fallback:

```ts
import { formatAgentPreflightFailureReply } from "../src/agents/agentFailurePolicy";

test("preflight failure reply keeps one actionable diagnostic line", () => {
    assert.equal(formatAgentPreflightFailureReply(
        "codex",
        "Error: Missing optional dependency @openai/codex-darwin-arm64.\n    at file:///opt/codex/bin.js:42:3\nError: Missing optional dependency @openai/codex-darwin-arm64.",
    ), "Missing optional dependency @openai/codex-darwin-arm64.");
});

test("preflight failure reply falls back when no useful diagnostic exists", () => {
    assert.equal(
        formatAgentPreflightFailureReply("codex", "\n    at file:///opt/codex/bin.js:42:3\n"),
        "Codex couldn’t complete this request. Try another agent.",
    );
});

test("preflight failure reply redacts obvious credentials", () => {
    const reply = formatAgentPreflightFailureReply("gemini", "Authentication failed for sk-abcdefghijklmnopqrstuvwxyz123456");
    assert.doesNotMatch(reply, /sk-abcdefghijklmnopqrstuvwxyz123456/u);
    assert.match(reply, /Authentication failed/u);
});
```

- [ ] **Step 2: Run the policy test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentFailurePolicy.test.js
```

Expected: compilation fails because `formatAgentPreflightFailureReply` is not exported.

- [ ] **Step 3: Implement the minimal shared presentation helper**

In `agentFailurePolicy.ts`, add a bounded sanitizer that removes ANSI escapes, trims `Error:` prefixes, ignores stack frames and command/environment lines, deduplicates lines, redacts obvious token patterns, caps the visible result, and falls back through the existing formatter:

```ts
const MAX_PREFLIGHT_FAILURE_REPLY_LENGTH = 500;

export function formatAgentPreflightFailureReply(
    target: AsideAgentTarget,
    diagnostic: string,
): string {
    const usefulLines = diagnostic
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
        .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/gu, "[redacted]")
        .split(/\r?\n/gu)
        .map((line) => line.trim().replace(/^Error:\s*/u, ""))
        .filter((line) => line.length > 0)
        .filter((line) => !/^(?:at\s|node:|npm ERR! command|PATH=|HOME=)/u.test(line));
    const firstUsefulLine = usefulLines.find((line, index) => usefulLines.indexOf(line) === index);
    if (!firstUsefulLine) {
        return `${getAgentActorLabel(target)} couldn’t complete this request. Try another agent.`;
    }
    return firstUsefulLine.length <= MAX_PREFLIGHT_FAILURE_REPLY_LENGTH
        ? firstUsefulLine
        : `${firstUsefulLine.slice(0, MAX_PREFLIGHT_FAILURE_REPLY_LENGTH - 3).trimEnd()}...`;
}
```

- [ ] **Step 4: Run the policy test and verify GREEN**

Run the command from Step 2.

Expected: all policy tests pass.

- [ ] **Step 5: Write failing runtime-probe tests for retained detail**

Extend `tests/agentRuntimeAdapter.test.ts` with a Codex probe whose callback returns an error plus stderr:

```ts
test("getCodexRuntimeDiagnostics retains actionable launcher stderr", async () => {
    resetResolvedAgentExecutionEnvForTests();
    const modules = createRuntimeModules((file, _args, _options, callback) => {
        if (file === "/bin/zsh") {
            callback(null, "/Users/test/.nvm/bin:/usr/bin\n", "");
            return createTrackedProcessStub();
        }
        callback(new Error("codex exited"), "", "Error: Missing optional dependency @openai/codex-darwin-arm64.\n    at launcher.js:20:3");
        return createTrackedProcessStub();
    });

    assert.deepEqual(await getCodexRuntimeDiagnostics(modules, {
        HOME: "/Users/test",
        PATH: "/usr/bin",
        SHELL: "/bin/zsh",
    }), {
        status: "unavailable",
        message: "Codex could not be launched from this Obsidian environment.",
        detail: "Error: Missing optional dependency @openai/codex-darwin-arm64.\n    at launcher.js:20:3",
    });
});
```

- [ ] **Step 6: Run the runtime test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern='retains actionable launcher stderr' .test-dist/tests/agentRuntimeAdapter.test.js
```

Expected: FAIL because probe diagnostics do not retain `detail`.

- [ ] **Step 7: Add diagnostic detail to all supported runtime probes**

Extend `AgentRuntimeDiagnostics` with `detail?: string`. Add one shared extractor that prefers bounded stderr, then the thrown error message:

```ts
function getRuntimeProbeFailureDetail(error: unknown): string | undefined {
    if (error && typeof error === "object" && "stderr" in error) {
        const stderr = (error as { stderr?: unknown }).stderr;
        if (typeof stderr === "string") {
            const normalized = normalizeRuntimeDiagnosticText(stderr);
            if (normalized) return normalized;
        }
    }
    if (error instanceof Error) {
        return normalizeRuntimeDiagnosticText(error.message) ?? undefined;
    }
    return undefined;
}
```

For the non-`ENOENT` catch branch in Codex, Claude, Cursor, Gemini, and OpenCode diagnostics, append:

```ts
detail: getRuntimeProbeFailureDetail(error),
```

Do not add `detail` to successful, missing-PATH, or unsupported results because their existing `message` is already the actionable diagnostic.

- [ ] **Step 8: Run focused policy and runtime tests**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentFailurePolicy.test.js .test-dist/tests/agentRuntimeAdapter.test.js
```

Expected: all tests pass.

- [ ] **Step 9: Commit diagnostic preservation**

```bash
git add src/agents/agentFailurePolicy.ts src/agents/agentRuntimeAdapter.ts tests/agentFailurePolicy.test.ts tests/agentRuntimeAdapter.test.ts
git commit -m "fix(agents): retain preflight diagnostics"
```

### Task 2: Carry blocked runtime context through selection

**Files:**
- Modify: `src/agents/agentRuntimeSelection.ts`
- Test: `tests/agentRuntimeSelection.test.ts`

- [ ] **Step 1: Change blocked-selection expectations first**

Update both blocked cases in `tests/agentRuntimeSelection.test.ts` to require the intended runtime and best diagnostic:

```ts
assert.deepEqual(resolveAgentRuntimeSelection({
    target: "codex",
    modePreference: "auto",
    localDiagnostics: {
        status: "unavailable",
        message: "Codex could not be launched from this Obsidian environment.",
        detail: "Missing optional dependency @openai/codex-darwin-arm64.",
    },
}), {
    kind: "blocked",
    runtime: "direct-cli",
    modePreference: "auto",
    notice: "Codex could not be launched from this Obsidian environment.",
    diagnostic: "Missing optional dependency @openai/codex-darwin-arm64.",
});
```

Keep an unsupported case without `detail` and expect its `message` as `diagnostic`.

- [ ] **Step 2: Run the selection test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeSelection.test.js
```

Expected: blocked selection lacks `runtime` and `diagnostic`.

- [ ] **Step 3: Extend the blocked selection type and planner**

Change `BlockedAgentRuntimeSelection` and `blockRuntimeSelection` to:

```ts
export interface BlockedAgentRuntimeSelection {
    kind: "blocked";
    runtime: "direct-cli";
    modePreference: AgentRuntimeModePreference;
    notice: string;
    diagnostic: string;
}

function blockRuntimeSelection(
    modePreference: AgentRuntimeModePreference,
    diagnostics: AgentRuntimeDiagnostics,
): BlockedAgentRuntimeSelection {
    return {
        kind: "blocked",
        runtime: "direct-cli",
        modePreference,
        notice: getLocalRuntimeUnavailableNotice(diagnostics),
        diagnostic: diagnostics.detail?.trim() || getLocalRuntimeUnavailableNotice(diagnostics),
    };
}
```

Pass `context.localDiagnostics` into the helper from `resolveAgentRuntimeSelection`.

- [ ] **Step 4: Run the selection tests and verify GREEN**

Run the command from Step 2.

Expected: all selection tests pass.

- [ ] **Step 5: Commit the selection contract**

```bash
git add src/agents/agentRuntimeSelection.ts tests/agentRuntimeSelection.test.ts
git commit -m "refactor(agents): carry blocked diagnostics"
```

### Task 3: Persist blocked initial requests as failed cards

**Files:**
- Modify: `src/agents/commentAgentController.ts:268-304,1473-1563`
- Test: `tests/commentAgentController.test.ts`

- [ ] **Step 1: Add a table-driven failing controller test**

Add a case for every supported target using `getSupportedAgentActors()` or the equivalent registry iterator. For each target, create a harness whose `runtimeSelection` is blocked, save the matching directive, and assert:

```ts
const run = harness.controller.getLatestAgentRunForThread("thread-1");
assert.equal(run?.requestedAgent, target);
assert.equal(run?.status, "failed");
assert.equal(run?.error, diagnostic);
assert.equal(run?.outputEntryId, "generated-2");
assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, expectedBody);
assert.deepEqual(harness.runtimeCalls, []);
assert.deepEqual(harness.notices, []);
```

Use one actionable diagnostic case and generic/stack-only diagnostics for the remaining providers so both presentation branches are covered without duplicating policy tests.

- [ ] **Step 2: Run the controller test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern='blocked preflight.*failed card' .test-dist/tests/commentAgentController.test.js
```

Expected: FAIL because the controller emits a notice and creates no run or card.

- [ ] **Step 3: Add one persisted preflight-failure helper**

Import `formatAgentPreflightFailureReply` and add a controller helper that stores the run, creates or reuses its output entry, marks it failed, refreshes views, and logs the diagnostic without starting the queue:

```ts
private async persistPreflightFailure(run: AgentRunRecord, diagnostic: string): Promise<boolean> {
    const failureText = formatAgentPreflightFailureReply(run.requestedAgent, diagnostic);
    const outputEntryId = run.outputEntryId ?? this.host.createCommentId();
    await this.store.addRun({ ...run, outputEntryId });
    const persisted = run.outputEntryId
        ? await this.host.editComment(outputEntryId, failureText, { skipCommentViewRefresh: true })
        : await this.host.appendThreadEntry(run.threadId, {
            id: outputEntryId,
            body: failureText,
            timestamp: this.host.now(),
        }, {
            insertAfterCommentId: run.triggerEntryId,
            alwaysInsertAfterTarget: true,
            skipCommentViewRefresh: true,
        });
    const failedRun = await this.store.updateRun(run.id, (currentRun) => ({
        ...currentRun,
        status: "failed",
        endedAt: this.host.now(),
        error: persisted ? diagnostic : "Unable to append the agent reply to the thread.",
    }));
    await this.refreshStatusViews();
    void this.host.log?.("warn", "agents", "agents.run.preflight-failed", {
        runId: run.id,
        threadId: run.threadId,
        requestedAgent: run.requestedAgent,
        runtime: run.runtime,
        error: diagnostic,
    });
    return !!failedRun && persisted;
}
```

Keep the helper provider-neutral. Do not call `enqueueRun` or `processQueue` for a blocked preflight.

- [ ] **Step 4: Route initial blocked selections through the helper**

Build the normal queued run before branching on selection. When selection is blocked, call `persistPreflightFailure(run, runtimeSelection.diagnostic)` and return. When resolved, retain the existing `enqueueRun`, skill log, and directive-detected log path.

- [ ] **Step 5: Run the controller test and verify GREEN**

Run the command from Step 2.

Expected: all provider cases pass, no runtime is invoked, and no transient notice is emitted.

- [ ] **Step 6: Run selection and controller tests together**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeSelection.test.js .test-dist/tests/commentAgentController.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit initial failed-card persistence**

```bash
git add src/agents/commentAgentController.ts tests/commentAgentController.test.ts
git commit -m "fix(agents): persist preflight failures"
```

### Task 4: Persist blocked retries without duplicate cards

**Files:**
- Modify: `src/agents/commentAgentController.ts:429-674`
- Test: `tests/commentAgentController.test.ts`

- [ ] **Step 1: Write a failing blocked-retry regression test**

Start with a saved `@codex` prompt and a previous failed run whose output entry exists. Configure blocked selection, invoke `retryRun`, and require one reused card:

```ts
assert.equal(await harness.controller.retryRun("run-old"), true);
const latest = harness.controller.getLatestAgentRunForThread("thread-1");
assert.equal(latest?.status, "failed");
assert.equal(latest?.retryOfRunId, "run-old");
assert.equal(latest?.outputEntryId, "reply-1");
assert.equal(harness.commentManager.getCommentById("reply-1")?.comment, "Codex was not found on PATH.");
assert.deepEqual(harness.appendedEntries, []);
assert.deepEqual(harness.runtimeCalls, []);
assert.deepEqual(harness.notices, []);
```

- [ ] **Step 2: Run the retry test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern='blocked retry.*failed card' .test-dist/tests/commentAgentController.test.js
```

Expected: FAIL because retry returns after a transient notice.

- [ ] **Step 3: Defer the blocked branch until retry output resolution**

In the direct-agent retry branch, retain the full `runtimeSelection` instead of returning immediately. Populate `requestedAgent`, `runtime`, `modePreference`, and `promptText` from either selection kind. After resolving `retryOutputEntryId` and building the new run:

```ts
if (runtimeSelection.kind === "blocked") {
    if (retryOutputEntryId) run.outputEntryId = retryOutputEntryId;
    return this.persistPreflightFailure(run, runtimeSelection.diagnostic);
}
```

Only call `clearRetryOutputEntry` and `enqueueRun` for resolved selections. This prevents briefly clearing the existing card before replacing it with a failed state.

- [ ] **Step 4: Run the retry test and verify GREEN**

Run the command from Step 2.

Expected: the existing output entry is reused, the retry run is failed and retryable, and no duplicate entry appears.

- [ ] **Step 5: Run all focused agent tests**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentFailurePolicy.test.js .test-dist/tests/agentRuntimeAdapter.test.js .test-dist/tests/agentRuntimeSelection.test.js .test-dist/tests/commentAgentController.test.js .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit retry behavior**

```bash
git add src/agents/commentAgentController.ts tests/commentAgentController.test.ts
git commit -m "fix(agents): persist blocked retries"
```

### Task 5: Audit, verify, install, and update tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-agent-preflight-failure-cards-design.md`

- [ ] **Step 1: Re-run the change-surface audit**

Run:

```bash
rg -n "couldn’t complete this request|preflight-failed|runtimeSelection.kind === \"blocked\"|showNotice\(runtimeSelection.notice" src tests docs/superpowers
```

Expected: generic failure copy has one production owner; direct initial/retry blocked branches use the shared persistence helper; no direct-agent blocked branch remains transient-notice-only.

- [ ] **Step 2: Run full production verification**

Run:

```bash
npm run build
```

Expected: tests, lint, typecheck, Obsidian compliance, production bundle, and release-artifact inspection pass.

- [ ] **Step 3: Inspect the exact shipped assets**

Run:

```bash
node scripts/check-release-artifacts.mjs
rg -n "sourceMappingURL|sourcesContent" main.js manifest.json styles.css
find . -maxdepth 2 \( -name 'main.js.map' -o -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' -o -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' \) -print
```

Expected: the guard passes; shipped assets contain no source-map markers or embedded sources; no forbidden file is part of the exact `main.js`, `manifest.json`, `styles.css` install set.

- [ ] **Step 4: Install the verified build into `lean-startup`**

Run:

```bash
npm run dev:install-built -- --vault /path/to/vault
```

Expected: `main.js`, `manifest.json`, and `styles.css` are installed into `/path/to/vault/.obsidian/plugins/aside`.

- [ ] **Step 5: Compare installed artifacts byte-for-byte**

Run:

```bash
/bin/zsh -lc 'plugin_dir="/path/to/vault/.obsidian/plugins/aside"; for artifact in main.js manifest.json styles.css; do cmp -s "$artifact" "$plugin_dir/$artifact" && result=match || result=mismatch; printf "%s: %s\n" "$artifact" "$result"; done'
```

Expected: all three assets report `match`.

- [ ] **Step 6: Mark the tracked spec complete only after evidence passes**

Change the implemented and verified items in `docs/superpowers/specs/2026-09-03-agent-preflight-failure-cards-design.md` from `[ ]` to `[x]`. Leave the original-thread manual retry unchecked if it cannot be performed without spending credits or mutating the user's note.

- [ ] **Step 7: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git diff -- src/agents/agentFailurePolicy.ts src/agents/agentRuntimeAdapter.ts src/agents/agentRuntimeSelection.ts src/agents/commentAgentController.ts tests/agentFailurePolicy.test.ts tests/agentRuntimeAdapter.test.ts tests/agentRuntimeSelection.test.ts tests/commentAgentController.test.ts docs/superpowers/specs/2026-09-03-agent-preflight-failure-cards-design.md
```

Expected: no whitespace errors; unrelated user changes remain untouched.

- [ ] **Step 8: Commit verification tracking**

```bash
git add -f docs/superpowers/specs/2026-09-03-agent-preflight-failure-cards-design.md docs/superpowers/plans/2026-09-03-agent-preflight-failure-cards.md
git commit -m "docs(agents): complete preflight failure cards"
```
