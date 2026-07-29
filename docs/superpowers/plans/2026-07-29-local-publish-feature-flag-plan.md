# Local Publish Feature Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the publish feature flag persistent in `data.json` while allowing testers to change it through an exact `"true"` or `"false"` local-storage value and an Aside reload.

**Architecture:** Add a dependency-free synchronization unit beside the existing feature-flag model. Aside loads canonical settings first, then asks the synchronizer to apply a valid local-storage request through the normal settings persistence callback and mirror the resulting canonical value back to local storage before registering publishing UI and actions.

**Tech Stack:** TypeScript, browser `Storage`, Obsidian plugin lifecycle, Node test runner, existing Aside settings persistence.

---

### Task 1: Feature-flag storage synchronization

**Files:**
- Create: `src/core/config/featureFlagStorageSync.ts`
- Create: `tests/featureFlagStorageSync.test.ts`

- [ ] **Step 1: Write failing synchronization tests**

Create `tests/featureFlagStorageSync.test.ts` with a small in-memory storage and host harness. Cover:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import {
    syncPublishFeatureFlagStorage,
    type FeatureFlagStorage,
    type PublishFeatureFlagStorageSyncOptions,
} from "../src/core/config/featureFlagStorageSync";
import {
    FeatureFlag,
    type FeatureFlags,
} from "../src/core/config/featureFlags";

interface HarnessConfig {
    persisted: boolean;
    stored?: string | null;
    storage?: null;
    readError?: Error;
    writeError?: Error;
    persistError?: Error;
}

interface Harness {
    readonly featureFlags: FeatureFlags;
    readonly persistCount: number;
    readonly storageValue: string | null;
    readonly operations: string[];
    readonly options: PublishFeatureFlagStorageSyncOptions;
}

function createHarness(config: HarnessConfig): Harness {
    let featureFlags: FeatureFlags = {
        [FeatureFlag.publish]: config.persisted,
    };
    let persistCount = 0;
    let storageValue = config.stored ?? null;
    const operations: string[] = [];
    const storage: FeatureFlagStorage | null = config.storage === null
        ? null
        : {
            getItem: () => {
                if (config.readError) {
                    throw config.readError;
                }
                return storageValue;
            },
            setItem: (_key, value) => {
                if (config.writeError) {
                    throw config.writeError;
                }
                storageValue = value;
            },
        };

    return {
        get featureFlags() {
            return featureFlags;
        },
        get persistCount() {
            return persistCount;
        },
        get storageValue() {
            return storageValue;
        },
        operations,
        options: {
            storage,
            getFeatureFlags: () => featureFlags,
            setFeatureFlags: (nextFeatureFlags) => {
                featureFlags = nextFeatureFlags;
            },
            persist: async () => {
                persistCount += 1;
                if (config.persistError) {
                    throw config.persistError;
                }
            },
            onError: (operation) => {
                operations.push(operation);
            },
        },
    };
}

test("true local-storage request persists and mirrors the enabled flag", async () => {
    const harness = createHarness({ persisted: false, stored: "true" });

    const result = await syncPublishFeatureFlagStorage(harness.options);

    assert.equal(harness.featureFlags.publish, true);
    assert.equal(harness.persistCount, 1);
    assert.equal(harness.storageValue, "true");
    assert.deepEqual(result, {
        featureFlags: { publish: true },
        persisted: true,
        mirrored: true,
    });
});

test("false local-storage request persists and mirrors the disabled flag", async () => {
    const harness = createHarness({ persisted: true, stored: "false" });

    await syncPublishFeatureFlagStorage(harness.options);

    assert.equal(harness.featureFlags.publish, false);
    assert.equal(harness.persistCount, 1);
    assert.equal(harness.storageValue, "false");
});

test("missing or invalid local-storage requests preserve persisted flags", async () => {
    for (const stored of [null, "", "TRUE", "invalid"]) {
        const harness = createHarness({ persisted: true, stored });
        await syncPublishFeatureFlagStorage(harness.options);
        assert.equal(harness.featureFlags.publish, true);
        assert.equal(harness.persistCount, 0);
        assert.equal(harness.storageValue, "true");
    }
});

test("unavailable or unreadable storage preserves persisted flags", async () => {
    const unavailable = createHarness({ persisted: true, storage: null });
    await syncPublishFeatureFlagStorage(unavailable.options);
    assert.equal(unavailable.featureFlags.publish, true);
    assert.equal(unavailable.persistCount, 0);

    const unreadable = createHarness({ persisted: true, readError: new Error("denied") });
    await syncPublishFeatureFlagStorage(unreadable.options);
    assert.equal(unreadable.featureFlags.publish, true);
    assert.equal(unreadable.persistCount, 0);
    assert.deepEqual(unreadable.operations, ["read"]);
});

test("failed persistence restores and mirrors the previous canonical flag", async () => {
    const harness = createHarness({
        persisted: false,
        stored: "true",
        persistError: new Error("save failed"),
    });

    await syncPublishFeatureFlagStorage(harness.options);

    assert.equal(harness.featureFlags.publish, false);
    assert.equal(harness.storageValue, "false");
    assert.deepEqual(harness.operations, ["persist"]);
});

