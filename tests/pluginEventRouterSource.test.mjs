import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync("src/main.ts", "utf8");
const onloadStart = mainSource.indexOf("async onload()");
const onloadEnd = mainSource.indexOf("\n    onunload()", onloadStart);
const onloadSource = mainSource.slice(onloadStart, onloadEnd);

test("main registers vault create immediately after script-registry seed and before full routing", () => {
    const seedIndex = onloadSource.indexOf("this.vaultScriptRegistry.seed(");
    const earlyRegisterIndex = onloadSource.indexOf("this.pluginEventRouter.registerVaultCreateEvent();");
    const fullRegisterIndex = onloadSource.indexOf("await this.pluginEventRouter.register();");

    assert.ok(seedIndex >= 0, "onload should seed the vault script registry");
    assert.ok(earlyRegisterIndex > seedIndex, "early create registration should follow the initial seed");
    assert.ok(fullRegisterIndex > earlyRegisterIndex, "early create registration should precede full routing");
    assert.doesNotMatch(
        onloadSource.slice(seedIndex, earlyRegisterIndex),
        /\bawait\b/,
        "startup must not yield between the initial seed and create registration",
    );
});

test("main delegates create ownership to the router exactly once", () => {
    const earlyRegistrationCalls = mainSource.match(/this\.pluginEventRouter\.registerVaultCreateEvent\(\);/g) ?? [];
    assert.equal(earlyRegistrationCalls.length, 1);
    assert.doesNotMatch(mainSource, /this\.app\.vault\.on\("create"/);
});
