# Advanced Capability Section Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Scripts and Publishing independently disabled by default, expose only native section-level enable controls while disabled, and prevent every new script-oriented execution without affecting ordinary agent replies.

**Architecture:** Persist `scriptsEnabled` beside the existing `publishEnabled` setting and resolve legacy state once from stored run history plus the canonical live script registry. Put section control metadata and detail visibility in the shared settings catalog, then carry the Scripts capability explicitly through mention discovery, saved-entry routing, and regenerate policy. Keep `main.ts` as the Obsidian adapter and enforce retry gates there as defense in depth.

**Tech Stack:** TypeScript, Obsidian settings APIs, Node test runner, existing vault-script registry, ESLint, esbuild.

---

## File Structure

- Modify `src/ui/settings/AsideSetting.ts`: add the persisted default-off setting and the public settings context used by the native UI.
- Modify `src/settings/indexNoteSettingsPlanner.ts`: own one-time Scripts migration inference and rewrite decisions.
- Modify `src/settings/indexNoteSettingsController.ts`: pass canonical script evidence, persist the Scripts toggle, and roll back failed capability saves.
- Modify `src/ui/settings/asideSettingCatalog.ts`: own advanced-section control metadata and section/detail visibility.
- Modify `src/ui/settings/asideSettingDefinitionsAdapter.ts`: translate shared section controls into declarative Obsidian settings.
- Modify `src/ui/settings/asideSettingLegacyAdapter.ts`: translate the same controls into the legacy renderer.
- Modify `src/core/text/actionableMentions.ts`: distinguish always-available mentions from script-oriented built-ins.
- Modify `src/ui/editor/commentMentionSuggestions.ts`: omit script commands and registered scripts while Scripts is off.
- Modify `src/vaultScripts/commentScriptController.ts`: route disabled script text past every script controller to the ordinary agent controller.
- Modify `src/ui/views/sidebarPersistedComment.ts`: suppress script-oriented Generate/Regenerate actions while preserving ordinary agent retries.
- Modify `src/ui/views/AsideView.ts`: pass the live capability into suggestions and persisted-card rendering.
- Modify `src/main.ts`: seed migration evidence before settings load, expose the capability, and guard runtime retry entrypoints.
- Modify `README.md`, `SCRIPTS.md`, and `ADVANCED_FEATURES.md`: document default-off controls and the agent/script boundary.
- Modify focused TypeScript and direct-source tests listed in each task.
- Modify `docs/superpowers/specs/2026-09-07-advanced-capability-section-gates-design.md`: record implementation completion only after full verification.

### Task 1: Persist Scripts State and Migrate Existing Vaults

**Files:**
- Modify: `src/ui/settings/AsideSetting.ts:41-64`
- Modify: `src/settings/indexNoteSettingsPlanner.ts:20-130`
- Modify: `src/settings/indexNoteSettingsController.ts:28-130,330-405,498-518`
- Modify: `src/main.ts:430-465,839-866,980-1030`
- Test: `tests/indexNoteSettingsController.test.ts`
- Test: `tests/pluginEventRouterSource.test.mjs`

- [x] **Step 1: Write failing normalization and migration tests**

Add `scriptsEnabled` to `createSettings`, add `hasRegisteredVaultScripts` to the controller harness, and cover the complete inference matrix. Extend the harness options and host with the canonical evidence seam:

```ts
function createControllerHarness(options: {
    settings?: AsideSettings;
    hasRegisteredVaultScripts?: boolean;
    files?: string[];
    adapterFiles?: string[];
    fileContents?: Record<string, string>;
    activeSidebarFilePath?: string | null;
    draftHostFilePath?: string | null;
    loadedData?: PersistedPluginData | null;
    renameFileError?: Error;
    saveDataError?: Error;
    saveData?: (data: PersistedPluginData) => Promise<void>;
} = {}) {
```

```ts
hasRegisteredVaultScripts: () => options.hasRegisteredVaultScripts ?? false,
```

Also exclude `scriptsEnabled` in the existing `withPublishDefaults` input type and restore it explicitly:

```ts
function withPublishDefaults(
    settings: Omit<AsideSettings, keyof typeof DEFAULT_PUBLISH_SETTINGS | "publishedPublicArtifactPaths" | "defaultAgent" | "scriptsEnabled">,
): AsideSettings {
    return {
        ...settings,
        defaultAgent: "codex",
        scriptsEnabled: false,
        publishedPublicArtifactPaths: [],
        ...DEFAULT_PUBLISH_SETTINGS,
    };
}
```

Cover the complete inference matrix:

