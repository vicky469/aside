# DeepSeek via OpenCode Agent Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `@deepseek` as a first-class Aside actor that runs the user's configured OpenCode model through the local OpenCode CLI.

**Architecture:** Extend the shared actor registry so directive parsing, suggestions, settings, run records, and labels remain provider-neutral. Keep process ownership in `agentRuntimeAdapter.ts`, extract the Gemini JSON-line lifecycle into one reusable local runner, and add only OpenCode-specific argv and event translation. OpenCode owns model selection and permissions; Aside passes `--format json` and `--auto` but no model, agent, continuation, attachment, or sharing override.

**Tech Stack:** TypeScript, Node child processes, OpenCode CLI JSONL, Obsidian desktop APIs, Node's built-in test runner, esbuild.

---

## File Structure

- Create `src/core/agents/deepseekActor.ts`: one actor definition for identity, directive, runtime strategy, and settings copy.
- Modify `src/core/agents/agentActorDefinition.ts`: add the `deepseek` target and `opencode-cli` runtime strategy.
- Modify `src/core/agents/agentActorRegistry.ts`: register DeepSeek after Gemini so every registry consumer inherits it.
- Modify `src/agents/agentRuntimeAdapter.ts`: add OpenCode diagnostics, argv construction, event translation, and execution; extract shared Gemini/OpenCode JSON-line process lifecycle to prevent duplication.
- Modify `src/main.ts`: dispatch target diagnostics to the OpenCode probe.
- Modify provider-derived tests under `tests/`: prove the actor propagates through parsing, suggestions, settings, fallback, controller dispatch, and presentation.
- Modify `README.md` and `EXPERIMENTAL_FEATURES.md`: document the new directive, OpenCode ownership, `--auto`, and reserved command name.
- Modify `docs/superpowers/specs/2026-08-26-deepseek-opencode-agent-support-design.md`: update tracking only after corresponding verification succeeds.

### Task 1: Register DeepSeek and propagate provider-derived surfaces

**Files:**
- Create: `src/core/agents/deepseekActor.ts`
- Modify: `src/core/agents/agentActorDefinition.ts`
- Modify: `src/core/agents/agentActorRegistry.ts`
- Test: `tests/agentActorRegistry.test.ts`
- Test: `tests/agentDirectives.test.ts`
- Test: `tests/actionableMentions.test.ts`
- Test: `tests/commentMentionSuggestions.test.ts`
- Test: `tests/asideSettingCatalog.test.ts`
- Test: `tests/defaultAgentSelection.test.ts`
- Test: `tests/agentRuntimeSettings.test.ts`
- Test: `tests/commentAgentController.test.ts`
- Test: `tests/sidebarPersistedComment.test.ts`

- [ ] **Step 1: Write failing registry and directive tests**

Extend the registry expectations with:

```ts
assert.equal(getAgentActorByDirectiveMention("@DeEpSeEk")?.id, "deepseek");
assert.deepEqual(
    getSupportedAgentActors().map((actor) => actor.id),
    ["codex", "claude", "gemini", "deepseek"],
);
assert.equal(
    formatSupportedAgentDirectives("or"),
    "@codex, @claude, @gemini, or @deepseek",
);
```

Add directive coverage:

```ts
test("parseAgentDirectives resolves repeated deepseek mentions case-insensitively", () => {
    assert.deepEqual(parseAgentDirectives("ask @DEEPSEEK twice @deepseek"), {
        target: "deepseek",
        hasConflict: false,
        matchedTargets: ["deepseek"],
        unsupportedTargets: [],
    });
});

test("parseAgentDirectives blocks deepseek mixed with another supported target", () => {
    assert.deepEqual(parseAgentDirectives("ask @gemini and @deepseek"), {
        target: null,
        hasConflict: true,
        matchedTargets: ["gemini", "deepseek"],
        unsupportedTargets: [],
    });
});
```

Add a controller tracer that saves `@deepseek review this`, drains the queue, and expects `requestedAgent`, runtime selection, and runtime invocation target to equal `deepseek`. Add an author-label case with a run whose `requestedAgent` is `deepseek` and expect `{ kind: "deepseek", label: "DeepSeek" }`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentActorRegistry.test.js .test-dist/tests/agentDirectives.test.js .test-dist/tests/commentAgentController.test.js .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: registry, directive, controller, and author-label assertions fail because `@deepseek` is unknown.