test("failed mirror writes do not reject synchronization", async () => {
    const harness = createHarness({
        persisted: false,
        stored: "true",
        writeError: new Error("denied"),
    });

    const result = await syncPublishFeatureFlagStorage(harness.options);

    assert.equal(harness.featureFlags.publish, true);
    assert.equal(harness.persistCount, 1);
    assert.equal(result.mirrored, false);
    assert.deepEqual(harness.operations, ["write"]);
});
```

The harness must expose mutable `featureFlags`, `persistCount`, `storageValue`, and captured error operations while implementing the production callback interface with real functions rather than mocks.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: TypeScript fails because `src/core/config/featureFlagStorageSync.ts` and its exports do not exist.

- [ ] **Step 3: Implement the synchronization unit**

Create `src/core/config/featureFlagStorageSync.ts`:

```ts
import {
    FeatureFlag,
    normalizeFeatureFlags,
    type FeatureFlags,
} from "./featureFlags";

export const PUBLISH_FEATURE_FLAG_STORAGE_KEY = "aside.feature.publish";

export interface FeatureFlagStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export type FeatureFlagStorageSyncOperation = "read" | "persist" | "write";

export interface PublishFeatureFlagStorageSyncOptions {
    storage: FeatureFlagStorage | null;
    getFeatureFlags(): unknown;
    setFeatureFlags(featureFlags: FeatureFlags): void;
    persist(): Promise<void>;
    onError?(operation: FeatureFlagStorageSyncOperation, error: unknown): void;
}

export interface PublishFeatureFlagStorageSyncResult {
    featureFlags: FeatureFlags;
    persisted: boolean;
    mirrored: boolean;
}

function reportError(
    options: PublishFeatureFlagStorageSyncOptions,
    operation: FeatureFlagStorageSyncOperation,
    error: unknown,
): void {
    try {
        options.onError?.(operation, error);
    } catch {
        // Feature-flag diagnostics must not block plugin startup.
    }
}

