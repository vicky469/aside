import * as assert from "node:assert/strict";
import test from "node:test";
import {
    isSidebarListLikeMode,
    SHARED_SIDEBAR_MODE_TABS,
} from "../src/ui/views/sidebarModeTabs";

test("shared sidebar mode tabs keep index and note headers in the same order", () => {
    assert.deepEqual(
        SHARED_SIDEBAR_MODE_TABS.map((tab) => [tab.mode, tab.label]),
        [
            ["list", "List"],
            ["todo", "Todo"],
            ["agent", "Agent"],
            ["thought-trail", "Thought Trail"],
        ],
    );
});

test("sidebar list-like modes include grouped comment tabs", () => {
    assert.equal(isSidebarListLikeMode("list"), true);
    assert.equal(isSidebarListLikeMode("tags"), true);
    assert.equal(isSidebarListLikeMode("todo"), true);
    assert.equal(isSidebarListLikeMode("agent"), true);
    assert.equal(isSidebarListLikeMode("thought-trail"), false);
});