- [ ] **Step 3: Add the actor definition and registry entry**

Create `src/core/agents/deepseekActor.ts`:

```ts
import type { AgentActorDefinition } from "./agentActorDefinition";

export const DEEPSEEK_AGENT_ACTOR: AgentActorDefinition = {
    id: "deepseek",
    label: "DeepSeek",
    directive: "@deepseek",
    supported: true,
    runtimeStrategy: "opencode-cli",
    unsupportedNotice: null,
    settingsDescription: "Type @deepseek in a comment to run the model currently configured in OpenCode.",
};
```

Expand the types:

```ts
export type AsideAgentTarget = "codex" | "claude" | "gemini" | "deepseek";

export type AgentActorRuntimeStrategy =
    | "codex-cli"
    | "claude-cli"
    | "gemini-cli"
    | "opencode-cli"
    | "unsupported";
```

Import `DEEPSEEK_AGENT_ACTOR` in `agentActorRegistry.ts` and append it after `GEMINI_AGENT_ACTOR`.

- [ ] **Step 4: Run registry and directive tests and verify GREEN**

Run the Step 2 commands.

Expected: PASS.

- [ ] **Step 5: Update derived-surface expectations**

Add `@deepseek` to actionable and mention-suggestion expected arrays, `DeepSeek tab` to the settings alias expectation, and `deepseek` to test diagnostics maps. Extend the settings option expectation with:

```ts
{
    target: "deepseek",
    label: "DeepSeek",
    status: "unavailable",
    statusLabel: "Unavailable",
    available: false,
    disabled: true,
    selected: false,
}
```

Add a default-selection case that proves DeepSeek can be preferred when available:

```ts
assert.deepEqual(resolveDefaultAgentSelection("deepseek", diagnostics(["deepseek"])), {
    kind: "preferred",
    preferredAgent: "deepseek",
    selectedAgent: "deepseek",
});
```

- [ ] **Step 6: Run provider-derived focused tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test \
  .test-dist/tests/actionableMentions.test.js \
  .test-dist/tests/commentMentionSuggestions.test.js \
  .test-dist/tests/asideSettingCatalog.test.js \
  .test-dist/tests/defaultAgentSelection.test.js \
  .test-dist/tests/agentRuntimeSettings.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit the registry slice**

```bash
git add src/core/agents/deepseekActor.ts src/core/agents/agentActorDefinition.ts src/core/agents/agentActorRegistry.ts tests/agentActorRegistry.test.ts tests/agentDirectives.test.ts tests/actionableMentions.test.ts tests/commentMentionSuggestions.test.ts tests/asideSettingCatalog.test.ts tests/defaultAgentSelection.test.ts tests/agentRuntimeSettings.test.ts tests/commentAgentController.test.ts tests/sidebarPersistedComment.test.ts
git commit -m "feat(agents): register DeepSeek actor"
```

### Task 2: Define the OpenCode command and JSON event contract

**Files:**
- Modify: `src/agents/agentRuntimeAdapter.ts`
- Test: `tests/agentRuntimeAdapter.test.ts`

- [ ] **Step 1: Add failing imports and pure adapter tests**

Import these new functions in `agentRuntimeAdapter.test.ts`:

```ts
buildOpenCodeCliArgs,
extractOpenCodeErrorTextFromJsonEvent,
extractOpenCodeProgressTextFromJsonEvent,
extractOpenCodeRunMetadataFromJsonEvent,
extractOpenCodeTextDeltaFromJsonEvent,
```

Add exact argv coverage:

```ts
test("buildOpenCodeCliArgs inherits model and starts a fresh private run", () => {
    const args = buildOpenCodeCliArgs("Aside prompt");
    assert.deepEqual(args, ["run", "--format", "json", "--auto", "Aside prompt"]);
    for (const forbidden of [
        "--model", "--variant", "--agent", "--continue", "--session",
        "--fork", "--attach", "--share",
    ]) {
        assert.equal(args.includes(forbidden), false, forbidden);
    }
});
```

