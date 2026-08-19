# Default-Agent Script Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an availability-aware default agent, a dedicated Agents settings section, and a built-in `/create-script` workflow that creates immediately runnable vault scripts.

**Architecture:** Pure core policies own agent selection and the `/create-script` directive. Existing settings adapters consume one shared catalog, while the existing comment-agent controller remains the only owner of agent run persistence and execution. Codex, Claude Code, and Gemini continue to share one side-note prompt builder, with a request-kind flag adding the script contract only when required.

**Tech Stack:** TypeScript 5.9, Obsidian 1.13 APIs, Node test runner, CommonJS shared prompt policy, esbuild.

---

## Associated Specification

- `docs/superpowers/specs/2026-08-19-default-agent-script-creation-design.md`

The unchecked items in that specification's `## Implementation Tracking` section are the source of truth for this plan.

## File Structure

### New files

- `src/core/agents/defaultAgentSelection.ts` — pure preferred-agent and ordered-fallback policy.
- `src/core/text/createScriptDirective.ts` — canonical `/create-script` identity, parser, and reserved-name export.
- `src/agents/createScriptCommandController.ts` — thin saved-entry adapter that rejects mixed directives and delegates valid requests to the existing agent controller.
- `src/ui/views/agentRunAuthor.ts` — shared selected/fallback agent attribution formatting for persisted and streaming views.
- `tests/defaultAgentSelection.test.ts` — selection order, availability, and no-agent tests.
- `tests/createScriptDirective.test.ts` — command parser and response-policy tests.
- `tests/createScriptCommandController.test.ts` — routing, mixed-directive, fast-return, and idempotency tests.

### Modified files

- `src/core/agents/agentActorRegistry.ts` — continue to own actor order and default normalization.
- `src/core/agents/claudeActor.ts` — change the shared display label to `Claude Code`.
- `src/ui/settings/AsideSetting.ts` — persist `defaultAgent` and render the availability-aware picker/status.
- `src/settings/indexNoteSettingsPlanner.ts` — normalize and migrate the new setting.
- `src/settings/indexNoteSettingsController.ts` — expose the setting getter/setter.
- `src/main.ts` — wire settings, diagnostics, default runtime resolution, and create-script routing.
- `src/ui/settings/asideSettingCatalog.ts` — add the Agents section and detach status from the sidebar toggle.
- `src/ui/settings/agentRuntimeSettings.ts` — format status/fallback presentation independently of tab visibility.
- `src/core/agents/agentRuns.ts` — add create-script and fallback metadata to runs/streams.
- `src/agents/agentRunStorePlanner.ts` — normalize the new optional persisted metadata.
- `shared/sideNotePromptPolicy.js` and `.d.ts` — own the script-creation prompt contract.
- `src/agents/agentRuntimeAdapter.ts` — pass request kind into the shared prompt for all three providers.
- `src/agents/commentAgentController.ts` — queue create-script runs, handle no-agent outcomes, and re-resolve on Regenerate.
- `src/vaultScripts/vaultScriptRegistry.ts` — reserve `create-script` through the shared command policy.
- `src/vaultScripts/commentScriptController.ts` — route built-in commands before registered scripts.
- `src/ui/editor/commentMentionSuggestions.ts` — suggest `/create-script` before live scripts.
- `src/ui/modals/SideNoteMentionSuggestModal.ts` and `src/ui/views/sidebarDraftComment.ts` — expose the command in frontend help text.
- `src/ui/views/sidebarPersistedComment.ts` and `src/ui/views/streamedAgentReplyController.ts` — display fallback attribution.
- Existing focused tests under `tests/` — update fixtures and add regression assertions.

## Task 1: Add the shared default-agent selection policy

**Files:**
- Create: `src/core/agents/defaultAgentSelection.ts`
- Create: `tests/defaultAgentSelection.test.ts`
- Modify: `src/core/agents/claudeActor.ts`
- Modify: `tests/commentMentionSuggestions.test.ts`

- [ ] **Step 1: Write failing selection-policy tests**

Create `tests/defaultAgentSelection.test.ts` with cases for preferred, fallback, and none:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import type { AgentRuntimeDiagnostics } from "../src/agents/agentRuntimeAdapter";
import {
    resolveDefaultAgentSelection,
} from "../src/core/agents/defaultAgentSelection";
import type { AsideAgentTarget } from "../src/core/config/agentTargets";

function diagnostics(available: AsideAgentTarget[]): Map<AsideAgentTarget, AgentRuntimeDiagnostics> {
    return new Map((["codex", "claude", "gemini"] as AsideAgentTarget[]).map((target) => [
        target,
        {
            status: available.includes(target) ? "available" : "unavailable",
            message: available.includes(target) ? "Ready" : "Missing",
        },
    ]));
}

test("default agent selection uses the available preference", () => {
    assert.deepEqual(resolveDefaultAgentSelection("gemini", diagnostics(["codex", "gemini"])), {
        kind: "preferred",
        preferredAgent: "gemini",
        selectedAgent: "gemini",
    });
});

