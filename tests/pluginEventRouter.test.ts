import * as assert from "node:assert/strict";
import test from "node:test";
import type { EventRef, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { PluginEventRouter } from "../src/app/pluginEventRouter";
import { resolveLoadedSettings } from "../src/settings/indexNoteSettingsPlanner";
import type { AsideSettings } from "../src/ui/settings/AsideSetting";
import { VaultScriptRegistry } from "../src/vaultScripts/vaultScriptRegistry";

type WorkspaceEventName = "file-open" | "active-leaf-change" | "editor-change";
type VaultEventName = "create" | "rename" | "delete" | "modify";
type MetadataCacheEventName = "resolved";

function createFile(path: string): TFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
        extension: path.split(".").pop() ?? "",
    } as TFile;
}

function createFolder(path: string): TAbstractFile {
    return {
        path,
        name: path.split("/").pop() ?? path,
    } as TAbstractFile;
}

function createDeferred<T>() {
    let resolve = (_value: T) => {};
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

async function settleAsyncDispatch(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

function createHarness(options: {
    layoutReady?: boolean;
    handleFileCreate?: (file: TFile | null) => void | Promise<void>;
    handleFileRename?: (file: TAbstractFile | null, oldPath: string) => void | Promise<void>;
    handleFileDelete?: (file: TAbstractFile | null) => void | Promise<void>;
    handleFileCreateMaintenance?: (file: TFile | null) => void;
    handleFileRenameMaintenance?: (file: TAbstractFile | null, oldPath: string) => void;
    handleFileDeleteMaintenance?: (file: TAbstractFile | null) => void;
} = {}) {
    const calls: string[] = [];
    const maintenanceCalls: string[] = [];
    const reportedErrors: Array<{ eventName: string; error: unknown }> = [];
    const registeredEvents: EventRef[] = [];
    const workspaceHandlers = new Map<WorkspaceEventName, (...args: any[]) => void>();
    const vaultHandlers = new Map<VaultEventName, (...args: any[]) => void>();
    const vaultRegistrationCounts = new Map<VaultEventName, number>();
    const metadataCacheHandlers = new Map<MetadataCacheEventName, (...args: any[]) => void>();
    let layoutReadyHandler: (() => void | Promise<void>) | null = null;

    const routerHost = {
        app: {
            workspace: {
                layoutReady: options.layoutReady ?? false,
                on(
                    eventName: WorkspaceEventName,
                    handler:
                        | ((file: TFile | null) => void)
                        | ((leaf: WorkspaceLeaf | null) => void)
                        | ((editor: unknown, info?: { file?: TFile | null }) => void),
                ): EventRef {
                    workspaceHandlers.set(eventName, handler);
                    return { name: `workspace:${eventName}` } as unknown as EventRef;
                },
                onLayoutReady(handler: () => void | Promise<void>): void {
                    layoutReadyHandler = handler;
                },
            },
            vault: {
                on(
                    eventName: VaultEventName,
                    handler:
                        | ((file: unknown, oldPath: string) => void | Promise<void>)
                        | ((file: unknown) => void | Promise<void>),
                ): EventRef {
                    vaultHandlers.set(eventName, handler);
                    vaultRegistrationCounts.set(eventName, (vaultRegistrationCounts.get(eventName) ?? 0) + 1);
                    return { name: `vault:${eventName}` } as unknown as EventRef;
                },
            },
            metadataCache: {
                on(eventName: MetadataCacheEventName, handler: () => void | Promise<void>): EventRef {
                    metadataCacheHandlers.set(eventName, handler);
                    return { name: `metadata-cache:${eventName}` } as unknown as EventRef;
                },
            },
        },
        registerEvent: (eventRef: EventRef) => {
            registeredEvents.push(eventRef);
        },
        isTFile: (value: unknown): value is TFile => !!value
            && typeof (value as TFile).path === "string"
            && typeof (value as TFile).extension === "string",
        handleFileCreateMaintenance: (file: TFile | null) => {
            maintenanceCalls.push(`create:${file?.path ?? "null"}`);
            options.handleFileCreateMaintenance?.(file);
        },
        handleFileRenameMaintenance: (file: TAbstractFile | null, oldPath: string) => {
            maintenanceCalls.push(`rename:${oldPath}->${file?.path ?? "null"}`);
            options.handleFileRenameMaintenance?.(file, oldPath);
        },
        handleFileDeleteMaintenance: (file: TAbstractFile | null) => {
            maintenanceCalls.push(`delete:${file?.path ?? "null"}`);
            options.handleFileDeleteMaintenance?.(file);
        },
        handleLayoutReady: async () => {
            calls.push("layout-ready");
        },
        handleFileOpen: (file: TFile | null) => {
            calls.push(`file-open:${file?.path ?? "null"}`);
        },
        handleActiveLeafChange: (leaf: WorkspaceLeaf | null) => {
            calls.push(`active-leaf-change:${leaf ? "leaf" : "null"}`);
        },
        handleFileCreate: async (file: TFile | null) => {
            calls.push(`create:${file?.path ?? "null"}`);
            await options.handleFileCreate?.(file);
        },
        handleFileRename: async (file: TAbstractFile | null, oldPath: string) => {
            calls.push(`rename:${oldPath}->${file?.path ?? "null"}`);
            await options.handleFileRename?.(file, oldPath);
        },
        handleFileDelete: async (file: TAbstractFile | null) => {
            calls.push(`delete:${file?.path ?? "null"}`);
            await options.handleFileDelete?.(file);
        },
        handleFileModify: async (file: TFile | null) => {
            calls.push(`modify:${file?.path ?? "null"}`);
        },
        handleMetadataResolved: async () => {
            calls.push("metadata-resolved");
        },
        handleEditorChange: (filePath: string | null | undefined) => {
            calls.push(`editor-change:${filePath ?? "null"}`);
        },
        reportAsyncEventError: (eventName: string, error: unknown) => {
            reportedErrors.push({ eventName, error });
        },
    };
    const router = new PluginEventRouter(routerHost);

    return {
        calls,
        maintenanceCalls,
        reportedErrors,
        registeredEvents,
        router,
        workspaceHandlers,
        vaultHandlers,
        vaultRegistrationCounts,
        metadataCacheHandlers,
        getLayoutReadyHandler: () => layoutReadyHandler,
    };
}

test("plugin event router registers vault maintenance early once and reuses it during full registration", async () => {
    const harness = createHarness();
    const note = createFile("docs/early.md");

    harness.router.registerVaultMaintenanceEvents();
    harness.router.registerVaultMaintenanceEvents();

    assert.deepEqual(Array.from(harness.vaultHandlers.keys()), ["create", "rename", "delete"]);
    assert.equal(harness.vaultRegistrationCounts.get("create"), 1);
    assert.equal(harness.vaultRegistrationCounts.get("rename"), 1);
    assert.equal(harness.vaultRegistrationCounts.get("delete"), 1);
    assert.equal(harness.registeredEvents.length, 3);

    harness.vaultHandlers.get("create")?.(note);
    harness.vaultHandlers.get("create")?.(createFolder("Assets"));
    assert.deepEqual(harness.maintenanceCalls, ["create:docs/early.md", "create:null"]);
    assert.deepEqual(harness.calls, []);

    await harness.router.register();

    assert.deepEqual(harness.calls, ["create:docs/early.md", "create:null"]);

    assert.deepEqual(
        Array.from(harness.vaultHandlers.keys()),
        ["create", "rename", "delete", "modify"],
    );
    assert.equal(harness.vaultRegistrationCounts.get("create"), 1);
    assert.equal(harness.vaultRegistrationCounts.get("rename"), 1);
    assert.equal(harness.vaultRegistrationCounts.get("delete"), 1);
    assert.equal(harness.registeredEvents.length, 8);
});

test("delayed startup file rename updates registry evidence immediately and replays path effects once", async () => {
    const registry = new VaultScriptRegistry();
    registry.seed(["drafts/clean.mjs"]);
    let currentPaths = ["drafts/clean.mjs"];
    const retargetedPaths: string[] = [];
    const harness = createHarness({
        handleFileRenameMaintenance: () => {
            registry.seed(currentPaths);
        },
        handleFileRename: (file, oldPath) => {
            retargetedPaths.push(`${oldPath}->${file?.path ?? "null"}`);
        },
    });
    harness.router.registerVaultMaintenanceEvents();
    const loadedData = createDeferred<Record<string, unknown>>();
    let persistedScriptsEnabled: boolean | undefined;
    const delayedSettingsLoad = (async () => {
        const loaded = await loadedData.promise;
        const resolved = resolveLoadedSettings(
            loaded,
            {} as AsideSettings,
            { hasRegisteredVaultScripts: registry.getRunnableScripts().length > 0 },
        );
        persistedScriptsEnabled = resolved.settings.scriptsEnabled;
    })();

    currentPaths = ["🛠️ scripts/clean.mjs"];
    harness.vaultHandlers.get("rename")?.(
        createFile("🛠️ scripts/clean.mjs"),
        "drafts/clean.mjs",
    );
    assert.equal(registry.resolve("/clean")?.path, "🛠️ scripts/clean.mjs");
    assert.deepEqual(retargetedPaths, []);

    loadedData.resolve({});
    await delayedSettingsLoad;
    await harness.router.register();

    assert.equal(persistedScriptsEnabled, true);
    assert.equal(registry.isRunnableMention("/clean"), true);
    assert.equal(registry.resolve("/clean")?.path, "🛠️ scripts/clean.mjs");
    assert.deepEqual(retargetedPaths, ["drafts/clean.mjs->🛠️ scripts/clean.mjs"]);
});

test("delayed startup folder rename reseeds registry immediately and replays the folder retarget once", async () => {
    const registry = new VaultScriptRegistry();
    registry.seed(["Draft scripts/clean.mjs", "Draft scripts/tidy.js"]);
    let currentPaths = ["Draft scripts/clean.mjs", "Draft scripts/tidy.js"];
    const retargetedPaths: string[] = [];
    const harness = createHarness({
        handleFileRenameMaintenance: () => {
            registry.seed(currentPaths);
        },
        handleFileRename: (file, oldPath) => {
            retargetedPaths.push(`${oldPath}->${file?.path ?? "null"}`);
        },
    });
    harness.router.registerVaultMaintenanceEvents();

    currentPaths = ["🛠️ scripts/clean.mjs", "🛠️ scripts/tidy.js"];
    harness.vaultHandlers.get("rename")?.(
        createFolder("🛠️ scripts"),
        "Draft scripts",
    );

    assert.equal(registry.resolve("/clean")?.path, "🛠️ scripts/clean.mjs");
    assert.equal(registry.resolve("/tidy")?.path, "🛠️ scripts/tidy.js");
    assert.deepEqual(retargetedPaths, []);

    await harness.router.register();

    assert.deepEqual(retargetedPaths, ["Draft scripts->🛠️ scripts"]);
});

test("delayed startup file delete updates registry evidence immediately and replays cleanup once", async () => {
    const scriptPath = "🛠️ scripts/clean.mjs";
    const registry = new VaultScriptRegistry();
    registry.seed([scriptPath]);
    let currentPaths = [scriptPath];
    const cleanedPaths: string[] = [];
    const harness = createHarness({
        handleFileDeleteMaintenance: () => {
            registry.seed(currentPaths);
        },
        handleFileDelete: (file) => {
            cleanedPaths.push(file?.path ?? "null");
        },
    });
    harness.router.registerVaultMaintenanceEvents();
    const loadedData = createDeferred<Record<string, unknown>>();
    let persistedScriptsEnabled: boolean | undefined;
    const delayedSettingsLoad = (async () => {
        const loaded = await loadedData.promise;
        const resolved = resolveLoadedSettings(
            loaded,
            {} as AsideSettings,
            { hasRegisteredVaultScripts: registry.getRunnableScripts().length > 0 },
        );
        persistedScriptsEnabled = resolved.settings.scriptsEnabled;
    })();

    currentPaths = [];
    harness.vaultHandlers.get("delete")?.(createFile(scriptPath));
    assert.equal(registry.isRunnableMention("/clean"), false);
    assert.deepEqual(cleanedPaths, []);

    loadedData.resolve({});
    await delayedSettingsLoad;
    await harness.router.register();

    assert.equal(persistedScriptsEnabled, false);
    assert.equal(registry.isRunnableMention("/clean"), false);
    assert.deepEqual(registry.getRunnableScripts(), []);
    assert.deepEqual(cleanedPaths, [scriptPath]);
});

test("delayed startup folder delete reseeds registry immediately and replays folder cleanup once", async () => {
    const registry = new VaultScriptRegistry();
    registry.seed(["🛠️ scripts/clean.mjs", "🛠️ scripts/tidy.js"]);
    let currentPaths = ["🛠️ scripts/clean.mjs", "🛠️ scripts/tidy.js"];
    const cleanedPaths: string[] = [];
    const harness = createHarness({
        handleFileDeleteMaintenance: () => {
            registry.seed(currentPaths);
        },
        handleFileDelete: (file) => {
            cleanedPaths.push(file?.path ?? "null");
        },
    });
    harness.router.registerVaultMaintenanceEvents();

    currentPaths = [];
    harness.vaultHandlers.get("delete")?.(createFolder("🛠️ scripts"));

    assert.deepEqual(registry.getRunnableScripts(), []);
    assert.deepEqual(cleanedPaths, []);

    await harness.router.register();

    assert.deepEqual(cleanedPaths, ["🛠️ scripts"]);
});

test("plugin event router exposes Obsidian event flow in one module", async () => {
    const harness = createHarness();
    const note = createFile("docs/a.md");

    await harness.router.register();

    assert.deepEqual(
        Array.from(harness.workspaceHandlers.keys()),
        ["file-open", "active-leaf-change", "editor-change"],
    );
    assert.deepEqual(
        Array.from(harness.vaultHandlers.keys()),
        ["create", "rename", "delete", "modify"],
    );
    assert.deepEqual(Array.from(harness.metadataCacheHandlers.keys()), ["resolved"]);
    assert.equal(harness.registeredEvents.length, 8);

    harness.workspaceHandlers.get("file-open")?.(note);
    harness.workspaceHandlers.get("active-leaf-change")?.({} as WorkspaceLeaf);
    harness.workspaceHandlers.get("editor-change")?.({}, { file: note });
    harness.vaultHandlers.get("create")?.(note);
    harness.vaultHandlers.get("create")?.(createFolder("Assets"));
    harness.vaultHandlers.get("rename")?.(note, "docs/old.md");
    harness.vaultHandlers.get("delete")?.(note);
    harness.vaultHandlers.get("modify")?.(note);
    harness.metadataCacheHandlers.get("resolved")?.();
    await settleAsyncDispatch();

    assert.deepEqual(harness.maintenanceCalls, [
        "create:docs/a.md",
        "create:null",
        "rename:docs/old.md->docs/a.md",
        "delete:docs/a.md",
    ]);

    assert.deepEqual(harness.calls, [
        "file-open:docs/a.md",
        "active-leaf-change:leaf",
        "editor-change:docs/a.md",
        "create:docs/a.md",
        "create:null",
        "rename:docs/old.md->docs/a.md",
        "delete:docs/a.md",
        "modify:docs/a.md",
        "metadata-resolved",
    ]);
});

test("plugin event router preserves deleted folder paths", async () => {
    const harness = createHarness();
    const folder = createFolder("Deleted");

    await harness.router.register();
    harness.vaultHandlers.get("delete")?.(folder);
    await settleAsyncDispatch();

    assert.deepEqual(harness.calls, ["delete:Deleted"]);
});

test("plugin event router drains startup events in order without losing an event fired during replay", async () => {
    const firstRenameStarted = createDeferred<void>();
    const releaseFirstRename = createDeferred<void>();
    const replayedPaths: string[] = [];
    const harness = createHarness({
        handleFileRename: async (file, oldPath) => {
            replayedPaths.push(`${oldPath}->${file?.path ?? "null"}`);
            if (oldPath === "docs/one.md") {
                firstRenameStarted.resolve(undefined);
                await releaseFirstRename.promise;
            }
        },
    });
    harness.router.registerVaultMaintenanceEvents();
    harness.vaultHandlers.get("rename")?.(createFile("docs/two.md"), "docs/one.md");

    const registration = harness.router.register();
    await firstRenameStarted.promise;
    harness.vaultHandlers.get("delete")?.(createFile("docs/two.md"));

    assert.deepEqual(harness.maintenanceCalls, [
        "rename:docs/one.md->docs/two.md",
        "delete:docs/two.md",
    ]);
    assert.deepEqual(replayedPaths, ["docs/one.md->docs/two.md"]);

    releaseFirstRename.resolve(undefined);
    await registration;

    assert.deepEqual(harness.calls, [
        "rename:docs/one.md->docs/two.md",
        "delete:docs/two.md",
    ]);
    assert.deepEqual(replayedPaths, ["docs/one.md->docs/two.md"]);

    harness.vaultHandlers.get("create")?.(createFile("docs/live.md"));
    await settleAsyncDispatch();
    assert.deepEqual(harness.calls, [
        "rename:docs/one.md->docs/two.md",
        "delete:docs/two.md",
        "create:docs/live.md",
    ]);
});

test("plugin event router snapshots mutable Obsidian file paths for ordered startup replay", async () => {
    const harness = createHarness();
    const renamedFile = createFile("docs/one.md");
    harness.router.registerVaultMaintenanceEvents();

    harness.vaultHandlers.get("rename")?.(renamedFile, "docs/original.md");
    renamedFile.path = "docs/two.md";
    harness.vaultHandlers.get("rename")?.(renamedFile, "docs/one.md");

    await harness.router.register();

    assert.deepEqual(harness.calls.slice(0, 2), [
        "rename:docs/original.md->docs/one.md",
        "rename:docs/one.md->docs/two.md",
    ]);
});

test("plugin event router catches and reports rejected void-delivered async vault handlers", async () => {
    const rejection = new Error("rename failed");
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (error: unknown) => {
        unhandledRejections.push(error);
    };
    process.on("unhandledRejection", onUnhandledRejection);
    try {
        const harness = createHarness({
            handleFileRename: async () => {
                throw rejection;
            },
        });
        await harness.router.register();

        const callbackResult = harness.vaultHandlers.get("rename")?.(
            createFile("docs/renamed.md"),
            "docs/original.md",
        );
        assert.equal(callbackResult, undefined, "Obsidian event callbacks should remain void-delivered");
        await settleAsyncDispatch();

        assert.deepEqual(harness.reportedErrors, [{
            eventName: "vault:rename",
            error: rejection,
        }]);
        assert.deepEqual(unhandledRejections, []);
    } finally {
        process.off("unhandledRejection", onUnhandledRejection);
    }
});

test("plugin event router preserves immediate and deferred layout-ready handling", async () => {
    const readyHarness = createHarness({ layoutReady: true });
    await readyHarness.router.register();
    assert.deepEqual(readyHarness.calls, ["layout-ready"]);
    assert.equal(readyHarness.getLayoutReadyHandler(), null);

    const deferredHarness = createHarness({ layoutReady: false });
    await deferredHarness.router.register();
    assert.deepEqual(deferredHarness.calls, []);
    await deferredHarness.getLayoutReadyHandler()?.();
    assert.deepEqual(deferredHarness.calls, ["layout-ready"]);
});