Add representative event tests:

```ts
test("OpenCode event helpers extract reply, progress, errors, and tool metadata", () => {
    assert.equal(extractOpenCodeProgressTextFromJsonEvent({ type: "step_start" }), "Starting OpenCode");
    assert.equal(extractOpenCodeTextDeltaFromJsonEvent({
        type: "text",
        part: { type: "text", text: "OpenCode reply." },
    }), "OpenCode reply.");
    assert.equal(extractOpenCodeProgressTextFromJsonEvent({
        type: "tool_use",
        part: { type: "tool", tool: "bash", state: { status: "completed" } },
    }), "Running command");
    assert.equal(extractOpenCodeErrorTextFromJsonEvent({
        type: "error",
        error: { data: { message: "Provider is not configured" } },
    }), "Provider is not configured");
    assert.deepEqual(extractOpenCodeRunMetadataFromJsonEvent({
        type: "tool_use",
        part: {
            type: "tool",
            tool: "read",
            state: {
                status: "completed",
                input: { filePath: "/vault/Note.md" },
                output: "https://example.com/docs?token=secret",
            },
        },
    }), {
        usedTools: ["read"],
        usedFiles: ["/vault/Note.md"],
        usedUrls: ["https://example.com/docs"],
    });
});
```

Add a tool-error case asserting `usedTools: ["bash (unavailable)"]` and a normalized `usedToolErrors` entry.

- [ ] **Step 2: Run the adapter test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL because the OpenCode helpers are not exported.

- [ ] **Step 3: Implement the pure OpenCode helpers**

Add the argv builder:

```ts
export function buildOpenCodeCliArgs(prompt: string): string[] {
    return ["run", "--format", "json", "--auto", prompt];
}
```

Implement event extraction beside the Gemini helpers. Use `isRecord`, `firstStringAtPaths`, `collectFilePathStrings`, `collectUrlStrings`, and the existing metadata normalizers rather than copying their logic. Normalize `bash`, `shell`, and `run_shell_command` to `shell`; read text only from `type === "text"` and `part.text`; read structured error detail in this order:

```ts
[
    ["error", "data", "message"],
    ["error", "message"],
    ["message"],
    ["error"],
]
```

For `tool_use`, inspect `part.tool` and `part.state`. Collect evidence from `state.input`, `state.output`, and `state.error`. Treat `state.status === "error"` as a tool failure, not a terminal run failure. Recognize an explicit OpenCode `skill` tool input with `name` or `skill` as `usedSkills`.

- [ ] **Step 4: Run the pure adapter tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeAdapter.test.js
```

Expected: PASS, including all existing Codex, Claude, and Gemini cases.

- [ ] **Step 5: Commit the event contract**

```bash
git add src/agents/agentRuntimeAdapter.ts tests/agentRuntimeAdapter.test.ts
git commit -m "feat(agents): parse OpenCode events"
```

### Task 3: Add OpenCode diagnostics and strategy routing

**Files:**
- Modify: `src/agents/agentRuntimeAdapter.ts`
- Modify: `src/main.ts`
- Test: `tests/agentRuntimeAdapter.test.ts`

- [ ] **Step 1: Write failing OpenCode diagnostic tests**

Add `getOpenCodeRuntimeDiagnostics` to the test import and cover available and missing binaries:

```ts
test("getOpenCodeRuntimeDiagnostics probes the OpenCode version", async () => {
    const modules = createRuntimeModules((file, args, options, callback) => {
        assert.equal(file, "opencode");
        assert.deepEqual(args, ["--version"]);
        assert.equal(options.cwd, "/Users/test");
        callback(null, "1.18.23", "");
        return createTrackedProcessStub();
    });
    assert.deepEqual(await getOpenCodeRuntimeDiagnostics(modules, {
        HOME: "/Users/test",
        PATH: "/usr/bin",
        SHELL: "/bin/zsh",
    }), { status: "available", message: "OpenCode CLI is available." });
});
```

The missing case returns `{ status: "missing", message: "OpenCode CLI was not found on PATH." }`; a generic launch failure returns `{ status: "unavailable", message: "OpenCode CLI could not be launched from this Obsidian environment." }`.

- [ ] **Step 2: Run typecheck and verify RED**

Run `./node_modules/.bin/tsc -p tsconfig.test.json`.

Expected: FAIL because `getOpenCodeRuntimeDiagnostics` is missing.

- [ ] **Step 3: Implement diagnostics and main routing**

Add:

```ts
export type OpenCodeRuntimeDiagnostics = AgentRuntimeDiagnostics;
```

Implement `getOpenCodeRuntimeDiagnostics()` using the existing module guard, `resolveAgentExecutionEnv`, and `execFileAsync(modules, "opencode", ["--version"], ...)`. Use the three exact messages from Step 1 and `Built-in @deepseek requires desktop Obsidian.` when Node modules are unavailable.

Import it in `main.ts` as `probeOpenCodeRuntimeDiagnostics` and add:

```ts
case "opencode-cli":
    return probeOpenCodeRuntimeDiagnostics();
