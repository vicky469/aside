# Agents Experiment Feature Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every Agents affordance and execution entry point behind a vault-scoped `agents` feature flag that defaults off while preserving saved agent data and the existing Publishing flag contract.

**Architecture:** Extend the canonical feature-flag registry, replace the publish-only storage synchronizer with a flag-parameterized implementation, and synchronize every declared flag before UI registration. Pass a boolean Agents capability into pure settings, suggestion, draft, and sidebar builders, while runtime controllers receive a host callback and reject disabled directives before diagnostics or launch.

**Tech Stack:** TypeScript, Obsidian plugin APIs, Node test runner, localStorage, esbuild, ESLint.

---

### Task 1: Generalize the canonical feature-flag model and storage synchronizer

**Files:**
- Create: `tests/featureFlags.test.ts`
- Modify: `tests/featureFlagStorageSync.test.ts`
- Modify: `tests/publishSettings.test.ts`
- Modify: `tests/publicHtmlPublishController.test.ts`
- Modify: `tests/indexNoteSettingsController.test.ts`
- Modify: `tests/asideSettingCatalog.test.ts`
- Modify: `src/core/config/featureFlags.ts`
- Modify: `src/core/config/featureFlagStorageSync.ts`

- [x] **Step 1: Add failing registry tests for the `agents` flag**

Create `tests/featureFlags.test.ts`:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import {
    DEFAULT_FEATURE_FLAGS,
    FeatureFlag,
    FEATURE_FLAG_KEYS,
    normalizeFeatureFlags,
    shouldRewriteNormalizedFeatureFlags,
} from "../src/core/config/featureFlags";

test("feature flag registry declares publish and agents disabled by default", () => {
    assert.deepEqual(FEATURE_FLAG_KEYS, [FeatureFlag.publish, FeatureFlag.agents]);
    assert.deepEqual(DEFAULT_FEATURE_FLAGS, {
        publish: false,
        agents: false,
    });
});

test("feature flag normalization preserves known booleans and drops unknown keys", () => {
    const normalized = normalizeFeatureFlags({
        publish: true,
        agents: true,
        unknown: true,
    });

    assert.deepEqual(normalized, { publish: true, agents: true });
    assert.equal(shouldRewriteNormalizedFeatureFlags({
        publish: true,
        agents: true,
        unknown: true,
    }, normalized), true);
    assert.equal(shouldRewriteNormalizedFeatureFlags(normalized, normalized), false);
});
```

- [x] **Step 2: Replace publish-only storage tests with flag-parameterized cases**

Update `tests/featureFlagStorageSync.test.ts` to import `getFeatureFlagStorageKey`, `syncFeatureFlagStorage`, and `FeatureFlagStorageSyncOptions`. Give the harness both canonical flags and a `flag` option. Add these assertions while retaining the read, write, invalid-value, and failed-persistence cases:

```ts
test("feature flag storage keys are scoped by flag and vault name", () => {
    assert.equal(
        getFeatureFlagStorageKey(FeatureFlag.publish, "Vault A"),
        "aside.feature.publish.Vault A",
    );
    assert.equal(
        getFeatureFlagStorageKey(FeatureFlag.agents, "Vault A"),
        "aside.feature.agents.Vault A",
    );
});

test("agents override changes only agents and preserves publish", async () => {
    const harness = createHarness({
        flag: FeatureFlag.agents,
        persisted: { publish: true, agents: false },
        stored: "true",
    });

    const result = await syncFeatureFlagStorage(harness.options);

    assert.deepEqual(harness.featureFlags, { publish: true, agents: true });
    assert.deepEqual(result.featureFlags, { publish: true, agents: true });
    assert.deepEqual(harness.storageAccesses, [
        "read:aside.feature.agents.Test Vault",
        "write:aside.feature.agents.Test Vault",
    ]);
});
```

For the existing Publishing cases, pass `flag: FeatureFlag.publish` and continue asserting the exact `aside.feature.publish.<vault>` key and rollback behavior.

- [x] **Step 3: Run the focused tests to verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/featureFlags.test.js .test-dist/tests/featureFlagStorageSync.test.js
```

Expected: compilation fails because `FeatureFlag.agents`, `FEATURE_FLAG_KEYS`, and the generic storage APIs do not exist.

- [x] **Step 4: Implement the canonical two-flag registry**