test("default agent selection falls back in registry order", () => {
    assert.deepEqual(resolveDefaultAgentSelection("gemini", diagnostics(["claude", "gemini"])), {
        kind: "preferred",
        preferredAgent: "gemini",
        selectedAgent: "gemini",
    });
    assert.deepEqual(resolveDefaultAgentSelection("gemini", diagnostics(["claude"])), {
        kind: "fallback",
        preferredAgent: "gemini",
        selectedAgent: "claude",
    });
    assert.deepEqual(resolveDefaultAgentSelection("gemini", diagnostics(["codex", "claude"])), {
        kind: "fallback",
        preferredAgent: "gemini",
        selectedAgent: "codex",
    });
});

test("default agent selection reports none when no runtime is available", () => {
    assert.deepEqual(resolveDefaultAgentSelection("codex", diagnostics([])), {
        kind: "none",
        preferredAgent: "codex",
    });
});
```

- [ ] **Step 2: Compile and run the new test to verify failure**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/defaultAgentSelection.test.js
```

Expected: compilation fails because `defaultAgentSelection.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure policy**

Create `src/core/agents/defaultAgentSelection.ts`:

```ts
import type { AgentRuntimeDiagnostics } from "../../agents/agentRuntimeAdapter";
import { getSupportedAgentActors } from "./agentActorRegistry";
import type { AsideAgentTarget } from "../config/agentTargets";

export type DefaultAgentSelection =
    | { kind: "preferred"; preferredAgent: AsideAgentTarget; selectedAgent: AsideAgentTarget }
    | { kind: "fallback"; preferredAgent: AsideAgentTarget; selectedAgent: AsideAgentTarget }
    | { kind: "none"; preferredAgent: AsideAgentTarget };

export function resolveDefaultAgentSelection(
    preferredAgent: AsideAgentTarget,
    diagnosticsByTarget: ReadonlyMap<AsideAgentTarget, AgentRuntimeDiagnostics>,
): DefaultAgentSelection {
    const availableTargets = getSupportedAgentActors()
        .filter((actor) => diagnosticsByTarget.get(actor.id)?.status === "available")
        .map((actor) => actor.id);
    if (availableTargets.includes(preferredAgent)) {
        return { kind: "preferred", preferredAgent, selectedAgent: preferredAgent };
    }
    const selectedAgent = availableTargets[0];
    return selectedAgent
        ? { kind: "fallback", preferredAgent, selectedAgent }
        : { kind: "none", preferredAgent };
}
```

Change `CLAUDE_AGENT_ACTOR.label` to `Claude Code`. Update the existing mention-suggestion label assertion from `Claude` to `Claude Code` while keeping `@claude` unchanged.

- [ ] **Step 4: Run focused tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/defaultAgentSelection.test.js .test-dist/tests/commentMentionSuggestions.test.js
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit the policy slice**

```bash
git add src/core/agents/defaultAgentSelection.ts src/core/agents/claudeActor.ts tests/defaultAgentSelection.test.ts tests/commentMentionSuggestions.test.ts
git commit -m "feat(agents): add default selection policy"
```

## Task 2: Persist the user's default-agent preference

**Files:**
- Modify: `src/ui/settings/AsideSetting.ts`
- Modify: `src/settings/indexNoteSettingsPlanner.ts`
- Modify: `src/settings/indexNoteSettingsController.ts`
- Modify: `src/main.ts`
- Modify: `tests/indexNoteSettingsController.test.ts`

- [ ] **Step 1: Add failing migration and setter tests**

Extend the test settings factory with `defaultAgent: overrides.defaultAgent ?? "codex"`, then add:

```ts
test("loaded settings normalize the default agent and rewrite invalid values", () => {
    const resolved = resolveLoadedSettings({
        indexNotePath: ALL_COMMENTS_NOTE_PATH,
        defaultAgent: " GEMINI ",
    } as PersistedPluginData, createSettings());

    assert.equal(resolved.settings.defaultAgent, "gemini");
    assert.equal(resolved.shouldRewriteLegacySettings, true);
});

test("index note settings controller persists the default agent", async () => {
    const harness = createControllerHarness();

    await harness.controller.setDefaultAgent("claude");

    assert.equal(harness.getSettings().defaultAgent, "claude");
    assert.equal(harness.savedPayloads.at(-1)?.defaultAgent, "claude");
});
```

- [ ] **Step 2: Compile to verify the missing setting failures**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: TypeScript reports missing `defaultAgent` and `setDefaultAgent` members.

- [ ] **Step 3: Add the normalized setting and controller API**

In `AsideSettings` and `DEFAULT_SETTINGS`, add:

```ts
defaultAgent: AsideAgentTarget;
// ...
defaultAgent: DEFAULT_ASIDE_AGENT_ACTOR_ID,
```

In `resolveLoadedSettings`, normalize through the registry:

```ts
const defaultAgent = normalizeSupportedAgentTarget(
    hasOwn(loaded ?? {}, "defaultAgent") ? loaded?.defaultAgent : defaults.defaultAgent,
);
```

Include `defaultAgent` in the resolved settings and mark persisted invalid or missing values for rewrite:

```ts
const hasDefaultAgentSetting = hasOwn(loaded ?? {}, "defaultAgent");
// ...
|| (loaded !== null && !hasDefaultAgentSetting)
|| (hasDefaultAgentSetting && defaultAgent !== loaded?.defaultAgent)
```

Add to `IndexNoteSettingsController`:

```ts
public getDefaultAgent(): AsideAgentTarget {
    return normalizeSupportedAgentTarget(this.host.getSettings().defaultAgent);
}

