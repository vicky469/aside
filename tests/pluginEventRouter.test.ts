import * as assert from "node:assert/strict";
import test from "node:test";
import type { EventRef, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { PluginEventRouter } from "../src/app/pluginEventRouter";
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

function createFolder(path: string, children: TAbstractFile[] = []): TAbstractFile {
    return {
        path,
        name: path.split("/").pop() ?? path,
        children,
    } as unknown as TAbstractFile;
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
    handleLayoutReady?: () => void | Promise<void>;
    handleFileRenameMaintenance?: (file: TFile | null, oldPath: string) => void;
    handleFileDeleteMaintenance?: (file: TAbstractFile | null) => void;
    handleFileRename?: (file: TFile | null, oldPath: string) => void | Promise<void>;
    handleFileDelete?: (file: TAbstractFile | null) => void | Promise<void>;
} = {}) {
    const calls: string[] = [];
    const maintenanceCalls: string[] = [];
    const reportedErrors: Array<{ eventName: string; error: unknown }> = [];
    const registeredEvents: EventRef[] = [];
    const workspaceHandlers = new Map<WorkspaceEventName, (...args: any[]) => void>();
    const workspaceRegistrationCounts = new Map<WorkspaceEventName, number>();
    const vaultHandlers = new Map<VaultEventName, (...args: any[]) => void>();
    const vaultRegistrationCounts = new Map<VaultEventName, number>();
    const metadataCacheHandlers = new Map<MetadataCacheEventName, (...args: any[]) => void>();
    const metadataCacheRegistrationCounts = new Map<MetadataCacheEventName, number>();
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
                    workspaceRegistrationCounts.set(
                        eventName,
                        (workspaceRegistrationCounts.get(eventName) ?? 0) + 1,
                    );
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
                    metadataCacheRegistrationCounts.set(
                        eventName,
                        (metadataCacheRegistrationCounts.get(eventName) ?? 0) + 1,
                    );
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
        handleFileRenameMaintenance: (file, oldPath) => {
            maintenanceCalls.push(`rename:${oldPath}->${file?.path ?? "null"}`);
            options.handleFileRenameMaintenance?.(file, oldPath);
        },
        handleFileDeleteMaintenance: (file) => {
            maintenanceCalls.push(`delete:${file?.path ?? "null"}`);
            options.handleFileDeleteMaintenance?.(file);
        },
        handleLayoutReady: async () => {
            calls.push("layout-ready");
            await options.handleLayoutReady?.();
        },
        handleFileOpen: (file) => {
            calls.push(`file-open:${file?.path ?? "null"}`);
        },
        handleActiveLeafChange: (leaf) => {
            calls.push(`active-leaf-change:${leaf ? "leaf" : "null"}`);
        },
        handleFileCreate: async (file) => {
            calls.push(`create:${file?.path ?? "null"}`);
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
        reportAsyncEventError: (eventName, error) => {
            reportedErrors.push({ eventName, error });
        },
    });

    return {
        calls,
        maintenanceCalls,
        reportedErrors,
        registeredEvents,
        router,
        workspaceHandlers,
        workspaceRegistrationCounts,
        vaultHandlers,
        vaultRegistrationCounts,
        metadataCacheHandlers,
        metadataCacheRegistrationCounts,
        getLayoutReadyHandler: () => layoutReadyHandler,
    };
}

test("startup rename and delete update maintenance immediately and replay once in order", async () => {
    const registry = new VaultScriptRegistry();
    registry.seed(["drafts/clean.mjs"]);
    let currentVaultPaths = ["drafts/clean.mjs"];
    const refreshRegistry = () => {
        registry.seed(currentVaultPaths);
    };
    const harness = createHarness({
        handleFileRenameMaintenance: refreshRegistry,
        handleFileDeleteMaintenance: refreshRegistry,
    });
    const script = createFile("🛠️ scripts/clean.mjs");

    harness.router.registerVaultStartupEvents();
    currentVaultPaths = [script.path];
    harness.vaultHandlers.get("rename")?.(script, "drafts/clean.mjs");
    assert.equal(registry.resolve("/clean")?.path, script.path);

    currentVaultPaths = [];
    harness.vaultHandlers.get("delete")?.(script);
    assert.equal(registry.isRunnableMention("/clean"), false);

    assert.deepEqual(harness.maintenanceCalls, [
        "rename:drafts/clean.mjs->🛠️ scripts/clean.mjs",
        "delete:🛠️ scripts/clean.mjs",
    ]);
    assert.deepEqual(harness.calls, []);

    await harness.router.register();

    assert.deepEqual(harness.calls, [
        "rename:drafts/clean.mjs->🛠️ scripts/clean.mjs",
        "delete:🛠️ scripts/clean.mjs",
    ]);
});

