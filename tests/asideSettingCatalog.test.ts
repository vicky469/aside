import * as assert from "node:assert/strict";
import test from "node:test";
import { ASIDE_SETTING_CATALOG } from "../src/ui/settings/asideSettingCatalog";
import { getLegacyAsideSettingKeys } from "../src/ui/settings/asideSettingLegacyAdapter";
import { getDefinitionAsideSettingKeys } from "../src/ui/settings/asideSettingDefinitionsAdapter";

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