```ts
function createSettings(overrides: Partial<AsideSettings> = {}): AsideSettings {
    return {
        indexNotePath: overrides.indexNotePath ?? ALL_COMMENTS_NOTE_PATH,
        indexHeaderImageUrl: overrides.indexHeaderImageUrl ?? "https://example.com/default.webp",
        indexHeaderImageCaption: overrides.indexHeaderImageCaption ?? "Default caption",
        agentRuntimeMode: overrides.agentRuntimeMode ?? "auto",
        defaultAgent: overrides.defaultAgent ?? "codex",
        scriptsEnabled: overrides.scriptsEnabled ?? false,
        showTodoSidebarTab: overrides.showTodoSidebarTab ?? true,
        showAgentSidebarTab: overrides.showAgentSidebarTab ?? false,
        publishedPublicArtifactPaths: overrides.publishedPublicArtifactPaths ?? [],
        publishEnabled: overrides.publishEnabled ?? DEFAULT_PUBLISH_SETTINGS.publishEnabled,
        publishPagesProjectName: overrides.publishPagesProjectName ?? DEFAULT_PUBLISH_SETTINGS.publishPagesProjectName,
        publishBaseUrl: overrides.publishBaseUrl ?? DEFAULT_PUBLISH_SETTINGS.publishBaseUrl,
        publishAllowedRoot: overrides.publishAllowedRoot ?? DEFAULT_PUBLISH_SETTINGS.publishAllowedRoot,
        publishRemotePurgeEnabled: overrides.publishRemotePurgeEnabled ?? DEFAULT_PUBLISH_SETTINGS.publishRemotePurgeEnabled,
        publishPurgeBrokerUrl: overrides.publishPurgeBrokerUrl ?? DEFAULT_PUBLISH_SETTINGS.publishPurgeBrokerUrl,
        publishPurgeBrokerSecretName: overrides.publishPurgeBrokerSecretName ?? DEFAULT_PUBLISH_SETTINGS.publishPurgeBrokerSecretName,
    };
}

test("loaded settings default Scripts off without prior usage evidence", () => {
    for (const loaded of [null, { indexNotePath: ALL_COMMENTS_NOTE_PATH }]) {
        const resolved = resolveLoadedSettings(
            loaded,
            createSettings(),
            { hasRegisteredVaultScripts: false },
        );
        assert.equal(resolved.settings.scriptsEnabled, false);
    }
});

test("loaded settings infer Scripts on from established workflow evidence", () => {
    for (const loaded of [{ agentRuns: [{}] }, { scriptRuns: [{}] }]) {
        const resolved = resolveLoadedSettings(
            loaded as PersistedPluginData,
            createSettings(),
            { hasRegisteredVaultScripts: false },
        );
        assert.equal(resolved.settings.scriptsEnabled, true);
        assert.equal(resolved.shouldRewriteLegacySettings, true);
    }

    const registered = resolveLoadedSettings(
        { indexNotePath: ALL_COMMENTS_NOTE_PATH },
        createSettings(),
        { hasRegisteredVaultScripts: true },
    );
    assert.equal(registered.settings.scriptsEnabled, true);
});

test("explicit Scripts choices override migration evidence", () => {
    for (const scriptsEnabled of [false, true]) {
        const resolved = resolveLoadedSettings(
            { scriptsEnabled, agentRuns: [{}], scriptRuns: [{}] } as PersistedPluginData,
            createSettings(),
            { hasRegisteredVaultScripts: true },
        );
        assert.equal(resolved.settings.scriptsEnabled, scriptsEnabled);
    }
});

test("invalid Scripts state is inferred and rewritten", () => {
    const resolved = resolveLoadedSettings(
        { scriptsEnabled: "yes", scriptRuns: [{}] } as unknown as PersistedPluginData,
        createSettings(),
        { hasRegisteredVaultScripts: false },
    );
    assert.equal(resolved.settings.scriptsEnabled, true);
    assert.equal(resolved.shouldRewriteLegacySettings, true);
});
```

Add controller tests proving `setScriptsEnabled` persists and that failed Scripts and Publishing capability saves restore the prior in-memory value:

```ts
test("index note settings controller persists the Scripts capability", async () => {
    const harness = createControllerHarness();

    await harness.controller.setScriptsEnabled(true);

    assert.equal(harness.getSettings().scriptsEnabled, true);
    assert.equal(harness.savedPayloads.at(-1)?.scriptsEnabled, true);
});

test("capability setters restore settings when persistence fails", async () => {
    const scriptsHarness = createControllerHarness({
        saveDataError: new Error("save failed"),
    });
    await assert.rejects(() => scriptsHarness.controller.setScriptsEnabled(true));
    assert.equal(scriptsHarness.getSettings().scriptsEnabled, false);

    const publishingHarness = createControllerHarness({
        saveDataError: new Error("save failed"),
    });
    await assert.rejects(() => publishingHarness.controller.setPublishEnabled(true));
    assert.equal(publishingHarness.getSettings().publishEnabled, false);
});

test("disabling capabilities preserves history and Publishing configuration", async () => {
    const loadedData = {
        ...createSettings({
            scriptsEnabled: true,
            publishEnabled: true,
            publishBaseUrl: "https://publish.example.com",
        }),
        agentRuns: [{ id: "agent-run-1" }],
        scriptRuns: [{ id: "script-run-1" }],
    } as PersistedPluginData;
    const harness = createControllerHarness({
        settings: createSettings({ scriptsEnabled: true, publishEnabled: true }),
        loadedData,
    });
    await harness.controller.loadSettings();

    await harness.controller.setScriptsEnabled(false);
    await harness.controller.setPublishEnabled(false);

    const saved = harness.savedPayloads.at(-1);
    assert.equal(saved?.scriptsEnabled, false);
    assert.equal(saved?.publishEnabled, false);
    assert.equal(saved?.publishBaseUrl, "https://publish.example.com");
    assert.deepEqual(saved?.agentRuns, [{ id: "agent-run-1" }]);
    assert.deepEqual(saved?.scriptRuns, [{ id: "script-run-1" }]);
});
```

In `tests/pluginEventRouterSource.test.mjs`, extend the startup ordering assertion:

```js
const loadSettingsIndex = onloadSource.indexOf("await this.loadSettings();");
assert.ok(loadSettingsIndex > earlyRegisterIndex, "script evidence must be seeded before settings migration");
```

- [x] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/indexNoteSettingsController.test.js
node --test tests/pluginEventRouterSource.test.mjs
```

Expected: compilation fails because `AsideSettings.scriptsEnabled`, the evidence argument, host method, and controller setter do not exist.

- [x] **Step 3: Implement persisted state and migration inference**

Add the setting in `AsideSetting.ts`:

```ts
export interface AsideSettings extends PublishSettings {
    indexNotePath: string;
    indexHeaderImageUrl: string;
    indexHeaderImageCaption: string;
    agentRuntimeMode: AgentRuntimeModePreference;
    defaultAgent: AsideAgentTarget;
    scriptsEnabled: boolean;
    showTodoSidebarTab: boolean;
    showAgentSidebarTab: boolean;
    publishedPublicArtifactPaths: string[];
}