public async setDefaultAgent(target: AsideAgentTarget): Promise<void> {
    const settings = this.host.getSettings();
    const defaultAgent = normalizeSupportedAgentTarget(target);
    if (settings.defaultAgent === defaultAgent) return;
    this.host.setSettings({ ...settings, defaultAgent });
    await this.saveSettings();
}
```

Expose matching `getDefaultAgent()` and `setDefaultAgent()` methods from `Aside` in `src/main.ts`.

- [ ] **Step 4: Run the focused settings tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/indexNoteSettingsController.test.js
```

Expected: all settings controller tests pass.

- [ ] **Step 5: Commit the persistence slice**

```bash
git add src/ui/settings/AsideSetting.ts src/settings/indexNoteSettingsPlanner.ts src/settings/indexNoteSettingsController.ts src/main.ts tests/indexNoteSettingsController.test.ts
git commit -m "feat(settings): persist default agent"
```

## Task 3: Add the Agents settings section and independent status

**Files:**
- Modify: `src/ui/settings/asideSettingCatalog.ts`
- Modify: `src/ui/settings/agentRuntimeSettings.ts`
- Modify: `src/ui/settings/AsideSetting.ts`
- Modify: `tests/asideSettingCatalog.test.ts`
- Modify: `tests/agentRuntimeSettings.test.ts`

- [ ] **Step 1: Write failing catalog and presentation tests**

Change expected settings keys to begin with `default-agent`, change the allowed sections to include `agents`, and assert section order:

```ts
assert.deepEqual(ASIDE_SETTING_SECTIONS.map((section) => section.key), [
    "agents",
    "sidebar",
    "publishing",
    "index-note",
]);
```

Replace the tab-visibility status test with an availability/fallback test:

```ts
test("agent status formatting is independent of sidebar visibility", () => {
    assert.deepEqual(formatAgentRuntimeStatusLines([
        { label: "Codex", statusBadge: "❌" },
        { label: "Claude Code", statusBadge: "✅" },
        { label: "Gemini", statusBadge: "❌" },
    ]), ["Codex ❌    Claude Code ✅    Gemini ❌"]);
    assert.equal(formatDefaultAgentFallback("codex", "claude"), "Using Claude Code while Codex is unavailable.");
});
```

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/asideSettingCatalog.test.js .test-dist/tests/agentRuntimeSettings.test.js
```

Expected: assertions fail because there is no Agents section and status still depends on the tab toggle.

- [ ] **Step 3: Refactor the shared settings catalog**

Add `agents` to `AsideSettingSection`, place `{ key: "agents", heading: "Agents" }` first, and add a catalog entry:

```ts
{
    key: "default-agent",
    section: "agents",
    name: "Default agent",
    description: "Preferred local agent for /create-script.",
    aliases: ["Codex", "Claude Code", "Gemini"],
    keywords: ["runtime", "availability", "fallback"],
    render: (setting, context) => context.renderDefaultAgentSettings(
        setting,
        "Preferred local agent for /create-script.",
    ),
},
```

Remove runtime-status rendering from `show-agent-tab`. Replace the catalog context method with `renderDefaultAgentSettings`.

In `agentRuntimeSettings.ts`, remove `shouldRenderAgentRuntimeStatus`, change status inputs from directive to label, and add:

```ts
export function formatDefaultAgentFallback(
    preferred: AsideAgentTarget,
    selected: AsideAgentTarget,
): string {
    return preferred === selected
        ? ""
        : `Using ${getAgentActorLabel(selected)} while ${getAgentActorLabel(preferred)} is unavailable.`;
}
```

- [ ] **Step 4: Render one availability-aware picker/status row**

Refactor the current diagnostics renderer in `AsideSetting.ts` so the **Default agent** row:

1. adds all three actor options in registry order;
2. disables every option until its probe completes;
3. enables only actors with `status === "available"`;
4. keeps an unavailable saved preference visible and selected;
5. formats the three status badges in the description;
6. appends the fallback sentence from the shared selection policy;
7. calls `plugin.setDefaultAgent` on change;
8. ignores stale async results through `agentStatusRefreshToken`.

The core state transition in the renderer should keep the persisted preference selected while calculating a separate effective target for the description:

```ts
const selection = resolveDefaultAgentSelection(
    this.plugin.settings.defaultAgent,
    localDiagnosticsByTarget,
);
const effectiveTarget = selection.kind === "none"
    ? this.plugin.settings.defaultAgent
    : selection.selectedAgent;
