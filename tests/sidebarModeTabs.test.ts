import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getSidebarModeTabGroups,
    isSidebarListLikeMode,
    resolveModeWithSidebarModeVisibility,
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

test("sidebar mode tab groups omit optional tabs when top-level settings are off", () => {
    const availability = {
        isTagsEnabled: true,
        isTodoEnabled: true,
        isAgentEnabled: true,
        isThoughtTrailEnabled: true,
        showTodoSidebarTab: false,
        showAgentSidebarTab: false,
    };

    assert.deepEqual(
        getSidebarModeTabGroups(availability, "note").map((group) => group.tabs.map((tab) => tab.mode)),
        [["list", "tags"], ["thought-trail"]],
    );
    assert.deepEqual(
        getSidebarModeTabGroups(availability, "index").map((group) => group.tabs.map((tab) => tab.mode)),
        [["list"], ["thought-trail"]],
    );
});

test("sidebar mode tab groups include todo and agent on note and index surfaces when settings are on", () => {
    const availability = {
        isTagsEnabled: true,
        isTodoEnabled: true,
        isAgentEnabled: true,
        isThoughtTrailEnabled: true,
        showTodoSidebarTab: true,
        showAgentSidebarTab: true,
    };

    assert.deepEqual(
        getSidebarModeTabGroups(availability, "note").map((group) => group.tabs.map((tab) => tab.mode)),
        [["list", "tags", "todo", "agent"], ["thought-trail"]],
    );
    assert.deepEqual(
        getSidebarModeTabGroups(availability, "index").map((group) => group.tabs.map((tab) => tab.mode)),
        [["list"], ["todo", "agent", "thought-trail"]],
    );
});

test("turned-off active todo and agent modes fall back to list", () => {
    assert.equal(
        resolveModeWithSidebarModeVisibility("todo", {
            showTodoSidebarTab: false,
            showAgentSidebarTab: true,
        }),
        "list",
    );
    assert.equal(
        resolveModeWithSidebarModeVisibility("agent", {
            showTodoSidebarTab: true,
            showAgentSidebarTab: false,
        }),
        "list",
    );
    assert.equal(
        resolveModeWithSidebarModeVisibility("thought-trail", {
            showTodoSidebarTab: false,
            showAgentSidebarTab: false,
        }),
        "thought-trail",
    );
});
