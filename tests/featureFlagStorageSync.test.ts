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
    type FeatureFlagKey,
    type FeatureFlags,
} from "../src/core/config/featureFlags";

interface HarnessConfig {
    flag?: FeatureFlagKey;
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
    const flag = config.flag ?? FeatureFlag.publish;
    let featureFlags: FeatureFlags = config.persisted ?? {
        [FeatureFlag.publish]: false,
        [FeatureFlag.agents]: false,
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
            flag,
            storage,
            storageKey: config.storageKey ?? getFeatureFlagStorageKey(flag, "Test Vault"),
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

test("publish override persists and mirrors without changing agents", async () => {
    const harness = createHarness({
        persisted: { publish: false, agents: true },
        stored: "true",
    });

    const result = await syncFeatureFlagStorage(harness.options);

    assert.deepEqual(harness.featureFlags, { publish: true, agents: true });
    assert.equal(harness.persistCount, 1);
    assert.equal(harness.storageValue, "true");
    assert.deepEqual(harness.storageAccesses, [
        "read:aside.feature.publish.Test Vault",
        "write:aside.feature.publish.Test Vault",
    ]);
    assert.deepEqual(result, {
        featureFlags: { publish: true, agents: true },
        persisted: true,
        mirrored: true,
    });
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

test("false local-storage request persists and mirrors the selected flag", async () => {
    const harness = createHarness({
        persisted: { publish: true, agents: true },
        stored: "false",
    });

    await syncFeatureFlagStorage(harness.options);

    assert.deepEqual(harness.featureFlags, { publish: false, agents: true });
    assert.equal(harness.persistCount, 1);
    assert.equal(harness.storageValue, "false");
});

test("missing or invalid local-storage requests preserve persisted flags", async () => {
    for (const stored of [null, "", "TRUE", "invalid"]) {
        const harness = createHarness({
            persisted: { publish: true, agents: false },
            stored,
        });
        await syncFeatureFlagStorage(harness.options);
        assert.deepEqual(harness.featureFlags, { publish: true, agents: false });
        assert.equal(harness.persistCount, 0);
        assert.equal(harness.storageValue, "true");
    }
});

test("unavailable or unreadable storage preserves persisted flags", async () => {
    const persisted = { publish: true, agents: false };
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

test("failed persistence restores and mirrors the previous complete flag object", async () => {
    const harness = createHarness({
        flag: FeatureFlag.agents,
        persisted: { publish: true, agents: false },
        stored: "true",
        persistError: new Error("save failed"),
    });

    await syncFeatureFlagStorage(harness.options);

    assert.deepEqual(harness.featureFlags, { publish: true, agents: false });
    assert.equal(harness.storageValue, "false");
    assert.deepEqual(harness.operations, ["persist"]);
});

test("failed mirror writes do not reject synchronization", async () => {
    const harness = createHarness({
        persisted: { publish: false, agents: false },
        stored: "true",
        writeError: new Error("denied"),
    });

    const result = await syncFeatureFlagStorage(harness.options);

    assert.deepEqual(harness.featureFlags, { publish: true, agents: false });
    assert.equal(harness.persistCount, 1);
    assert.equal(result.mirrored, false);
    assert.deepEqual(harness.operations, ["write"]);
});