dropdown.setValue(this.plugin.settings.defaultAgent);
```

Do not persist `effectiveTarget`; it is display/runtime fallback only.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/asideSettingCatalog.test.js .test-dist/tests/agentRuntimeSettings.test.js .test-dist/tests/indexNoteSettingsController.test.js
npm run typecheck
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 6: Commit the settings UI slice**

```bash
git add src/ui/settings/asideSettingCatalog.ts src/ui/settings/agentRuntimeSettings.ts src/ui/settings/AsideSetting.ts tests/asideSettingCatalog.test.ts tests/agentRuntimeSettings.test.ts
git commit -m "feat(settings): add agents section"
```

## Task 4: Add the reserved `/create-script` command and suggestion

**Files:**
- Create: `src/core/text/createScriptDirective.ts`
- Create: `tests/createScriptDirective.test.ts`
- Modify: `src/vaultScripts/vaultScriptRegistry.ts`
- Modify: `src/ui/editor/commentMentionSuggestions.ts`
- Modify: `src/ui/modals/SideNoteMentionSuggestModal.ts`
- Modify: `src/ui/views/sidebarDraftComment.ts`
- Modify: `tests/vaultScriptRegistry.test.ts`
- Modify: `tests/commentMentionSuggestions.test.ts`
- Modify: `tests/sidebarDraftComment.test.ts`

- [ ] **Step 1: Write failing parser and reservation tests**

Create `tests/createScriptDirective.test.ts`:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import { parseCreateScriptDirective } from "../src/core/text/createScriptDirective";

test("create-script parser extracts one natural-language request", () => {
    assert.deepEqual(parseCreateScriptDirective("/create-script build a cleaner"), {
        kind: "request",
        requestText: "build a cleaner",
    });
});

test("create-script parser handles empty and repeated commands", () => {
    assert.deepEqual(parseCreateScriptDirective("/create-script"), { kind: "empty" });
    assert.deepEqual(parseCreateScriptDirective("/create-script x /create-script y"), {
        kind: "rejected",
        message: "Use /create-script only once per side note.",
    });
});
```

Add registry and suggestion assertions:

```ts
registry.seed(["🛠️ scripts/create-script.mjs", "🛠️ scripts/clean.mjs"]);
assert.equal(registry.resolve("create-script"), null);
assert.deepEqual(registry.getRunnableScripts().map((script) => script.mentionName), ["clean"]);

assert.deepEqual(
    buildMentionSuggestions([cleanLinksScript], "/").map((item) => item.mention),
    ["/create-script", "/clean-links"],
);
```

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/createScriptDirective.test.js .test-dist/tests/vaultScriptRegistry.test.js .test-dist/tests/commentMentionSuggestions.test.js
```

Expected: compilation or assertions fail because the command policy and suggestion do not exist.

- [ ] **Step 3: Implement the command policy**

Create `src/core/text/createScriptDirective.ts`:

```ts
export const CREATE_SCRIPT_DIRECTIVE = "/create-script";
export const RESERVED_BUILT_IN_SLASH_MENTION_NAMES = new Set(["create-script"]);
export const CREATE_SCRIPT_USAGE = "Use /create-script followed by the script you want to create.";
export const CREATE_SCRIPT_NO_AGENT = "No agent is available to create the script.";
export const CREATE_SCRIPT_MIXED_SCRIPT = "Use /create-script or a vault script, not both.";
export const CREATE_SCRIPT_MIXED_AGENT = "Use /create-script without @agent; choose the default under Settings → Agents.";

export type CreateScriptDirectiveResolution =
    | { kind: "none" }
    | { kind: "empty" }
    | { kind: "request"; requestText: string }
    | { kind: "rejected"; message: string };

const CREATE_SCRIPT_PATTERN = /(^|[^\w/])\/create-script(?=$|\s)/giu;

