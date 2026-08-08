# Gemini CLI Agent Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `@gemini` as a first-class local Aside agent that streams replies and tool activity from the user's sandboxed Gemini CLI.

**Architecture:** Extend the existing actor registry so directive parsing, suggestions, labels, settings, and run records stay provider-neutral. Keep process ownership in `agentRuntimeAdapter.ts`; add only Gemini-specific argv construction, JSONL event translation, diagnostics, and a direct runner. Use the installed Gemini CLI's documented `init`, `message`, `tool_use`, `tool_result`, `error`, and `result` event schema.

**Tech Stack:** TypeScript, Node child processes, Gemini CLI headless `stream-json`, Obsidian desktop plugin APIs, Node's built-in test runner, esbuild.

---

## File Structure

- Create `src/core/agents/geminiActor.ts`: Gemini's actor identity and runtime strategy.
- Modify `src/core/agents/agentActorDefinition.ts`: add the `gemini` target and `gemini-cli` strategy.
- Modify `src/core/agents/agentActorRegistry.ts`: register Gemini and own natural-language supported-directive formatting.
- Modify `src/ui/views/sidebarDraftComment.ts`: consume the registry formatter for new-comment help copy.
- Modify `src/ui/settings/asideSettingCatalog.ts`: derive agent-tab search aliases from actor labels.
- Modify `shared/sideNotePromptPolicy.js`: keep agent write-mode policy provider-neutral.
- Modify `src/agents/agentRuntimeAdapter.ts`: own Gemini diagnostics, argv, event translation, process lifecycle, and runtime dispatch.
- Modify `src/main.ts`: connect `gemini-cli` to generic settings diagnostics.
- Modify `tests/agentActorRegistry.test.ts`, `tests/agentDirectives.test.ts`, `tests/commentMentionSuggestions.test.ts`, `tests/sidebarDraftComment.test.ts`, and `tests/agentRuntimeSettings.test.ts`: prove registry-derived product surfaces include Gemini.
- Modify `tests/sidebarDraftEditor.test.ts`, `tests/vaultScriptRegistry.test.ts`, `tests/scriptDirectives.test.ts`, `tests/asideSettingCatalog.test.ts`, and `tests/sideNotePromptPolicy.test.mjs`: prove disconnected suggestions, script reservation, search aliases, and prompt policy remain registry-safe.
- Modify `tests/agentRuntimeAdapter.test.ts`: prove Gemini command, diagnostics, event schema, streaming, metadata, failure, and cancellation behavior without invoking the real CLI.
- Modify `tests/commentAgentController.test.ts`: remove the local two-provider test union and prove generic Gemini dispatch persists a reply.
- Modify `README.md`: document `@gemini` alongside the existing local agents.
- Modify `docs/superpowers/specs/2026-08-08-gemini-cli-agent-support-design.md`: mark only verified tracking items complete.

### Task 1: Register Gemini and derive shared provider copy

**Files:**
- Create: `src/core/agents/geminiActor.ts`
- Modify: `src/core/agents/agentActorDefinition.ts`
- Modify: `src/core/agents/agentActorRegistry.ts`
- Modify: `src/ui/views/sidebarDraftComment.ts`
- Modify: `src/ui/settings/asideSettingCatalog.ts`
- Modify: `shared/sideNotePromptPolicy.js`
- Test: `tests/agentActorRegistry.test.ts`
- Test: `tests/agentDirectives.test.ts`
- Test: `tests/commentMentionSuggestions.test.ts`
- Test: `tests/sidebarDraftComment.test.ts`
- Test: `tests/agentRuntimeSettings.test.ts`
- Test: `tests/sidebarDraftEditor.test.ts`
- Test: `tests/vaultScriptRegistry.test.ts`
- Test: `tests/scriptDirectives.test.ts`
- Test: `tests/asideSettingCatalog.test.ts`
- Test: `tests/sideNotePromptPolicy.test.mjs`

- [ ] **Step 1: Write failing actor, directive, suggestion, placeholder, and status tests**

Update the expected supported actors and add Gemini-specific assertions:

```ts
assert.equal(getAgentActorByDirectiveMention("@GeMiNi")?.id, "gemini");
assert.deepEqual(
    getSupportedAgentActors().map((actor) => actor.id),
    ["codex", "claude", "gemini"],
);
assert.equal(
    formatSupportedAgentDirectives("or"),
    "@codex, @claude, or @gemini",
);
```

Add directive coverage:

```ts
assert.deepEqual(parseAgentDirectives("ask @GEMINI twice @gemini"), {
    target: "gemini",
    hasConflict: false,
    matchedTargets: ["gemini"],
    unsupportedTargets: [],
});
assert.deepEqual(parseAgentDirectives("ask @codex and @gemini"), {
    target: null,
    hasConflict: true,
    matchedTargets: ["codex", "gemini"],
    unsupportedTargets: [],
});
```

Update the provider-derived surface expectations:

```ts
assert.deepEqual(
    buildMentionSuggestions([cleanLinksScript], "").map((item) => item.mention),
    ["@todo", "@codex", "@claude", "@gemini", "/clean-links"],
);
assert.equal(
    presentation.placeholder,
    "Write a side note. Use B or H for styling, or type /script-name, @todo, @codex, @claude, or @gemini.",
);
assert.deepEqual(
    formatAgentRuntimeStatusLines([
        { directive: "@codex", statusBadge: "..." },
        { directive: "@claude", statusBadge: "✅" },
        { directive: "@gemini", statusBadge: "❌" },
    ]),
    ["@codex ...    @claude ✅    @gemini ❌"],
);
assert.deepEqual(
    buildMentionSuggestions([cleanLinksScript], "@cl").map((item) => item.mention),
    ["@todo", "@codex", "@claude", "@gemini"],
);
```

Update the disconnected `@c` suggestion expectation in `sidebarDraftEditor.test.ts` to the same four built-ins. Seed `🛠️ scripts/Gemini.mjs` in both `vaultScriptRegistry.test.ts` and the `scriptDirectives.test.ts` fixture, assert `registry.resolve("@GEMINI") === null`, and assert `resolveScriptDirective("/gemini", registry).kind === "none"`.