export async function syncPublishFeatureFlagStorage(
    options: PublishFeatureFlagStorageSyncOptions,
): Promise<PublishFeatureFlagStorageSyncResult> {
    const previousFlags = normalizeFeatureFlags(options.getFeatureFlags());
    if (!options.storage) {
        return {
            featureFlags: previousFlags,
            persisted: false,
            mirrored: false,
        };
    }

    let storedValue: string | null;
    try {
        storedValue = options.storage.getItem(PUBLISH_FEATURE_FLAG_STORAGE_KEY);
    } catch (error) {
        reportError(options, "read", error);
        return {
            featureFlags: previousFlags,
            persisted: false,
            mirrored: false,
        };
    }

    const requestedValue = storedValue === "true"
        ? true
        : storedValue === "false"
            ? false
            : null;
    let canonicalFlags = previousFlags;
    let persisted = false;

    if (
        requestedValue !== null
        && requestedValue !== previousFlags[FeatureFlag.publish]
    ) {
        const requestedFlags = {
            ...previousFlags,
            [FeatureFlag.publish]: requestedValue,
        };
        options.setFeatureFlags(requestedFlags);
        try {
            await options.persist();
            canonicalFlags = requestedFlags;
            persisted = true;
        } catch (error) {
            options.setFeatureFlags(previousFlags);
            reportError(options, "persist", error);
        }
    }

    let mirrored = false;
    try {
        options.storage.setItem(
            PUBLISH_FEATURE_FLAG_STORAGE_KEY,
            String(canonicalFlags[FeatureFlag.publish]),
        );
        mirrored = true;
    } catch (error) {
        reportError(options, "write", error);
    }

    return {
        featureFlags: canonicalFlags,
        persisted,
        mirrored,
    };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/featureFlagStorageSync.test.js
```

Expected: all feature-flag storage synchronization tests pass.

- [ ] **Step 5: Commit the core unit**

```bash
git add src/core/config/featureFlagStorageSync.ts tests/featureFlagStorageSync.test.ts
git commit -m "feat(settings): sync publish flag from local storage"
```

### Task 2: Plugin startup and persistence wiring

**Files:**
- Modify: `src/main.ts`
- Modify: `tests/pluginStartupOrder.test.ts`

- [ ] **Step 1: Write the failing startup-order test**

Extend `tests/pluginStartupOrder.test.ts`:

```ts
test("plugin synchronizes the publish feature flag before registering UI", () => {
    const source = readFileSync("src/main.ts", "utf8");
    const onloadStart = source.indexOf("async onload()");
    const unloadStart = source.indexOf("onunload()");
    const onloadBody = source.slice(onloadStart, unloadStart);
    const loadSettingsIndex = onloadBody.indexOf("await this.loadSettings();");
    const syncFeatureFlagIndex = onloadBody.indexOf("await this.syncPublishFeatureFlagStorage();");
    const registerIndex = onloadBody.indexOf("this.pluginRegistrationController.register();");

    assert.ok(loadSettingsIndex >= 0);
    assert.ok(syncFeatureFlagIndex > loadSettingsIndex);
    assert.ok(registerIndex > syncFeatureFlagIndex);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/pluginStartupOrder.test.js
```

Expected: the new test fails because `src/main.ts` does not call `syncPublishFeatureFlagStorage`.

- [ ] **Step 3: Wire synchronization into `src/main.ts`**

Import `syncPublishFeatureFlagStorage` from `./core/config/featureFlagStorageSync`.

Immediately after `await this.loadSettings();` in `onload`, add:

```ts
await this.syncPublishFeatureFlagStorage();
```

Add this private method near `loadSettings`:

```ts
private async syncPublishFeatureFlagStorage(): Promise<void> {
    await syncPublishFeatureFlagStorage({
        storage: getSafeLocalStorage(),
        getFeatureFlags: () => this.settings.featureFlags,
        setFeatureFlags: (featureFlags) => {
            this.settings.featureFlags = featureFlags;
        },
        persist: () => this.saveSettings(),
        onError: (operation, error) => {
            this.warn(
                `Unable to ${operation} the publish feature flag through local storage.`,
                error,
                "settings",
                `settings.publish-feature-flag.${operation}.warn`,
            );
        },
    });
}
```

This uses the existing `saveSettings()` path, so an accepted value becomes canonical in `data.json` without replacing unrelated plugin data. The core synchronizer restores the previous runtime flag if persistence fails.

- [ ] **Step 4: Run focused and settings tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/featureFlagStorageSync.test.js .test-dist/tests/pluginStartupOrder.test.js .test-dist/tests/indexNoteSettingsController.test.js .test-dist/tests/asideSettingCatalog.test.js
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit startup wiring**

```bash
git add src/main.ts tests/pluginStartupOrder.test.ts
git commit -m "feat(settings): apply publish flag during startup"
```

### Task 3: DevTools workflow and obsolete CLI cleanup

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Delete: `scripts/set-feature-flag.mjs`
- Delete: `tests/setFeatureFlagScript.test.ts`
- Create: `tests/publishFeatureFlagDocs.test.mjs`
- Modify: `docs/superpowers/specs/2026-07-29-local-publish-feature-flag-design.md`

- [ ] **Step 1: Add a failing governance test for the public instructions**

Create `tests/publishFeatureFlagDocs.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("README documents the source-free DevTools publish feature flag workflow", async () => {
    const readme = await readFile("README.md", "utf8");

    assert.match(readme, /localStorage\.setItem\("aside\.feature\.publish", "true"\)/u);
    assert.match(readme, /localStorage\.setItem\("aside\.feature\.publish", "false"\)/u);
    assert.match(readme, /app\.plugins\.disablePlugin\("aside"\)/u);
    assert.match(readme, /app\.plugins\.enablePlugin\("aside"\)/u);
    assert.doesNotMatch(readme, /npm run feature:flag/u);
});
```

- [ ] **Step 2: Run the documentation test and verify RED**

Run:

```bash
node --test tests/publishFeatureFlagDocs.test.mjs
```

Expected: the test fails because README still documents `npm run feature:flag`.

- [ ] **Step 3: Replace the README instruction**

Replace the repository-only flag command with a short Developer Tools section containing:

```js
localStorage.setItem("aside.feature.publish", "true");
await app.plugins.disablePlugin("aside");
await app.plugins.enablePlugin("aside");
```

Also document the corresponding `"false"` snippet and state that testers may edit the `aside.feature.publish` value directly under Developer Tools → Application → Local Storage before reloading Aside.

- [ ] **Step 4: Remove the obsolete repository CLI**

Remove the `"feature:flag"` package script from `package.json`, then delete:

```text
scripts/set-feature-flag.mjs
tests/setFeatureFlagScript.test.ts
```

- [ ] **Step 5: Run documentation and full verification**

Run:

```bash
node --test tests/publishFeatureFlagDocs.test.mjs
npm run build
```

Expected: the documentation test and the complete build pass, including tests, lint, typecheck, Obsidian compliance, bundling, and release-artifact inspection.

- [ ] **Step 6: Update implementation tracking**

In `docs/superpowers/specs/2026-07-29-local-publish-feature-flag-design.md`, mark the implemented and verified checklist items complete only after the commands in Step 5 pass. Keep the `public/` detection and visibility non-goals unchanged.

- [ ] **Step 7: Commit documentation, cleanup, and verified tracking**

```bash
git add README.md package.json tests/publishFeatureFlagDocs.test.mjs
git add -u scripts/set-feature-flag.mjs tests/setFeatureFlagScript.test.ts
git add -f docs/superpowers/specs/2026-07-29-local-publish-feature-flag-design.md docs/superpowers/plans/2026-07-29-local-publish-feature-flag-plan.md
git commit -m "docs(settings): document publish flag DevTools flow"
```