```

- [ ] **Step 4: Run diagnostics tests and typecheck**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeAdapter.test.js
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit diagnostics**

```bash
git add src/agents/agentRuntimeAdapter.ts src/main.ts tests/agentRuntimeAdapter.test.ts
git commit -m "feat(agents): probe OpenCode runtime"
```

### Task 4: Execute OpenCode through the shared JSON-line lifecycle

**Files:**
- Modify: `src/agents/agentRuntimeAdapter.ts`
- Test: `tests/agentRuntimeAdapter.test.ts`

- [ ] **Step 1: Refactor the test harness while GREEN**

Rename `createGeminiRuntimeHarness` to `createJsonLineRuntimeHarness` and update existing Gemini tests. Add:

```ts
const OPENCODE_TEST_INVOCATION = {
    target: "deepseek" as const,
    prompt: "@deepseek review this",
    cwd: "/vault/project",
    vaultRootPath: "/vault",
};
```

Run the existing adapter test and confirm it remains PASS before adding new behavior.

- [ ] **Step 2: Write the failing successful-run test**

Start `runAgentRuntimeWithModules(harness.modules, OPENCODE_TEST_INVOCATION)`, emit newline-delimited `step_start`, completed `tool_use`, `text`, and `step_finish` events, then close with code zero. Assert:

```ts
assert.equal(harness.spawnCalls[0]?.file, "opencode");
assert.deepEqual(
    harness.spawnCalls[0]?.args,
    buildOpenCodeCliArgs(buildSideNotePrompt({
        promptText: "@deepseek review this",
        vaultRootPath: "/vault",
    })),
);
assert.equal(harness.child.ended, true);
assert.deepEqual(harness.child.stdinChunks, []);
assert.equal(result.replyText, "OpenCode reply.");
assert.equal(progress.includes("Starting OpenCode"), true);
assert.equal(progress.includes("Running command"), true);
```

Also assert sanitized metadata and partial reply callbacks.

- [ ] **Step 3: Run the adapter test and verify RED**

Run the focused adapter test.

Expected: FAIL with `DeepSeek does not have an executable runtime strategy.`

- [ ] **Step 4: Extract one shared JSON-line process owner**

Create a private definition used by both Gemini and OpenCode:

```ts
interface JsonLineAgentRuntimeDefinition {
    executable: string;
    args: string[];
    stdinPrompt?: string;
    emptyResponseMessage: string;
    unsuccessfulResultMessage: string;
    extractText(event: unknown): string | null;
    extractProgress(event: unknown): string | null;
    extractError(event: unknown): string | null;
    extractMetadata(event: unknown): AgentRunMetadata;
    isTerminalError(event: unknown): boolean;
    normalizeFailureDiagnostic?(value: string | null): string | null;
}
```

Move the JSONL buffer, stderr buffer, active-process cleanup, abort listener, metadata deduplication, partial/progress callbacks, close handling, and stdin transport from `runGeminiDirect()` into `runJsonLineAgentDirect(modules, invocation, definition)`. Preserve every existing Gemini message and callback. When `stdinPrompt` is absent, close stdin without writing; when present, require stdin, write once, and close it.

Rewrite `runGeminiDirect()` as a thin wrapper that creates its tool-ID map and supplies the existing Gemini extractors, terminal `result.status === "error"` rule, and Gemini diagnostic normalization.

- [ ] **Step 5: Add the thin OpenCode wrapper and dispatcher**

Implement:

```ts
async function runOpenCodeDirect(
    modules: NodeModules,
    invocation: AgentRuntimeInvocation,
): Promise<AgentRuntimeResult> {
    const prompt = buildSideNotePrompt({
        promptText: invocation.prompt,
        vaultRootPath: invocation.vaultRootPath,
        requestKind: invocation.requestKind,
        targetScriptPath: invocation.targetScriptPath,
    });
    return runJsonLineAgentDirect(modules, invocation, {
        executable: "opencode",
        args: buildOpenCodeCliArgs(prompt),
        emptyResponseMessage: "OpenCode returned an empty response.",
        unsuccessfulResultMessage: "OpenCode reported an unsuccessful result.",
        extractText: extractOpenCodeTextDeltaFromJsonEvent,
        extractProgress: extractOpenCodeProgressTextFromJsonEvent,
        extractError: extractOpenCodeErrorTextFromJsonEvent,
        extractMetadata: extractOpenCodeRunMetadataFromJsonEvent,
        isTerminalError: (event) => isRecord(event) && event.type === "error",
    });
}
```

Add `case "opencode-cli": return runOpenCodeDirect(modules, invocation);` to `runAgentRuntimeWithModules()`.

- [ ] **Step 6: Verify GREEN for success and Gemini regression coverage**

Run the full adapter test.

Expected: PASS for all Codex, Claude, Gemini, and OpenCode success cases.

- [ ] **Step 7: Add RED/GREEN lifecycle edge cases**

Add one test at a time, run it RED, then make only the minimal runner change needed for GREEN:

- malformed and unknown stdout events are ignored;
- exit zero with valid text and no `step_finish` succeeds;
- exit zero with no text rejects `OpenCode returned an empty response.`;
- an `error` event rejects its structured message even on exit zero;
- nonzero exit prefers structured error, then stderr, then `spawn opencode exited with code ...`;
- spawn failure rejects immediately;
- cancellation before spawn and during execution rejects as `AgentRuntimeCancelledError` and sends `SIGTERM`;
- callbacks after settlement do not mutate the result.

- [ ] **Step 8: Run focused tests and commit runtime execution**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeAdapter.test.js
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/agents/agentRuntimeAdapter.ts tests/agentRuntimeAdapter.test.ts
git commit -m "feat(agents): run OpenCode from comments"
```