Add settings and prompt-policy assertions:

```ts
const agentTabSetting = ASIDE_SETTING_CATALOG.find((entry) => entry.key === "show-agent-tab");
assert.deepEqual(agentTabSetting?.aliases, ["Codex tab", "Claude tab", "Gemini tab"]);
```

```js
assert.match(prompt, /explicit in-note agent directive/i);
assert.doesNotMatch(prompt, /@codex, @claude, or future agent directives/i);
```

- [ ] **Step 2: Run the focused tests and verify the new expectations fail**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test \
  .test-dist/tests/agentActorRegistry.test.js \
  .test-dist/tests/agentDirectives.test.js \
  .test-dist/tests/commentMentionSuggestions.test.js \
  .test-dist/tests/sidebarDraftComment.test.js \
  .test-dist/tests/agentRuntimeSettings.test.js \
  .test-dist/tests/sidebarDraftEditor.test.js \
  .test-dist/tests/vaultScriptRegistry.test.js \
  .test-dist/tests/scriptDirectives.test.js \
  .test-dist/tests/asideSettingCatalog.test.js
node --test tests/sideNotePromptPolicy.test.mjs
```

Expected: compilation fails because `gemini` and `formatSupportedAgentDirectives` do not exist, or the updated expectations fail because the registry still has two actors.

- [ ] **Step 3: Add the Gemini actor and shared directive-list formatter**

Create `src/core/agents/geminiActor.ts`:

```ts
import type { AgentActorDefinition } from "./agentActorDefinition";

export const GEMINI_AGENT_ACTOR: AgentActorDefinition = {
    id: "gemini",
    label: "Gemini",
    directive: "@gemini",
    supported: true,
    runtimeStrategy: "gemini-cli",
    unsupportedNotice: null,
    settingsDescription: "Type @gemini in a comment to have Gemini read it and answer questions or do the task.",
};
```

Extend the unions in `agentActorDefinition.ts`:

```ts
export type AsideAgentTarget = "codex" | "claude" | "gemini";

export type AgentActorRuntimeStrategy =
    | "codex-cli"
    | "claude-cli"
    | "gemini-cli"
    | "unsupported";
```

Register Gemini after Claude and add one natural-language formatter in `agentActorRegistry.ts`:

```ts
import { GEMINI_AGENT_ACTOR } from "./geminiActor";

export const ASIDE_AGENT_ACTORS: readonly AgentActorDefinition[] = [
    CODEX_AGENT_ACTOR,
    CLAUDE_AGENT_ACTOR,
    GEMINI_AGENT_ACTOR,
];

function formatDirectiveList(directives: readonly string[], conjunction: "and" | "or"): string {
    if (directives.length <= 1) {
        return directives[0] ?? "";
    }
    if (directives.length === 2) {
        return `${directives[0]} ${conjunction} ${directives[1]}`;
    }
    return `${directives.slice(0, -1).join(", ")}, ${conjunction} ${directives.at(-1)}`;
}

export function formatSupportedAgentDirectives(conjunction: "and" | "or" = "and"): string {
    return formatDirectiveList(
        getSupportedAgentActors().map((actor) => actor.directive),
        conjunction,
    );
}
```

Use `formatSupportedAgentDirectives("and")` inside `resolveUnsupportedAgentNotice`. Import `formatSupportedAgentDirectives` in `sidebarDraftComment.ts` and build the new-note placeholder from it:

```ts
const supportedAgentDirectives = formatSupportedAgentDirectives("or");
const newDraftPlaceholder = supportedAgentDirectives
    ? `Write a side note. Use B or H for styling, or type /script-name, @todo, ${supportedAgentDirectives}.`
    : "Write a side note. Use B or H for styling, or type /script-name or @todo.";
```

Import `getSupportedAgentActors` in `asideSettingCatalog.ts` and derive the agent-tab aliases:

```ts
aliases: getSupportedAgentActors().map((actor) => `${actor.label} tab`),
```

Replace the provider enumeration in `shared/sideNotePromptPolicy.js` with stable policy text:

```js
"An explicit in-note agent directive means the user is asking the selected local agent to answer in this Aside thread; these requests default to write mode.",
```

- [ ] **Step 4: Recompile and run the focused tests**

Run the Step 2 commands again.

Expected: all selected tests pass and the mention presentation still returns only the insertion value.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`

Expected: 1,051 or more TypeScript tests and 75 repository checks pass with zero failures.

- [ ] **Step 6: Commit the provider model and shared surfaces**

```bash
git add \
  src/core/agents/agentActorDefinition.ts \
  src/core/agents/agentActorRegistry.ts \
  src/core/agents/geminiActor.ts \
  src/ui/views/sidebarDraftComment.ts \
  src/ui/settings/asideSettingCatalog.ts \
  shared/sideNotePromptPolicy.js \
  tests/agentActorRegistry.test.ts \
  tests/agentDirectives.test.ts \
  tests/commentMentionSuggestions.test.ts \
  tests/sidebarDraftComment.test.ts \
  tests/agentRuntimeSettings.test.ts \
  tests/sidebarDraftEditor.test.ts \
  tests/vaultScriptRegistry.test.ts \
  tests/scriptDirectives.test.ts \
  tests/asideSettingCatalog.test.ts \
  tests/sideNotePromptPolicy.test.mjs
git commit -m "feat: register Gemini agent"
```

### Task 2: Translate Gemini stream-json events

**Files:**
- Modify: `src/agents/agentRuntimeAdapter.ts`
- Test: `tests/agentRuntimeAdapter.test.ts`

- [ ] **Step 1: Write failing event translation tests**

Import these new functions from `agentRuntimeAdapter.ts`:

```ts
extractGeminiErrorTextFromJsonEvent,
extractGeminiProgressTextFromJsonEvent,
extractGeminiResultStatusFromJsonEvent,
extractGeminiRunMetadataFromJsonEvent,
extractGeminiTextDeltaFromJsonEvent,
```

