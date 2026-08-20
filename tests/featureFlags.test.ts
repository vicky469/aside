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
