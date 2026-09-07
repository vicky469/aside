import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import { RefreshCoordinator } from "../src/app/refreshCoordinator";
import { WorkspaceViewController } from "../src/app/workspaceViewController";

function createHarness(appliedEventCount: number) {
    const calls: string[] = [];
    const host = {
        replaySyncedSideNoteEvents: async (targetNotePath?: string) => {
            calls.push(`replay:${targetNotePath ?? "all"}`);
            return appliedEventCount;
        },
        refreshCommentViews: async (options?: { skipDataRefresh?: boolean }) => {
            calls.push(`refresh-views:${options?.skipDataRefresh === true}`);
        },
        scheduleAggregateNoteRefresh: () => {
            calls.push("schedule-index");
        },
        syncPublicFilePublishActions: () => {
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
        "replay:all",
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
        "replay:all",
        "refresh-views:true",
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
        syncPublicFilePublishActions: () => {
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
