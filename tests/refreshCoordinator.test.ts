import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import {
    RefreshCoordinator,
    runReportedAsyncRefresh,
} from "../src/app/refreshCoordinator";
import { WorkspaceViewController } from "../src/app/workspaceViewController";

function createHarness(appliedEventCount: number) {
    const calls: string[] = [];
    const host = {
        replaySyncedSideNoteEvents: async (
            targetNotePath?: string,
            options?: { deferSurfaceRefresh?: boolean },
        ) => {
            calls.push([
                `replay:${targetNotePath ?? "all"}`,
                `defer:${options?.deferSurfaceRefresh === true}`,
            ].join(":"));
            return appliedEventCount;
        },
        refreshCommentViews: async (options?: { skipDataRefresh?: boolean }) => {
            calls.push(`refresh-views:${options?.skipDataRefresh === true}`);
        },
        scheduleAggregateNoteRefresh: () => {
            calls.push("schedule-index");
        },
        syncPublicFilePublishActions: async () => {
            calls.push("sync-publish-actions");
        },
    };
    const coordinator = new RefreshCoordinator(host);

    return { calls, coordinator };
}

test("refresh coordinator refreshes open surfaces after external side-note sync changes", async () => {
    const harness = createHarness(2);

    const appliedEventCount = await harness.coordinator.handleExternalPluginDataChange();

    assert.equal(appliedEventCount, 2);
    assert.deepEqual(harness.calls, [
        "replay:all:defer:true",
        "refresh-views:true",
        "schedule-index",
        "sync-publish-actions",
    ]);
});

test("refresh coordinator refreshes capability surfaces when external plugin data has no side-note changes", async () => {
    const harness = createHarness(0);

    const appliedEventCount = await harness.coordinator.handleExternalPluginDataChange();

    assert.equal(appliedEventCount, 0);
    assert.deepEqual(harness.calls, [
        "replay:all:defer:true",
        "refresh-views:true",
        "schedule-index",
        "sync-publish-actions",
    ]);
});

test("zero-event external refresh updates active and pinned capability surfaces", async () => {
    const note = {
        path: "docs/note.md",
        basename: "note",
        extension: "md",
    } as TFile;
    const renderSnapshots: string[] = [];
    const settings = {
        scriptsEnabled: false,
        publishEnabled: false,
        generateAvailable: false,
    };
    const createSidebarView = (surface: "active" | "pinned") => ({
        file: note,
        pinnedSidebarFilePath: surface === "pinned" ? note.path : null,
        getViewType: () => "aside-view",
        renderComments: async (options?: { skipDataRefresh?: boolean }) => {
            renderSnapshots.push([
                surface,
                `scripts:${settings.scriptsEnabled}`,
                `generate:${settings.generateAvailable}`,
                `skip-data:${options?.skipDataRefresh === true}`,
            ].join(":"));
        },
    });
    const leaves = [
        { view: createSidebarView("active") },
        { view: createSidebarView("pinned") },
    ];
    const app = {
        workspace: {
            getLeavesOfType: () => leaves,
        },
    } as unknown as ConstructorParameters<typeof WorkspaceViewController>[0]["app"];
    const workspaceViews = new WorkspaceViewController({
        app,
        isSidebarSupportedFile: (file): file is TFile => !!file,
        isAllCommentsNotePath: () => false,
        ensureIndexedCommentsLoaded: async () => {},
        hasPendingAggregateRefresh: () => false,
        refreshAggregateNoteNow: async () => {},
        loadCommentsForFile: async () => {},
    });
    const publishActionSnapshots: boolean[] = [];
    const coordinatorHost = {
        replaySyncedSideNoteEvents: async () => 0,
        refreshCommentViews: (options?: { skipDataRefresh?: boolean }) => workspaceViews.refreshCommentViews(options),
        scheduleAggregateNoteRefresh: () => {},
        syncPublicFilePublishActions: async () => {
            publishActionSnapshots.push(settings.publishEnabled);
        },
    };
    const coordinator = new RefreshCoordinator(coordinatorHost);

    settings.scriptsEnabled = true;
    settings.publishEnabled = true;
    settings.generateAvailable = true;
    await coordinator.handleExternalPluginDataChange();

    assert.deepEqual(renderSnapshots, [
        "active:scripts:true:generate:true:skip-data:true",
        "pinned:scripts:true:generate:true:skip-data:true",
    ]);
    assert.deepEqual(publishActionSnapshots, [true]);
});

