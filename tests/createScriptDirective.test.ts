import * as assert from "node:assert/strict";
import test from "node:test";
import { parseCreateScriptDirective } from "../src/core/text/createScriptDirective";

test("create-script parser extracts one natural-language request", () => {
    assert.deepEqual(parseCreateScriptDirective("/create-script build a cleaner"), {
        kind: "request",
        requestText: "build a cleaner",
    });
    assert.deepEqual(parseCreateScriptDirective("please /create-script build a cleaner"), {
        kind: "request",
        requestText: "please build a cleaner",
    });
});

test("create-script parser handles empty and repeated commands", () => {
    assert.deepEqual(parseCreateScriptDirective("/create-script"), { kind: "empty" });
    assert.deepEqual(parseCreateScriptDirective("/create-script x /create-script y"), {
        kind: "rejected",
        message: "Use /create-script only once per side note.",
    });
});

test("create-script parser ignores paths and longer slash names", () => {
    assert.deepEqual(parseCreateScriptDirective("docs/create-script"), { kind: "none" });
    assert.deepEqual(parseCreateScriptDirective("/create-script-extra"), { kind: "none" });
});
