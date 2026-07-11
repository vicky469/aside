# Rabbit Index Note Filename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename Aside's generated vault-root index note from `Aside index.md` to `🐰 Aside Index.md` for new and existing users without adding a setting or overwriting an existing target file.

**Architecture:** `src/core/derived/allCommentsNote.ts` owns both the current and legacy filenames. Settings loading resolves brand-new installs to the current filename, recognizes legacy existing state, and delegates the one-time vault rename to `IndexNoteSettingsController`; graph modules consume the shared current constant instead of copying a fallback literal.

**Tech Stack:** TypeScript 5.9, Obsidian plugin API, Node.js test runner, esbuild, ESLint

---

### Task 1: Centralize the Current and Legacy Filenames

**Files:**
- Modify: `tests/allCommentsNote.test.ts:3-21,380-390`
- Modify: `src/core/derived/allCommentsNote.ts:9-10`
- Modify: `src/core/derived/thoughtTrail.ts:1-7`
- Modify: `src/core/derived/thoughtTrailNoteLinkGraph.ts:1-9`
- Modify: `src/core/derived/indexFileFilterGraph.ts:1-5`

- [x] **Step 1: Write the failing shared-name test**

Add `LEGACY_ALL_COMMENTS_NOTE_PATH` to the existing import from `allCommentsNote` and extend the normalization test:

```ts
import {
    ALL_COMMENTS_NOTE_PATH,
    ALL_COMMENTS_NOTE_IMAGE_ALT,
    ALL_COMMENTS_NOTE_IMAGE_CAPTION,
    ALL_COMMENTS_NOTE_IMAGE_URL,
    LEGACY_ALL_COMMENTS_NOTE_PATH,
    buildAllCommentsNoteContent,
    buildCommentLocationLineNumberMap,
    buildIndexCommentBlockId,
    buildIndexNoteNavigationMap,
    buildCommentLocationUrl,
    findCommentLocationLineNumber,
    findCommentLocationTargetInMarkdownLine,
    findFileHeadingPathInMarkdownLine,
    findIndexMarkdownLineTarget,
    isAllCommentsNotePath,
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
    parseCommentLocationUrl,
    parseIndexFileOpenUrl,
} from "../src/core/derived/allCommentsNote";

test("normalizeAllCommentsNotePath keeps the current default and legacy migration name", () => {
    assert.equal(ALL_COMMENTS_NOTE_PATH, "🐰 Aside Index.md");
    assert.equal(LEGACY_ALL_COMMENTS_NOTE_PATH, "Aside index.md");
    assert.equal(normalizeAllCommentsNotePath(""), ALL_COMMENTS_NOTE_PATH);
    assert.equal(normalizeAllCommentsNotePath("notes/custom index"), "notes/custom index.md");
    assert.equal(normalizeAllCommentsNotePath("notes/custom index.md"), "notes/custom index.md");
});
```

- [x] **Step 2: Compile and run the focused test to verify it fails**

Run:

```bash
rm -rf .test-dist
tsc -p tsconfig.test.json
node --test .test-dist/tests/allCommentsNote.test.js
```

Expected: TypeScript fails because `LEGACY_ALL_COMMENTS_NOTE_PATH` is not exported, or the assertion fails because the current constant is still `Aside index.md`.

- [x] **Step 3: Define both names in the shared module**

Replace the current constant declaration in `src/core/derived/allCommentsNote.ts` with:

```ts
export const ALL_COMMENTS_NOTE_PATH = "🐰 Aside Index.md";
export const LEGACY_ALL_COMMENTS_NOTE_PATH = "Aside index.md";
```

Keep `normalizeAllCommentsNotePath("")` returning `ALL_COMMENTS_NOTE_PATH`; this makes the rabbit filename the default for new state.

- [x] **Step 4: Replace production fallback copies with imports**

In `src/core/derived/thoughtTrail.ts`, remove the local constant and add:

```ts
import { ALL_COMMENTS_NOTE_PATH } from "./allCommentsNote";
```

In `src/core/derived/thoughtTrailNoteLinkGraph.ts`, remove the local constant and add:

```ts
import { ALL_COMMENTS_NOTE_PATH } from "./allCommentsNote";
```

In `src/core/derived/indexFileFilterGraph.ts`, remove the local constant and add:

```ts
import { ALL_COMMENTS_NOTE_PATH } from "./allCommentsNote";
```

Keep each module's existing path-normalization behavior unchanged; only the fallback owner changes.

- [x] **Step 5: Run the focused derived-note tests**

Run:

```bash
rm -rf .test-dist
tsc -p tsconfig.test.json
node --test .test-dist/tests/allCommentsNote.test.js .test-dist/tests/thoughtTrail.test.js .test-dist/tests/thoughtTrailNoteLinkGraph.test.js .test-dist/tests/indexFileFilterGraph.test.js
```

Expected: all focused tests pass. Tests that explicitly inject `Aside index.md` continue to pass because an injected path is independent of the new default.

- [x] **Step 6: Commit the shared-name change**

```bash
git add src/core/derived/allCommentsNote.ts src/core/derived/thoughtTrail.ts src/core/derived/thoughtTrailNoteLinkGraph.ts src/core/derived/indexFileFilterGraph.ts tests/allCommentsNote.test.ts
git commit -m "refactor(index): centralize index note names"
```

### Task 2: Migrate the Existing Generated Index on Startup

**Files:**
- Modify: `tests/indexNoteSettingsController.test.ts:4-37,226-262,346-389,537-577`
- Modify: `src/settings/indexNoteSettingsPlanner.ts:11-16,67-111`
- Modify: `src/settings/indexNoteSettingsController.ts:13-28,54-64,304`

- [x] **Step 1: Write failing first-install and legacy-resolution tests**

Import the shared constants into `tests/indexNoteSettingsController.test.ts`:

```ts
import {
    ALL_COMMENTS_NOTE_PATH,
    LEGACY_ALL_COMMENTS_NOTE_PATH,
} from "../src/core/derived/allCommentsNote";
```

Make the harness's default settings use the current filename:

```ts
function createSettings(overrides: Partial<AsideSettings> = {}): AsideSettings {
    return {
        indexNotePath: overrides.indexNotePath ?? ALL_COMMENTS_NOTE_PATH,
        indexHeaderImageUrl: overrides.indexHeaderImageUrl ?? "https://example.com/default.webp",
        indexHeaderImageCaption: overrides.indexHeaderImageCaption ?? "Default caption",
        agentRuntimeMode: overrides.agentRuntimeMode ?? "auto",
        showTodoSidebarTab: overrides.showTodoSidebarTab ?? true,
        showAgentSidebarTab: overrides.showAgentSidebarTab ?? true,
        publishedPublicArtifactPaths: overrides.publishedPublicArtifactPaths ?? [],
        publishEnabled: overrides.publishEnabled ?? DEFAULT_PUBLISH_SETTINGS.publishEnabled,
        publishPagesProjectName: overrides.publishPagesProjectName ?? DEFAULT_PUBLISH_SETTINGS.publishPagesProjectName,
        publishBaseUrl: overrides.publishBaseUrl ?? DEFAULT_PUBLISH_SETTINGS.publishBaseUrl,
        publishAllowedRoot: overrides.publishAllowedRoot ?? DEFAULT_PUBLISH_SETTINGS.publishAllowedRoot,
    };
}
```

Add resolution tests that distinguish a new installation from legacy persisted data:

```ts
test("loaded settings resolution uses the rabbit index for a new installation", () => {
    const resolved = resolveLoadedSettings(null, createSettings());
    assert.equal(resolved.settings.indexNotePath, ALL_COMMENTS_NOTE_PATH);
});

test("loaded settings resolution keeps the legacy index active until startup migration", () => {
    const resolved = resolveLoadedSettings({}, createSettings());
    assert.equal(resolved.settings.indexNotePath, LEGACY_ALL_COMMENTS_NOTE_PATH);
    assert.equal(resolved.shouldRewriteLegacySettings, true);
});
```

Make these fixture updates in the same test file:

- The two `resolveLoadedSettings(...)` expectations whose loaded object omits `indexNotePath` use `LEGACY_ALL_COMMENTS_NOTE_PATH`; they represent existing schema data awaiting migration.
- The generic `resolveIndexNotePathChange(...)` cases use `ALL_COMMENTS_NOTE_PATH` for `nextPathInput`, `currentStoredPath`, `previousPath`, `currentIndexFilePath`, `activeSidebarFilePath`, and `draftHostFilePath` wherever the old literal was the default fixture.
- Controller tests for runtime mode, sidebar toggles, publishing, direct path rename, missing-folder rejection, and target conflict use `ALL_COMMENTS_NOTE_PATH` for their ordinary default settings and files.
- Only the new startup migration and collision tests use `LEGACY_ALL_COMMENTS_NOTE_PATH` as the active generated index.

- [x] **Step 2: Write failing controller migration tests**

Add these tests beside the existing index-note rename tests:

```ts
test("loading settings renames the legacy index and retargets live state", async () => {
    const legacySettings = createSettings({ indexNotePath: LEGACY_ALL_COMMENTS_NOTE_PATH });
    const harness = createControllerHarness({
        settings: legacySettings,
        loadedData: legacySettings,
        files: [LEGACY_ALL_COMMENTS_NOTE_PATH, "docs/source.md"],
        activeSidebarFilePath: LEGACY_ALL_COMMENTS_NOTE_PATH,
        draftHostFilePath: LEGACY_ALL_COMMENTS_NOTE_PATH,
    });

    await harness.controller.loadSettings();

    assert.equal(harness.getSettings().indexNotePath, ALL_COMMENTS_NOTE_PATH);
    assert.deepEqual(harness.renamedFiles, [{
        from: LEGACY_ALL_COMMENTS_NOTE_PATH,
        to: ALL_COMMENTS_NOTE_PATH,
    }]);
    assert.equal(harness.getActiveSidebarFile()?.path, ALL_COMMENTS_NOTE_PATH);
    assert.equal(harness.getDraftHostFilePath(), ALL_COMMENTS_NOTE_PATH);
    assert.equal(harness.getRefreshAggregateNoteCount(), 1);
    assert.equal(harness.savedPayloads.at(-1)?.indexNotePath, ALL_COMMENTS_NOTE_PATH);
});

test("loading without persisted data still migrates an existing legacy index file", async () => {
    const harness = createControllerHarness({
        settings: createSettings(),
        loadedData: null,
        files: [LEGACY_ALL_COMMENTS_NOTE_PATH],
    });

    await harness.controller.loadSettings();

    assert.deepEqual(harness.renamedFiles, [{
        from: LEGACY_ALL_COMMENTS_NOTE_PATH,
        to: ALL_COMMENTS_NOTE_PATH,
    }]);
    assert.equal(harness.getSettings().indexNotePath, ALL_COMMENTS_NOTE_PATH);
});

test("loading keeps the legacy index when the rabbit filename is occupied", async () => {
    const legacySettings = createSettings({ indexNotePath: LEGACY_ALL_COMMENTS_NOTE_PATH });
    const harness = createControllerHarness({
        settings: legacySettings,
        loadedData: legacySettings,
        files: [LEGACY_ALL_COMMENTS_NOTE_PATH, ALL_COMMENTS_NOTE_PATH],
    });

    await harness.controller.loadSettings();

    assert.equal(harness.getSettings().indexNotePath, LEGACY_ALL_COMMENTS_NOTE_PATH);
    assert.deepEqual(harness.renamedFiles, []);
    assert.deepEqual(harness.notices, [
        `Unable to rename ${LEGACY_ALL_COMMENTS_NOTE_PATH} because ${ALL_COMMENTS_NOTE_PATH} already exists.`,
    ]);
});
```