test("a delete observed while startup replay is draining is handled once after the earlier rename", async () => {
    const renameHandled = createDeferred<void>();
    const harness = createHarness({
        handleFileRename: () => renameHandled.promise,
    });

    harness.router.registerVaultStartupEvents();
    harness.vaultHandlers.get("rename")?.(createFile("docs/renamed.md"), "docs/original.md");
    const registration = harness.router.register();

    assert.deepEqual(harness.calls, ["rename:docs/original.md->docs/renamed.md"]);
    harness.vaultHandlers.get("delete")?.(createFile("docs/deleted.md"));
    assert.deepEqual(harness.maintenanceCalls, [
        "rename:docs/original.md->docs/renamed.md",
        "delete:docs/deleted.md",
    ]);
    assert.deepEqual(harness.calls, ["rename:docs/original.md->docs/renamed.md"]);

    renameHandled.resolve();
    await registration;

    assert.deepEqual(harness.calls, [
        "rename:docs/original.md->docs/renamed.md",
        "delete:docs/deleted.md",
    ]);
});

test("a live rename starts its existing lifecycle handler immediately", async () => {
    const harness = createHarness();
    await harness.router.register();

    harness.vaultHandlers.get("rename")?.(createFile("docs/live.md"), "docs/old.md");

    assert.deepEqual(harness.maintenanceCalls, []);
    assert.deepEqual(harness.calls, ["rename:docs/old.md->docs/live.md"]);
});

test("startup delete replay preserves a removed folder and its descendant paths", async () => {
    const replayedFiles: Array<TAbstractFile | null> = [];
    const harness = createHarness({
        handleFileDelete: (file) => {
            replayedFiles.push(file);
        },
    });
    const child = createFile("Deleted/Nested/note.md");
    const nested = createFolder("Deleted/Nested", [child]);
    const folder = createFolder("Deleted", [nested]);

    harness.router.registerVaultStartupEvents();
    harness.vaultHandlers.get("delete")?.(folder);
    folder.path = "";
    nested.path = "";
    child.path = "";
    (folder as unknown as { children: TAbstractFile[] }).children.length = 0;

    await harness.router.register();

    const replayedFolder = replayedFiles[0] as TAbstractFile & { children?: TAbstractFile[] };
    const replayedNested = replayedFolder.children?.[0] as TAbstractFile & { children?: TAbstractFile[] };
    assert.equal(replayedFolder.path, "Deleted");
    assert.equal(replayedNested.path, "Deleted/Nested");
    assert.equal(replayedNested.children?.[0]?.path, "Deleted/Nested/note.md");
});

test("startup rename preserves existing TFile filtering", async () => {
    const harness = createHarness();

    harness.router.registerVaultStartupEvents();
    harness.vaultHandlers.get("rename")?.(createFolder("Renamed"), "Original");

    assert.deepEqual(harness.maintenanceCalls, ["rename:Original->null"]);
    assert.deepEqual(harness.calls, []);

    await harness.router.register();

    assert.deepEqual(harness.calls, ["rename:Original->null"]);
});

test("startup replay snapshots a mutable file at each rename", async () => {
    const harness = createHarness();
    const file = createFile("docs/one.md");

    harness.router.registerVaultStartupEvents();
    harness.vaultHandlers.get("rename")?.(file, "docs/original.md");
    file.path = "docs/two.md";
    harness.vaultHandlers.get("rename")?.(file, "docs/one.md");
    file.path = "docs/three.md";

    await harness.router.register();

    assert.deepEqual(harness.calls, [
        "rename:docs/original.md->docs/one.md",
        "rename:docs/one.md->docs/two.md",
    ]);
});