export function parseCreateScriptDirective(value: string): CreateScriptDirectiveResolution {
    const matches = Array.from(value.matchAll(CREATE_SCRIPT_PATTERN));
    if (matches.length === 0) return { kind: "none" };
    if (matches.length > 1) {
        return { kind: "rejected", message: "Use /create-script only once per side note." };
    }
    const match = matches[0];
    const fullMatch = match?.[0] ?? "";
    const prefixLength = match?.[1]?.length ?? 0;
    const commandStart = (match?.index ?? 0) + prefixLength;
    const requestText = `${value.slice(0, commandStart)}${value.slice(commandStart + fullMatch.length - prefixLength)}`.trim();
    return requestText ? { kind: "request", requestText } : { kind: "empty" };
}
```

Use `RESERVED_BUILT_IN_SLASH_MENTION_NAMES` in `VaultScriptRegistry` beside `todo` and agent names.

- [ ] **Step 4: Add the slash built-in to frontend suggestions**

Extend the built-in suggestion union to allow slash values. Build separate `@` and `/` built-in lists so explicit slash queries return `/create-script` plus matching live scripts. Continue deriving reserved names from the combined built-in list.

Update help text to mention `/create-script`:

```ts
this.setPlaceholder("Mention an agent, todo, /create-script, or a vault script");
```

```ts
`Write a side note. Use B or H for styling, or type /create-script, /script-name, @todo, ${supportedAgentDirectives}.`
```

- [ ] **Step 5: Run focused frontend and policy tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/createScriptDirective.test.js .test-dist/tests/vaultScriptRegistry.test.js .test-dist/tests/commentMentionSuggestions.test.js .test-dist/tests/sidebarDraftComment.test.js
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit the directive slice**

```bash
git add src/core/text/createScriptDirective.ts src/vaultScripts/vaultScriptRegistry.ts src/ui/editor/commentMentionSuggestions.ts src/ui/modals/SideNoteMentionSuggestModal.ts src/ui/views/sidebarDraftComment.ts tests/createScriptDirective.test.ts tests/vaultScriptRegistry.test.ts tests/commentMentionSuggestions.test.ts tests/sidebarDraftComment.test.ts
git commit -m "feat(scripts): add create-script directive"
```

## Task 5: Persist request kind and share the creation prompt

**Files:**
- Modify: `src/core/agents/agentRuns.ts`
- Modify: `src/agents/agentRunStorePlanner.ts`
- Modify: `shared/sideNotePromptPolicy.js`
- Modify: `shared/sideNotePromptPolicy.d.ts`
- Modify: `src/agents/agentRuntimeAdapter.ts`
- Modify: `tests/agentRunStorePlanner.test.ts`
- Modify: `tests/sideNotePromptPolicy.test.mjs`
- Modify: `tests/agentRuntimeAdapter.test.ts`

- [ ] **Step 1: Write failing metadata and prompt tests**

Add to `tests/agentRunStorePlanner.test.ts` a valid persisted run with:

```ts
requestKind: "create-script",
preferredAgent: "GEMINI",
requestedAgent: "claude",
```

Assert normalization keeps `requestKind: "create-script"` and normalizes `preferredAgent: "gemini"`. Assert an unknown request kind is omitted and legacy runs remain valid.

Add to `tests/sideNotePromptPolicy.test.mjs`:

```js
test("buildSideNotePrompt adds the shared create-script contract only for create-script runs", () => {
    const createPrompt = sideNotePromptPolicy.buildSideNotePrompt({
        promptText: "build a cleaner",
        rootLabel: "vault root",
        rootPath: "/vault",
        requestKind: "create-script",
    });
    assert.match(createPrompt, /first positional argument/i);
    assert.match(createPrompt, /standard output/i);
    assert.match(createPrompt, /\/script-name/i);

    const ordinaryPrompt = sideNotePromptPolicy.buildSideNotePrompt({
        promptText: "explain this",
        rootLabel: "vault root",
        rootPath: "/vault",
    });
    assert.doesNotMatch(ordinaryPrompt, /first positional argument/i);
});
```

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test tests/sideNotePromptPolicy.test.mjs .test-dist/tests/agentRunStorePlanner.test.js .test-dist/tests/agentRuntimeAdapter.test.js
```

Expected: metadata assertions and prompt assertions fail.

- [ ] **Step 3: Add optional run and stream metadata**

In `agentRuns.ts`, add:

```ts
export type AgentRunRequestKind = "create-script";

// On AgentRunRecord and AgentRunStreamState:
requestKind?: AgentRunRequestKind;
preferredAgent?: AsideAgentTarget;
```

Normalize only the known request kind and normalize `preferredAgent` only when it is a supported value. Preserve the fields through clones and stream-state builders.

- [ ] **Step 4: Add the shared create-script prompt contract**

Extend `buildSideNotePrompt` options with `requestKind?: "create-script"`. When selected, inject one shared block before the user prompt:

```js
if (options?.requestKind === "create-script") {
    promptLines.push(
        "This is a /create-script request. Create the requested reusable vault script now.",
        `Create a collision-free direct child of the active vault's \`${VAULT_SCRIPT_FOLDER_PATH}/\` using .mjs, .js, or .cjs.`,
        "Do not use the reserved create-script name, raw TypeScript, JSX-family files, nested script folders, or a case-insensitive mention collision.",
        "The script receives the current Markdown note's absolute path as its first positional argument and runs with the vault root as its working directory.",
        "Write concise user-facing results to standard output and failures to standard error.",
        "In the Aside reply, report the created vault-relative path and its /script-name invocation.",
        "If a previous attempt already created matching work, inspect and finish that file instead of creating a duplicate.",
    );
}
```

Add `requestKind` to `AgentRuntimeInvocation`, pass it through the TypeScript wrapper, and use the same call for Codex, Claude Code, and Gemini.

- [ ] **Step 5: Run focused metadata and prompt tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test tests/sideNotePromptPolicy.test.mjs .test-dist/tests/agentRunStorePlanner.test.js .test-dist/tests/agentRuntimeAdapter.test.js
```