- [x] **Step 3: Compile and run the focused settings test to verify failure**

Run:

```bash
rm -rf .test-dist
tsc -p tsconfig.test.json
node --test .test-dist/tests/indexNoteSettingsController.test.js
```

Expected: the new resolution and migration tests fail because existing data without `indexNotePath` resolves to the new default and `loadSettings()` does not migrate the file.

- [x] **Step 4: Make settings resolution migration-aware**

Import the legacy constant in `src/settings/indexNoteSettingsPlanner.ts`:

```ts
import {
    LEGACY_ALL_COMMENTS_NOTE_PATH,
    isAllCommentsNotePath,
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../core/derived/allCommentsNote";
```

At the start of `resolveLoadedSettings`, distinguish null new-install data from existing data whose old schema lacks the property:

```ts
const hasIndexNotePathSetting = hasOwn(loaded ?? {}, "indexNotePath");
const indexNotePath = normalizeAllCommentsNotePath(
    hasIndexNotePathSetting
        ? loaded?.indexNotePath
        : loaded === null
            ? defaults.indexNotePath
            : LEGACY_ALL_COMMENTS_NOTE_PATH,
);
```

Add this clause to `shouldRewriteLegacySettings` so legacy data receives an explicit path after migration or collision handling:

```ts
|| (loaded !== null && !hasIndexNotePathSetting)
```

- [x] **Step 5: Add the collision-safe startup migration**

Import both filename constants in `src/settings/indexNoteSettingsController.ts`:

```ts
import {
    ALL_COMMENTS_NOTE_PATH,
    LEGACY_ALL_COMMENTS_NOTE_PATH,
    isAllCommentsNotePath,
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../core/derived/allCommentsNote";
```

Change `loadSettings()` so a successful migration supplies the required save and an unsuccessful migration still allows legacy-setting cleanup:

```ts
public async loadSettings(): Promise<void> {
    const loaded = await this.host.loadData();
    this.persistedPluginData = loaded ?? {};
    const resolved = resolveLoadedSettings(loaded, this.host.getSettings());
    this.host.setSettings(resolved.settings);

    const migratedLegacyIndex = await this.migrateLegacyIndexNotePath(loaded);
    if (resolved.shouldRewriteLegacySettings && !migratedLegacyIndex) {
        await this.saveSettings();
    }
}
```

Add this private method before `setPublishSettings`:

```ts
private async migrateLegacyIndexNotePath(loaded: PersistedPluginData | null): Promise<boolean> {
    const legacyFile = this.host.getMarkdownFileByPath(LEGACY_ALL_COMMENTS_NOTE_PATH);
    const hasPersistedIndexPath = !!loaded?.indexNotePath?.trim();
    const shouldRecoverLegacyFile = !hasPersistedIndexPath && !!legacyFile;
    if (
        this.getAllCommentsNotePath() !== LEGACY_ALL_COMMENTS_NOTE_PATH
        && !shouldRecoverLegacyFile
    ) {
        return false;
    }

    if (this.getAllCommentsNotePath() !== LEGACY_ALL_COMMENTS_NOTE_PATH) {
        this.host.setSettings({
            ...this.host.getSettings(),
            indexNotePath: LEGACY_ALL_COMMENTS_NOTE_PATH,
        });
    }

    if (this.host.getFileByPath(ALL_COMMENTS_NOTE_PATH)) {
        this.host.showNotice(
            `Unable to rename ${LEGACY_ALL_COMMENTS_NOTE_PATH} because ${ALL_COMMENTS_NOTE_PATH} already exists.`,
        );
        return false;
    }

    await this.setIndexNotePath(ALL_COMMENTS_NOTE_PATH);
    return this.getAllCommentsNotePath() === ALL_COMMENTS_NOTE_PATH;
}
```