Change `src/core/config/featureFlags.ts` to:

```ts
export const FeatureFlag = {
    publish: "publish",
    agents: "agents",
} as const;

export type FeatureFlagKey = typeof FeatureFlag[keyof typeof FeatureFlag];

export const FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = Object.values(FeatureFlag);

export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
    [FeatureFlag.publish]: false,
    [FeatureFlag.agents]: false,
};

export function normalizeFeatureFlags(value: unknown): FeatureFlags {
    const source = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    return {
        [FeatureFlag.publish]: source[FeatureFlag.publish] === true,
        [FeatureFlag.agents]: source[FeatureFlag.agents] === true,
    };
}
```

Keep `isFeatureFlagEnabled` and `shouldRewriteNormalizedFeatureFlags`, but make the rewrite check consume `FEATURE_FLAG_KEYS` rather than deriving a second registry.

Update existing typed `FeatureFlags` fixtures in `tests/publishSettings.test.ts`, `tests/publicHtmlPublishController.test.ts`, `tests/indexNoteSettingsController.test.ts`, and `tests/asideSettingCatalog.test.ts` to include `[FeatureFlag.agents]: false`. This is a compile-only schema migration; Publishing assertions remain unchanged.

- [x] **Step 5: Implement the generic storage synchronizer**

Replace publish-specific exports in `src/core/config/featureFlagStorageSync.ts` with:

```ts
export function getFeatureFlagStorageKey(
    flag: FeatureFlagKey,
    vaultName: string,
): string {
    return `aside.feature.${flag}.${vaultName}`;
}

export interface FeatureFlagStorageSyncOptions {
    flag: FeatureFlagKey;
    storage: FeatureFlagStorage | null;
    storageKey: string;
    getFeatureFlags(): unknown;
    setFeatureFlags(featureFlags: FeatureFlags): void;
    persist(): Promise<void>;
    onError?(operation: FeatureFlagStorageSyncOperation, error: unknown): void;
}

export interface FeatureFlagStorageSyncResult {
    featureFlags: FeatureFlags;
    persisted: boolean;
    mirrored: boolean;
}
```

Rename `syncPublishFeatureFlagStorage` to `syncFeatureFlagStorage`. Use `options.flag` for both the requested update and canonical mirror:

```ts
const requestedFlags = {
    ...previousFlags,
    [options.flag]: requestedValue,
};

options.storage.setItem(
    options.storageKey,
    String(canonicalFlags[options.flag]),
);
```

Preserve the current read-error, invalid-value, persistence rollback, and mirror-error semantics exactly.

- [x] **Step 6: Run the focused tests to verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/featureFlags.test.js .test-dist/tests/featureFlagStorageSync.test.js
```

Expected: all feature-flag registry and synchronization tests pass.

- [x] **Step 7: Commit the generic feature-flag core**

```bash
git add src/core/config/featureFlags.ts src/core/config/featureFlagStorageSync.ts tests/featureFlags.test.ts tests/featureFlagStorageSync.test.ts tests/publishSettings.test.ts tests/publicHtmlPublishController.test.ts tests/indexNoteSettingsController.test.ts tests/asideSettingCatalog.test.ts
git commit -m "feat(flags): generalize vault feature flags"
```

### Task 2: Synchronize every declared feature flag before UI registration

**Files:**
- Modify: `tests/indexNoteSettingsController.test.ts`
- Modify: `tests/pluginStartupOrder.test.ts`
- Modify: `src/settings/indexNoteSettingsController.ts`
- Modify: `src/main.ts`

- [x] **Step 1: Add failing controller tests for independent flag persistence**

Update the settings harness fixtures so every `FeatureFlags` object contains both keys. Replace calls to `syncPublishFeatureFlagStorage` with `syncFeatureFlagStorage(flag, storage, storageKey, onError)`. Add:

```ts
test("feature flag storage synchronization persists agents without changing publish", async () => {
    const persistedSettings = createSettings({
        featureFlags: {
            [FeatureFlag.publish]: true,
            [FeatureFlag.agents]: false,
        },
    });
    const harness = createControllerHarness({ loadedData: persistedSettings });
    let storageValue: string | null = "true";
    const storage: FeatureFlagStorage = {
        getItem: () => storageValue,
        setItem: (_key, value) => {
            storageValue = value;
        },
    };

    await harness.controller.loadSettings();
    await harness.controller.syncFeatureFlagStorage(
        FeatureFlag.agents,
        storage,
        "aside.feature.agents.Test Vault",
    );

    assert.deepEqual(harness.getSettings().featureFlags, {
        publish: true,
        agents: true,
    });
    assert.deepEqual(harness.savedPayloads.at(-1)?.featureFlags, {
        publish: true,
        agents: true,
    });
});
```

Also update loaded-settings assertions so absent `agents` normalizes to `false`, unknown keys are dropped, and saved `defaultAgent` plus `showAgentSidebarTab` remain unchanged.

- [x] **Step 2: Replace the startup-order test with registry-wide synchronization**

Change `tests/pluginStartupOrder.test.ts` to require `await this.syncFeatureFlagStorage();` between settings load and `pluginRegistrationController.register()`. Assert that `src/main.ts` iterates `FEATURE_FLAG_KEYS` and calls:

```ts
getFeatureFlagStorageKey(flag, this.app.vault.getName())
```

- [x] **Step 3: Run the focused tests to verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/indexNoteSettingsController.test.js .test-dist/tests/pluginStartupOrder.test.js
```

