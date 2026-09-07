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

function createHarness(options: {
    layoutReady?: boolean;
    handleFileCreate?: (file: TFile | null) => void | Promise<void>;
    handleFileRename?: (file: TFile | null, oldPath: string) => void | Promise<void>;
    handleFileDelete?: (file: TAbstractFile | null) => void | Promise<void>;
} = {}) {
    const calls: string[] = [];
    const registeredEvents: EventRef[] = [];
    const workspaceHandlers = new Map<WorkspaceEventName, (...args: any[]) => void>();
    const vaultHandlers = new Map<VaultEventName, (...args: any[]) => void>();
    const vaultRegistrationCounts = new Map<VaultEventName, number>();
    const metadataCacheHandlers = new Map<MetadataCacheEventName, (...args: any[]) => void>();
    let layoutReadyHandler: (() => void | Promise<void>) | null = null;

    const router = new PluginEventRouter({
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
        registerEvent: (eventRef) => {
            registeredEvents.push(eventRef);
        },
        isTFile: (value): value is TFile => !!value
            && typeof (value as TFile).path === "string"
            && typeof (value as TFile).extension === "string",
        handleLayoutReady: async () => {
            calls.push("layout-ready");
        },
        handleFileOpen: (file) => {
            calls.push(`file-open:${file?.path ?? "null"}`);
        },
        handleActiveLeafChange: (leaf) => {
            calls.push(`active-leaf-change:${leaf ? "leaf" : "null"}`);
        },
        handleFileCreate: async (file) => {
            calls.push(`create:${file?.path ?? "null"}`);
            await options.handleFileCreate?.(file);
        },
        handleFileRename: async (file, oldPath) => {
            calls.push(`rename:${oldPath}->${file?.path ?? "null"}`);
            await options.handleFileRename?.(file, oldPath);
        },
        handleFileDelete: async (file) => {
            calls.push(`delete:${file?.path ?? "null"}`);
            await options.handleFileDelete?.(file);
        },
        handleFileModify: async (file) => {
            calls.push(`modify:${file?.path ?? "null"}`);
        },
        handleMetadataResolved: async () => {
            calls.push("metadata-resolved");
        },
        handleEditorChange: (filePath) => {
            calls.push(`editor-change:${filePath ?? "null"}`);
        },
    });

    return {
        calls,
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
    await Promise.resolve();
    assert.deepEqual(harness.calls, ["create:docs/early.md", "create:null"]);

    await harness.router.register();

    assert.deepEqual(
        Array.from(harness.vaultHandlers.keys()),
        ["create", "rename", "delete", "modify"],
    );
    assert.equal(harness.vaultRegistrationCounts.get("create"), 1);
    assert.equal(harness.vaultRegistrationCounts.get("rename"), 1);
    assert.equal(harness.vaultRegistrationCounts.get("delete"), 1);
    assert.equal(harness.registeredEvents.length, 8);
});

test("early vault maintenance keeps rename migration evidence and final script actionability live", async () => {
    const registry = new VaultScriptRegistry();
    registry.seed(["drafts/clean.mjs"]);
    const harness = createHarness({
        handleFileRename: (file, oldPath) => {
            if (file) {
                registry.rename(oldPath, file.path);
            }
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

    await harness.vaultHandlers.get("rename")?.(
        createFile("🛠️ scripts/clean.mjs"),
        "drafts/clean.mjs",
    );
    loadedData.resolve({});
    await delayedSettingsLoad;

    assert.equal(persistedScriptsEnabled, true);
    assert.equal(registry.isRunnableMention("/clean"), true);
    assert.equal(registry.resolve("/clean")?.path, "🛠️ scripts/clean.mjs");
});

test("early vault maintenance keeps delete migration evidence and final script actionability live", async () => {
    const scriptPath = "🛠️ scripts/clean.mjs";
    const registry = new VaultScriptRegistry();
    registry.seed([scriptPath]);
    const harness = createHarness({
        handleFileDelete: (file) => {
            if (file) {
                registry.remove(file.path);
            }
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

    await harness.vaultHandlers.get("delete")?.(createFile(scriptPath));
    loadedData.resolve({});
    await delayedSettingsLoad;

    assert.equal(persistedScriptsEnabled, false);
    assert.equal(registry.isRunnableMention("/clean"), false);
    assert.deepEqual(registry.getRunnableScripts(), []);
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
    await Promise.resolve();

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
    await Promise.resolve();

    assert.deepEqual(harness.calls, ["delete:Deleted"]);
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
