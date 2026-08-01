import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getPublishFeatureFlagStorageKey,
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
    readonly options: PublishFeatureFlagStorageSyncOptions;
}

function createHarness(config: HarnessConfig): Harness {
    let featureFlags: FeatureFlags = {
        [FeatureFlag.publish]: config.persisted,
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
            storage,
            storageKey: config.storageKey ?? "aside.feature.publish.Test Vault",
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

test("publish feature flag storage keys are scoped by vault name", () => {
    assert.equal(
        getPublishFeatureFlagStorageKey("Vault A"),
        "aside.feature.publish.Vault A",
    );
    assert.equal(
        getPublishFeatureFlagStorageKey("Vault B"),
        "aside.feature.publish.Vault B",
    );
});

test("true local-storage request persists and mirrors the enabled flag", async () => {
    const harness = createHarness({ persisted: false, stored: "true" });

    const result = await syncPublishFeatureFlagStorage(harness.options);

    assert.equal(harness.featureFlags.publish, true);
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