Expected: compilation or assertions fail because the controller and startup still expose publish-only synchronization.

- [x] **Step 4: Generalize the settings controller entry point**

In `src/settings/indexNoteSettingsController.ts`, import `syncFeatureFlagStorage` and `FeatureFlagKey`, then expose:

```ts
public async syncFeatureFlagStorage(
    flag: FeatureFlagKey,
    storage: FeatureFlagStorage | null,
    storageKey: string,
    onError?: (operation: FeatureFlagStorageSyncOperation, error: unknown) => void,
): Promise<void> {
    await syncStoredFeatureFlag({
        flag,
        storage,
        storageKey,
        getFeatureFlags: () => this.host.getSettings().featureFlags,
        setFeatureFlags: (featureFlags) => {
            this.host.setSettings({
                ...this.host.getSettings(),
                featureFlags,
            });
        },
        persist: () => this.saveSettings(),
        onError,
    });
}
```

- [x] **Step 5: Iterate the canonical registry during startup**

In `src/main.ts`, import `FEATURE_FLAG_KEYS` and `getFeatureFlagStorageKey`. Replace `syncPublishFeatureFlagStorage` with:

```ts
private async syncFeatureFlagStorage(): Promise<void> {
    const storage = getSafeLocalStorage();
    for (const flag of FEATURE_FLAG_KEYS) {
        await this.indexNoteSettingsController.syncFeatureFlagStorage(
            flag,
            storage,
            getFeatureFlagStorageKey(flag, this.app.vault.getName()),
            (operation, error) => {
                this.warn(
                    `Unable to synchronize the ${flag} feature flag (${operation}).`,
                    error,
                    "settings",
                    `settings.${flag}-feature-flag.${operation}.warn`,
                );
            },
        );
    }
}
```

Call it immediately after loading settings and run-store initialization, before vault capability seeding and UI registration.