Test assistant-only text and terminal status:

```ts
assert.equal(extractGeminiTextDeltaFromJsonEvent({
    type: "message",
    role: "assistant",
    content: "Hello",
    delta: true,
}), "Hello");
assert.equal(extractGeminiTextDeltaFromJsonEvent({
    type: "message",
    role: "user",
    content: "ignore",
}), null);
assert.equal(extractGeminiResultStatusFromJsonEvent({
    type: "result",
    status: "success",
}), "success");
assert.equal(extractGeminiResultStatusFromJsonEvent({
    type: "result",
    status: "error",
}), "error");
```

Test progress, errors, and tool-call correlation:

```ts
const toolNamesById = new Map<string, string>();
assert.deepEqual(extractGeminiRunMetadataFromJsonEvent({
    type: "tool_use",
    tool_name: "read_file",
    tool_id: "call-1",
    parameters: {
        file_path: "Raw/Source.md",
        url: "https://example.com/page?token=secret#debug",
    },
}, toolNamesById), {
    usedTools: ["read_file"],
    usedFiles: ["Raw/Source.md"],
    usedUrls: ["https://example.com/page"],
});
assert.deepEqual(extractGeminiRunMetadataFromJsonEvent({
    type: "tool_result",
    tool_id: "call-1",
    status: "error",
    error: { type: "NOT_FOUND", message: "File missing" },
}, toolNamesById), {
    usedTools: ["read_file (unavailable)"],
    usedFiles: [],
    usedUrls: [],
    usedToolErrors: [{ name: "read_file", payload: "File missing" }],
});
assert.equal(extractGeminiProgressTextFromJsonEvent({ type: "init" }), "Starting Gemini");
assert.equal(extractGeminiProgressTextFromJsonEvent({
    type: "tool_use",
    tool_name: "run_shell_command",
}), "Running command");
assert.equal(extractGeminiErrorTextFromJsonEvent({
    type: "error",
    severity: "error",
    message: "Maximum session turns exceeded",
}), "Maximum session turns exceeded");
```

- [ ] **Step 2: Run the focused runtime test and verify it fails**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeAdapter.test.js
```

Expected: compilation fails because the Gemini extraction functions are not exported.

- [ ] **Step 3: Implement defensive Gemini event helpers beside the existing provider helpers**

Use the documented Gemini field names and the adapter's existing `isRecord`, `firstStringAtPaths`, `collectFilePathStrings`, `collectUrlStrings`, and metadata normalizers:

```ts
type GeminiResultStatus = "success" | "error";

function normalizeGeminiToolName(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }
    return /^(?:run_shell_command|shell|bash)$/iu.test(normalized)
        ? "shell"
        : normalized;
}

export function extractGeminiTextDeltaFromJsonEvent(event: unknown): string | null {
    if (!isRecord(event) || event.type !== "message" || event.role !== "assistant") {
        return null;
    }
    return typeof event.content === "string" && event.content.length > 0
        ? event.content
        : null;
}

export function extractGeminiResultStatusFromJsonEvent(event: unknown): GeminiResultStatus | null {
    if (!isRecord(event) || event.type !== "result") {
        return null;
    }
    return event.status === "success" || event.status === "error"
        ? event.status
        : null;
}

export function extractGeminiErrorTextFromJsonEvent(event: unknown): string | null {
    if (!isRecord(event) || event.type !== "error") {
        return null;
    }
    return normalizeRuntimeDiagnosticText(firstStringAtPaths(event, [
        ["message"],
        ["error", "message"],
        ["error"],
    ]) ?? "");
}

export function extractGeminiProgressTextFromJsonEvent(event: unknown): string | null {
    if (!isRecord(event)) {
        return null;
    }
    if (event.type === "init") {
        return "Starting Gemini";
    }
    if (event.type !== "tool_use") {
        return null;
    }
    const toolName = normalizeGeminiToolName(event.tool_name);
    if (!toolName) {
        return null;
    }
    return toolName === "shell"
        ? "Running command"
        : normalizeProgressText(`Using ${toolName}`);
}

