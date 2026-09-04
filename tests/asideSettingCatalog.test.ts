import * as assert from "node:assert/strict";
import test from "node:test";
import {
    ASIDE_SETTING_CATALOG,
    ASIDE_SETTING_SECTIONS,
} from "../src/ui/settings/asideSettingCatalog";
import { getLegacyAsideSettingKeys } from "../src/ui/settings/asideSettingLegacyAdapter";
import {
    getAsideSettingDefinitions,
    getDefinitionAsideSettingKeys,
} from "../src/ui/settings/asideSettingDefinitionsAdapter";
import { FeatureFlag } from "../src/core/config/featureFlags";

const EXPECTED_KEYS = [
    "default-agent",
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
        assert.ok(["agents", "sidebar", "publishing", "index-note"].includes(entry.section));
    }
});

test("Scripts section is the first settings section", () => {
    assert.deepEqual(ASIDE_SETTING_SECTIONS.map((section) => section.key), [
        "agents",
        "sidebar",
        "publishing",
        "index-note",
    ]);
});

test("agent tab search aliases derive from every supported agent", () => {
    const entry = ASIDE_SETTING_CATALOG.find((candidate) => candidate.key === "show-agent-tab");
    assert.deepEqual(entry?.aliases, ["Codex tab", "Claude Code tab", "Cursor tab", "Gemini tab", "DeepSeek tab"]);
});

test("default agent description covers every built-in default-agent command", () => {
    const entry = ASIDE_SETTING_CATALOG.find((candidate) => candidate.key === "default-agent");
    assert.equal(
        entry?.description,
        "Preferred local agent for /create-script, /update-script, and /pdf-to-markdown.",
    );
});

test("vault scripts do not introduce a setting", () => {
    assert.equal(
        ASIDE_SETTING_SECTIONS.some((section) => section.key === ("scripts" as never)),
        false,
    );
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
        renderDefaultAgentSettings: () => undefined,
        renderPurgeBrokerSecret: () => undefined,
    } as unknown as Parameters<NonNullable<(typeof ASIDE_SETTING_CATALOG)[number]["visible"]>>[0];
}

test("graduated agent settings have no feature visibility predicate", () => {
    const context = createCatalogContext({ publishFeatureEnabled: false });

    assert.equal(getCatalogEntry("default-agent").visible, undefined);
    assert.equal(getCatalogEntry("show-agent-tab").visible, undefined);

    const group = getAsideSettingDefinitions(context)
        .find((item) => "heading" in item && item.heading === "Scripts");
    assert.ok(group && typeof group.visible === "function");
    assert.equal(group.visible(), true);
});

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

test("publishing setting definition group follows the publish feature flag", () => {
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

    const getPublishingGroupVisible = (context: ReturnType<typeof createCatalogContext>): boolean => {
        const group = getAsideSettingDefinitions(context)
            .find((item) => "heading" in item && item.heading === "Publishing (experimental)");
        assert.ok(group, "Publishing settings group should exist");
        const visible = group.visible;
        if (typeof visible !== "function") {
            assert.fail("Publishing settings group should define visible as a function");
        }
        return visible();
    };

    assert.equal(getPublishingGroupVisible(disabledContext), false);
    assert.equal(getPublishingGroupVisible(enabledContext), true);
});
