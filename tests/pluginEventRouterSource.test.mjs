import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync("src/main.ts", "utf8");
const routerSource = readFileSync("src/app/pluginEventRouter.ts", "utf8");
const onloadStart = mainSource.indexOf("async onload()");
const onloadEnd = mainSource.indexOf("\n    onunload()", onloadStart);
const onloadSource = mainSource.slice(onloadStart, onloadEnd);

test("main registers vault create, rename, and delete immediately after script-registry seed", () => {
    const seedIndex = onloadSource.indexOf("this.vaultScriptRegistry.seed(");
    const earlyRegisterIndex = onloadSource.indexOf("this.pluginEventRouter.registerVaultMaintenanceEvents();");
    const firstStartupYieldIndex = onloadSource.indexOf("await ");
    const loadSettingsIndex = onloadSource.indexOf("await this.loadSettings();");
    const fullRegisterIndex = onloadSource.indexOf("await this.pluginEventRouter.register();");

    assert.ok(seedIndex >= 0, "onload should seed the vault script registry");
    assert.ok(earlyRegisterIndex > seedIndex, "early vault maintenance registration should follow the initial seed");
    assert.ok(earlyRegisterIndex < firstStartupYieldIndex, "early vault maintenance registration should precede the first startup yield");
    assert.ok(loadSettingsIndex > earlyRegisterIndex, "settings migration should observe the seeded registry");
    assert.ok(fullRegisterIndex > earlyRegisterIndex, "early create registration should precede full routing");
    assert.doesNotMatch(
        onloadSource.slice(seedIndex, earlyRegisterIndex),
        /\bawait\b/,
        "startup must not yield between the initial seed and create registration",
    );
});

test("main reaches full vault routing only after persisted stores are initialized", () => {
    const loadSettingsIndex = onloadSource.indexOf("await this.loadSettings();");
    const scriptStoreLoadIndex = onloadSource.indexOf("this.scriptRunStore.load();");
    const agentStoreLoadIndex = onloadSource.indexOf("this.commentAgentController.initialize();");
    const fullRegisterIndex = onloadSource.indexOf("await this.pluginEventRouter.register();");

    assert.ok(loadSettingsIndex >= 0, "settings and publishing state should load");
    assert.ok(scriptStoreLoadIndex > loadSettingsIndex, "script runs should load after persisted settings data");
    assert.ok(agentStoreLoadIndex > scriptStoreLoadIndex, "agent runs should load before vault replay");
    assert.ok(fullRegisterIndex > agentStoreLoadIndex, "startup vault replay should wait for persisted stores");
});

test("main delegates early vault maintenance ownership to the router exactly once", () => {
    const earlyRegistrationCalls = mainSource.match(/this\.pluginEventRouter\.registerVaultMaintenanceEvents\(\);/g) ?? [];
    assert.equal(earlyRegistrationCalls.length, 1);
    assert.doesNotMatch(mainSource, /this\.app\.vault\.on\("create"/);
    assert.doesNotMatch(mainSource, /this\.app\.vault\.on\("rename"/);
    assert.doesNotMatch(mainSource, /this\.app\.vault\.on\("delete"/);
});

test("router vault listeners remain void callbacks with an explicit rejection boundary", () => {
    assert.doesNotMatch(routerSource, /vault\.on\("(?:create|rename|delete|modify)",\s*async\b/u);
    assert.match(routerSource, /reportAsyncEventError/u);
});

test("main exposes canonical registry evidence and delegates Scripts settings changes", () => {
    assert.match(
        mainSource,
        /hasRegisteredVaultScripts:\s*\(\)\s*=>\s*this\.vaultScriptRegistry\.getRunnableScripts\(\)\.length\s*>\s*0/,
    );
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
