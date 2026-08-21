import * as assert from "node:assert/strict";
import test from "node:test";
import { parseUpdateScriptDirective } from "../src/core/text/updateScriptDirective";

test("update-script parser extracts the registered-script argument and request", () => {
    assert.deepEqual(parseUpdateScriptDirective(
        "/update-script /embed-image-urls make the default size reasonable. currently too big.",
    ), {
        kind: "request",
        targetMention: "/embed-image-urls",
        requestText: "make the default size reasonable. currently too big.",
    });
});

test("update-script parser enforces command, target, and request positions", () => {
    assert.deepEqual(parseUpdateScriptDirective("/update-script"), { kind: "empty" });
    assert.deepEqual(parseUpdateScriptDirective("/update-script /clean"), { kind: "empty" });
    assert.equal(parseUpdateScriptDirective("/update-script clean change it").kind, "rejected");
    assert.equal(parseUpdateScriptDirective("please /update-script /clean change it").kind, "rejected");
});

test("update-script parser keeps request tokens opaque and ignores longer names", () => {
    assert.deepEqual(
        parseUpdateScriptDirective("/update-script /clean explain /update-script and @codex"),
        {
            kind: "request",
            targetMention: "/clean",
            requestText: "explain /update-script and @codex",
        },
    );
    assert.deepEqual(parseUpdateScriptDirective("/update-script-extra /clean x"), { kind: "none" });
});
