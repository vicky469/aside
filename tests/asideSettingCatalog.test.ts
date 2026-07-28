import * as assert from "node:assert/strict";
import test from "node:test";
import { ASIDE_SETTING_CATALOG } from "../src/ui/settings/asideSettingCatalog";
import { getLegacyAsideSettingKeys } from "../src/ui/settings/asideSettingLegacyAdapter";
import { getDefinitionAsideSettingKeys } from "../src/ui/settings/asideSettingDefinitionsAdapter";
import { FeatureFlag } from "../src/core/config/featureFlags";

const EXPECTED_KEYS = [
    "show-todo-tab",
    "show-agent-tab",
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

test("legacy and declarative setting adapters expose the same stable keys", () => {
    assert.deepEqual(getLegacyAsideSettingKeys(), EXPECTED_KEYS);
    assert.deepEqual(getDefinitionAsideSettingKeys(), EXPECTED_KEYS);
});

test("every Aside setting has searchable metadata and one section owner", () => {
    assert.deepEqual(ASIDE_SETTING_CATALOG.map((entry) => entry.key), EXPECTED_KEYS);
    for (const entry of ASIDE_SETTING_CATALOG) {
        assert.ok(entry.name.trim());
        assert.ok(entry.description.trim());
        assert.ok(entry.aliases.length > 0);
        assert.ok(entry.keywords.length > 0);
        assert.ok(["sidebar", "publishing", "index-note"].includes(entry.section));
    }
});

function getCatalogEntry(key: string) {
    const entry = ASIDE_SETTING_CATALOG.find((candidate) => candidate.key === key);
    assert.ok(entry, `Missing setting catalog entry: ${key}`);
    return entry;
}

function createCatalogContext(options: {
    publishFeatureEnabled: boolean;
    publishEnabled?: boolean;
    remotePurgeEnabled?: boolean;
}) {
    return {
        plugin: {
            settings: {
                featureFlags: {
                    [FeatureFlag.publish]: options.publishFeatureEnabled,
                },
                publishEnabled: options.publishEnabled ?? false,
                publishRemotePurgeEnabled: options.remotePurgeEnabled ?? false,
            },
        },
        refresh: () => undefined,
        renderAgentRuntimeStatus: () => undefined,
        renderPurgeBrokerSecret: () => undefined,
    } as unknown as Parameters<NonNullable<(typeof ASIDE_SETTING_CATALOG)[number]["visible"]>>[0];
}

function isVisible(key: string, context: ReturnType<typeof createCatalogContext>): boolean {
    const entry = getCatalogEntry(key);
    return entry.visible?.(context) ?? true;
}

test("publishing settings are hidden until the publish feature flag is enabled", () => {
    const disabledContext = createCatalogContext({
        publishFeatureEnabled: false,
        publishEnabled: true,
        remotePurgeEnabled: true,
    });
    const enabledContext = createCatalogContext({
        publishFeatureEnabled: true,
        publishEnabled: true,
        remotePurgeEnabled: true,
    });

    for (const key of EXPECTED_KEYS.filter((candidate) => candidate.startsWith("publish-"))) {
        assert.equal(isVisible(key, disabledContext), false, `${key} should be hidden`);
        assert.equal(isVisible(key, enabledContext), true, `${key} should be visible`);
    }
});
