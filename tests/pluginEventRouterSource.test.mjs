import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync("src/main.ts", "utf8");
const routerSource = readFileSync("src/app/pluginEventRouter.ts", "utf8");
const onloadStart = mainSource.indexOf("async onload()");
const onloadEnd = mainSource.indexOf("\n    onunload()", onloadStart);
const onloadSource = mainSource.slice(onloadStart, onloadEnd);

test("main registers only vault create immediately after the initial script-registry seed", () => {
    const seedIndex = onloadSource.indexOf("this.vaultScriptRegistry.seed(");
    const earlyRegisterIndex = onloadSource.indexOf("this.pluginEventRouter.registerVaultCreateEvent();");
    const loadSettingsIndex = onloadSource.indexOf("await this.loadSettings();");
    const fullRegisterIndex = onloadSource.indexOf("await this.pluginEventRouter.register();");

    assert.ok(seedIndex >= 0, "onload should seed the vault script registry");
    assert.ok(earlyRegisterIndex > seedIndex, "early vault create registration should follow the initial seed");
    assert.ok(loadSettingsIndex > earlyRegisterIndex, "settings migration should observe the seeded registry");
    assert.ok(fullRegisterIndex > earlyRegisterIndex, "early create registration should precede full routing");
    assert.doesNotMatch(
        onloadSource.slice(seedIndex, earlyRegisterIndex),
        /\bawait\b/,
        "startup must not yield between the initial seed and create registration",
    );
});

test("main delegates early vault create ownership to the router exactly once", () => {
    const earlyRegistrationCalls = mainSource.match(/this\.pluginEventRouter\.registerVaultCreateEvent\(\);/g) ?? [];
    assert.equal(earlyRegistrationCalls.length, 1);
    assert.doesNotMatch(mainSource, /registerVaultMaintenanceEvents/u);
    assert.doesNotMatch(mainSource, /this\.app\.vault\.on\("create"/);
    assert.doesNotMatch(mainSource, /this\.app\.vault\.on\("rename"/);
    assert.doesNotMatch(mainSource, /this\.app\.vault\.on\("delete"/);
    assert.doesNotMatch(mainSource, /this\.app\.vault\.on\("modify"/);
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

test("full router registration installs vault listeners before its first await", () => {
    const registerStart = routerSource.indexOf("public async register()");
    const createRegistrationStart = routerSource.indexOf("public registerVaultCreateEvent()", registerStart);
    const registerSource = routerSource.slice(registerStart, createRegistrationStart);
    const vaultEventsStart = routerSource.indexOf("private registerVaultEvents(): void");
    const layoutReadyStart = routerSource.indexOf("private async registerLayoutReady()", vaultEventsStart);
    const vaultEventsSource = routerSource.slice(vaultEventsStart, layoutReadyStart);
    const vaultRegistrationIndex = registerSource.indexOf("this.registerVaultEvents();");
    const layoutReadyAwaitIndex = registerSource.indexOf("await this.registerLayoutReady();");

    assert.ok(registerStart >= 0 && createRegistrationStart > registerStart);
    assert.ok(vaultEventsStart >= 0 && layoutReadyStart > vaultEventsStart);
    assert.ok(vaultRegistrationIndex >= 0);
    assert.ok(layoutReadyAwaitIndex > vaultRegistrationIndex);
    assert.match(vaultEventsSource, /^private registerVaultEvents\(\): void/u);
    assert.match(vaultEventsSource, /vault\.on\("rename"/u);
    assert.match(vaultEventsSource, /vault\.on\("delete"/u);
    assert.match(vaultEventsSource, /vault\.on\("modify"/u);
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
        /await this\.indexNoteSettingsController\.setPublishEnabled\(\s*enabled,\s*this\.app\.vault\.getName\(\),?\s*\);/,
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
