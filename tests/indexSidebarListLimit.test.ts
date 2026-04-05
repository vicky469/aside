import * as assert from "node:assert/strict";
import test from "node:test";
import {
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