test("external refresh completes every cleanup phase and rethrows the replay error", async () => {
    const calls: string[] = [];
    const replayError = new Error("replay failed");
    const refreshError = new Error("view refresh also failed");
    const coordinator = new RefreshCoordinator({
        replaySyncedSideNoteEvents: async () => {
            calls.push("replay");
            throw replayError;
        },
        refreshCommentViews: async () => {
            calls.push("refresh-views");
            throw refreshError;
        },
        scheduleAggregateNoteRefresh: () => {
            calls.push("schedule-index");
        },
        syncPublicFilePublishActions: async () => {
            calls.push("sync-publish-actions");
        },
    });

    await assert.rejects(
        coordinator.handleExternalPluginDataChange(),
        (error: unknown) => error === replayError,
    );
    assert.deepEqual(calls, [
        "replay",
        "refresh-views",
        "schedule-index",
        "sync-publish-actions",
    ]);
});

test("external refresh does not let a view failure skip aggregate or publish cleanup", async () => {
    const calls: string[] = [];
    const refreshError = new Error("view refresh failed");
    const coordinator = new RefreshCoordinator({
        replaySyncedSideNoteEvents: async () => {
            calls.push("replay");
            return 1;
        },
        refreshCommentViews: async () => {
            calls.push("refresh-views");
            throw refreshError;
        },
        scheduleAggregateNoteRefresh: () => {
            calls.push("schedule-index");
        },
        syncPublicFilePublishActions: async () => {
            calls.push("sync-publish-actions");
        },
    });

    await assert.rejects(
        coordinator.handleExternalPluginDataChange(),
        (error: unknown) => error === refreshError,
    );
    assert.deepEqual(calls, [
        "replay",
        "refresh-views",
        "schedule-index",
        "sync-publish-actions",
    ]);
});

test("external refresh awaits asynchronous publish action synchronization", async () => {
    let releasePublishSync = () => {};
    let settled = false;
    const coordinator = new RefreshCoordinator({
        replaySyncedSideNoteEvents: async () => 0,
        refreshCommentViews: async () => {},
        scheduleAggregateNoteRefresh: () => {},
        syncPublicFilePublishActions: () => new Promise<void>((resolve) => {
            releasePublishSync = resolve;
        }),
    });

    const refresh = coordinator.handleExternalPluginDataChange().then(() => {
        settled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);

    releasePublishSync();
    await refresh;
    assert.equal(settled, true);
});

test("overlapping external refreshes coalesce into the active pass and one queued rerun", async () => {
    let releaseFirstReplay = () => {};
    let markFirstReplayStarted = () => {};
    const firstReplayStarted = new Promise<void>((resolve) => {
        markFirstReplayStarted = resolve;
    });
    const calls: string[] = [];
    let replayCount = 0;
    const coordinator = new RefreshCoordinator({
        replaySyncedSideNoteEvents: async () => {
            replayCount += 1;
            calls.push(`replay:${replayCount}`);
            if (replayCount === 1) {
                markFirstReplayStarted();
                await new Promise<void>((resolve) => {
                    releaseFirstReplay = resolve;
                });
            }
            return replayCount;
        },
        refreshCommentViews: async () => {
            calls.push("refresh-views");
        },
        scheduleAggregateNoteRefresh: () => {
            calls.push("schedule-index");
        },
        syncPublicFilePublishActions: async () => {
            calls.push("sync-publish-actions");
        },
    });

    const first = coordinator.handleExternalPluginDataChange();
    await firstReplayStarted;
    const second = coordinator.handleExternalPluginDataChange();
    const third = coordinator.handleExternalPluginDataChange();
    releaseFirstReplay();

    assert.deepEqual(await Promise.all([first, second, third]), [3, 3, 3]);
    assert.deepEqual(calls, [
        "replay:1",
        "refresh-views",
        "schedule-index",
        "sync-publish-actions",
        "replay:2",
        "refresh-views",
        "schedule-index",
        "sync-publish-actions",
    ]);
});

test("reported async refresh contains a rejected workspace refresh", async () => {
    const refreshError = new Error("publish action refresh failed");
    const reportedErrors: unknown[] = [];

    runReportedAsyncRefresh(
        () => Promise.reject(refreshError),
        (error: unknown) => {
            reportedErrors.push(error);
        },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(reportedErrors, [refreshError]);
});
