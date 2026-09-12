import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { CommentPersistenceController } from "../src/comments/commentPersistenceController";
import { filterThreadsBySidebarGroupMode } from "../src/ui/views/sidebarThreadGroups";
import { SidebarSearchNavigation } from "../src/ui/views/sidebarSearchNavigation";

const source = ts.createSourceFile(
    "AsideView.ts", readFileSync("src/ui/views/AsideView.ts", "utf8"), ts.ScriptTarget.Latest, true,
);
const viewClass = source.statements.find((node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === "AsideView",
)!;
const memberNames = new Set(["renderComments", "startInitialIndexSidebarLoad", "renderCommentsForInteraction", "onClose"]);
const renderMethods = viewClass.members.filter((node) => node.name && memberNames.has(node.name.getText(source)));
const renderCode = ts.transpileModule(
    `class AsideView { ${renderMethods.map((node) => node.getText(source)).join("\n")} }; new AsideView();`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
).outputText;

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

function createStartupHarness() {
    const loadStarted = deferred();
    const releaseLoad = deferred();
    const threads: any[] = [];
    const counts = { reads: 0, replays: 0, immediateRefreshes: 0, scheduledRefreshes: 0 };
    // Replace storage I/O, not initialization or rendering control flow.
    const controller: any = Object.create(CommentPersistenceController.prototype);
    Object.assign(controller, {
        disposed: false,
        aggregateIndexInitialized: false,
        aggregateIndexInitializationPromise: null,
        host: {
            getAggregateCommentIndex: () => ({ updateFile: (_path: string, loaded: any[]) => threads.push(...loaded) }),
        },
        async getPersistedCommentSourceRecords() {
            counts.reads++;
            loadStarted.resolve();
            await releaseLoad.promise;
            return [{ notePath: "note.md", threads: [{ id: "todo-1", entries: [{ body: "@todo follow-up" }] }] }];
        },
        getPageNoteCapableFileByPath: (path: string) => ({ path }),
        isPageNoteCapableFile: () => true,
        normalizeThreadsForFile: async (_path: string, loaded: any[]) => loaded,
        replaySyncedSideNoteEvents: async () => { counts.replays++; },
        refreshAggregateNoteNow: async () => { counts.immediateRefreshes++; },
        scheduleAggregateNoteRefresh: () => { counts.scheduledRefreshes++; },
    });
    const view = runInNewContext(renderCode, {
        normalizeSidebarViewFile: (file: unknown) => file,
        resolveModeWithSidebarModeVisibility: (mode: string) => mode,
    });
    const snapshots: number[] = [];
    const errors: string[] = [];
    const loadingModes: string[] = [];
    const loadErrors: string[] = [];
    const reachedSnapshot = Symbol("stop before DOM rendering");
    Object.assign(view, {
        renderVersion: 0,
        indexSidebarInitialLoad: null,
        indexSidebarDataReady: false,
        file: { path: "🐰 Aside Index.md" },
        indexSidebarMode: "todo",
        selectedIndexFileFilterRootPath: null,
        clearReorderDragState() {},
        renderInitialIndexSidebarLoading() { loadingModes.push(view.indexSidebarMode); },
        renderIndexSidebarLoadError() { loadErrors.push(view.indexSidebarMode); },
        getSidebarModeVisibility: () => ({ showTodoSidebarTab: true, showAgentSidebarTab: false }),
        plugin: {
            isSidebarSupportedFile: () => true,
            isAllCommentsNotePath: (path: string) => path === "🐰 Aside Index.md",
            shouldShowDeletedComments: () => false,
            ensureIndexedCommentsLoaded: (options: unknown) => controller.ensureIndexedCommentsLoaded(options),
            logEvent: async (_level: string, _area: string, event: string) => { errors.push(event); },
        },
        async getIndexDefaultSidebarCache() {
            snapshots.push(filterThreadsBySidebarGroupMode(threads, "todo").length);
            throw reachedSnapshot;
        },
    });
    const originalRender = view.renderComments.bind(view);
    view.renderComments = async (options: { skipDataRefresh?: boolean } = {}) => {
        try { await originalRender(options); }
        catch (error) { if (error !== reachedSnapshot) throw error; }
    };
    return {
        controller, view, counts, snapshots, errors, loadingModes, loadErrors, loadStarted, releaseLoad,
        async render(options: { skipDataRefresh?: boolean } = {}) {
            await view.renderComments(options);
        },
    };
}

test("a lightweight refresh during first Index open waits for Todos and renders without a tab switch", async () => {
    const h = createStartupHarness();
    const initial = h.render();
    await h.loadStarted.promise;
    const metadataRefresh = h.render({ skipDataRefresh: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const earlySnapshots = h.snapshots.slice();
    h.releaseLoad.resolve();
    await Promise.all([initial, metadataRefresh]);
    assert.deepEqual(earlySnapshots, [], "uninitialized data must not produce a no-Todos state");
    assert.deepEqual(h.snapshots, [1], "the newest render must show the loaded Todo");
    assert.equal(h.counts.reads, 1, "concurrent renders share initialization");
    assert.equal(h.counts.replays, 1, "lightweight renders must not replay sync events");
});

test("a cold lightweight render initializes once and later tab switches perform no storage refresh", async () => {
    const h = createStartupHarness();
    h.releaseLoad.resolve();
    await h.render({ skipDataRefresh: true });
    await h.view.indexSidebarInitialLoad;
    await h.render({ skipDataRefresh: true });
    assert.deepEqual(h.snapshots, [1, 1]);
    assert.deepEqual(h.counts, { reads: 1, replays: 1, immediateRefreshes: 0, scheduledRefreshes: 1 });
});

test("sync-triggered sidebar refresh can initialize without re-entering sync replay", async () => {
    const h = createStartupHarness();
    h.releaseLoad.resolve();
    h.controller.replaySyncedSideNoteEvents = async () => {
        h.counts.replays++;
        assert.equal(h.counts.replays, 1, "recursive sync replay");
        await h.render({ skipDataRefresh: true });
    };
    await h.render();
    assert.deepEqual(h.snapshots, [1]);
    assert.equal(h.counts.reads, 1);
    assert.equal(h.counts.replays, 1);
});

test("a failed initial load is retryable and never renders a false empty result", async () => {
    const h = createStartupHarness();
    const readRecords = h.controller.getPersistedCommentSourceRecords;
    h.controller.getPersistedCommentSourceRecords = async () => { throw new Error("storage unavailable"); };
    await h.render();
    assert.deepEqual(h.snapshots, []);
    assert.deepEqual(h.errors, ["sidebar.index.initial-load.error"]);
    assert.deepEqual(h.loadErrors, ["todo"]);
    h.controller.getPersistedCommentSourceRecords = readRecords;
    h.releaseLoad.resolve();
    await h.render();
    assert.deepEqual(h.snapshots, [1]);
});

test("finishing initialization cannot render an Index that the user has left", async () => {
    const h = createStartupHarness();
    const render = h.render();
    await h.loadStarted.promise;
    h.view.file = { path: "other.md" };
    h.releaseLoad.resolve();
    await render;
    assert.deepEqual(h.snapshots, []);
});

test("cold interaction requests wait until the initial render is available for focus", async () => {
    const h = createStartupHarness();
    let completed = false;
    const focusRender = h.view.renderCommentsForInteraction({ skipDataRefresh: true }).then(() => { completed = true; });
    await h.loadStarted.promise;
    assert.equal(completed, false);
    h.releaseLoad.resolve();
    await focusRender;
    assert.equal(completed, true);
    assert.deepEqual(h.snapshots, [1]);
    assert.match(source.text, /renderComments: \(options\) => this\.renderCommentsForInteraction\(options\)/);
});

test("a lightweight refresh cannot hydrate stale records ahead of full sync replay", async () => {
    const h = createStartupHarness();
    const replayStarted = deferred();
    const finishReplay = deferred();
    h.controller.replaySyncedSideNoteEvents = async () => {
        replayStarted.resolve();
        await finishReplay.promise;
    };
    const initial = h.render();
    await replayStarted.promise;
    await h.render({ skipDataRefresh: true });
    assert.equal(h.counts.reads, 0, "storage hydration must stay behind the full sync replay");
    finishReplay.resolve();
    h.releaseLoad.resolve();
    await initial;
    assert.deepEqual(h.snapshots, [1]);
});

test("closing during load suppresses the old render without cancelling a reopened view", async () => {
    const h = createStartupHarness();
    Object.assign(h.view, {
        searchNavigation: new SidebarSearchNavigation(),
        containerEl: { ownerDocument: { removeEventListener() {} }, removeEventListener() {} },
        interactionController: { cancelPendingRevealedCommentSelectionClear() {} },
        clearNoteSidebarSearchDebounceTimer() {},
        clearIndexSidebarSearchState() {},
        clearIndexTagSearchState() {},
        resetStreamedReplyControllers() {},
    });
    const firstOpen = h.render();
    await h.loadStarted.promise;
    await h.view.onClose();
    const reopened = h.render();
    h.releaseLoad.resolve();
    await Promise.all([firstOpen, reopened]);
    assert.deepEqual(h.snapshots, [1]);
    assert.equal(h.view.indexSidebarDataReady, true);
    assert.equal(h.view.indexSidebarInitialLoad, null);
});

test("normal note interactions do not wait for an unrelated Index load", async () => {
    const h = createStartupHarness();
    const initial = h.render();
    await h.loadStarted.promise;
    h.view.file = { path: "other.md" };
    h.view.renderPageSidebar = async () => {};
    let focused = false;
    const interaction = h.view.renderCommentsForInteraction({ skipDataRefresh: true }).then(() => { focused = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const focusedBeforeIndexReady = focused;
    h.releaseLoad.resolve();
    await Promise.all([initial, interaction]);
    assert.equal(focusedBeforeIndexReady, true);
});

test("new Index sidebars default to List", () => {
    const mode = viewClass.members.find((node) => node.name?.getText(source) === "indexSidebarMode");
    assert.ok(mode && ts.isPropertyDeclaration(mode));
    assert.equal(mode.initializer?.getText(source), '"list"');
});

test("Todo shows loading feedback immediately while the first data load is pending", async () => {
    const h = createStartupHarness();
    const initial = h.render();
    await h.loadStarted.promise;
    await h.render({ skipDataRefresh: true });
    const modesWhileLoading = h.loadingModes.slice();
    h.releaseLoad.resolve();
    await initial;
    assert.deepEqual(modesWhileLoading, ["todo", "todo"]);
    assert.deepEqual(h.snapshots, [1]);
});

test("sidebar readiness does not wait for derived Index note maintenance", async () => {
    const h = createStartupHarness();
    const releaseMaintenance = deferred();
    h.controller.refreshAggregateNoteNow = async () => { await releaseMaintenance.promise; };
    h.releaseLoad.resolve();
    const initial = h.render();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const readyBeforeMaintenance = h.view.indexSidebarDataReady;
    releaseMaintenance.resolve();
    await initial;
    assert.equal(readyBeforeMaintenance, true);
    assert.deepEqual(h.snapshots, [1]);
    assert.equal(h.counts.scheduledRefreshes, 1);
});