### Task 5: Update user-facing copy and recheck end-to-end dispatch

**Files:**
- Test: `tests/commentAgentController.test.ts`
- Test: `tests/sidebarPersistedComment.test.ts`
- Modify: `README.md`
- Modify: `EXPERIMENTAL_FEATURES.md`

- [ ] **Step 1: Re-run the controller tracer and presentation tests**

The fail-first tracer from Task 1 must contain this complete peer-provider case beside Gemini:

```ts
test("comment agent controller dispatches deepseek through OpenCode", async () => {
    const harness = createHarness({ runtimeReplyText: "OpenCode reply." });
    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@deepseek review this",
    });
    await waitForAgentQueueToDrain(harness.controller);
    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.status, "succeeded");
    assert.equal(latestRun?.requestedAgent, "deepseek");
    assert.deepEqual(harness.runtimeSelectionCalls, ["deepseek"]);
    assert.equal(harness.runtimeCalls[0]?.target, "deepseek");
    assert.deepEqual(harness.editedEntries, [{
        commentId: "generated-2",
        body: "OpenCode reply.",
    }]);
});
```

The Task 1 presentation coverage must also prove a DeepSeek output renders `DeepSeek` and a fallback copy can render `DeepSeek (fallback for Gemini)`.

- [ ] **Step 2: Run controller and presentation tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentAgentController.test.js .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: PASS because generic consumers now use the registered actor. A failure blocks documentation work and must be corrected in the shared registry consumer without a DeepSeek-specific view branch.

- [ ] **Step 3: Update README and experimental-feature copy**

Add `@deepseek` to the three README directive lists. Add an OpenCode setup paragraph stating:

