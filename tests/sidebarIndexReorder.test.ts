import * as assert from "node:assert/strict";
import test from "node:test";
import { canDropIndexThreadOnThread } from "../src/ui/views/sidebarIndexReorder";

test("index thread drag accepts only a different thread from the same source file", () => {
    const source = { id: "a", filePath: "docs/source.md" };

    assert.equal(canDropIndexThreadOnThread(source, {
        id: "b",
        filePath: "docs/source.md",
    }), true);
    assert.equal(canDropIndexThreadOnThread(source, {
        id: "a",
        filePath: "docs/source.md",
    }), false);
    assert.equal(canDropIndexThreadOnThread(source, {
        id: "c",
        filePath: "docs/other.md",
    }), false);
});