Expected: all focused tests pass and each provider invocation uses the shared prompt builder.

- [ ] **Step 6: Commit the metadata and prompt slice**

```bash
git add src/core/agents/agentRuns.ts src/agents/agentRunStorePlanner.ts shared/sideNotePromptPolicy.js shared/sideNotePromptPolicy.d.ts src/agents/agentRuntimeAdapter.ts tests/agentRunStorePlanner.test.ts tests/sideNotePromptPolicy.test.mjs tests/agentRuntimeAdapter.test.ts
git commit -m "feat(scripts): add creation prompt contract"
```

## Task 6: Route `/create-script` through the available default agent

**Files:**
- Create: `src/agents/createScriptCommandController.ts`
- Create: `tests/createScriptCommandController.test.ts`
- Modify: `src/agents/commentAgentController.ts`
- Modify: `src/agents/agentRuntimeSelection.ts`
- Modify: `src/vaultScripts/commentScriptController.ts`
- Modify: `src/main.ts`
- Modify: `tests/commentAgentController.test.ts`
- Modify: `tests/commentScriptController.test.ts`

- [ ] **Step 1: Write failing routing and fallback tests**

Create a command-controller harness with a real `VaultScriptRegistry` and a fake dispatcher. Cover:

```ts
test("create-script command delegates valid request text before vault scripts", async () => {
    const harness = createHarness({ scripts: ["🛠️ scripts/clean.mjs"] });
    assert.equal(await harness.controller.handleSavedUserEntry(event(
        "/create-script build a formatter",
    )), true);
    assert.deepEqual(harness.dispatchedRequests, ["build a formatter"]);
});

test("create-script rejects mixed registered scripts and explicit agents", async () => {
    const harness = createHarness({ scripts: ["🛠️ scripts/clean.mjs"] });
    await harness.controller.handleSavedUserEntry(event("/create-script /clean do it"));
    await harness.controller.handleSavedUserEntry(event("/create-script @claude do it", "entry-2"));
    assert.deepEqual(harness.dispatchedRequests, []);
    assert.match(harness.replies[0] ?? "", /one directive/i);
    assert.match(harness.replies[1] ?? "", /Settings → Agents/i);
});
```

Extend `commentAgentController.test.ts` with preferred, fallback, and none outcomes. The fallback case must assert:

```ts
assert.equal(latestRun?.requestKind, "create-script");
assert.equal(latestRun?.preferredAgent, "gemini");
assert.equal(latestRun?.requestedAgent, "codex");
assert.equal(harness.runtimeCalls[0]?.requestKind, "create-script");
```

The none case must assert the exact reply, zero runs, and zero runtime calls.

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/createScriptCommandController.test.js .test-dist/tests/commentAgentController.test.js .test-dist/tests/commentScriptController.test.js
```

Expected: compilation fails because the command controller and default dispatch APIs do not exist.

- [ ] **Step 3: Add a thin command controller**

Create `CreateScriptCommandController` with `handleSavedUserEntry(event): Promise<boolean>`. It must:

1. call `parseCreateScriptDirective`;
2. return `false` for `none`;
3. append the usage or parser rejection for `empty`/`rejected`;
4. call `resolveScriptDirective` and `parseAgentDirectives` to reject mixed directives;
5. delegate the validated `requestText` to `CommentAgentController.handleCreateScriptRequest`;
6. keep an in-memory `handledEntryIds` set, cleared on controller disposal, so one saved entry cannot append duplicate fast-return replies during the session.

Import these response constants from the shared `createScriptDirective.ts` policy:

```ts
import {
    CREATE_SCRIPT_MIXED_AGENT,
    CREATE_SCRIPT_MIXED_SCRIPT,
    CREATE_SCRIPT_NO_AGENT,
    CREATE_SCRIPT_USAGE,
} from "../core/text/createScriptDirective";
```

Construct the controller with a narrow host interface:

```ts
export interface CreateScriptCommandHost {
    getRegistry(): VaultScriptRegistry;
    appendReply(event: SavedUserEntryEvent, body: string): Promise<void>;
    dispatchRequest(event: SavedUserEntryEvent, requestText: string): Promise<void>;
}
```

- [ ] **Step 4: Add default runtime resolution in Main**

Add a result type that combines the pure selection with the existing runtime selection:

```ts
export type DefaultAgentRuntimeSelection =
    | {
        kind: "resolved";
        selectedAgent: AsideAgentTarget;
        preferredAgent: AsideAgentTarget;
        usedFallback: boolean;
        runtime: AgentRunRuntime;
        modePreference: AgentRuntimeModePreference;
    }
    | { kind: "none"; preferredAgent: AsideAgentTarget };