- [x] **Step 6: Run the focused tests to verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/indexNoteSettingsController.test.js .test-dist/tests/pluginStartupOrder.test.js
```

Expected: both the complete payload persistence tests and startup-order tests pass for Publishing and Agents.

- [x] **Step 7: Commit startup synchronization**

```bash
git add src/settings/indexNoteSettingsController.ts src/main.ts tests/indexNoteSettingsController.test.ts tests/pluginStartupOrder.test.ts
git commit -m "feat(flags): sync every vault feature flag"
```

### Task 3: Hide Agents settings, suggestions, and draft guidance while disabled

**Files:**
- Modify: `tests/asideSettingCatalog.test.ts`
- Modify: `tests/commentMentionSuggestions.test.ts`
- Modify: `tests/sidebarDraftComment.test.ts`
- Modify: `src/ui/settings/asideSettingCatalog.ts`
- Modify: `src/ui/editor/commentMentionSuggestions.ts`
- Modify: `src/ui/views/sidebarDraftComment.ts`
- Modify: `src/ui/views/AsideView.ts`

- [x] **Step 1: Add failing settings visibility tests**

Extend `createCatalogContext` with `agentsFeatureEnabled`. Add:

```ts
test("Agents settings and group follow the agents feature flag", () => {
    const disabled = createCatalogContext({
        agentsFeatureEnabled: false,
        publishFeatureEnabled: false,
    });
    const enabled = createCatalogContext({
        agentsFeatureEnabled: true,
        publishFeatureEnabled: false,
    });

    assert.equal(isVisible("default-agent", disabled), false);
    assert.equal(isVisible("show-agent-tab", disabled), false);
    assert.equal(isVisible("default-agent", enabled), true);
    assert.equal(isVisible("show-agent-tab", enabled), true);

    const group = getAsideSettingDefinitions(disabled)
        .find((item) => "heading" in item && item.heading === "Agents (experimental)");
    if (!group || typeof group.visible !== "function") {
        assert.fail("Agents settings group should define feature visibility");
    }
    assert.equal(group.visible(), false);
});
```

- [x] **Step 2: Add failing capability tests for suggestions and placeholder copy**

Make the capability argument required in tests. Add:

```ts
test("disabled Agents suggestions keep todo and vault scripts only", () => {
    assert.deepEqual(
        buildMentionSuggestions([cleanLinksScript], "", false).map((item) => item.mention),
        ["@todo", "/clean-links"],
    );
    assert.deepEqual(buildMentionSuggestions([cleanLinksScript], "@co", false), []);
    assert.deepEqual(buildMentionSuggestions([cleanLinksScript], "/create", false), []);
});
```

Retain a registration named `CODEX` and `create-script` in the reserved-name test and prove neither appears when Agents is disabled. In `tests/sidebarDraftComment.test.ts`, pass `false` and expect:

```text
Write a side note. Use B or H for styling, or type /script-name or @todo.
```

Pass `true` to the existing enabled placeholder test and keep its current text unchanged.

- [x] **Step 3: Run the focused tests to verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/asideSettingCatalog.test.js .test-dist/tests/commentMentionSuggestions.test.js .test-dist/tests/sidebarDraftComment.test.js
```

Expected: Agents settings remain visible, and suggestions/placeholders still expose agent directives and `/create-script`.

- [x] **Step 4: Gate the settings catalog**

In `src/ui/settings/asideSettingCatalog.ts`:

```ts
function isAgentsFeatureAvailable(context: AsideSettingCatalogContext): boolean {
    return isFeatureFlagEnabled(context.plugin.settings.featureFlags, FeatureFlag.agents);
}
```

Change the section heading to **Agents (experimental)** and assign `visible: isAgentsFeatureAvailable` to both `default-agent` and `show-agent-tab`. Leave stored preference values untouched.

- [x] **Step 5: Gate pure mention suggestions without releasing reserved names**

Change the builder signature to:

```ts
export function buildMentionSuggestions(
    scripts: readonly VaultScriptRegistration[],
    rawQuery: string,
    agentsFeatureAvailable: boolean,
): SideNoteMentionSuggestion[]
```

Always build the complete reserved-name set from `@todo`, all supported agents, and `/create-script`. Only include agent actors and `/create-script` in candidate arrays when `agentsFeatureAvailable` is true. This keeps hidden built-in names unavailable to vault scripts.

- [x] **Step 6: Gate draft guidance and wire the runtime capability**

Change `buildDraftCommentPresentation` to require `agentsFeatureAvailable: boolean`. Use the existing copy when true and the todo/script-only copy when false. Add `isAgentsFeatureAvailable(): boolean` to `SidebarDraftCommentHost` and pass it from both card and inline-edit renderers.

In `src/ui/views/AsideView.ts`, add `isAgentsFeatureAvailable()` to `AsideWithVaultScriptMentions`, pass it to `buildMentionSuggestions`, and expose it through both draft render hosts.