```md
`@deepseek` requires a configured OpenCode CLI. Aside runs the model currently selected by OpenCode and passes `--auto` for headless execution; permissions explicitly denied in OpenCode remain denied. Because Aside does not pass `--model`, the DeepSeek label does not guarantee the active OpenCode model is still a DeepSeek model.
```

Add `deepseek` to the reserved command names in `EXPERIMENTAL_FEATURES.md`.

- [ ] **Step 4: Run copy and focused behavior checks**

Run:

```bash
rg -n "@deepseek|OpenCode|deepseek" README.md EXPERIMENTAL_FEATURES.md src tests
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentAgentController.test.js .test-dist/tests/sidebarPersistedComment.test.js
```

Expected: the new actor appears in intentional definitions, adapters, tests, and docs; focused tests PASS.

- [ ] **Step 5: Commit controller and documentation coverage**

```bash
git add tests/commentAgentController.test.ts tests/sidebarPersistedComment.test.ts README.md EXPERIMENTAL_FEATURES.md
git commit -m "docs(agents): explain OpenCode ownership"
```

### Task 6: Audit the change surface, verify the build, and close tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-08-26-deepseek-opencode-agent-support-design.md`
- Review: `src/`
- Review: `tests/`
- Review: `scripts/`
- Review: `README.md`
- Review: `EXPERIMENTAL_FEATURES.md`

- [ ] **Step 1: Re-run the provider-enumeration audit**

Run:

```bash
rg -n --hidden -S "codex.*claude|claude.*gemini|@gemini|gemini-cli|deepseek|opencode-cli" src tests scripts README.md EXPERIMENTAL_FEATURES.md
```

Classify each hit as registry source, runtime adapter, type declaration, intentional test fixture, intentional documentation example, or stale duplicate. Replace stale application-owned lists with registry-derived data and update the affected tests.

- [ ] **Step 2: Run complete automated verification**

Run:

```bash
npm run build
```

Expected: 1,429 baseline tests plus new DeepSeek/OpenCode tests PASS; lint, typecheck, Obsidian compliance, production bundle, and release artifact guard all exit zero.

The artifact guard must inspect `main.js`, `manifest.json`, and `styles.css` and reject `main.js.map`, `sourceMappingURL`, `sourcesContent`, raw TypeScript/JSX-family files, `.env*`, `.npmrc`, keys, and certificates.

- [ ] **Step 3: Inspect the exact shipped assets**

Run:

```bash
ls -l main.js manifest.json styles.css
rg -n "sourceMappingURL|sourcesContent|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|API[_-]?KEY" main.js manifest.json styles.css
find . -maxdepth 1 -type f \( -name 'main.js.map' -o -name '*.ts' -o -name '*.tsx' -o -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' \)
```

Expected: only the three intended plugin assets are in the release-artifact allowlist; both searches return no source exposure or secret-bearing shipped material.

- [ ] **Step 4: Smoke-check the built plugin without changing OpenCode configuration**

Install the built plugin into the configured development vault with:

```bash
npm run dev:install-built -- --vault /Users/example/Obsidian/lean-startup
obsidian plugin:reload id=aside vault=lean-startup
```

Then verify:

- `@deepseek` appears once in suggestions;
- settings report OpenCode availability;
- saving `@deepseek answer with one short sentence` launches `opencode` with the current model;
- progress and final reply appear and persist;
- cancellation sends termination and keeps the reply card stable;
- missing authentication/model errors remain actionable;
- OpenCode credentials, selected model, and permission configuration are unchanged.

If this smoke check would spend provider credits or mutate a real note without prior user authorization, record it as pending rather than performing it.

- [ ] **Step 5: Update tracked spec evidence**

Mark implementation and automated verification items `[x]` only when their code and checks passed. Leave the smoke item unchecked with a dated note if it was not authorized or could not complete.

- [ ] **Step 6: Run final diff and repository checks**

Run:

```bash
git diff --check
git status --short
git log --oneline --decorate -6
```

Expected: no whitespace errors, only intentional final documentation changes remain, and the feature commits are visible.

- [ ] **Step 7: Commit completed tracking**

```bash
git add -f docs/superpowers/specs/2026-08-26-deepseek-opencode-agent-support-design.md
git commit -m "docs(agents): complete OpenCode tracking"
```
