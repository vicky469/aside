import * as assert from "node:assert/strict";
import test from "node:test";
import { nodeInstanceOf } from "../src/ui/domGuards";

test("nodeInstanceOf delegates to Obsidian's cross-window instanceOf when available", () => {
    class FakeElement {}
    const element = {
        instanceOf(type: { new (): unknown }) {
            return type === FakeElement;
        },
    };

    assert.equal(nodeInstanceOf(element, FakeElement), true);
    assert.equal(nodeInstanceOf(element, class OtherElement {}), false);
});

test("nodeInstanceOf falls back to prototype constructor names for non-Obsidian tests", () => {
    class FakeHTMLElement {}
    class FakeDivElement extends FakeHTMLElement {}
    const div = new FakeDivElement();

    assert.equal(nodeInstanceOf(div, FakeDivElement), true);
    assert.equal(nodeInstanceOf(div, FakeHTMLElement), true);
    assert.equal(nodeInstanceOf(div, class FakeText {}), false);
});
