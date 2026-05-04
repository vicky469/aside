import * as assert from "node:assert/strict";
import test from "node:test";
import { RefreshCoordinator } from "../src/app/refreshCoordinator";

function createHarness(appliedEventCount: number) {
    const calls: string[] = [];
    const coordinator = new RefreshCoordinator({
        replaySyncedSideNoteEvents: async (targetNotePath) => {
            calls.push(`replay:${targetNotePath ?? "all"}`);
            return appliedEventCount;
        },
        refreshCommentViews: async (options) => {
            calls.push(`refresh-views:${options?.skipDataRefresh === true}`);
        },
        scheduleAggregateNoteRefresh: () => {
            calls.push("schedule-index");
        },
    });

    return { calls, coordinator };
}

test("refresh coordinator refreshes open surfaces after external side-note sync changes", async () => {
    const harness = createHarness(2);

    const appliedEventCount = await harness.coordinator.handleExternalPluginDataChange();

    assert.equal(appliedEventCount, 2);
    assert.deepEqual(harness.calls, [
        "replay:all",
        "refresh-views:true",
        "schedule-index",
    ]);
});

test("refresh coordinator does not refresh surfaces when external plugin data has no side-note changes", async () => {
    const harness = createHarness(0);

    const appliedEventCount = await harness.coordinator.handleExternalPluginDataChange();

    assert.equal(appliedEventCount, 0);
    assert.deepEqual(harness.calls, ["replay:all"]);
});