test("a rejected live vault handler is reported without an unhandled rejection", async () => {
    const failure = new Error("rename failed");
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (error: unknown) => {
        unhandledRejections.push(error);
    };
    process.on("unhandledRejection", onUnhandledRejection);
    try {
        const harness = createHarness({
            handleFileRename: async () => {
                throw failure;
            },
        });
        await harness.router.register();

        const callbackResult = harness.vaultHandlers.get("rename")?.(
            createFile("docs/renamed.md"),
            "docs/original.md",
        );
        assert.equal(callbackResult, undefined);
        await new Promise<void>((resolve) => setImmediate(resolve));

        assert.deepEqual(harness.reportedErrors, [{
            eventName: "vault:rename",
            error: failure,
        }]);
        assert.deepEqual(unhandledRejections, []);
    } finally {
        process.off("unhandledRejection", onUnhandledRejection);
    }
});

test("startup replay reports a rejected event and continues draining in order", async () => {
    const failure = new Error("rename failed");
    const harness = createHarness({
        handleFileRename: async () => {
            throw failure;
        },
    });

    harness.router.registerVaultStartupEvents();
    harness.vaultHandlers.get("rename")?.(createFile("docs/renamed.md"), "docs/original.md");
    harness.vaultHandlers.get("delete")?.(createFile("docs/deleted.md"));

    await harness.router.register();

    assert.deepEqual(harness.calls, [
        "rename:docs/original.md->docs/renamed.md",
        "delete:docs/deleted.md",
    ]);
    assert.deepEqual(harness.reportedErrors, [{
        eventName: "vault:rename",
        error: failure,
    }]);
});

test("plugin event router registers startup listeners once and adds modify before layout readiness", async () => {
    const layoutReady = createDeferred<void>();
    const harness = createHarness({
        layoutReady: true,
        handleLayoutReady: () => layoutReady.promise,
    });
    const note = createFile("docs/early.md");

    harness.router.registerVaultStartupEvents();
    harness.router.registerVaultStartupEvents();

    assert.deepEqual(Array.from(harness.vaultHandlers.keys()), ["create", "rename", "delete"]);
    assert.equal(harness.vaultRegistrationCounts.get("create"), 1);
    assert.equal(harness.vaultRegistrationCounts.get("rename"), 1);
    assert.equal(harness.vaultRegistrationCounts.get("delete"), 1);
    assert.equal(harness.registeredEvents.length, 3);

    harness.vaultHandlers.get("create")?.(note);
    harness.vaultHandlers.get("create")?.(createFolder("Assets"));
    await Promise.resolve();
    assert.deepEqual(harness.calls, ["create:docs/early.md", "create:null"]);

    const firstRegistration = harness.router.register();
    const secondRegistration = harness.router.register();
    assert.equal(secondRegistration, firstRegistration);

    assert.deepEqual(
        Array.from(harness.vaultHandlers.keys()),
        ["create", "rename", "delete", "modify"],
    );
    assert.equal(harness.vaultRegistrationCounts.get("create"), 1);
    assert.equal(harness.vaultRegistrationCounts.get("rename"), 1);
    assert.equal(harness.vaultRegistrationCounts.get("delete"), 1);
    assert.equal(harness.vaultRegistrationCounts.get("modify"), 1);

    layoutReady.resolve();
    await Promise.all([firstRegistration, secondRegistration]);

    assert.equal(harness.registeredEvents.length, 8);
    assert.equal(harness.workspaceRegistrationCounts.get("file-open"), 1);
    assert.equal(harness.workspaceRegistrationCounts.get("active-leaf-change"), 1);
    assert.equal(harness.workspaceRegistrationCounts.get("editor-change"), 1);
    assert.equal(harness.metadataCacheRegistrationCounts.get("resolved"), 1);
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
