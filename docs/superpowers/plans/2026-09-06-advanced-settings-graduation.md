# Advanced Settings Graduation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder Aside settings, label Scripts and Publishing as advanced, and remove the obsolete hidden feature-flag system so the visible publishing toggle is the only publishing gate.

**Architecture:** Keep `asideSettingCatalog.ts` as the single owner of settings order, labels, and visibility. Remove the feature-flag modules and all adapters; `AsideSettings.publishEnabled` becomes the sole capability state, while the settings persistence sanitizer drops legacy `featureFlags` data. Rename the user guide from experimental to advanced and keep historical release/spec documents unchanged.

**Tech Stack:** TypeScript, Obsidian Settings API, Node test runner, Markdown documentation, esbuild.

---

### Task 1: Lock the Advanced Settings Contract

**Files:**
- Modify: `tests/asideSettingCatalog.test.ts`
- Modify: `tests/publishSettings.test.ts`
- Modify: `tests/publicHtmlPublishController.test.ts`
- Modify: `tests/indexNoteSettingsController.test.ts`
- Modify: `tests/pluginStartupOrder.test.ts`

- [ ] **Step 1: Replace flag-era assertions with the approved settings order and visibility contract**

Assert the shared section metadata exactly equals:

```ts
[
    { key: "sidebar", heading: "Sidebar tabs" },
    { key: "agents", heading: "Scripts (advanced)" },
    { key: "publishing", heading: "Publishing (advanced)" },
    { key: "index-note", heading: "Index note" },
]
```

Assert `publish-enabled` is always visible; dependent fields follow `publishEnabled`; remote purge fields additionally follow `publishRemotePurgeEnabled`.

- [ ] **Step 2: Replace publishing validation/controller flag tests**

Call `validatePublishSettings(settings)` without a second argument. Keep the disabled-toggle failure and successful complete-config coverage, and remove the hidden-flag failure case and host `getFeatureFlags` adapter.

- [ ] **Step 3: Add legacy settings cleanup coverage**

Load persisted data containing `featureFlags: { publish: true }`, then assert the resolved runtime settings omit `featureFlags`, `shouldRewriteLegacySettings` is true, and the controller's saved payload drops the legacy key while retaining unrelated settings.

- [ ] **Step 4: Run the focused tests and confirm they fail for the expected old behavior**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/asideSettingCatalog.test.js .test-dist/tests/publishSettings.test.js .test-dist/tests/publicHtmlPublishController.test.js .test-dist/tests/indexNoteSettingsController.test.js .test-dist/tests/pluginStartupOrder.test.js
```

Expected: failures show the old section order/labels, feature-flag APIs, and persisted `featureFlags` field.

### Task 2: Remove Feature Flags from Production

**Files:**
- Modify: `src/ui/settings/asideSettingCatalog.ts`
- Modify: `src/ui/settings/AsideSetting.ts`
- Modify: `src/core/publish/publishSettings.ts`
- Modify: `src/publish/publicHtmlPublishController.ts`
- Modify: `src/settings/indexNoteSettingsPlanner.ts`
- Modify: `src/settings/indexNoteSettingsController.ts`
- Modify: `src/main.ts`
- Delete: `src/core/config/featureFlags.ts`
- Delete: `src/core/config/featureFlagStorageSync.ts`
- Delete: `tests/featureFlags.test.ts`
- Delete: `tests/featureFlagStorageSync.test.ts`

- [ ] **Step 1: Make the catalog own the exact approved order and advanced labels**

Remove `isPublishFeatureAvailable`. Use `publishEnabled` only for dependent publishing fields and `publishRemotePurgeEnabled` only for purge details. Change the enable-setting description to “Show advanced publish controls for supported files in the public folder.”

- [ ] **Step 2: Make publishing validation depend only on the visible toggle**

Use this signature:

```ts
export function validatePublishSettings(
    settings: PublishSettings,
): PublishSettingsValidation
```

Delete `PUBLISH_FEATURE_DISABLED_NOTICE`, the feature-flag imports, and the flag-first branch. Remove `getFeatureFlags()` from `PublicHtmlPublishHost` and from the main-plugin adapter.

- [ ] **Step 3: Remove feature flags from runtime settings and startup**

Delete `featureFlags` from `AsideSettings` and `DEFAULT_SETTINGS`. Delete feature-flag imports, browser-storage synchronization, the startup synchronization call, `isPublishFeatureAvailable`, and the action-controller branch that returns no actions behind the hidden flag.

- [ ] **Step 4: Drop legacy persisted flags safely**

Add `featureFlags?: unknown` only to `PersistedPluginData` as a legacy input. Mark any stored occurrence for rewrite and delete it in `sanitizePersistedPluginData`, ensuring the cached loaded object cannot reintroduce it during a settings save.

- [ ] **Step 5: Delete the now-unreferenced flag modules and tests**

Delete both production flag modules and their isolated test files. Re-run `rg` to verify no active `src/`, `scripts/`, or current tests reference `FeatureFlag`, `featureFlags`, `FEATURE_FLAG_KEYS`, or `syncFeatureFlagStorage`.

- [ ] **Step 6: Run the focused tests**

Run the Task 1 focused command. Expected: all focused tests pass.

- [ ] **Step 7: Commit the production migration**

```bash
git add src tests
git commit -m "feat(settings): graduate advanced sections"
```

### Task 3: Graduate the Documentation

**Files:**
- Delete: `EXPERIMENTAL_FEATURES.md`
- Create: `ADVANCED_FEATURES.md`
- Modify: `README.md`
- Modify: `tests/agentScriptsDocumentation.test.mjs`
- Modify: `docs/superpowers/specs/2026-09-06-advanced-settings-graduation-design.md`

- [ ] **Step 1: Rename and rewrite the guide**

Use `# Advanced Features`, retain the publishing security/network/workflow material, remove all local-storage activation snippets, and instruct users to open **Settings → Aside → Publishing (advanced)** and turn on **Enable publishing**.

- [ ] **Step 2: Update the README and documentation contract test**

Link `[Advanced Features](ADVANCED_FEATURES.md)` and make the test assert the new file, heading, settings route, and absence of `localStorage` and `aside.feature.publish` instructions.

- [ ] **Step 3: Run the documentation test**

```bash
node --test tests/agentScriptsDocumentation.test.mjs
```

Expected: pass.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md ADVANCED_FEATURES.md EXPERIMENTAL_FEATURES.md tests/agentScriptsDocumentation.test.mjs docs/superpowers/specs/2026-09-06-advanced-settings-graduation-design.md
git commit -m "docs: graduate advanced publishing guide"
```

### Task 4: Verify and Close Tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-09-06-advanced-settings-graduation-design.md`

- [ ] **Step 1: Re-run the change-surface audit**

Search active code, current tests, README, and advanced guide for flag-era identifiers and hidden activation copy. Historical release notes and historical specs may retain their original language.

- [ ] **Step 2: Run the complete build**

```bash
npm run build
```

Expected: all TypeScript/direct tests, lint, typecheck, Obsidian compliance, bundle-size guard, and release-artifact inspection pass.

- [ ] **Step 3: Mark every design-spec tracking item complete with verification evidence**

Record the final test totals, bundle byte count, and exact release-artifact inspection result.

- [ ] **Step 4: Commit verification tracking**

```bash
git add -f docs/superpowers/specs/2026-09-06-advanced-settings-graduation-design.md docs/superpowers/plans/2026-09-06-advanced-settings-graduation.md
git commit -m "docs(settings): record graduation verification"
```