- [x] **Step 7: Run the focused tests and compile all call sites**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/asideSettingCatalog.test.js .test-dist/tests/commentMentionSuggestions.test.js .test-dist/tests/sidebarDraftComment.test.js .test-dist/tests/sidebarDraftEditor.test.js
```

Expected: disabled mode exposes only `@todo` and registered non-reserved scripts; enabled behavior remains unchanged.

- [x] **Step 8: Commit hidden Agents affordances**

```bash
git add src/ui/settings/asideSettingCatalog.ts src/ui/editor/commentMentionSuggestions.ts src/ui/views/sidebarDraftComment.ts src/ui/views/AsideView.ts tests/asideSettingCatalog.test.ts tests/commentMentionSuggestions.test.ts tests/sidebarDraftComment.test.ts
git commit -m "feat(agents): hide disabled affordances"
```

### Task 4: Prevent the Agent sidebar tab from rendering or remaining selected

**Files:**
- Modify: `tests/sidebarModeTabs.test.ts`
- Modify: `src/ui/views/sidebarModeTabs.ts`
- Modify: `src/ui/views/AsideView.ts`
- Modify: `src/main.ts`

- [x] **Step 1: Add failing sidebar capability tests**

Add `agentsFeatureAvailable` to every `SidebarModeVisibility` fixture. Add:

```ts
test("disabled Agents capability hides the tab and falls active agent mode back to list", () => {
    const availability = {
        isTagsEnabled: true,
        isTodoEnabled: true,
        isAgentEnabled: true,
        isThoughtTrailEnabled: true,
        showTodoSidebarTab: true,
        showAgentSidebarTab: true,
        agentsFeatureAvailable: false,
    };

    assert.deepEqual(
        getSidebarModeTabGroups(availability, "note")
            .flatMap((group) => group.tabs.map((tab) => tab.mode)),
        ["list", "tags", "todo", "thought-trail"],
    );
    assert.equal(resolveModeWithSidebarModeVisibility("agent", availability), "list");
});
```

Retain the enabled case with `agentsFeatureAvailable: true`.

- [x] **Step 2: Run the focused test to verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarModeTabs.test.js
```

Expected: Agent remains visible because mode visibility does not know the feature capability.

- [x] **Step 3: Add the capability to sidebar visibility policy**

In `src/ui/views/sidebarModeTabs.ts`, require:

```ts
export interface SidebarModeVisibility {
    showTodoSidebarTab: boolean;
    showAgentSidebarTab: boolean;
    agentsFeatureAvailable: boolean;
}
```

Change `SidebarModeTabOptions` to `SidebarModeAvailability & SidebarModeVisibility` so callers cannot omit the capability. The Agent tab is visible only when both `showAgentSidebarTab` and `agentsFeatureAvailable` are true. `resolveModeWithSidebarModeVisibility("agent", visibility)` returns `"list"` when either is false.

- [x] **Step 4: Expose and wire the canonical runtime query**

Add to `src/main.ts`:

```ts
public isAgentsFeatureAvailable(): boolean {
    return isFeatureFlagEnabled(this.settings.featureFlags, FeatureFlag.agents);
}
```

In `AsideView.getSidebarModeVisibility`, preserve the stored `showAgentSidebarTab` value and add:

```ts
agentsFeatureAvailable: this.plugin.isAgentsFeatureAvailable(),
```

Every existing mode restore, render, and cached-index path already consumes this one helper, so the active `agent` mode falls back without rewriting `showAgentSidebarTab`.

- [x] **Step 5: Run sidebar and view-state tests to verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarModeTabs.test.js .test-dist/tests/indexSidebarState.test.js
```

Expected: disabled Agents cannot render or restore the Agent tab; enabled and non-Agent modes remain unchanged.

- [x] **Step 6: Commit sidebar gating**

```bash
git add src/ui/views/sidebarModeTabs.ts src/ui/views/AsideView.ts src/main.ts tests/sidebarModeTabs.test.ts
git commit -m "feat(agents): gate the Agent sidebar tab"
```

### Task 5: Fail closed before agent diagnostics, dispatch, or regenerate

**Files:**
- Create: `src/core/agents/agentsFeaturePolicy.ts`
- Modify: `tests/createScriptCommandController.test.ts`
- Modify: `tests/commentAgentController.test.ts`
- Modify: `src/agents/createScriptCommandController.ts`
- Modify: `src/agents/commentAgentController.ts`
- Modify: `src/main.ts`

- [x] **Step 1: Add disabled `/create-script` controller tests**

Extend the create-script harness with `agentsFeatureAvailable` and notices. Add:

```ts
test("disabled create-script is handled without dispatch or a generated reply", async () => {
    const harness = createHarness({ agentsFeatureAvailable: false });

    assert.equal(await harness.controller.handleSavedUserEntry(event(
        "/create-script build a formatter",
    )), true);
    assert.deepEqual(harness.dispatchedRequests, []);
    assert.deepEqual(harness.replies, []);
    assert.deepEqual(harness.notices, ["Agents experiment is disabled."]);
});
```

Also prove an ordinary note still returns `false`, allowing vault-script and todo routing to continue.

- [x] **Step 2: Add disabled agent dispatch, create request, and retry tests**

Extend the CommentAgent harness with `agentsFeatureAvailable` and wire `isAgentsFeatureAvailable: () => options.agentsFeatureAvailable ?? true`. Add these three tests:

```ts
test("disabled agent directive performs no runtime selection or launch", async () => {
    const harness = createHarness({ agentsFeatureAvailable: false });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex say hi",
    });

    assert.deepEqual(harness.runtimeSelectionCalls, []);
    assert.deepEqual(harness.runtimeCalls, []);
    assert.deepEqual(harness.controller.getAgentRuns(), []);
    assert.deepEqual(harness.notices, ["Agents experiment is disabled."]);
});

