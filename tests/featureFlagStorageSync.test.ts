import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getFeatureFlagStorageKey,
    syncFeatureFlagStorage,
    type FeatureFlagStorage,
    type FeatureFlagStorageSyncOptions,
} from "../src/core/config/featureFlagStorageSync";
import {
    FeatureFlag,
    type FeatureFlags,
} from "../src/core/config/featureFlags";

interface HarnessConfig {
    persisted?: FeatureFlags;
    stored?: string | null;
    storageKey?: string;
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
    readonly storageAccesses: string[];
    readonly options: FeatureFlagStorageSyncOptions;
}

function createHarness(config: HarnessConfig = {}): Harness {
    let featureFlags: FeatureFlags = config.persisted ?? {
        [FeatureFlag.publish]: false,
    };
    let persistCount = 0;
    let storageValue = config.stored ?? null;
    const operations: string[] = [];
    const storageAccesses: string[] = [];
    const storage: FeatureFlagStorage | null = config.storage === null
        ? null
        : {
            getItem: (key) => {
                storageAccesses.push(`read:${key}`);
                if (config.readError) {
                    throw config.readError;
                }
                return storageValue;
            },
            setItem: (key, value) => {
                storageAccesses.push(`write:${key}`);
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
        storageAccesses,
        options: {
            flag: FeatureFlag.publish,
            storage,
            storageKey: config.storageKey ?? getFeatureFlagStorageKey(FeatureFlag.publish, "Test Vault"),
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

test("publish feature flag storage key is scoped by vault name", () => {
    assert.equal(
        getFeatureFlagStorageKey(FeatureFlag.publish, "Vault A"),
        "aside.feature.publish.Vault A",
    );
});

test("publish override persists and mirrors", async () => {
    const harness = createHarness({
        persisted: { publish: false },
        stored: "true",
    });

    const result = await syncFeatureFlagStorage(harness.options);

    assert.deepEqual(harness.featureFlags, { publish: true });
    assert.equal(harness.persistCount, 1);
    assert.equal(harness.storageValue, "true");
    assert.deepEqual(harness.storageAccesses, [
        "read:aside.feature.publish.Test Vault",
        "write:aside.feature.publish.Test Vault",
    ]);
    assert.deepEqual(result, {
        featureFlags: { publish: true },
        persisted: true,
        mirrored: true,
    });
});

test("false local-storage request persists and mirrors the selected flag", async () => {
    const harness = createHarness({
        persisted: { publish: true },
        stored: "false",
    });

    await syncFeatureFlagStorage(harness.options);

    assert.deepEqual(harness.featureFlags, { publish: false });
    assert.equal(harness.persistCount, 1);
    assert.equal(harness.storageValue, "false");
});

test("missing or invalid local-storage requests preserve persisted flags", async () => {
    for (const stored of [null, "", "TRUE", "invalid"]) {
        const harness = createHarness({
            persisted: { publish: true },
            stored,
        });
        await syncFeatureFlagStorage(harness.options);
        assert.deepEqual(harness.featureFlags, { publish: true });
        assert.equal(harness.persistCount, 0);
        assert.equal(harness.storageValue, "true");
    }
});

test("unavailable or unreadable storage preserves persisted publishing", async () => {
    const persisted = { publish: true };
    const unavailable = createHarness({ persisted, storage: null });
    await syncFeatureFlagStorage(unavailable.options);
    assert.deepEqual(unavailable.featureFlags, persisted);
    assert.equal(unavailable.persistCount, 0);

    const unreadable = createHarness({ persisted, readError: new Error("denied") });
    await syncFeatureFlagStorage(unreadable.options);
    assert.deepEqual(unreadable.featureFlags, persisted);
    assert.equal(unreadable.persistCount, 0);
    assert.deepEqual(unreadable.operations, ["read"]);
});

test("failed persistence restores and mirrors the previous publish flag", async () => {
    const harness = createHarness({
        persisted: { publish: false },
        stored: "true",
        persistError: new Error("save failed"),
    });

    await syncFeatureFlagStorage(harness.options);

    assert.deepEqual(harness.featureFlags, { publish: false });
    assert.equal(harness.storageValue, "false");
    assert.deepEqual(harness.operations, ["persist"]);
});

test("failed mirror writes do not reject synchronization", async () => {
    const harness = createHarness({
        persisted: { publish: false },
        stored: "true",
        writeError: new Error("denied"),
    });

    const result = await syncFeatureFlagStorage(harness.options);

    assert.deepEqual(harness.featureFlags, { publish: true });
    assert.equal(harness.persistCount, 1);
    assert.equal(result.mirrored, false);
    assert.deepEqual(harness.operations, ["write"]);
});
