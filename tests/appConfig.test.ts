import * as assert from "node:assert/strict";
import test from "node:test";
import { parsePromptDeleteSetting } from "../src/core/appConfig";

test("parsePromptDeleteSetting returns the core promptDelete toggle when present", () => {
    assert.equal(parsePromptDeleteSetting('{"promptDelete":true}'), true);
    assert.equal(parsePromptDeleteSetting('{"promptDelete":false}'), false);
});

test("parsePromptDeleteSetting returns null for missing or invalid config", () => {
    assert.equal(parsePromptDeleteSetting("{}"), null);
    assert.equal(parsePromptDeleteSetting('{"promptDelete":"yes"}'), null);
    assert.equal(parsePromptDeleteSetting("{"), null);
});
