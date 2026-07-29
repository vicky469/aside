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
