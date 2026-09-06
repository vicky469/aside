import * as assert from "node:assert/strict";
import test from "node:test";
import {
    canRetryAgentRunWithScriptsCapability,
    canRetryScriptRunWithScriptsCapability,
} from "../src/core/scripts/scriptCapabilities";

test("agent retry capability blocks only known script-oriented runs while Scripts is off", () => {
    for (const requestKind of ["create-script", "update-script", "pdf-to-markdown"] as const) {
        assert.equal(
            canRetryAgentRunWithScriptsCapability(false, { requestKind }),
            false,
            requestKind,
        );
    }
    assert.equal(
        canRetryAgentRunWithScriptsCapability(false, { requestKind: undefined }),
        true,
    );
    assert.equal(canRetryAgentRunWithScriptsCapability(false, null), true);
    assert.equal(
        canRetryAgentRunWithScriptsCapability(true, { requestKind: "create-script" }),
        true,
    );
});

test("script retry capability follows the live Scripts setting", () => {
    assert.equal(canRetryScriptRunWithScriptsCapability(false), false);
    assert.equal(canRetryScriptRunWithScriptsCapability(true), true);
});