This deliberately routes the successful operation through the existing rename controller, preserving persistence, conflict planning, sidebar retargeting, draft retargeting, aggregate refresh, and sidebar refresh behavior.

- [x] **Step 6: Run the focused settings tests**

Run:

```bash
rm -rf .test-dist
tsc -p tsconfig.test.json
node --test .test-dist/tests/indexNoteSettingsController.test.js .test-dist/tests/allCommentsNote.test.js
```

Expected: all focused tests pass, including new-install, existing-install, no-persisted-data recovery, live-state retargeting, and collision cases.

- [x] **Step 7: Commit the startup migration**

```bash
git add src/settings/indexNoteSettingsPlanner.ts src/settings/indexNoteSettingsController.ts tests/indexNoteSettingsController.test.ts
git commit -m "feat(index): migrate to rabbit index filename"
```

### Task 3: Update Active Product and Agent Documentation

**Files:**
- Modify: `README.md:54,118-119`
- Modify: `skills/aside/SKILL.md:30`

**Machine-local guidance:** The ignored root `AGENTS.md` was updated separately to use the rabbit filename. It is not a tracked worktree artifact and must not be staged or committed.

- [x] **Step 1: Update current filename references**

Apply these exact wording changes:

```md
- Generates `🐰 Aside Index.md` as a vault-wide comment index.
```

```md
- **`🐰 Aside Index.md`**
  The generated vault-wide index note. It is derived output, not the source of truth.
```

In `skills/aside/SKILL.md`, use:

```md
- `🐰 Aside Index.md` is derived; use only for discovery.
```

- [x] **Step 2: Confirm active documentation no longer advertises the legacy filename**

Run:

```bash
rg -n "Aside index\.md" README.md skills/aside/SKILL.md
```

Expected: no matches.

- [x] **Step 3: Commit the documentation update**

```bash
git add README.md skills/aside/SKILL.md
git commit -m "docs(index): document rabbit index filename"
```

### Task 4: Verify the Change Surface and Complete Tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-07-11-index-note-name-design.md:6-28`

- [x] **Step 1: Audit production filename ownership**

Run:

```bash
rg -n 'Aside index\.md|🐰 Aside Index\.md|ALL_COMMENTS_NOTE_PATH|LEGACY_ALL_COMMENTS_NOTE_PATH' src tests scripts README.md skills/aside/SKILL.md
```

Expected: production filename literals exist only in `src/core/derived/allCommentsNote.ts`; other production modules import the constants or receive an injected configured path. Test literals are limited to explicit fixtures and migration assertions. Active documentation uses only the rabbit filename.

- [x] **Step 2: Run the full repository verification pipeline**

Run:

```bash
npm run build
```

Expected: `npm run test`, ESLint, TypeScript `--noEmit`, and the production esbuild bundle all complete successfully.

- [x] **Step 3: Inspect the worktree for unintended changes**

Run:

```bash
git status --short
git diff --check
git diff --stat 832318a..HEAD
```

Expected: no whitespace errors; relative to the pre-feature base `832318a`, only the planned source, tests, README, Aside skill, and tracked implementation/spec documents changed. The ignored root `AGENTS.md` update is not part of the worktree diff.

- [x] **Step 4: Mark verified spec items complete**

After the focused tests, change-surface audit, and full build have passed, change every implemented and verified checkbox in `docs/superpowers/specs/2026-07-11-index-note-name-design.md` from `[ ]` to `[x]`. Do not mark any item whose command did not pass.

- [x] **Step 5: Commit verified tracking state**

```bash
git add -f docs/superpowers/specs/2026-07-11-index-note-name-design.md
git commit -m "docs(index): complete rabbit rename tracking"
```
