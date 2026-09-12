import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync("src/main.ts", "utf8");
const routerSource = readFileSync("src/app/pluginEventRouter.ts", "utf8");
const onloadStart = mainSource.indexOf("async onload()");
const onloadEnd = mainSource.indexOf("\n    onunload()", onloadStart);
const onloadSource = mainSource.slice(onloadStart, onloadEnd);

test("main registers startup vault listeners immediately after the initial script-registry seed", () => {
    const seedIndex = onloadSource.indexOf("this.vaultScriptRegistry.seed(");
    const earlyRegisterIndex = onloadSource.indexOf("this.pluginEventRouter.registerVaultStartupEvents();");
    const loadSettingsIndex = onloadSource.indexOf("await this.loadSettings();");
    const fullRegisterIndex = onloadSource.indexOf("await this.pluginEventRouter.register();");

    assert.ok(seedIndex >= 0, "onload should seed the vault script registry");
    assert.ok(earlyRegisterIndex > seedIndex, "startup vault registration should follow the initial seed");
    assert.ok(loadSettingsIndex > earlyRegisterIndex, "settings migration should observe the seeded registry");
    assert.ok(fullRegisterIndex > earlyRegisterIndex, "startup vault registration should precede full routing");
    assert.doesNotMatch(
        onloadSource.slice(seedIndex, earlyRegisterIndex),
        /\bawait\b/,
        "startup must not yield between the initial seed and startup listener registration",
    );
});

test("main delegates startup vault listener ownership to the router exactly once", () => {
    const earlyRegistrationCalls = mainSource.match(/this\.pluginEventRouter\.registerVaultStartupEvents\(\);/g) ?? [];
    assert.equal(earlyRegistrationCalls.length, 1);
    assert.doesNotMatch(mainSource, /registerVaultMaintenanceEvents/u);
    assert.doesNotMatch(mainSource, /registerVaultCreateEvent/u);
    assert.doesNotMatch(mainSource, /this\.app\.vault\.on\("create"/);
    assert.doesNotMatch(mainSource, /this\.app\.vault\.on\("rename"/);
    assert.doesNotMatch(mainSource, /this\.app\.vault\.on\("delete"/);
    assert.doesNotMatch(mainSource, /this\.app\.vault\.on\("modify"/);
});

test("startup rename and delete maintenance refresh only the vault script registry", () => {
    const routerHostStart = mainSource.indexOf("private readonly pluginEventRouter = new PluginEventRouter({");
    const renameMaintenanceStart = mainSource.indexOf("handleFileRenameMaintenance:", routerHostStart);
    const deleteMaintenanceStart = mainSource.indexOf("handleFileDeleteMaintenance:", renameMaintenanceStart);
    const layoutReadyStart = mainSource.indexOf("handleLayoutReady:", deleteMaintenanceStart);
    const renameMaintenanceSource = mainSource.slice(renameMaintenanceStart, deleteMaintenanceStart);
    const deleteMaintenanceSource = mainSource.slice(deleteMaintenanceStart, layoutReadyStart);

    assert.ok(routerHostStart >= 0 && renameMaintenanceStart > routerHostStart);
    assert.ok(deleteMaintenanceStart > renameMaintenanceStart && layoutReadyStart > deleteMaintenanceStart);
    for (const maintenanceSource of [renameMaintenanceSource, deleteMaintenanceSource]) {
        assert.match(maintenanceSource, /refreshVaultScriptRegistry\(/u);
        assert.doesNotMatch(maintenanceSource, /pluginLifecycleController/u);
        assert.doesNotMatch(maintenanceSource, /vaultCapabilityIndex/u);
    }
});

test("settings migration evidence refreshes the canonical registry from current vault files", () => {
    assert.match(
        mainSource,
        /hasRegisteredVaultScripts:\s*\(\)\s*=>\s*refreshVaultScriptRegistryEvidence\(\s*this\.vaultScriptRegistry,\s*this\.app\.vault\.getFiles\(\)\.map\(\(file\)\s*=>\s*file\.path\),?\s*\)/u,
    );
});

test("main refreshes the script registry immediately before final router registration", () => {
    assert.match(
        onloadSource,
        /this\.vaultScriptRegistry\.seed\(\s*this\.app\.vault\.getFiles\(\)\.map\(\(file\)\s*=>\s*file\.path\),?\s*\);\s*await this\.pluginEventRouter\.register\(\);/u,
    );
});

test("full router registration starts activation before its first unrelated await", () => {
    const registerStart = routerSource.indexOf("public register(): Promise<void>");
    const completionStart = routerSource.indexOf("private async completeRegistration()", registerStart);
    const startupRegistrationStart = routerSource.indexOf("public registerVaultStartupEvents()", completionStart);
    const registerSource = routerSource.slice(registerStart, completionStart);
    const completionSource = routerSource.slice(completionStart, startupRegistrationStart);
    const startupEventsEnd = routerSource.indexOf("private async activateVaultLifecycleEvents", startupRegistrationStart);
    const startupEventsSource = routerSource.slice(startupRegistrationStart, startupEventsEnd);

    assert.ok(registerStart >= 0 && completionStart > registerStart);
    assert.ok(startupRegistrationStart > completionStart && startupEventsEnd > startupRegistrationStart);
    assert.match(
        registerSource,
        /this\.registerVaultStartupEvents\(\);\s*this\.registerVaultModifyEvent\(\);\s*this\.registrationPromise = this\.completeRegistration\(\);/u,
    );
    assert.match(
        completionSource,
        /await this\.activateVaultLifecycleEvents\(\);\s*await this\.registerLayoutReady\(\);/u,
    );
    assert.match(startupEventsSource, /vault\.on\("create"/u);
    assert.match(startupEventsSource, /vault\.on\("rename"/u);
    assert.match(startupEventsSource, /vault\.on\("delete"/u);
});

test("main delegates Scripts settings changes", () => {
    assert.match(
        mainSource,
        /public async setScriptsEnabled\(enabled: boolean\): Promise<void> \{\s*await this\.indexNoteSettingsController\.setScriptsEnabled\(enabled\);\s*\}/,
    );
});

test("main delegates Publishing initialization as one controller transition", () => {
    const methodStart = mainSource.indexOf("public async setPublishEnabled(enabled: boolean)");
    const methodEnd = mainSource.indexOf("public async setPublishPagesProjectName", methodStart);
    const methodSource = mainSource.slice(methodStart, methodEnd);

    assert.match(
        methodSource,
        /await this\.indexNoteSettingsController\.setPublishEnabled\(enabled\);/,
    );
    assert.doesNotMatch(methodSource, /this\.setPublishPagesProjectName\(/);
    assert.doesNotMatch(methodSource, /this\.setPublishBaseUrl\(/);
});

test("main resolves actionable vault scripts through its public capability boundary", () => {
    const methodStart = mainSource.indexOf("public isActionableMention(mention: string)");
    const methodEnd = mainSource.indexOf("public getScriptRuns()", methodStart);
    const methodSource = mainSource.slice(methodStart, methodEnd);

    assert.match(
        methodSource,
        /isRunnableVaultScriptMention:\s*\(candidate\)\s*=>\s*this\.isRunnableVaultScriptMention\(candidate\)/u,
    );
    assert.doesNotMatch(methodSource, /vaultScriptRegistry\.isRunnableMention/u);
});
