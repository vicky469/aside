import * as assert from "node:assert/strict";
import test from "node:test";
import {
    DEFAULT_FEATURE_FLAGS,
    FeatureFlag,
    FEATURE_FLAG_KEYS,
    normalizeFeatureFlags,
    shouldRewriteNormalizedFeatureFlags,
} from "../src/core/config/featureFlags";

test("feature flag registry declares publishing disabled by default", () => {
    assert.deepEqual(FEATURE_FLAG_KEYS, [FeatureFlag.publish]);
    assert.deepEqual(DEFAULT_FEATURE_FLAGS, {
        publish: false,
    });
});

test("feature flag normalization preserves publishing and drops legacy agents", () => {
    const normalized = normalizeFeatureFlags({
        publish: true,
        agents: true,
    });

    assert.deepEqual(normalized, { publish: true });
    assert.equal(shouldRewriteNormalizedFeatureFlags({
        publish: true,
        agents: true,
    }, normalized), true);
    assert.equal(shouldRewriteNormalizedFeatureFlags(normalized, normalized), false);
});
