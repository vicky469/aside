import * as assert from "node:assert/strict";
import test from "node:test";
import {
    buildIndexSidebarLimitNotice,
    INDEX_SIDEBAR_LIST_LIMIT,
    limitIndexSidebarListItems,
} from "../src/ui/views/indexSidebarListLimit";

test("limitIndexSidebarListItems leaves small lists unchanged", () => {
    const items = ["a", "b", "c"];

    assert.deepEqual(limitIndexSidebarListItems(items), {
        visibleItems: items,
        hiddenCount: 0,
    });
});

test("limitIndexSidebarListItems caps oversized lists at the sidebar limit", () => {
    const items = Array.from({ length: INDEX_SIDEBAR_LIST_LIMIT + 7 }, (_, index) => `item-${index + 1}`);

    const limited = limitIndexSidebarListItems(items);

    assert.equal(limited.visibleItems.length, INDEX_SIDEBAR_LIST_LIMIT);
    assert.deepEqual(limited.visibleItems, items.slice(0, INDEX_SIDEBAR_LIST_LIMIT));
    assert.equal(limited.hiddenCount, 7);
});

test("buildIndexSidebarLimitNotice describes the ordinary list window", () => {
    assert.deepEqual(buildIndexSidebarLimitNotice({
        visibleCount: 100,
        hiddenCount: 37,
    }), {
        primary: "100 shown, 37 hidden.",
        secondary: "Use files to filter the index to see more.",
    });
});

test("buildIndexSidebarLimitNotice omits the notice when every result is visible", () => {
    assert.equal(buildIndexSidebarLimitNotice({
        visibleCount: 12,
        hiddenCount: 0,
    }), null);
});