test("disabled create-script request performs no default-agent selection", async () => {
    const harness = createHarness({ agentsFeatureAvailable: false });

    await harness.controller.handleCreateScriptRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/create-script build a cleaner",
    }, "build a cleaner");

    assert.equal(harness.getDefaultRuntimeSelectionCalls(), 0);
    assert.deepEqual(harness.runtimeCalls, []);
    assert.deepEqual(harness.notices, ["Agents experiment is disabled."]);
});

test("disabled regenerate preserves the existing run without diagnostics", async () => {
    const existingRun = {
        id: "run-old",
        threadId: "thread-1",
        triggerEntryId: "thread-1",
        filePath: "Folder/Note.md",
        requestedAgent: "codex" as const,
        runtime: "direct-cli" as const,
        status: "succeeded" as const,
        promptText: "@codex say hi",
        createdAt: 10,
        startedAt: 11,
        endedAt: 12,
    };
    const harness = createHarness({
        agentsFeatureAvailable: false,
        initialPersistedData: { agentRuns: [existingRun] },
    });

    assert.equal(await harness.controller.retryRun("run-old"), false);
    assert.deepEqual(harness.runtimeSelectionCalls, []);
    assert.deepEqual(harness.runtimeCalls, []);
    assert.deepEqual(harness.controller.getAgentRuns(), [existingRun]);
    assert.deepEqual(harness.notices, ["Agents experiment is disabled."]);
});
```

- [x] **Step 3: Run the focused tests to verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/createScriptCommandController.test.js .test-dist/tests/commentAgentController.test.js
```

Expected: disabled requests still reach selection or dispatch because controller hosts lack the capability.

- [x] **Step 4: Define one disabled notice and gate `/create-script`**

Create `src/core/agents/agentsFeaturePolicy.ts`:

```ts
export const AGENTS_EXPERIMENT_DISABLED_NOTICE = "Agents experiment is disabled.";
```

Add `isAgentsFeatureAvailable(): boolean` and `showNotice(message: string): void` to `CreateScriptCommandHost`. After parsing confirms `/create-script` but before usage validation or dispatch, return handled and show the shared notice when unavailable. Preserve entry-id deduplication.

- [x] **Step 5: Gate every CommentAgent entry point before selection**

Add `isAgentsFeatureAvailable(): boolean` to `CommentAgentHost`.

- In `handleSavedUserEntry`, parse first so ordinary notes remain ignored; if the resolution contains a supported or recognized unsupported agent target and Agents is unavailable, show the shared notice and return before `resolveDispatchTarget` or runtime selection.
- In `handleCreateScriptRequest`, check capability before duplicate-run lookup or default-agent selection.
- In `retryPromptForCommentInternal`, check capability before loading files, parsing the saved prompt, clearing output, or resolving any runtime.

Do not mutate `defaultAgent`, `showAgentSidebarTab`, persisted runs, streams, or comment entries on these disabled paths.

- [x] **Step 6: Wire capability hosts and add a defensive diagnostics boundary**

In `src/main.ts`, pass `isAgentsFeatureAvailable` and `showNotice` to both controllers. At the start of `getAgentRuntimeDiagnostics`, return an unsupported diagnostic containing the shared disabled notice when the feature is off, ensuring direct settings or programmatic calls cannot launch provider probes.