export function extractGeminiRunMetadataFromJsonEvent(
    event: unknown,
    toolNamesById: Map<string, string> = new Map<string, string>(),
): Pick<AgentRunMetadata, "usedSkills" | "usedTools" | "usedFiles" | "usedUrls" | "usedToolErrors"> {
    if (!isRecord(event) || !(event.type === "tool_use" || event.type === "tool_result")) {
        return { usedTools: [], usedFiles: [], usedUrls: [] };
    }

    const toolId = typeof event.tool_id === "string" ? event.tool_id : null;
    let toolName: string | null = null;
    let payload: unknown;
    if (event.type === "tool_use") {
        toolName = normalizeGeminiToolName(event.tool_name);
        payload = event.parameters;
        if (toolId && toolName) {
            toolNamesById.set(toolId, toolName);
        }
    } else {
        toolName = toolId ? toolNamesById.get(toolId) ?? null : null;
        payload = {
            output: event.output,
            error: event.error,
        };
    }

    const fileCandidates: unknown[] = [];
    collectFilePathStrings(payload, fileCandidates);
    const urlSet = new Set<string>();
    collectUrlStrings(payload, urlSet);
    const isToolError = event.type === "tool_result" && event.status === "error";
    const errorPayload = isToolError
        ? getNestedValue(event, ["error", "message"]) ?? event.error ?? event.output
        : null;
    const usedToolErrors = toolName && isToolError
        ? normalizeAgentRunToolErrors([{ name: toolName, payload: errorPayload }])
        : [];
    const skillName = event.type === "tool_use" && toolName === "activate_skill"
        ? firstStringAtPaths(payload, [["skill"], ["name"]])
        : null;
    const usedSkills = skillName
        ? normalizeAgentRunSkillMetadata([{ name: skillName }])
        : [];
    return {
        ...(usedSkills.length ? { usedSkills } : {}),
        usedTools: normalizeAgentRunToolNames([
            ...(toolName ? [toolName] : []),
            ...usedToolErrors.map((error) => formatUnavailableAgentRunToolName(error.name)),
        ]),
        usedFiles: normalizeAgentRunFilePaths(fileCandidates),
        usedUrls: Array.from(urlSet),
        ...(usedToolErrors.length ? { usedToolErrors } : {}),
    };
}
```

- [ ] **Step 4: Recompile and run the focused runtime tests**

Run the Step 2 commands again.

Expected: every Gemini event test and all existing Codex/Claude adapter tests pass.

- [ ] **Step 5: Commit the event translation**

```bash
git add src/agents/agentRuntimeAdapter.ts tests/agentRuntimeAdapter.test.ts
git commit -m "feat: parse Gemini runtime events"
```

### Task 3: Add Gemini CLI arguments and diagnostics

**Files:**
- Modify: `src/agents/agentRuntimeAdapter.ts`
- Modify: `src/main.ts`
- Test: `tests/agentRuntimeAdapter.test.ts`

- [ ] **Step 1: Write failing argv and diagnostics tests**

Add `buildGeminiCliArgs` and `getGeminiRuntimeDiagnostics` to the test imports. Assert the exact process policy:

```ts
assert.deepEqual(buildGeminiCliArgs({
    cwd: "/vault/project",
    vaultRootPath: "/vault",
}), [
    "--prompt", "",
    "--output-format", "stream-json",
    "--skip-trust",
    "--sandbox",
    "--approval-mode", "yolo",
    "--include-directories", "/vault",
]);
assert.deepEqual(buildGeminiCliArgs({
    cwd: "/vault",
    vaultRootPath: "/vault",
}), [
    "--prompt", "",
    "--output-format", "stream-json",
    "--skip-trust",
    "--sandbox",
    "--approval-mode", "yolo",
]);
```

Assert that no argv item is `--model`, `--extensions`, `--allowed-mcp-server-names`, `--resume`, or `--session-id`. Add these diagnostics cases:

```ts
resetResolvedAgentExecutionEnvForTests();
const availableModules = createRuntimeModules((file, args, _options, callback) => {
    if (file === "/bin/zsh") {
        callback(null, "/Users/test/.nvm/bin:/usr/bin\n", "");
    } else {
        assert.equal(file, "gemini");
        assert.deepEqual(args, ["--help"]);
        callback(null, "gemini help", "");
    }
    return createTrackedProcessStub();
});
assert.deepEqual(await getGeminiRuntimeDiagnostics(availableModules, {
    HOME: "/Users/test",
    PATH: "/usr/bin",
    SHELL: "/bin/zsh",
}), { status: "available", message: "Gemini CLI is available." });

resetResolvedAgentExecutionEnvForTests();
const missingModules = createRuntimeModules((file, _args, _options, callback) => {
    if (file === "/bin/zsh") {
        callback(null, "/Users/test/.nvm/bin:/usr/bin\n", "");
    } else {
        callback(Object.assign(new Error("missing gemini"), { code: "ENOENT" }), "", "");
    }
    return createTrackedProcessStub();
});
assert.deepEqual(await getGeminiRuntimeDiagnostics(missingModules, {
    HOME: "/Users/test",
    PATH: "/usr/bin",
    SHELL: "/bin/zsh",
}), { status: "missing", message: "Gemini CLI was not found on PATH." });

resetResolvedAgentExecutionEnvForTests();
const unavailableModules = createRuntimeModules((file, _args, _options, callback) => {
    if (file === "/bin/zsh") {
        callback(null, "/Users/test/.nvm/bin:/usr/bin\n", "");
    } else {
        callback(new Error("authentication failed"), "", "authentication failed");
    }
    return createTrackedProcessStub();
});
assert.deepEqual(await getGeminiRuntimeDiagnostics(unavailableModules, {
    HOME: "/Users/test",
    PATH: "/usr/bin",
    SHELL: "/bin/zsh",
}), {
    status: "unavailable",
    message: "Gemini CLI could not be launched or authenticated from this Obsidian environment.",
});
```

- [ ] **Step 2: Run the focused runtime test and verify it fails**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeAdapter.test.js
```

Expected: compilation fails because the Gemini argv and diagnostic exports do not exist.

- [ ] **Step 3: Implement argv and non-mutating diagnostics**

Add the diagnostic alias and argv builder:

```ts
export type GeminiRuntimeDiagnostics = AgentRuntimeDiagnostics;

export function buildGeminiCliArgs(options: {
    cwd: string;
    vaultRootPath?: string | null;
}): string[] {
    const args = [
        "--prompt", "",
        "--output-format", "stream-json",
        "--skip-trust",
        "--sandbox",
        "--approval-mode", "yolo",
    ];
    if (options.vaultRootPath && options.vaultRootPath !== options.cwd) {
        args.push("--include-directories", options.vaultRootPath);
    }
    return args;
}

export async function getGeminiRuntimeDiagnostics(
    modulesOverride?: NodeModules | null,
    baseEnv: ExecEnv = getBaseProcessEnv(),
): Promise<GeminiRuntimeDiagnostics> {
    const modules = modulesOverride ?? getNodeModules();
    if (!modules) {
        return {
            status: "unsupported",
            message: "Built-in @gemini requires desktop Obsidian.",
        };
    }
    try {
        const env = await resolveAgentExecutionEnv(modules, baseEnv);
        await execFileAsync(modules, "gemini", ["--help"], {
            cwd: env.HOME ?? "/",
            env,
        });
        return {
            status: "available",
            message: "Gemini CLI is available.",
        };
    } catch (error) {
        if (isExecErrorWithCode(error, "ENOENT")) {
            return {
                status: "missing",
                message: "Gemini CLI was not found on PATH.",
            };
        }
        return {
            status: "unavailable",
            message: "Gemini CLI could not be launched or authenticated from this Obsidian environment.",
        };
    }
}
```

Import `getGeminiRuntimeDiagnostics` in `main.ts` as `probeGeminiRuntimeDiagnostics` and add:

