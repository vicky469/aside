import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("plugin registers its UI before expensive startup maintenance", () => {
    const source = readFileSync("src/main.ts", "utf8");
    const onloadStart = source.indexOf("async onload()");
    const unloadStart = source.indexOf("onunload()");
    const onloadBody = source.slice(onloadStart, unloadStart);

    assert.notEqual(onloadStart, -1);
    assert.notEqual(unloadStart, -1);
    assert.equal(onloadBody.includes("await this.ensureSidecarStorageMigrated();"), false);
    assert.equal(onloadBody.includes("await this.ensureSideNoteSyncEventsMigrated();"), false);
    assert.equal(onloadBody.includes("await this.ensureSourceIdentitiesMigrated();"), false);
    assert.equal(onloadBody.includes("await this.commentPersistenceController.replaySyncedSideNoteEvents();"), false);
    assert.ok(
        onloadBody.indexOf("this.pluginRegistrationController.register();")
            < onloadBody.indexOf("this.runStartupPersistenceMaintenance()"),
    );
});

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