export const DEFAULT_SETTINGS: AsideSettings = {
    indexNotePath: normalizeAllCommentsNotePath(""),
    indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(""),
    indexHeaderImageCaption: normalizeAllCommentsNoteImageCaption(null),
    agentRuntimeMode: normalizeAgentRuntimeModePreference("auto"),
    defaultAgent: DEFAULT_ASIDE_AGENT_ACTOR_ID,
    scriptsEnabled: false,
    showTodoSidebarTab: true,
    showAgentSidebarTab: false,
    publishedPublicArtifactPaths: [],
    ...DEFAULT_PUBLISH_SETTINGS,
};
```

Add explicit migration evidence and a pure resolver in `indexNoteSettingsPlanner.ts`:

```ts
export interface LoadedSettingsEvidence {
    hasRegisteredVaultScripts: boolean;
}

function hasPersistedRuns(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0;
}

function resolveScriptsEnabled(
    loaded: PersistedPluginData | null,
    evidence: LoadedSettingsEvidence,
): boolean {
    if (typeof loaded?.scriptsEnabled === "boolean") {
        return loaded.scriptsEnabled;
    }
    return hasPersistedRuns(loaded?.agentRuns)
        || hasPersistedRuns(loaded?.scriptRuns)
        || evidence.hasRegisteredVaultScripts;
}