```ts
case "gemini-cli":
    return probeGeminiRuntimeDiagnostics();
```

- [ ] **Step 4: Run focused tests and production typecheck**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeAdapter.test.js
npm run typecheck
```

Expected: all commands exit zero.

- [ ] **Step 5: Commit command and diagnostic support**

```bash
git add src/agents/agentRuntimeAdapter.ts src/main.ts tests/agentRuntimeAdapter.test.ts
git commit -m "feat: probe Gemini CLI runtime"
```

### Task 4: Run Gemini with streaming, metadata, failures, and cancellation

**Files:**
- Modify: `src/agents/agentRuntimeAdapter.ts`
- Test: `tests/agentRuntimeAdapter.test.ts`

- [ ] **Step 1: Add a deterministic fake child-process harness**

Use `node:events` to create fake stdout, stderr, stdin, and close/error behavior. Capture the spawned file, argv, cwd, stdin writes, and kill signal. Resolve a `spawned` promise inside the fake `spawn` method so tests never depend on timers.

```ts
import { EventEmitter } from "node:events";
import type { AgentRunMetadata } from "../src/core/agents/agentRuns";

class RuntimeStreamStub extends EventEmitter {
    emitText(value: string): void {
        this.emit("data", Buffer.from(value));
    }
}

class RuntimeProcessStub extends EventEmitter {
    readonly stdout = new RuntimeStreamStub();
    readonly stderr = new RuntimeStreamStub();
    readonly stdinChunks: string[] = [];
    ended = false;
    killedWith: string | number | undefined;
    readonly stdin: {
        write: (chunk: string | Uint8Array) => boolean;
        end: () => void;
    } | null;
    constructor(options: { withStdin?: boolean } = {}) {
        super();
        this.stdin = options.withStdin === false ? null : {
            write: (chunk: string | Uint8Array) => {
                this.stdinChunks.push(String(chunk));
                return true;
            },
            end: () => { this.ended = true; },
        };
    }
    kill(signal?: string | number): boolean {
        this.killedWith = signal;
        return true;
    }
}

function createGeminiRuntimeHarness(options: {
    child?: RuntimeProcessStub;
    spawnError?: Error;
} = {}) {
    resetResolvedAgentExecutionEnvForTests();
    const child = options.child ?? new RuntimeProcessStub();
    let resolveSpawned!: (value: RuntimeProcessStub) => void;
    const spawned = new Promise<RuntimeProcessStub>((resolve) => {
        resolveSpawned = resolve;
    });
    const spawnCalls: Array<{ file: string; args: string[]; cwd?: string }> = [];
    const modules = createRuntimeModules((file, _args, _execOptions, callback) => {
        assert.equal(file, "/bin/zsh");
        callback(null, "/Users/test/.nvm/bin:/usr/bin\n", "");
        return createTrackedProcessStub();
    });
    modules.childProcess.spawn = (file, args, spawnOptions) => {
        if (options.spawnError) {
            throw options.spawnError;
        }
        spawnCalls.push({ file, args, cwd: spawnOptions.cwd });
        resolveSpawned(child);
        return child;
    };
    return { child, modules, spawned, spawnCalls };
}
```

- [ ] **Step 2: Write failing successful-stream and metadata tests**

Export a test seam named `runAgentRuntimeWithModules`. Start a Gemini invocation, wait for the fake spawn, and emit split JSONL chunks containing `init`, two assistant messages, `tool_use`, `tool_result`, and a successful `result` before closing with code zero.

```ts
const harness = createGeminiRuntimeHarness();
const partials: string[] = [];
const progress: string[] = [];
const metadata: AgentRunMetadata[] = [];
const runPromise = runAgentRuntimeWithModules(harness.modules, {
    target: "gemini",
    prompt: "@gemini review this",
    cwd: "/vault/project",
    vaultRootPath: "/vault",
    onPartialText: (value) => partials.push(value),
    onProgressText: (value) => progress.push(value),
    onRunMetadata: (value) => metadata.push(value),
});
const child = await harness.spawned;
child.stdout.emitText('{"type":"init","session_id":"session-1"}\n{"type":"message","role":"assistant","content":"Hel');
child.stdout.emitText('lo","delta":true}\n' + [
    { type: "tool_use", tool_name: "read_file", tool_id: "call-1", parameters: { file_path: "Raw/Source.md" } },
    { type: "tool_result", tool_id: "call-1", status: "success", output: "ok" },
    { type: "message", role: "assistant", content: " world", delta: true },
    { type: "result", status: "success", stats: { tool_calls: 1 } },
].map((event) => JSON.stringify(event)).join("\n") + "\n");
child.emit("close", 0, null);
const result = await runPromise;
```

Expected result assertions:

```ts
assert.equal(result.runtime, "direct-cli");
assert.equal(result.replyText, "Hello world");
assert.deepEqual(partials, ["Hello", "Hello world"]);
assert.equal(progress.includes("Starting Gemini"), true);
assert.equal(progress.includes("Using read_file"), true);
assert.deepEqual(result.usedTools, ["read_file"]);
assert.deepEqual(result.usedFiles, ["Raw/Source.md"]);
assert.equal(metadata.length > 0, true);
assert.equal(harness.spawnCalls[0]?.file, "gemini");
assert.equal(harness.spawnCalls[0]?.cwd, "/vault/project");
assert.equal(child.stdinChunks.join(""), buildSideNotePrompt({
    promptText: "@gemini review this",
    vaultRootPath: "/vault",
}));
assert.equal(child.ended, true);
```

- [ ] **Step 3: Write failing empty, terminal-error, nonzero, stdin, spawn, and cancellation tests**

Cover these exact outcomes:

```ts
const invocation = {
    target: "gemini" as const,
    prompt: "@gemini review this",
    cwd: "/vault/project",
    vaultRootPath: "/vault",
};

const emptyHarness = createGeminiRuntimeHarness();
const emptyRun = runAgentRuntimeWithModules(emptyHarness.modules, invocation);
const emptyChild = await emptyHarness.spawned;
emptyChild.stdout.emitText('{"type":"result","status":"success"}\n');
emptyChild.emit("close", 0, null);
await assert.rejects(emptyRun, /Gemini returned an empty response\./);