- [x] **Step 7: Run controller tests to verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/createScriptCommandController.test.js .test-dist/tests/commentAgentController.test.js .test-dist/tests/commentScriptController.test.js
```

Expected: disabled agent and create-script routes produce one notice, no selection/diagnostic/runtime calls, no data mutation, and ordinary registered vault scripts remain runnable.

- [x] **Step 8: Commit runtime fail-closed behavior**

```bash
git add src/core/agents/agentsFeaturePolicy.ts src/agents/createScriptCommandController.ts src/agents/commentAgentController.ts src/main.ts tests/createScriptCommandController.test.ts tests/commentAgentController.test.ts
git commit -m "feat(agents): fail closed when experiment is off"
```

### Task 6: Verify, document, install, and enable the acceptance vault

**Files:**
- Modify: `docs/superpowers/specs/2026-08-20-agents-experiment-feature-flag-design.md`
- Modify: `docs/superpowers/plans/2026-08-20-agents-experiment-feature-flag.md`
- Install exact artifacts to: `/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/`

- [x] **Step 1: Run focused cross-surface verification**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/featureFlags.test.js .test-dist/tests/featureFlagStorageSync.test.js .test-dist/tests/indexNoteSettingsController.test.js .test-dist/tests/pluginStartupOrder.test.js .test-dist/tests/asideSettingCatalog.test.js .test-dist/tests/commentMentionSuggestions.test.js .test-dist/tests/sidebarDraftComment.test.js .test-dist/tests/sidebarModeTabs.test.js .test-dist/tests/createScriptCommandController.test.js .test-dist/tests/commentAgentController.test.js .test-dist/tests/commentScriptController.test.js
```

Expected: all feature-flag, UI, sidebar, and runtime boundary tests pass.

- [x] **Step 2: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all compiled and contract tests pass with zero failures.

- [x] **Step 3: Build and inspect the exact public artifacts**

Run:

```bash
npm run build
node scripts/check-release-artifacts.mjs
```

Expected: lint, typecheck, Obsidian compliance, bundle, and artifact inspection pass. The exact public set is `main.js`, `manifest.json`, and `styles.css`, with no `main.js.map`, `sourceMappingURL`, `sourcesContent`, raw TypeScript/JSX-family source, or secret-bearing files.

- [x] **Step 4: Update tracked implementation status**

Mark implementation and repository verification items complete in the design spec and this plan. Keep installation/acceptance items pending until the installed build is verified.

- [x] **Step 5: Commit repository verification records**

```bash
git add -f docs/superpowers/specs/2026-08-20-agents-experiment-feature-flag-design.md docs/superpowers/plans/2026-08-20-agents-experiment-feature-flag.md
git commit -m "docs(agents): record feature flag verification"
```

- [x] **Step 6: Install the verified artifacts into `lean-startup`**

Run:

```bash
node scripts/install-built-plugin.mjs --vault "/Users/example/Obsidian/lean-startup"
```

Expected: only `main.js`, `manifest.json`, and `styles.css` are copied into the installed Aside plugin directory.

- [x] **Step 7: Enable the vault-scoped override and reload Aside**

Run:

```bash
obsidian vault=lean-startup eval code="localStorage.setItem('aside.feature.agents.lean-startup','true')"
obsidian vault=lean-startup plugin:reload id=aside
obsidian vault=lean-startup eval code="JSON.stringify({stored:localStorage.getItem('aside.feature.agents.lean-startup'),persisted:app.plugins.plugins.aside.settings.featureFlags.agents,available:app.plugins.plugins.aside.isAgentsFeatureAvailable()})"
```

Expected:

```text
=> {"stored":"true","persisted":true,"available":true}
```

- [x] **Step 8: Compare installed artifacts byte-for-byte**

Run:

```bash
cmp main.js "/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/main.js"
cmp manifest.json "/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/manifest.json"
cmp styles.css "/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/styles.css"
```

Expected: all three commands exit zero with no differences.

- [x] **Step 9: Record acceptance and commit final tracking**

Mark the installed-build verification items complete, record the exact test counts and artifact result, and commit:

```bash
git add -f docs/superpowers/specs/2026-08-20-agents-experiment-feature-flag-design.md docs/superpowers/plans/2026-08-20-agents-experiment-feature-flag.md
git commit -m "docs(agents): complete feature flag acceptance"
```

- [ ] **Step 10: Review the branch and use the finishing workflow**

Run:

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git status --short --branch
```

Expected: the worktree is clean, the branch contains the approved default-agent work plus the Agents experiment boundary, and nothing has been pushed. Then use the finishing-a-development-branch workflow to choose local merge, PR, branch preservation, or discard.
