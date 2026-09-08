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

test("plugin startup queues script-run initialization after settings load", () => {
    const source = readFileSync("src/main.ts", "utf8");
    const onloadStart = source.indexOf("async onload()");
    const unloadStart = source.indexOf("onunload()");
    const onloadBody = source.slice(onloadStart, unloadStart);
    const settingsLoad = onloadBody.indexOf("await this.loadSettings();");
    const scriptRunInitialization = onloadBody.indexOf(
        "await this.scriptRunStore.initializeFromPersistedData();",
    );

    assert.ok(settingsLoad >= 0);
    assert.ok(scriptRunInitialization > settingsLoad);
    assert.equal(onloadBody.includes("this.scriptRunStore.load();"), false);
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

test("plugin startup awaits public file action synchronization", () => {
    const source = readFileSync("src/main.ts", "utf8");
    const onloadStart = source.indexOf("async onload()");
    const unloadStart = source.indexOf("onunload()");
    const onloadBody = source.slice(onloadStart, unloadStart);

    assert.match(onloadBody, /await this\.syncPublicFilePublishActions\(\);/u);
});

test("workspace publish action refreshes contain and report rejected promises", () => {
    const source = readFileSync("src/main.ts", "utf8");
    const routerHostStart = source.indexOf("private readonly pluginEventRouter = new PluginEventRouter({");
    const routerHostEnd = source.indexOf("private activeMarkdownFile", routerHostStart);
    const routerHostSource = source.slice(routerHostStart, routerHostEnd);
    const safeMethodStart = source.indexOf("private syncPublicFilePublishActionsSafely()");
    const safeMethodEnd = source.indexOf("private syncPublicFilePublishActions()", safeMethodStart);
    const safeMethodSource = source.slice(safeMethodStart, safeMethodEnd);

    assert.ok(routerHostStart >= 0 && routerHostEnd > routerHostStart);
    assert.match(routerHostSource, /handleFileOpen:[\s\S]*this\.syncPublicFilePublishActionsSafely\(\)/u);
    assert.match(routerHostSource, /handleActiveLeafChange:[\s\S]*this\.syncPublicFilePublishActionsSafely\(\)/u);
    assert.ok(safeMethodStart >= 0 && safeMethodEnd > safeMethodStart);
    assert.match(safeMethodSource, /runReportedAsyncRefresh\(/u);
    assert.match(safeMethodSource, /this\.warn\(/u);
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