const resultErrorHarness = createGeminiRuntimeHarness();
const resultErrorRun = runAgentRuntimeWithModules(resultErrorHarness.modules, invocation);
const resultErrorChild = await resultErrorHarness.spawned;
resultErrorChild.stdout.emitText([
    { type: "error", severity: "error", message: "Maximum session turns exceeded" },
    { type: "result", status: "error" },
].map((event) => JSON.stringify(event)).join("\n") + "\n");
resultErrorChild.emit("close", 0, null);
await assert.rejects(resultErrorRun, /Maximum session turns exceeded/);

const nonzeroHarness = createGeminiRuntimeHarness();
const nonzeroRun = runAgentRuntimeWithModules(nonzeroHarness.modules, invocation);
const nonzeroChild = await nonzeroHarness.spawned;
nonzeroChild.stderr.emitText("Authentication failed");
nonzeroChild.emit("close", 1, null);
await assert.rejects(nonzeroRun, /Authentication failed/);

const stdinHarness = createGeminiRuntimeHarness({
    child: new RuntimeProcessStub({ withStdin: false }),
});
const stdinRun = runAgentRuntimeWithModules(stdinHarness.modules, invocation);
await stdinHarness.spawned;
await assert.rejects(stdinRun, /Gemini CLI did not expose stdin\./);

const spawnHarness = createGeminiRuntimeHarness({ spawnError: new Error("spawn failed") });
await assert.rejects(
    runAgentRuntimeWithModules(spawnHarness.modules, invocation),
    /spawn failed/,
);

const preAbortedController = new AbortController();
preAbortedController.abort();
const preAbortedHarness = createGeminiRuntimeHarness();
await assert.rejects(
    runAgentRuntimeWithModules(preAbortedHarness.modules, {
        ...invocation,
        abortSignal: preAbortedController.signal,
    }),
    { name: "AgentRuntimeCancelledError" },
);
assert.equal(preAbortedHarness.spawnCalls.length, 0);

const cancelledController = new AbortController();
const cancelledHarness = createGeminiRuntimeHarness();
const cancelledRun = runAgentRuntimeWithModules(cancelledHarness.modules, {
    ...invocation,
    abortSignal: cancelledController.signal,
});
const cancelledChild = await cancelledHarness.spawned;
cancelledController.abort();
await assert.rejects(cancelledRun, { name: "AgentRuntimeCancelledError" });
assert.equal(cancelledChild.killedWith, "SIGTERM");
```

Add the malformed/unknown-event compatibility case:

```ts
const compatibilityHarness = createGeminiRuntimeHarness();
const compatibilityRun = runAgentRuntimeWithModules(compatibilityHarness.modules, invocation);
const compatibilityChild = await compatibilityHarness.spawned;
compatibilityChild.stdout.emitText([
    "not-json",
    JSON.stringify({ type: "future_event", value: "ignore" }),
    JSON.stringify({ type: "message", role: "assistant", content: "Useful reply", delta: true }),
    JSON.stringify({ type: "result", status: "success" }),
].join("\n") + "\n");
compatibilityChild.emit("close", 0, null);
assert.equal((await compatibilityRun).replyText, "Useful reply");
```

- [ ] **Step 4: Run the focused runtime tests and verify they fail**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeAdapter.test.js
```

Expected: compilation fails because `runAgentRuntimeWithModules` is not exported, or the Gemini runner cases fail because runtime dispatch has no `gemini-cli` branch.

- [ ] **Step 5: Implement `runGeminiDirect` with the shared lifecycle**

Add the Gemini runner beside the existing direct runners without introducing another process registry:

```ts
async function runGeminiDirect(
    modules: NodeModules,
    invocation: AgentRuntimeInvocation,
): Promise<AgentRuntimeResult> {
    if (invocation.abortSignal?.aborted) {
        throw new AgentRuntimeCancelledError();
    }
    const childProcess = await spawnInteractiveAgentRuntimeProcess(
        modules,
        "gemini",
        buildGeminiCliArgs(invocation),
        { cwd: invocation.cwd },
    );

    return await new Promise<AgentRuntimeResult>((resolve, reject) => {
        let settled = false;
        let stdoutBuffer = "";
        let stderrBuffer = "";
        let streamedText = "";
        let resultStatus: GeminiResultStatus | null = null;
        const diagnosticLines: string[] = [];
        const geminiErrorMessages: string[] = [];
        const toolNamesById = new Map<string, string>();
        const usedSkills = new Map<string, AgentRunSkillMetadata>();
        const usedTools = new Set<string>();
        const usedFiles = new Set<string>();
        const usedUrls = new Set<string>();
        const usedToolErrors = new Map<string, AgentRunToolErrorMetadata>();
        let abortHandler: (() => void) | null = null;

        const snapshotMetadata = (): AgentRunMetadata => ({
            usedSkills: Array.from(usedSkills.values()),
            usedTools: Array.from(usedTools),
            usedFiles: Array.from(usedFiles),
            usedUrls: Array.from(usedUrls),
            usedToolErrors: Array.from(usedToolErrors.values()),
        });

        const cleanup = () => {
            activeAgentRuntimeProcesses.delete(childProcess);
            if (invocation.abortSignal && abortHandler) {
                invocation.abortSignal.removeEventListener("abort", abortHandler);
                abortHandler = null;
            }
        };

        const finalizeError = (error: unknown) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            try {
                childProcess.kill("SIGTERM");
            } catch {
                // Best-effort process cleanup.
            }
            reject(error instanceof Error ? error : new Error(String(error)));
        };

        const finalizeSuccess = (replyText: string) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            try {
                childProcess.stdin?.end();
            } catch {
                // Best-effort stdin cleanup.
            }
            resolve({
                runtime: "direct-cli",
                replyText,
                ...snapshotMetadata(),
            });
        };

        const publishRunMetadata = (event: unknown) => {
            const metadata = extractGeminiRunMetadataFromJsonEvent(event, toolNamesById);
            let changed = false;
            for (const skill of metadata.usedSkills ?? []) {
                const key = [skill.name, skill.mode ?? "", skill.source ?? ""].join("\u0000");
                if (!usedSkills.has(key)) {
                    usedSkills.set(key, skill);
                    changed = true;
                }
            }
            for (const tool of metadata.usedTools ?? []) {
                const baseName = getAgentRunToolBaseName(tool);
                const prior = Array.from(usedTools).find(
                    (candidate) => getAgentRunToolBaseName(candidate) === baseName,
                );
                if (prior && prior !== tool && /\(unavailable\)$/iu.test(tool)) {
                    usedTools.delete(prior);
                }
                if (!usedTools.has(tool)) {
                    usedTools.add(tool);
                    changed = true;
                }
            }
            for (const filePath of metadata.usedFiles ?? []) {
                if (!usedFiles.has(filePath)) {
                    usedFiles.add(filePath);
                    changed = true;
                }
            }
            for (const url of metadata.usedUrls ?? []) {
                if (!usedUrls.has(url)) {
                    usedUrls.add(url);
                    changed = true;
                }
            }
            for (const toolError of metadata.usedToolErrors ?? []) {
                const key = `${toolError.name}\u0000${toolError.payload}`;
                if (!usedToolErrors.has(key)) {
                    usedToolErrors.set(key, toolError);
                    changed = true;
                }
            }
            if (changed) {
                invocation.onRunMetadata?.(snapshotMetadata());
            }
        };

        const handleStdoutMessage = (event: unknown) => {
            pushUniqueDiagnostic(
                geminiErrorMessages,
                extractGeminiErrorTextFromJsonEvent(event),
            );
            resultStatus = extractGeminiResultStatusFromJsonEvent(event) ?? resultStatus;
            publishRunMetadata(event);
            const progressText = extractGeminiProgressTextFromJsonEvent(event);
            if (progressText) {
                invocation.onProgressText?.(progressText);
            }
            const delta = extractGeminiTextDeltaFromJsonEvent(event);
            if (delta) {
                streamedText += delta;
                invocation.onPartialText?.(sanitizeAgentReplyText(streamedText));
            }
        };

        const handleStdoutLine = (line: string) => {
            if (!line.trim()) {
                return;
            }
            const parsed = parseJsonLine(line);
            if (parsed === null) {
                pushUniqueDiagnostic(
                    diagnosticLines,
                    normalizeRuntimeDiagnosticText(line),
                );
                return;
            }
            handleStdoutMessage(parsed);
        };

        const flushStdoutBuffer = () => {
            handleStdoutLine(stdoutBuffer);
            stdoutBuffer = "";
        };

        childProcess.stdout?.on("data", (chunk) => {
            stdoutBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
            while (true) {
                const newlineIndex = stdoutBuffer.indexOf("\n");
                if (newlineIndex === -1) {
                    break;
                }
                const line = stdoutBuffer.slice(0, newlineIndex);
                stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
                handleStdoutLine(line);
            }
        });

        childProcess.stderr?.on("data", (chunk) => {
            stderrBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        });

        childProcess.on("error", finalizeError);
        childProcess.on("close", (code, signal) => {
            flushStdoutBuffer();
            if (settled) {
                return;
            }
            const replyText = sanitizeAgentReplyText(streamedText);
            const diagnosticMessage = joinRuntimeDiagnostics([
                normalizeRuntimeDiagnosticText(stderrBuffer),
                ...geminiErrorMessages,
                ...diagnosticLines,
            ]);
            if (code === 0 && resultStatus !== "error" && replyText) {
                finalizeSuccess(replyText);
                return;
            }
            if (code === 0 && resultStatus === "error") {
                finalizeError(new Error(
                    diagnosticMessage ?? "Gemini reported an unsuccessful result.",
                ));
                return;
            }
            if (code === 0) {
                finalizeError(new Error("Gemini returned an empty response."));
                return;
            }
            finalizeError(new Error(
                diagnosticMessage
                    ?? `spawn gemini exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`,
            ));
        });

        if (invocation.abortSignal) {
            abortHandler = () => finalizeError(new AgentRuntimeCancelledError());
            invocation.abortSignal.addEventListener("abort", abortHandler, { once: true });
            if (invocation.abortSignal.aborted) {
                abortHandler();
                return;
            }
        }

        try {
            const stdin = childProcess.stdin;
            if (!stdin) {
                throw new Error("Gemini CLI did not expose stdin.");
            }
            stdin.write(buildSideNotePrompt({
                promptText: invocation.prompt,
                vaultRootPath: invocation.vaultRootPath,
            }));
            stdin.end();
        } catch (error) {
            finalizeError(error);
        }
    });
}
```

This uses the existing prompt builder and active-process registry. The argv builder remains the sole owner of the rule that no model, authentication, extension, MCP, resume, or reusable session option is passed.

- [ ] **Step 6: Add a module-injected runtime seam and Gemini dispatch**

Refactor only the final dispatch boundary:

```ts
export async function runAgentRuntimeWithModules(
    modules: NodeModules,
    invocation: AgentRuntimeInvocation,
): Promise<AgentRuntimeResult> {
    const actor = getAgentActorById(invocation.target);
    if (!actor.supported || actor.runtimeStrategy === "unsupported") {
        throw new Error(actor.unsupportedNotice ?? `${actor.label} is not supported in this build.`);
    }
    switch (actor.runtimeStrategy) {
        case "codex-cli": return runCodexDirect(modules, invocation);
        case "claude-cli": return runClaudeDirect(modules, invocation);
        case "gemini-cli": return runGeminiDirect(modules, invocation);
        default: throw new Error(`${actor.label} does not have an executable runtime strategy.`);
    }
}

export async function runAgentRuntime(invocation: AgentRuntimeInvocation): Promise<AgentRuntimeResult> {
    const modules = getNodeModules();
    if (!modules) {
        throw new Error("Local agent execution is unavailable in this Obsidian environment.");
    }
    return runAgentRuntimeWithModules(modules, invocation);
}
```

