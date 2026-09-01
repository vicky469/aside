# Supported Agent Failure Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace recognized quota, billing, authentication, rate-limit, and availability garbage from every supported agent with a concise provider-aware reply while keeping the run visibly failed.

**Architecture:** Add one shared agent-failure policy that classifies high-confidence failure text and formats copy from the supported actor registry. Enforce it in the comment controller for both thrown runtime errors and failure-like text returned through a successful transport, while retaining raw diagnostics in the run record and using the existing failed-run retry flow.

**Tech Stack:** TypeScript, Node test runner, Obsidian sidebar rendering, local CLI agent adapters.

---

### Task 1: Add the shared supported-agent failure policy

**Files:**
- Create: `src/agents/agentFailurePolicy.ts`
- Create: `tests/agentFailurePolicy.test.ts`

- [x] **Step 1: Write the failing policy tests**

Create table-driven tests covering all supported user-facing actors and the main high-confidence diagnostic families:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
    formatKnownAgentFailureReply,
    isKnownAgentProviderFailure,
} from "../src/agents/agentFailurePolicy";

const cases = [
    ["codex", "You have insufficient credits", "Codex"],
    ["claude", "Credit balance is too low", "Claude Code"],
    ["cursor", "Authentication failed: please log in", "Cursor"],
    ["gemini", "RESOURCE_EXHAUSTED: quota exceeded", "Gemini"],
    ["deepseek", "Rate limit exceeded", "DeepSeek"],
] as const;

for (const [target, diagnostic, label] of cases) {
    test(`${target} receives the shared provider failure fallback`, () => {
        assert.equal(isKnownAgentProviderFailure(diagnostic), true);
        assert.equal(
            formatKnownAgentFailureReply(target, diagnostic),
            `${label} couldn’t complete this request. Try another agent.`,
        );
    });
}

test("ordinary agent prose is not classified as a provider failure", () => {
    assert.equal(isKnownAgentProviderFailure("Here is how API quotas work."), false);
    assert.equal(formatKnownAgentFailureReply("gemini", "Here is the answer."), null);
});
```

- [x] **Step 2: Run the policy tests and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentFailurePolicy.test.js
```

Expected: TypeScript compilation fails because `agentFailurePolicy.ts` does not exist.

- [x] **Step 3: Implement the shared classifier and formatter**

Create a focused module that derives labels from the actor registry and recognizes only explicit provider-failure signatures:

```ts
import type { AsideAgentTarget } from "../core/agents/agentActorDefinition";
import { getAgentActorLabel } from "../core/agents/agentActorRegistry";

const KNOWN_AGENT_PROVIDER_FAILURE_PATTERNS: readonly RegExp[] = [
    /\bresource_exhausted\b/iu,
    /\bresource has been exhausted\b/iu,
    /\b(?:quota|rate limit)(?: has been| was)? exceeded\b/iu,
    /\bexceeded (?:your )?(?:current )?quota\b/iu,
    /\byou(?:['’]ve| have)? (?:hit|reached) (?:your )?(?:current )?usage limit\b/iu,
    /\b429\b.{0,20}\btoo many requests\b/iu,
    /\b(?:insufficient|no|out of|exhausted) (?:api )?credits?\b/iu,
    /\bcredit balance\b.{0,40}\b(?:low|zero|empty|exhausted|insufficient)\b/iu,
    /\b(?:authentication|authorization) (?:failed|required)\b/iu,
    /\bnot (?:authenticated|authorized|logged in)\b/iu,
    /\b(?:billing|payment) (?:is )?(?:disabled|required|not enabled)\b/iu,
    /\b(?:service|model|runtime) (?:is )?(?:currently )?(?:unavailable|overloaded)\b/iu,
];

export function isKnownAgentProviderFailure(value: string): boolean {
    const normalized = value.replace(/\s+/gu, " ").trim();
    return normalized.length > 0
        && KNOWN_AGENT_PROVIDER_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function formatKnownAgentFailureReply(
    target: AsideAgentTarget,
    diagnostic: string,
): string | null {
    return isKnownAgentProviderFailure(diagnostic)
        ? `${getAgentActorLabel(target)} couldn’t complete this request. Try another agent.`
        : null;
}
```

- [x] **Step 4: Run the policy tests and verify GREEN**

Run the command from Step 2.

Expected: all policy tests pass.

### Task 2: Enforce the fallback for errors and successful-looking garbage

**Files:**
- Modify: `src/agents/commentAgentController.ts:975-1010,1130-1142`
- Modify: `tests/commentAgentController.test.ts`

- [x] **Step 1: Write failing controller regression tests**

Add one test where Gemini streams provider garbage and then throws a structured quota error. Assert the generic fallback replaces the partial text, the run remains failed, and the raw error remains in `run.error`. Add another test where a supported agent returns a failure sentence through a successful runtime result:

```ts
test("comment agent controller replaces streamed provider garbage on a known failure", async () => {
    const harness = createHarness({
        customRunAgentRuntime: async (invocation) => {
            invocation.onPartialText?.("RESOURCE_EXHAUSTED: quota exceeded and internal details");
            throw new Error("RESOURCE_EXHAUSTED: quota exceeded");
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@gemini summarize this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const run = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(run?.status, "failed");
    assert.equal(run?.error, "RESOURCE_EXHAUSTED: quota exceeded");
    assert.equal(
        harness.commentManager.getCommentById(run?.outputEntryId ?? "")?.comment,
        "Gemini couldn’t complete this request. Try another agent.",
    );
});

test("comment agent controller rejects provider failure text returned as success", async () => {
    const harness = createHarness({
        customRunAgentRuntime: async () => ({
            runtime: "direct-cli",
            replyText: "You have insufficient credits to continue.",
        }),
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex summarize this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const run = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(run?.status, "failed");
    assert.equal(
        harness.commentManager.getCommentById(run?.outputEntryId ?? "")?.comment,
        "Codex couldn’t complete this request. Try another agent.",
    );
});
```

Keep the existing `Runtime exploded` retry test unchanged to prove unclassified failures still preserve current behavior.

- [x] **Step 2: Run the controller tests and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern='provider garbage|provider failure text|failed runs retryable' .test-dist/tests/commentAgentController.test.js
```

Expected: the first test persists streamed garbage and the second test succeeds instead of failing.

- [x] **Step 3: Validate final replies and override classified failure text**

Import `formatKnownAgentFailureReply`. After `runAgentRuntime` resolves and before `completeRunWithReply`, reject a failure-like returned reply while preserving it as the diagnostic:

```ts
if (formatKnownAgentFailureReply(options.run.requestedAgent, runtimeResponse.replyText)) {
    throw new Error(runtimeResponse.replyText);
}
```

In `failRun`, classify the combined thrown diagnostic and any streamed partial text, then prefer the safe fallback over the existing partial:

```ts
const existingStream = this.runStreams.get(runId);
const classifiedFailureText = formatKnownAgentFailureReply(
    run.requestedAgent,
    [message, existingStream?.partialText].filter(Boolean).join("\n"),
);
const failureText = classifiedFailureText
    ?? (existingStream?.partialText.trim().length ? existingStream.partialText : message);
```

Continue storing `message` in `run.error` and logs so diagnostics remain available.

- [x] **Step 4: Run the controller tests and verify GREEN**

Run the command from Step 2.

Expected: all selected tests pass.

### Task 3: Use the explicit failed marker

**Files:**
- Modify: `src/ui/views/sidebarPersistedComment.ts:168-183`
- Modify: `tests/sidebarPersistedComment.test.ts:1411-1420`

- [x] **Step 1: Change the expected failed marker**

Update the agent status presentation test:

```ts
assert.deepEqual(getAgentRunStatusPresentation("failed"), {
    marker: "❌",
    markerKind: "text",
});
```

- [x] **Step 2: Run the sidebar test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern='compact success and failure markers' .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: FAIL because the current marker is `✕`.

- [x] **Step 3: Change the shared agent failed marker**

In `getAgentRunStatusPresentation`, return:

```ts
case "failed":
    return { marker: "❌", markerKind: "text" };
```

Both persisted and streamed agent cards consume this shared presentation. Do not change script-run markers.

- [x] **Step 4: Run the sidebar test and verify GREEN**

Run the command from Step 2.

Expected: the selected test passes.

### Task 4: Verify, audit, and update tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-09-01-supported-agent-failure-fallback-design.md`

- [x] **Step 1: Run the focused agent tests**

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentFailurePolicy.test.js .test-dist/tests/commentAgentController.test.js .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: all focused tests pass.

- [x] **Step 2: Re-run the change-surface audit**

```bash
rg -n "couldn’t complete this request|RESOURCE_EXHAUSTED|insufficient credits|marker: \"❌\"" src tests docs/superpowers
```

Expected: fallback policy text has one production owner; controller is the only enforcement point; provider/runtime adapters contain no copied UI message.

- [x] **Step 3: Run the full production verification**

```bash
npm run build
```

Expected: tests, lint, typecheck, Obsidian compliance, bundle, and release artifact guard all pass.

- [x] **Step 4: Inspect the final diff**

```bash
git diff --check
git status --short
git diff -- src/agents/agentFailurePolicy.ts src/agents/commentAgentController.ts src/ui/views/sidebarPersistedComment.ts tests/agentFailurePolicy.test.ts tests/commentAgentController.test.ts tests/sidebarPersistedComment.test.ts docs/superpowers/specs/2026-09-01-supported-agent-failure-fallback-design.md docs/superpowers/plans/2026-09-01-supported-agent-failure-fallback.md
```

Expected: no whitespace errors and no files outside the approved shared policy, controller, agent marker, tests, and docs.

- [x] **Step 5: Mark the tracked spec complete**

Change each implemented and freshly verified checklist item in the associated design spec from `[ ]` to `[x]`.

- [x] **Step 6: Commit the implementation**

```bash
git add src/agents/agentFailurePolicy.ts src/agents/commentAgentController.ts src/ui/views/sidebarPersistedComment.ts tests/agentFailurePolicy.test.ts tests/commentAgentController.test.ts tests/sidebarPersistedComment.test.ts
git add -f docs/superpowers/specs/2026-09-01-supported-agent-failure-fallback-design.md docs/superpowers/plans/2026-09-01-supported-agent-failure-fallback.md
git commit -m "fix(agents): normalize provider failures"
```
