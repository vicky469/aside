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

test("plugin startup has no hidden feature-flag synchronization", () => {
    const source = readFileSync("src/main.ts", "utf8");
    const onloadStart = source.indexOf("async onload()");
    const unloadStart = source.indexOf("onunload()");
    const onloadBody = source.slice(onloadStart, unloadStart);

    assert.ok(onloadBody.indexOf("await this.loadSettings();") >= 0);
    assert.equal(onloadBody.includes("syncFeatureFlagStorage"), false);
    assert.equal(source.includes("FEATURE_FLAG_KEYS"), false);
    assert.equal(source.includes("getFeatureFlagStorageKey"), false);
});

test("plugin unload resets vault event routing before lifecycle teardown", () => {
    const source = readFileSync("src/main.ts", "utf8");
    const unloadStart = source.indexOf("onunload()");
    const maintenanceReset = source.indexOf("this.pluginEventRouter.resetForReload();", unloadStart);
    const lifecycleTeardown = source.indexOf("this.pluginLifecycleController.handleUnload();", unloadStart);

    assert.ok(unloadStart >= 0);
    assert.ok(maintenanceReset > unloadStart);
    assert.ok(maintenanceReset < lifecycleTeardown);
});

test("plugin refreshes the public inventory during startup maintenance", () => {
    const source = readFileSync("src/main.ts", "utf8");
    const maintenanceStart = source.indexOf("private async runStartupPersistenceMaintenance()");
    const loadSettingsStart = source.indexOf("async loadSettings()", maintenanceStart);
    const maintenanceBody = source.slice(maintenanceStart, loadSettingsStart);

    assert.ok(maintenanceStart >= 0);
    assert.ok(loadSettingsStart > maintenanceStart);
    assert.match(
        maintenanceBody,
        /await this\.publicHtmlPublishController\.refreshPublicPublishIndex\(\);/u,
    );
});

test("metadata changes update tag membership before refreshing visible tag results", () => {
    const source = readFileSync("src/main.ts", "utf8");
    const callbackStart = source.indexOf('this.registerEvent(this.app.metadataCache.on("changed"');
    const callbackEnd = source.indexOf("}));", callbackStart);
    const callbackSource = source.slice(callbackStart, callbackEnd);
    const upsertIndex = callbackSource.indexOf("this.vaultCapabilityIndex.upsert(");
    const refreshIndex = callbackSource.indexOf("this.workspaceViewController.refreshIndexTagSearchViews();");

    assert.ok(callbackStart >= 0 && callbackEnd > callbackStart);
    assert.ok(upsertIndex >= 0);
    assert.ok(refreshIndex > upsertIndex);
});