- [ ] **Step 7: Recompile and run focused plus full tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeAdapter.test.js
npm test
```

Expected: all runtime cases pass; the full suite has zero failures.

- [ ] **Step 8: Commit the Gemini process runner**

```bash
git add src/agents/agentRuntimeAdapter.ts tests/agentRuntimeAdapter.test.ts
git commit -m "feat: run Gemini CLI from comments"
```

### Task 5: Prove generic controller dispatch and document Gemini

**Files:**
- Modify: `tests/commentAgentController.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Replace the test harness's local provider union with `AsideAgentTarget`**

Import the shared type and use it for runtime calls and selection calls:

```ts
import type { AsideAgentTarget } from "../src/core/config/agentTargets";

const runtimeCalls: Array<{
    target: AsideAgentTarget;
    prompt: string;
    cwd: string;
    vaultRootPath?: string | null;
}> = [];
const runtimeSelectionCalls: AsideAgentTarget[] = [];
```

Use `getAgentActorLabel(target)` for the ownership string rather than a Claude/Codex conditional.

- [ ] **Step 2: Add a failing Gemini controller tracer test**

Add this Gemini peer-provider test:

```ts
test("comment agent controller dispatches gemini as a peer provider", async () => {
    const harness = createHarness({ runtimeReplyText: "Gemini reply." });
    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@gemini review this",
    });
    await waitForAgentQueueToDrain(harness.controller);
    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.status, "succeeded");
    assert.equal(latestRun?.requestedAgent, "gemini");
    assert.deepEqual(harness.runtimeSelectionCalls, ["gemini"]);
    assert.equal(harness.runtimeCalls[0]?.target, "gemini");
    assert.deepEqual(harness.editedEntries, [{
        commentId: "generated-2",
        body: "Gemini reply.",
    }]);
});
```

- [ ] **Step 3: Run the focused controller test**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentAgentController.test.js
```

Expected: the updated type-safe harness and Gemini tracer pass without controller production changes. If a hard-coded provider branch remains, the tracer fails and that branch must be replaced with actor-registry data.

- [ ] **Step 4: Update README provider examples**

Change all four current user-facing Codex/Claude lists to include Gemini, including the local-agent security disclosure:

```md
Type `@codex`, `@claude`, or `@gemini` in a thread...
```

Keep the local-runtime requirement explicit and do not add API-key, model-picker, remote Gemini, or mobile Gemini instructions.

- [ ] **Step 5: Re-run the change-surface search and tests**

Run:

```bash
rg -n '"codex" \| "claude"|@codex.*@claude|@claude.*@codex' src tests README.md -g '*.ts' -g '*.md'
npm test
```

Expected: remaining matches are intentional examples, provider adapters, compatibility methods, or test fixtures; all tests pass.

- [ ] **Step 6: Commit controller proof and docs**

```bash
git add tests/commentAgentController.test.ts README.md
git commit -m "docs: expose Gemini agent workflow"
```

### Task 6: Verify production artifacts, install the build, and update tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-gemini-cli-agent-support-design.md`
- Generated and inspected: `main.js`
- Inspected: `manifest.json`
- Inspected: `styles.css`

- [ ] **Step 1: Run whitespace, test, lint, type, compliance, bundle, and artifact checks**

Run:

```bash
git diff --check
npm run build
```

Expected: the complete test suite, ESLint, TypeScript typecheck, Obsidian compliance check, production bundle, and release artifact guard all exit zero.

- [ ] **Step 2: Inspect the exact public artifact set for source exposure**

Run:

```bash
find . -maxdepth 1 -type f \( -name 'main.js*' -o -name 'manifest.json' -o -name 'styles.css' \) -print | sort
rg -n 'sourceMappingURL|sourcesContent|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|API[_-]?KEY|SECRET=' main.js manifest.json styles.css
test ! -e main.js.map
node scripts/check-release-artifacts.mjs
```

Expected: the release allowlist tests and guard establish that the shipped plugin assets are `main.js`, `manifest.json`, and `styles.css`; no map, embedded sources, raw source, secret-bearing file, or secret marker is present. A nonzero `rg` exit with no matches is expected.

- [ ] **Step 3: Install and compare the verified build in `lean-startup`**

Run:

```bash
node scripts/install-built-plugin.mjs --vault /Users/wenqingli/Obsidian/lean-startup
cmp -s main.js /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/main.js
cmp -s manifest.json /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json
cmp -s styles.css /Users/wenqingli/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css
```

Expected: installation succeeds and every `cmp` exits zero.

- [ ] **Step 4: Perform the real Obsidian smoke check when UI control is available**

In `lean-startup`, reload Aside, create a side note containing `@gemini answer with one short sentence`, save it, and confirm:

- `@gemini` appears once in the inline dropdown.
- Settings show the Gemini runtime status.
- The run displays `Starting Gemini`, streams a reply, and persists the final entry.
- A second run can be cancelled and stays cancelled.
- Aside settings contain no Gemini API key, model, extension, MCP, or session fields.

If macOS Accessibility prevents UI automation, leave this one manual verification checkbox unchecked and report it precisely; do not claim it passed.

- [ ] **Step 5: Mark verified spec tracking items complete**

Change each implemented `[ ]` item under `### To Implement` to `[x]`. Mark automatic verification items `[x]` only after their commands pass. Mark the `lean-startup` smoke item `[x]` only if Step 4 was actually completed.

- [ ] **Step 6: Commit verification tracking**

```bash
git add docs/superpowers/specs/2026-08-08-gemini-cli-agent-support-design.md
git commit -m "docs: record Gemini verification"
```

- [ ] **Step 7: Review the complete branch diff**

Run:

```bash
git status --short
git log --oneline --decorate main..HEAD
git diff --stat main...HEAD
git diff --check main...HEAD
```

Expected: the worktree is clean, the branch contains only Gemini implementation/spec commits, and the final diff has no whitespace errors.