export function resolveLoadedSettings(
    loaded: PersistedPluginData | null,
    defaults: AsideSettings,
    evidence: LoadedSettingsEvidence = { hasRegisteredVaultScripts: false },
): LoadedSettingsResolution {
    const scriptsEnabled = resolveScriptsEnabled(loaded, evidence);
```

Include `scriptsEnabled` in the resolved settings and include this rewrite predicate:

```ts
scriptsEnabled,
```

```ts
|| !hasOwn(loaded ?? {}, "scriptsEnabled")
|| typeof loaded?.scriptsEnabled !== "boolean"
```

Add `hasRegisteredVaultScripts()` to `IndexNoteSettingsHost`, pass it to `resolveLoadedSettings`, implement `setScriptsEnabled`, and make mutable capability settings roll back on failure:

```ts
hasRegisteredVaultScripts(): boolean;
```

```ts
const resolved = resolveLoadedSettings(loaded, this.host.getSettings(), {
    hasRegisteredVaultScripts: this.host.hasRegisteredVaultScripts(),
});
```

```ts
public async setScriptsEnabled(enabled: boolean): Promise<void> {
    const settings = this.host.getSettings();
    if (settings.scriptsEnabled === enabled) {
        return;
    }
    this.host.setSettings({ ...settings, scriptsEnabled: enabled });
    try {
        await this.saveSettings();
    } catch (error) {
        this.host.setSettings(settings);
        throw error;
    }
}
```

Wrap `setPublishSettings` persistence with the same rollback shape:

```ts
this.host.setSettings(nextSettings);
try {
    await this.saveSettings();
} catch (error) {
    this.host.setSettings(settings);
    throw error;
}
```

In `main.ts`, expose the canonical registry as migration evidence, move seed plus early create registration before settings load without an `await` between them, and add the setter adapter:

```ts
hasRegisteredVaultScripts: () => this.vaultScriptRegistry.getRunnableScripts().length > 0,
```

```ts
this.commentManager = new CommentManager([]);
this.vaultScriptRegistry.seed(this.app.vault.getFiles().map((file) => file.path));
this.pluginEventRouter.registerVaultCreateEvent();
await this.loadSettings();
```

```ts
public async setScriptsEnabled(enabled: boolean): Promise<void> {
    await this.indexNoteSettingsController.setScriptsEnabled(enabled);
}
```

- [x] **Step 4: Run focused tests and verify they pass**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/indexNoteSettingsController.test.js
node --test tests/pluginEventRouterSource.test.mjs
```

Expected: all settings migration, rollback, and startup-order tests pass.

- [x] **Step 5: Commit the state slice**

```bash
git add src/ui/settings/AsideSetting.ts src/settings/indexNoteSettingsPlanner.ts src/settings/indexNoteSettingsController.ts src/main.ts tests/indexNoteSettingsController.test.ts tests/pluginEventRouterSource.test.mjs
git commit -m "feat(settings): persist Scripts capability"
```

### Task 2: Render Native Section-Level Controls

**Files:**
- Modify: `src/ui/settings/asideSettingCatalog.ts:8-145`
- Modify: `src/ui/settings/asideSettingDefinitionsAdapter.ts`
- Modify: `src/ui/settings/asideSettingLegacyAdapter.ts`
- Test: `tests/asideSettingCatalog.test.ts`

- [x] **Step 1: Write failing shared-catalog and adapter tests**

Change the stable UI key order to reflect actual section order and add disabled/enabled assertions for both advanced sections:

```ts
const EXPECTED_KEYS = [
    "show-todo-tab",
    "show-agent-tab",
    "scripts-enabled",
    "default-agent",
    "publish-enabled",
    "publish-base-url",
    "publish-project-name",
    "publish-remote-purge-enabled",
    "publish-purge-broker-url",
    "publish-purge-broker-secret",
    "publish-purge-allowed-host",
    "index-header-image-url",
    "index-header-image-caption",
];
```

Because controls now belong to section metadata, compare detail entries separately and project section order through only its stable identity fields:

```ts
const EXPECTED_DETAIL_KEYS = EXPECTED_KEYS.filter((key) =>
    key !== "scripts-enabled" && key !== "publish-enabled");

assert.deepEqual(
    ASIDE_SETTING_CATALOG.map((entry) => entry.key),
    EXPECTED_DETAIL_KEYS,
);
assert.deepEqual(
    ASIDE_SETTING_SECTIONS.map(({ key, heading }) => ({ key, heading })),
    [
        { key: "sidebar", heading: "Sidebar tabs" },
        { key: "agents", heading: "Scripts (advanced)" },
        { key: "publishing", heading: "Publishing (advanced)" },
        { key: "index-note", heading: "Index note" },
    ],
);
```

Replace the old “graduated agent settings have no feature visibility predicate” assertion and stop looking up `publish-enabled` as a detail entry.

Extend `createCatalogContext` with `scriptsEnabled`, then inspect declarative item visibility through a helper:

```ts
function getGroupItems(
    context: ReturnType<typeof createCatalogContext>,
    heading: string,
) {
    const group = getAsideSettingDefinitions(context)
        .find((item) => "heading" in item && item.heading === heading);
    assert.ok(group && "items" in group && group.items);
    return group.items;
}

function getVisibleNames(items: ReturnType<typeof getGroupItems>): string[] {
    return items
        .filter((item) => typeof item.visible !== "function" || item.visible())
        .map((item) => item.name ?? "");
}

test("advanced sections expose only their enable control while disabled", () => {
    const context = createCatalogContext();
    assert.deepEqual(getVisibleNames(getGroupItems(context, "Scripts (advanced)")), [
        "Enable scripts",
    ]);
    assert.deepEqual(getVisibleNames(getGroupItems(context, "Publishing (advanced)")), [
        "Enable publishing",
    ]);
});

test("advanced section details appear independently when enabled", () => {
    const scriptsContext = createCatalogContext({ scriptsEnabled: true });
    const publishingContext = createCatalogContext({ publishEnabled: true });

    assert.deepEqual(getVisibleNames(getGroupItems(scriptsContext, "Scripts (advanced)")), [
        "Enable scripts",
        "Default agent",
    ]);
    assert.deepEqual(getVisibleNames(getGroupItems(publishingContext, "Publishing (advanced)")), [
        "Enable publishing",
        "Publishing URL",
        "Project name",
        "Remote cache purge",
    ]);
});
```

Add `renderLegacyAsideSettings` to the test imports and use this recording fake to prove the legacy adapter consumes the same disabled policy:

```ts
test("legacy settings hide disabled advanced details", () => {
    const names: string[] = [];
    const createComponent = () => {
        const component = {
            setPlaceholder: () => component,
            setValue: () => component,
            onChange: () => component,
        };
        return component;
    };
    const createSetting = () => {
        const setting = {
            setName: (name: string) => {
                names.push(name);
                return setting;
            },
            setHeading: () => setting,
            setDesc: () => setting,
            addToggle: (callback: (component: ReturnType<typeof createComponent>) => unknown) => {
                callback(createComponent());
                return setting;
            },
            addText: (callback: (component: ReturnType<typeof createComponent>) => unknown) => {
                callback(createComponent());
                return setting;
            },
        };
        return setting as never;
    };

    renderLegacyAsideSettings(
        {} as HTMLElement,
        createCatalogContext(),
        createSetting,
    );

    assert.ok(names.includes("Scripts (advanced)"));
    assert.ok(names.includes("Enable scripts"));
    assert.ok(names.includes("Publishing (advanced)"));
    assert.ok(names.includes("Enable publishing"));
    assert.equal(names.includes("Default agent"), false);
    assert.equal(names.includes("Publishing URL"), false);
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/asideSettingCatalog.test.js
```

Expected: the Scripts section has no enable control, Publishing still owns its enable toggle as a detail entry, and disabled Scripts still exposes Default agent.

- [x] **Step 3: Add section control metadata and shared visibility helpers**

In `asideSettingCatalog.ts`, define native section controls:

```ts
export interface AsideSettingSectionControl {
    key: string;
    name: string;
    description: string;
    aliases: readonly string[];
    keywords: readonly string[];
    getValue(context: AsideSettingCatalogContext): boolean;
    setValue(context: AsideSettingCatalogContext, value: boolean): Promise<void>;
}

export interface AsideSettingSectionDefinition {
    key: AsideSettingSection;
    heading: string;
    control?: AsideSettingSectionControl;
}
```

Give Scripts and Publishing these control definitions:

```ts
{
    key: "agents",
    heading: "Scripts (advanced)",
    control: {
        key: "scripts-enabled",
        name: "Enable scripts",
        description: "Create and run trusted local scripts with your local agent.",
        aliases: ["vault scripts"],
        keywords: ["agent", "commands", "automation"],
        getValue: ({ plugin }) => plugin.settings.scriptsEnabled,
        setValue: async (context, value) => {
            await context.plugin.setScriptsEnabled(value);
        },
    },
},
{
    key: "publishing",
    heading: "Publishing (advanced)",
    control: {
        key: "publish-enabled",
        name: "Enable publishing",
        description: "Show advanced publish controls for supported files in the public folder.",
        aliases: ["Cloudflare Pages"],
        keywords: ["public folder", "deploy"],
        getValue: ({ plugin }) => plugin.settings.publishEnabled,
        setValue: async (context, value) => {
            await context.plugin.setPublishEnabled(value);
        },
    },
},
```

Remove the old `publish-enabled` detail entry. Add shared helpers used by both adapters:

```ts
export function isAsideSettingSectionEnabled(
    section: AsideSettingSectionDefinition,
    context: AsideSettingCatalogContext,
): boolean {
    return section.control?.getValue(context) ?? true;
}

export function isAsideSettingEntryVisible(
    entry: AsideSettingCatalogEntry,
    context: AsideSettingCatalogContext,
): boolean {
    const section = ASIDE_SETTING_SECTIONS.find((candidate) => candidate.key === entry.section);
    if (!section) {
        return false;
    }
    return isAsideSettingSectionEnabled(section, context)
        && entry.visible?.(context) !== false;
}

export function getAsideSettingSurfaceKeys(): string[] {
    return ASIDE_SETTING_SECTIONS.flatMap((section) => [
        ...(section.control ? [section.control.key] : []),
        ...ASIDE_SETTING_CATALOG
            .filter((entry) => entry.section === section.key)
            .map((entry) => entry.key),
    ]);
}

export function renderAsideSettingSectionControl(
    setting: Setting,
    section: AsideSettingSectionDefinition,
    context: AsideSettingCatalogContext,
): void {
    const control = section.control;
    if (!control) {
        return;
    }
    setting.addToggle((toggle) => toggle
        .setValue(control.getValue(context))
        .onChange(async (value) => {
            try {
                await control.setValue(context, value);
            } finally {
                toggle.setValue(control.getValue(context));
                context.refresh();
            }
        }));
}
```

Publishing detail predicates should only express nested dependencies after the section gate:

```ts
function isRemotePurgeSettingVisible(context: AsideSettingCatalogContext): boolean {
    return context.plugin.settings.publishRemotePurgeEnabled;
}
```

- [x] **Step 4: Make both adapters thin translations of the shared policy**

In the declarative adapter, use `getAsideSettingSurfaceKeys`, prepend one control render item, and apply `isAsideSettingEntryVisible` to detail items:

```ts
export function getDefinitionAsideSettingKeys(): string[] {
    return getAsideSettingSurfaceKeys();
}

const controlItems: SettingDefinitionRender[] = section.control ? [{
    name: section.control.name,
    desc: section.control.description,
    aliases: [...section.control.aliases, ...section.control.keywords],
    visible: true,
    render: (setting) => renderAsideSettingSectionControl(setting, section, context),
}] : [];

return {
    type: "group",
    heading: section.heading,
    visible: true,
    items: [
        ...controlItems,
        ...entries.map<SettingDefinitionRender>((entry) => ({
            name: entry.name,
            desc: entry.key === "default-agent" ? "" : entry.description,
            aliases: [...entry.aliases, ...entry.keywords],
            visible: () => isAsideSettingEntryVisible(entry, context),
            render: (setting) => entry.render(setting, context),
        })),
    ],
};
```

In the legacy adapter, use the same key helper, always render a gated section's heading and control, and filter details through `isAsideSettingEntryVisible`:

```ts
export function getLegacyAsideSettingKeys(): string[] {
    return getAsideSettingSurfaceKeys();
}

const entries = ASIDE_SETTING_CATALOG.filter((entry) =>
    entry.section === section.key && isAsideSettingEntryVisible(entry, context));
if (!section.control && entries.length === 0) {
    continue;
}

createSetting(containerEl).setName(section.heading).setHeading();
if (section.control) {
    const controlSetting = createSetting(containerEl)
        .setName(section.control.name)
        .setDesc(section.control.description);
    renderAsideSettingSectionControl(controlSetting, section, context);
}
```

- [x] **Step 5: Run focused tests and verify they pass**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/asideSettingCatalog.test.js
```

Expected: catalog and both adapter assertions pass; disabled detail definitions report invisible.

- [x] **Step 6: Commit the section UI slice**

```bash
git add src/ui/settings/asideSettingCatalog.ts src/ui/settings/asideSettingDefinitionsAdapter.ts src/ui/settings/asideSettingLegacyAdapter.ts tests/asideSettingCatalog.test.ts
git commit -m "feat(settings): gate advanced section details"
```

### Task 3: Gate Script Discovery and Mention Actionability

**Files:**
- Modify: `src/core/text/actionableMentions.ts`
- Modify: `src/ui/editor/commentMentionSuggestions.ts`
- Modify: `src/ui/views/AsideView.ts:240-260,1485-1500`
- Modify: `src/main.ts:1248-1272`
- Test: `tests/actionableMentions.test.ts`
- Test: `tests/commentMentionSuggestions.test.ts`
- Test: `tests/commentEditorFormatting.test.ts`
- Test: `tests/commentEditorPersistedMentions.test.ts`

- [x] **Step 1: Write failing off-state discovery tests**

Make capability input explicit in existing calls and add these assertions:

```ts
test("Scripts off keeps todos and agents actionable but rejects script commands", () => {
    const context = {
        scriptsEnabled: false,
        isRunnableVaultScriptMention: () => true,
    };

    assert.equal(isActionableMention("@todo", context), true);
    assert.equal(isActionableMention("@codex", context), true);
    assert.equal(isActionableMention("/create-script", context), false);
    assert.equal(isActionableMention("/update-script", context), false);
    assert.equal(isActionableMention("/pdf-to-markdown", context), false);
    assert.equal(isActionableMention("/clean", context), false);
});
```

```ts
test("Scripts off omits built-in and registered slash suggestions", () => {
    assert.deepEqual(
        buildMentionSuggestions([cleanLinksScript], "", false).map((item) => item.mention),
        ["@todo", "@codex", "@claude", "@cursor", "@gemini", "@deepseek"],
    );
    assert.deepEqual(buildMentionSuggestions([cleanLinksScript], "/", false), []);
    assert.deepEqual(
        buildMentionSuggestions([cleanLinksScript], "@co", false).map((item) => item.mention),
        ["@codex"],
    );
});
```

Pass `true` in all existing tests that assert enabled script behavior. Add `scriptsEnabled: true` to existing `ActionableMentionContext` literals in formatting and persisted-mention tests.

- [x] **Step 2: Run focused tests and verify they fail**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/actionableMentions.test.js .test-dist/tests/commentMentionSuggestions.test.js .test-dist/tests/commentEditorFormatting.test.js .test-dist/tests/commentEditorPersistedMentions.test.js
```

Expected: signatures and off-state assertions fail because all built-in commands and registry mentions are still unconditional.

- [x] **Step 3: Split always-available and script-oriented mention policy**

Change `actionableMentions.ts` so reservations remain stable while visible/actionable candidates follow the capability:

```ts
export interface ActionableMentionContext {
    scriptsEnabled: boolean;
    isRunnableVaultScriptMention(mention: string): boolean;
}

function isScriptBuiltInMention(item: ActionableBuiltInMention): boolean {
    return item.mention.startsWith("/");
}

export function getActionableBuiltInMentions(
    scriptsEnabled: boolean,
): ActionableBuiltInMention[] {
    return getAllBuiltInMentions().filter((item) =>
        scriptsEnabled || !isScriptBuiltInMention(item));
}

export function isActionableMention(
    mention: string,
    context: ActionableMentionContext,
): boolean {
    const normalized = mention.trim().toLowerCase();
    if (getActionableBuiltInMentions(context.scriptsEnabled)
        .some((item) => item.mention === normalized)) {
        return true;
    }
    return context.scriptsEnabled
        && normalized.startsWith("/")
        && context.isRunnableVaultScriptMention(normalized);
}
```

Keep `RESERVED_BUILT_IN_MENTION_NAMES` derived from `getAllBuiltInMentions()` so a disabled built-in name cannot become a colliding vault script.

- [x] **Step 4: Carry the capability through suggestions and the Obsidian adapter**

Update the suggestion signature and filter:

```ts
export function buildMentionSuggestions(
    scripts: readonly VaultScriptRegistration[],
    rawQuery: string,
    scriptsEnabled: boolean,
): SideNoteMentionSuggestion[] {
```

```ts
const builtInCandidates: SideNoteMentionSuggestion[] = getActionableBuiltInMentions(scriptsEnabled)
```

```ts
const scriptCandidates = scriptsEnabled && shouldIncludeScripts
    ? scripts.filter((script) => !RESERVED_BUILT_IN_MENTION_NAMES.has(script.normalizedMentionName))
        .map((script) => ({
            kind: "script" as const,
            mention: `/${script.mentionName}` as `/${string}`,
            label: script.fileName,
            scriptPath: script.path,
        }))
    : [];
```

Add `isScriptsEnabled(): boolean` to the `AsideView` plugin contract and pass it into `buildMentionSuggestions`. In `main.ts`, make all public discovery adapters agree:

```ts
public isScriptsEnabled(): boolean {
    return this.settings.scriptsEnabled;
}

public getRunnableVaultScripts() {
    return this.isScriptsEnabled()
        ? this.vaultScriptRegistry.getRunnableScripts()
        : [];
}

public isRunnableVaultScriptMention(mention: string): boolean {
    return this.isScriptsEnabled()
        && this.vaultScriptRegistry.isRunnableMention(mention);
}

public isActionableMention(mention: string): boolean {
    return resolveActionableMention(mention, {
        scriptsEnabled: this.isScriptsEnabled(),
        isRunnableVaultScriptMention: (candidate) =>
            this.vaultScriptRegistry.isRunnableMention(candidate),
    });
}
```

```ts
getMentionSuggestions: (query) => buildMentionSuggestions(
    this.plugin.getRunnableVaultScripts(),
    query,
    this.plugin.isScriptsEnabled(),
),
```

- [x] **Step 5: Run focused tests and verify they pass**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/actionableMentions.test.js .test-dist/tests/commentMentionSuggestions.test.js .test-dist/tests/commentEditorFormatting.test.js .test-dist/tests/commentEditorPersistedMentions.test.js
```

Expected: enabled behavior remains unchanged, off-state slash results are empty, and agent/todo mentions remain actionable.

- [x] **Step 6: Commit the discovery slice**

```bash
git add src/core/text/actionableMentions.ts src/ui/editor/commentMentionSuggestions.ts src/ui/views/AsideView.ts src/main.ts tests/actionableMentions.test.ts tests/commentMentionSuggestions.test.ts tests/commentEditorFormatting.test.ts tests/commentEditorPersistedMentions.test.ts
git commit -m "feat(scripts): gate command discovery"
```

### Task 4: Gate Saved Dispatch and Generate/Regenerate Paths

**Files:**
- Modify: `src/vaultScripts/commentScriptController.ts:48-90`
- Modify: `src/ui/views/sidebarPersistedComment.ts:90-180,615-660,1200-1240,1400-1445,1560-1605`
- Modify: `src/ui/views/AsideView.ts:4870-4930`
- Modify: `src/main.ts:1380-1410,1780-1800`
- Test: `tests/commentScriptController.test.ts`
- Test: `tests/sidebarPersistedComment.test.ts`
- Create: `tests/scriptsCapabilityWiring.test.mjs`

- [x] **Step 1: Write failing routing tests**

Replace positional routing arguments with a named route and test that disabled script flows go only to the ordinary agent controller:

```ts
test("saved entry routing skips every script controller while Scripts is off", async () => {
    const routeCalls: string[] = [];
    await routeSavedUserEntry({
        threadId: "thread-1",
        entryId: "entry-1",
        filePath: "Folder/Note.md",
        body: "/create-script build a cleaner",
    }, {
        scriptsEnabled: false,
        builtInControllers: [{
            handleSavedUserEntry: async () => {
                routeCalls.push("built-in");
                return true;
            },
        }],
        scriptController: {
            handleSavedUserEntry: async () => {
                routeCalls.push("script");
                return true;
            },
        },
        agentController: {
            handleSavedUserEntry: async () => {
                routeCalls.push("agent");
            },
        },
    });
    assert.deepEqual(routeCalls, ["agent"]);
});
```

Convert existing enabled routing tests to `{ scriptsEnabled: true, builtInControllers, scriptController, agentController }` and retain their exact call-order assertions.

- [x] **Step 2: Write failing regenerate-policy tests**

Pass a required `scriptsEnabled` boolean to regenerate planning and add these cases in `sidebarPersistedComment.test.ts`:

```ts
test("Scripts off suppresses script and script-oriented agent regeneration", () => {
    assert.equal(
        getSidebarCommentRegenerateAction(
            "entry-1",
            "/clean",
            [],
            [createScriptRun({ triggerEntryId: "entry-1" })],
            false,
        ),
        null,
    );
    assert.equal(
        getSidebarCommentRegenerateAction(
            "entry-2",
            "/create-script clean links",
            [createAgentRun({ requestKind: "create-script", triggerEntryId: "entry-2" })],
            [],
            false,
        ),
        null,
    );
});

test("Scripts off preserves ordinary agent regeneration", () => {
    const action = getSidebarCommentRegenerateAction(
        "entry-1",
        "@codex explain this",
        [createAgentRun({ triggerEntryId: "entry-1" })],
        [],
        false,
    );
    assert.deepEqual(action, { kind: "agent-run", runId: "run-1" });
    assert.equal(
        shouldShowRetryActionForSidebarComment("entry-2", "@codex explain this", [], [], false),
        true,
    );
});
```

Use the test file's existing run factories, add `scriptsEnabled: true` to its shared `createRenderHost` defaults, and pass `true` to every existing regenerate-policy call to preserve the prior enabled behavior.

- [x] **Step 3: Add a direct-source test for runtime defense in depth**

Create `tests/scriptsCapabilityWiring.test.mjs`:

```js
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync("src/main.ts", "utf8");

test("main gates saved script routing and both retry entrypoints", () => {
    assert.match(
        mainSource,
        /routeSavedUserEntry\([\s\S]*scriptsEnabled:\s*this\.isScriptsEnabled\(\)/u,
    );
    assert.match(
        mainSource,
        /retryScriptRun\([\s\S]*if \(!this\.isScriptsEnabled\(\)\)[\s\S]*return false/u,
    );
    assert.match(
        mainSource,
        /retryAgentRun\([\s\S]*run\?\.requestKind[\s\S]*!this\.isScriptsEnabled\(\)/u,
    );
});
```

- [x] **Step 4: Run focused tests and verify they fail**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentScriptController.test.js .test-dist/tests/sidebarPersistedComment.test.js
node --test tests/scriptsCapabilityWiring.test.mjs
```

Expected: named routing, required regenerate capability, and main retry guards are absent.

- [x] **Step 5: Implement named capability-aware routing**

In `commentScriptController.ts`, define and consume one route object:

```ts
export interface SavedUserEntryRoute {
    scriptsEnabled: boolean;
    builtInControllers: readonly SavedEntryBuiltInController[];
    scriptController: SavedEntryScriptController | null;
    agentController: SavedEntryAgentController;
}

export async function routeSavedUserEntry(
    event: SavedUserEntryEvent,
    route: SavedUserEntryRoute,
): Promise<void> {
    if (!route.scriptsEnabled) {
        await route.agentController.handleSavedUserEntry(event);
        return;
    }
    for (const builtInController of route.builtInControllers) {
        if (await builtInController.handleSavedUserEntry(event)) {
            return;
        }
    }
    const handledByScript = await route.scriptController?.handleSavedUserEntry(event) ?? false;
    if (!handledByScript) {
        await route.agentController.handleSavedUserEntry(event);
    }
}
```

Pass the named route from `main.ts`:

```ts
await routeSavedUserEntry(event, {
    scriptsEnabled: this.isScriptsEnabled(),
    builtInControllers: [
        this.updateScriptCommandController,
        this.createScriptCommandController,
        this.pdfToMarkdownCommandController,
    ],
    scriptController: this.commentScriptController,
    agentController: this.commentAgentController,
});
```

- [x] **Step 6: Implement retry visibility and host guards**

Add `scriptsEnabled: boolean` to `SidebarPersistedCommentHost`. Require it in regenerate planning:

```ts
export function getSidebarCommentRegenerateAction(
    commentId: string,
    commentBody: string,
    threadAgentRuns: readonly AgentRunRecord[],
    threadScriptRuns: readonly ScriptRunRecord[],
    scriptsEnabled: boolean,
): SidebarCommentRegenerateAction | null {
    const retryableScriptRun = getRetryableScriptRunForSidebarComment(commentId, threadScriptRuns);
    if (scriptsEnabled && retryableScriptRun) {
        return { kind: "script-run", runId: retryableScriptRun.id };
    }
    const retryableAgentRun = getRetryableAgentRunForSidebarComment(commentId, threadAgentRuns);
    if (retryableAgentRun && (scriptsEnabled || retryableAgentRun.requestKind === undefined)) {
        return { kind: "agent-run", runId: retryableAgentRun.id };
    }
    if (parseAgentDirectives(commentBody).target !== null) {
        return { kind: "agent-prompt" };
    }
    return null;
}
```

Pass `host.scriptsEnabled` from both entry and parent regenerate calculations, update `shouldShowRetryActionForSidebarComment` to forward it, and set the host field in `AsideView`:

```ts
scriptsEnabled: this.plugin.isScriptsEnabled(),
```

Guard both public retry methods in `main.ts` while preserving cancellation and ordinary agent retries:

```ts
public async retryAgentRun(runId: string): Promise<boolean> {
    const run = this.commentAgentController.getAgentRuns()
        .find((candidate) => candidate.id === runId);
    if (run?.requestKind && !this.isScriptsEnabled()) {
        return false;
    }
    return this.commentAgentController.retryRun(runId);
}

public async retryScriptRun(runId: string): Promise<boolean> {
    if (!this.isScriptsEnabled()) {
        return false;
    }
    return this.commentScriptController.retryRun(runId);
}
```

- [x] **Step 7: Run focused tests and verify they pass**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/commentScriptController.test.js .test-dist/tests/sidebarPersistedComment.test.js
node --test tests/scriptsCapabilityWiring.test.mjs
```

Expected: disabled routing reaches only the ordinary agent controller, disabled script retries disappear and reject, and ordinary agent retry cases pass.

- [x] **Step 8: Commit the runtime slice**

```bash
git add src/vaultScripts/commentScriptController.ts src/ui/views/sidebarPersistedComment.ts src/ui/views/AsideView.ts src/main.ts tests/commentScriptController.test.ts tests/sidebarPersistedComment.test.ts tests/scriptsCapabilityWiring.test.mjs
git commit -m "feat(scripts): block disabled execution paths"
```

### Task 5: Update Current User Documentation

**Files:**
- Modify: `README.md`
- Modify: `SCRIPTS.md`
- Modify: `ADVANCED_FEATURES.md`
- Modify: `tests/agentScriptsDocumentation.test.mjs`

- [x] **Step 1: Write failing documentation assertions**

Replace the old no-activation expectation with explicit capability-boundary checks:

```js
test("current guides document default-off advanced capabilities", () => {
    const readme = readRequiredFile("README.md");
    const scripts = readRequiredFile("SCRIPTS.md");
    const advanced = readRequiredFile("ADVANCED_FEATURES.md");

    assert.match(readme, /Scripts and Publishing[^\n]*disabled by default/iu);
    assert.match(scripts, /Settings → Aside → Scripts \(advanced\) → Enable scripts/u);
    assert.match(scripts, /ordinary `@agent` replies[^\n]*do not require/iu);
    assert.match(scripts, /turning Scripts off[^\n]*does not delete/iu);
    assert.match(advanced, /Scripts[^\n]*off by default/iu);
    assert.match(advanced, /Publishing[^\n]*off by default/iu);
    assert.match(advanced, /disabling Publishing[^\n]*does not unpublish/iu);
});
```

Retain every existing security, provider, script-registration, and workflow assertion.

- [x] **Step 2: Run documentation tests and verify they fail**

Run:

```bash
node --test tests/agentScriptsDocumentation.test.mjs
```

Expected: the new default-off, enable-path, and non-destructive-disable statements are absent.

- [x] **Step 3: Update README and focused guides**

Use this exact product boundary in the current guides:

```md
Scripts and Publishing are optional advanced capabilities and are disabled by default. Ordinary side notes, todos, wikilinks, tags, thought trails, and explicit `@agent` replies do not require either capability.
```

Add this setup boundary near the start of `SCRIPTS.md` and before its script command lists:

```md
Ordinary `@agent` replies do not require Scripts. To use `/create-script`, `/update-script`, `/pdf-to-markdown`, or a registered `/script-name`, open **Settings → Aside → Scripts (advanced) → Enable scripts** first.

Turning Scripts off blocks new script commands and script-oriented Generate actions. It does not delete registered scripts, stored run history, or existing replies.
```

Update the `ADVANCED_FEATURES.md` availability table to say `Off by default; desktop Obsidian`, add the exact Scripts enable path, and add this Publishing guarantee:

```md
Publishing is off by default. Enable it under **Settings → Aside → Publishing (advanced) → Enable publishing**. Disabling Publishing later hides its controls and blocks new publishing actions; it does not unpublish existing pages or delete saved configuration.
```

Keep the existing local-script warning and every local-agent privacy statement unchanged in substance.

- [x] **Step 4: Run documentation tests and verify they pass**

Run:

```bash
node --test tests/agentScriptsDocumentation.test.mjs
```

Expected: all README, Scripts, Advanced Features, privacy, and non-sandboxing assertions pass.

- [x] **Step 5: Commit the documentation slice**

```bash
git add README.md SCRIPTS.md ADVANCED_FEATURES.md tests/agentScriptsDocumentation.test.mjs
git commit -m "docs: explain advanced capability controls"
```

### Task 6: Run Full Verification and Close the Tracked Spec

**Files:**
- Modify: `docs/superpowers/specs/2026-09-07-advanced-capability-section-gates-design.md`

- [x] **Step 1: Run the full production build**

Run:

```bash
npm run build
```

Expected: compiled TypeScript tests, direct tests, ESLint, typecheck, Obsidian compliance, production bundling, bundle-size guard, and release-artifact guard all pass.

- [x] **Step 2: Re-run exact artifact exposure inspection**

Run:

```bash
npm run release:artifacts:check
```

Expected: the exact ship set is `main.js`, `manifest.json`, and `styles.css`; no `main.js.map`, `sourceMappingURL`, `sourcesContent`, raw TypeScript/JSX-family source, secret-bearing file, or local absolute path is reported.

- [x] **Step 3: Audit the final change surface**

Run:

```bash
rg -n "scriptsEnabled|isScriptsEnabled|scripts-enabled" src tests README.md SCRIPTS.md ADVANCED_FEATURES.md
rg -n "routeSavedUserEntry|getSidebarCommentRegenerateAction|retryAgentRun|retryScriptRun" src tests
git diff main...HEAD --check
git status --short
```

Expected: every Scripts setting consumer is intentional; discovery, saved routing, and retries are covered; no whitespace errors or unexpected worktree changes appear. Generated `main.js` remains ignored.

- [x] **Step 4: Update the tracked spec only after evidence exists**

Mark all seven Implementation Tracking items complete, change status to `Implemented and verified`, and append this evidence section after confirming each statement against Step 1 output:

```md
## Verification Evidence

- Focused settings, migration, discovery, routing, retry, and documentation tests passed.
- The full build passed, including compiled TypeScript tests and direct tests.
- ESLint, typecheck, Obsidian compliance, production bundling, and the bundle-size guard passed.
- Exact artifact inspection passed for `main.js`, `manifest.json`, and `styles.css`; no source maps, embedded source content, raw TypeScript/JSX-family source, secret-bearing files, or local absolute paths were included.
```

- [x] **Step 5: Commit the verification record**

```bash
git add -f docs/superpowers/specs/2026-09-07-advanced-capability-section-gates-design.md
git commit -m "docs(settings): record capability verification"
```

- [x] **Step 6: Confirm the branch is ready for review**

Run:

```bash
git status --short
git log --oneline main..HEAD
```

Expected: the worktree is clean and the feature branch contains the state, UI, discovery, runtime, documentation, and verification commits.

## Verification Record

Task 6 was completed on 2026-09-07 without an install, publish, release, or push:

- Pre-build `git status --short --branch`: clean on `feat/advanced-capability-gates`.
- `npm run build`: exit 0; 1,575 compiled tests and 171 direct-source tests passed with zero failures, skips, cancellations, or todos. ESLint, typecheck, Obsidian compliance, bundling, the 705,354/750,000-byte size guard, and the integrated release-artifact guard passed.
- Focused capability verification: 307 compiled behavior tests and 13 direct wiring/documentation tests passed with zero failures, explicitly exercising the off-state and allowed retry/cancellation boundaries.
- Explicit post-build `npm run release:artifacts:check`: exit 0 for exactly `main.js`, `manifest.json`, and `styles.css`.
- Manual public-artifact audit: `main.js` 705,354 bytes, `manifest.json` 349 bytes, `styles.css` 97,579 bytes; manifest `aside` / `Aside` version `2.0.103`, minimum app `1.12.7`; no shipped map, embedded source markers, raw TypeScript/JSX-family source, secrets, certificates/private keys, fixtures, or local-only files.
- Generated-artifact policy: `main.js` is ignored by `.gitignore`; `manifest.json` and `styles.css` are tracked and remained unchanged. No generated artifact was staged.
- Targeted current-surface language audit (historical release notes and historical design records excluded): no contradictory default-on or Experimental-settings wording; legacy `featureFlags` references only detect and remove old persisted data.
- `git diff main...HEAD --check` and post-build status were clean before adding this documentation-only record.