```

Implement `Aside.resolveDefaultAgentRuntimeSelection()` by probing every supported actor with `Promise.all`, calling `resolveDefaultAgentSelection`, and converting the selected actor's already-fetched diagnostic through `resolveAgentRuntimeSelectionPlan`. Probe errors become unavailable diagnostics for that actor.

- [ ] **Step 5: Queue create-script runs in the existing agent controller**

Add `resolveDefaultAgentRuntimeSelection` to `CommentAgentHost` and implement:

```ts
public async handleCreateScriptRequest(
    event: SavedUserEntryEvent,
    requestText: string,
): Promise<void> {
    if (getLatestAgentRunForTriggerEntry(this.store.getRuns(), event.entryId)) return;
    const selection = await this.host.resolveDefaultAgentRuntimeSelection();
    if (selection.kind === "none") {
        await this.appendCommandReply(event, CREATE_SCRIPT_NO_AGENT);
        return;
    }
    const run = this.buildQueuedRun({
        threadId: event.threadId,
        triggerEntryId: event.entryId,
        filePath: event.filePath,
        requestedAgent: selection.selectedAgent,
        preferredAgent: selection.usedFallback ? selection.preferredAgent : undefined,
        requestKind: "create-script",
        runtime: selection.runtime,
        modePreference: selection.modePreference,
        promptText: requestText,
    });
    await this.enqueueRun(run);
}
```

Pass `run.requestKind` to `runAgentRuntime`. Add `requestKind` and `preferredAgent` to `buildQueuedRun` options and output.

- [ ] **Step 6: Wire routing order**

Change `routeSavedUserEntry` to:

```ts
const handledByBuiltIn = await createScriptController?.handleSavedUserEntry(event) ?? false;
if (handledByBuiltIn) return;
const handledByScript = await scriptController?.handleSavedUserEntry(event) ?? false;
if (!handledByScript) await agentController.handleSavedUserEntry(event);
```

Construct the command controller in `main.ts`, initialize/dispose it with the plugin, and pass it into the router.

- [ ] **Step 7: Run focused routing tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/createScriptCommandController.test.js .test-dist/tests/commentAgentController.test.js .test-dist/tests/commentScriptController.test.js
```

Expected: valid commands queue once, fallback metadata is correct, no-agent returns immediately, mixed commands are rejected, and old routing tests pass.

- [ ] **Step 8: Commit the routing slice**

```bash
git add src/agents/createScriptCommandController.ts src/agents/commentAgentController.ts src/vaultScripts/commentScriptController.ts src/main.ts tests/createScriptCommandController.test.ts tests/commentAgentController.test.ts tests/commentScriptController.test.ts
git commit -m "feat(scripts): route creation through agents"
```

## Task 7: Re-resolve Regenerate and display fallback attribution

**Files:**
- Modify: `src/agents/commentAgentController.ts`
- Modify: `src/core/agents/agentRuns.ts`
- Create: `src/ui/views/agentRunAuthor.ts`
- Create: `tests/agentRunAuthor.test.ts`
- Modify: `src/ui/views/sidebarPersistedComment.ts`
- Modify: `src/ui/views/streamedAgentReplyController.ts`
- Modify: `tests/commentAgentController.test.ts`
- Modify: `tests/sidebarPersistedComment.test.ts`
- Modify: `tests/streamedAgentReplyController.test.ts`

- [ ] **Step 1: Write failing Regenerate and presentation tests**

Add a controller test that creates a failed create-script run with preferred Gemini and effective Codex, changes the fake selection to Claude Code, invokes `retryRun`, and asserts the replacement run:

```ts
assert.equal(retry?.requestKind, "create-script");
assert.equal(retry?.requestedAgent, "claude");
assert.equal(retry?.preferredAgent, "gemini");
assert.equal(retry?.outputEntryId, previous.outputEntryId);
```

Add pure author-label assertions in `tests/agentRunAuthor.test.ts`:

```ts
assert.equal(getAgentRunAuthorLabel(createAgentRun({
    requestKind: "create-script",
    requestedAgent: "claude",
    preferredAgent: "gemini",
})), "Claude Code (fallback for Gemini)");
```

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentAgentController.test.js .test-dist/tests/sidebarPersistedComment.test.js .test-dist/tests/streamedAgentReplyController.test.js
```

Expected: Regenerate still requires an explicit `@agent`, and labels omit fallback attribution.

- [ ] **Step 3: Re-resolve create-script retries explicitly**

In `retryPromptForCommentInternal`, inspect the previous run before parsing explicit directives. For `requestKind === "create-script"`:

1. parse the latest trigger entry as `/create-script`;
2. reject only if it is no longer a valid request;
3. call `resolveDefaultAgentRuntimeSelection()` again;
4. return the no-agent notice without launching when none are available;
5. build a replacement run with the same request kind and newly selected actor;
6. preserve the existing output-entry replacement behavior and retry lineage.

Do not add automatic fallback inside `executeLocalRun`; a launch or execution failure remains attributed to the selected provider until the user explicitly presses Regenerate.

- [ ] **Step 4: Centralize fallback author labels**

Create `src/ui/views/agentRunAuthor.ts` with one formatter:

```ts
export function getAgentRunAuthorLabel(
    run: Pick<AgentRunRecord, "requestedAgent" | "preferredAgent">,
): string {
    const selected = getAgentActorLabel(run.requestedAgent);
    return run.preferredAgent && run.preferredAgent !== run.requestedAgent
        ? `${selected} (fallback for ${getAgentActorLabel(run.preferredAgent)})`
        : selected;
}
```

Use the same formatter for persisted and streamed author indicators. Carry `preferredAgent` into `AgentRunStreamState` from the run so attribution is visible while the command is running.

- [ ] **Step 5: Run focused Regenerate and UI tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentAgentController.test.js .test-dist/tests/sidebarPersistedComment.test.js .test-dist/tests/streamedAgentReplyController.test.js
```

Expected: explicit Regenerate can choose a new fallback, output replacement remains stable, and both streaming and persisted labels identify fallback.

- [ ] **Step 6: Commit the retry and attribution slice**

```bash
git add src/agents/commentAgentController.ts src/core/agents/agentRuns.ts src/ui/views/agentRunAuthor.ts src/ui/views/sidebarPersistedComment.ts src/ui/views/streamedAgentReplyController.ts tests/agentRunAuthor.test.ts tests/commentAgentController.test.ts tests/sidebarPersistedComment.test.ts tests/streamedAgentReplyController.test.ts
git commit -m "feat(agents): show script fallback runs"
```

## Task 8: Run complete verification and update tracked documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-08-19-default-agent-script-creation-design.md`
- Verify: `main.js`, `manifest.json`, `styles.css`

- [ ] **Step 1: Re-run the change-surface audit search**

Run:

```bash
rg -n "create-script|Codex → Claude Code → Gemini|first positional argument|No agent is available to create the script" src shared tests docs
```

Expected: product rules appear only in their shared owners, intentional adapters, tests, and documentation. Remove any duplicated provider-specific prompt or settings policy found by the search.

- [ ] **Step 2: Run the complete automated verification**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run check:obsidian
npm run bundle
npm run release:artifacts:check
```

Expected: every command exits 0. The artifact guard confirms that the shipped set remains `main.js`, `manifest.json`, and `styles.css`, with no `main.js.map`, `sourceMappingURL`, `sourcesContent`, raw TypeScript/JSX-family files, or secret-bearing files.

- [ ] **Step 3: Install the built plugin for frontend acceptance**

Run:

```bash
npm run dev:install-built -- --vault /Users/example/Obsidian/lean-startup
```

Expected: the installer copies only `main.js`, `manifest.json`, and `styles.css` into the installed Aside plugin directory.

- [ ] **Step 4: Hand the installed build to the user for frontend acceptance**

Ask the user to perform these checks in Obsidian:

1. Open **Settings → Aside → Agents**.
2. Confirm Codex, Claude Code, and Gemini appear in order with current status.
3. Choose an available default agent.
4. Submit `/create-script create a Docling image-to-Markdown script` in a real Aside thread.
5. Confirm the chosen or fallback provider is attributed correctly.
6. Confirm the reply names a direct `🛠️ scripts/<name>.<ext>` file and `/name`.
7. Type `/` in another draft and confirm `/name` appears without restarting.
8. Invoke `/name` and confirm the existing script runner receives the current note path.
9. Make all agent runtimes unavailable and confirm the immediate no-agent reply with no queued run.

Expected: the user reports the frontend result. Do not mark the smoke-test tracking item complete before that report.

- [ ] **Step 5: Mark verified spec items complete**

After Steps 1–4 provide evidence, change only the corresponding verified `[ ]` items in `## Implementation Tracking` to `[x]`. Leave the installed-plugin smoke-test item unchecked until the frontend test is actually performed.

- [ ] **Step 6: Commit verification tracking**

```bash
git add -f docs/superpowers/specs/2026-08-19-default-agent-script-creation-design.md
git commit -m "docs: complete script creation tracking"
```

## Completion Criteria

- `/create-script` is suggested and cannot be shadowed by a vault file.
- The user can select an available default agent under a dedicated Agents section.
- Dispatch uses the preference when available, otherwise Codex → Claude Code → Gemini fallback order.
- No available agent returns immediately without queuing a run.
- All three providers receive one shared creation contract.
- Explicit agents and existing vault scripts retain their behavior.
- Automatic cross-provider retry never occurs after launch.
- Regenerate re-evaluates availability and fallback only after explicit user action.
- Fallback is visible in streaming and persisted attribution.
- Automated verification and artifact exposure checks pass.
- The tracked spec reflects only evidence-backed completion.
