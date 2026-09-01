# Cursor Runtime Parity Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Cursor working narration in Aside's grey progress stream, constrain Cursor execution, and reject unrelated executables named `agent`.

**Architecture:** Preserve `agentRuntimeAdapter.ts` as the Cursor-specific event and launch-policy owner. Reuse the existing generic JSON-line runner by making Cursor's progress extractor consume non-terminal assistant deltas while its text extractor consumes only successful terminal results.

**Tech Stack:** TypeScript, Node test runner, Cursor Agent CLI stream JSON, Obsidian desktop runtime.

---

### Task 1: Separate Cursor progress from final reply text

**Files:**
- Modify: `tests/agentRuntimeAdapter.test.ts:756-825`
- Modify: `src/agents/agentRuntimeAdapter.ts:1401-1473`

- [x] **Step 1: Write the failing runtime regression test**

Change the Cursor stream test so its assistant events contain process narration and its terminal result contains the user-facing answer. Assert that partial replies contain only the terminal result and progress contains the accumulated narration events:

```ts
const narration = "I'll read the Aside workflow skill and the note, then fetch the YouTube transcript to append.";
child.stdout.emitText([
    JSON.stringify({ type: "system", subtype: "init", cwd: "/vault/project" }),
    JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: narration }] },
        timestamp_ms: 1,
    }),
    JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Transcript appended.",
    }),
].join("\n") + "\n");

assert.deepEqual(partials, ["Transcript appended."]);
assert.equal(progress.includes(narration), true);
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern='Cursor' .test-dist/tests/agentRuntimeAdapter.test.js
```

Expected: FAIL because narration appears in `partials` and not in `progress`.

- [x] **Step 3: Implement the minimal event-routing change**

Make `extractCursorTextDeltaFromJsonEvent` return only a successful result. Extend `extractCursorProgressTextFromJsonEvent` so timestamped assistant events return their text content before falling back to Claude-compatible tool progress:

```ts
export function extractCursorTextDeltaFromJsonEvent(event: unknown): string | null {
    return extractClaudeReplyTextFromJsonEvent(event);
}

export function extractCursorProgressTextFromJsonEvent(event: unknown): string | null {
    if (getClaudeEventType(event) === "system" && firstStringAtPaths(event, [["subtype"]]) === "init") {
        return "Starting Cursor";
    }

    if (getClaudeEventType(event) === "assistant" && isRecord(event) && "timestamp_ms" in event) {
        return normalizeProgressText(
            joinTextContentItems(getNestedValue(event, ["message", "content"])) ?? "",
        );
    }

    return extractClaudeProgressTextFromJsonEvent(event);
}
```

Remove `appendCursorStreamText`; the generic runner now sees only the terminal result and needs no Cursor-specific append behavior.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2.

Expected: all Cursor tests PASS.

### Task 2: Require Cursor identity during diagnostics

**Files:**
- Modify: `tests/agentRuntimeAdapter.test.ts:346-402`
- Modify: `src/agents/agentRuntimeAdapter.ts:977-1017`

- [x] **Step 1: Write failing positive and collision tests**

Update the available test to return Cursor-identifying help output. Add a test where an unrelated executable returns successful generic help and assert diagnostics are unavailable:

```ts
callback(null, "Usage: agent [options]\nStart the Cursor Agent", "");

assert.deepEqual(await getCursorRuntimeDiagnostics(modules, env), {
    status: "unavailable",
    message: "Cursor CLI is not authenticated or could not start.",
});
```

- [x] **Step 2: Run the focused diagnostics tests and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern='getCursorRuntimeDiagnostics' .test-dist/tests/agentRuntimeAdapter.test.js
```

Expected: collision test FAILS because exit code zero currently returns `available`.

- [x] **Step 3: Validate the help signature**

Capture the `execFileAsync` result and require `/\bCursor Agent\b/u` in combined stdout and stderr before returning `available`. Throw an error on a signature mismatch so existing unavailable handling remains the single failure path.

- [x] **Step 4: Run diagnostics tests and verify GREEN**

Run the command from Step 2.

Expected: both genuine-Cursor and collision tests PASS.

### Task 3: Force Cursor sandboxing

**Files:**
- Modify: `tests/agentRuntimeAdapter.test.ts:756-825`
- Modify: `src/agents/agentRuntimeAdapter.ts:2045-2064`

- [x] **Step 1: Add a failing argument assertion**

Update the `buildCursorCliArgs` expected array to include:

```ts
"--sandbox",
"enabled",
```

immediately after `--trust`.

- [x] **Step 2: Run the Cursor argument test and verify RED**

Run the focused Cursor command from Task 1, Step 2.

Expected: FAIL because the production argument list omits the sandbox option.

- [x] **Step 3: Add the sandbox arguments**

Insert `"--sandbox", "enabled"` after `"--trust"` in `buildCursorCliArgs`.

- [x] **Step 4: Run the Cursor argument test and verify GREEN**

Run the focused Cursor command from Task 1, Step 2.

Expected: all Cursor tests PASS.

### Task 4: Verify and update tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-09-01-cursor-runtime-parity-fixes-design.md`

- [x] **Step 1: Run the full runtime adapter test file**

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeAdapter.test.js
```

Expected: all tests PASS.

- [x] **Step 2: Run the full project verification**

```bash
npm run build
```

Expected: tests, lint, typecheck, Obsidian compliance, bundle, and release artifact guard all PASS.

- [x] **Step 3: Inspect the final change surface**

```bash
git diff --check
git diff -- src/agents/agentRuntimeAdapter.ts tests/agentRuntimeAdapter.test.ts docs/superpowers/specs/2026-09-01-cursor-runtime-parity-fixes-design.md
```

Expected: no whitespace errors; only the approved Cursor runtime, tests, and tracking checklist changed.

- [x] **Step 4: Mark the tracked spec complete**

Change each implemented and freshly verified checklist item in the associated design spec from `[ ]` to `[x]`.

- [x] **Step 5: Commit only the implementation files**

```bash
git add src/agents/agentRuntimeAdapter.ts tests/agentRuntimeAdapter.test.ts
git add -f docs/superpowers/specs/2026-09-01-cursor-runtime-parity-fixes-design.md docs/superpowers/plans/2026-09-01-cursor-runtime-parity-fixes.md
git commit -m "fix(agents): align Cursor runtime streaming"
```

Do not stage unrelated existing working-tree changes.
