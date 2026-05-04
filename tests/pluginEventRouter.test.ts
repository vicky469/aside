import * as assert from "node:assert/strict";
import test from "node:test";
import type { EventRef, TFile, WorkspaceLeaf } from "obsidian";
import { PluginEventRouter } from "../src/app/pluginEventRouter";

type WorkspaceEventName = "file-open" | "active-leaf-change" | "editor-change";
type VaultEventName = "rename" | "delete" | "modify";

function createFile(path: string): TFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
        extension: path.split(".").pop() ?? "",
    } as TFile;
}

function createHarness(options: { layoutReady?: boolean } = {}) {
    const calls: string[] = [];
    const registeredEvents: EventRef[] = [];
    const workspaceHandlers = new Map<WorkspaceEventName, (...args: any[]) => void>();
    const vaultHandlers = new Map<VaultEventName, (...args: any[]) => void>();
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
                    return { name: `vault:${eventName}` } as unknown as EventRef;
                },
            },
        },
        registerEvent: (eventRef) => {
            registeredEvents.push(eventRef);
        },
        isTFile: (value): value is TFile => !!value && typeof (value as TFile).path === "string",
        handleLayoutReady: async () => {
            calls.push("layout-ready");
        },
        handleFileOpen: (file) => {
            calls.push(`file-open:${file?.path ?? "null"}`);
        },
        handleActiveLeafChange: (leaf) => {
            calls.push(`active-leaf-change:${leaf ? "leaf" : "null"}`);
        },
        handleFileRename: async (file, oldPath) => {
            calls.push(`rename:${oldPath}->${file?.path ?? "null"}`);
        },
        handleFileDelete: async (file) => {
            calls.push(`delete:${file?.path ?? "null"}`);
        },
        handleFileModify: async (file) => {
            calls.push(`modify:${file?.path ?? "null"}`);
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
        getLayoutReadyHandler: () => layoutReadyHandler,
    };
}

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
        ["rename", "delete", "modify"],
    );
    assert.equal(harness.registeredEvents.length, 6);

    harness.workspaceHandlers.get("file-open")?.(note);
    harness.workspaceHandlers.get("active-leaf-change")?.({} as WorkspaceLeaf);
    harness.workspaceHandlers.get("editor-change")?.({}, { file: note });
    harness.vaultHandlers.get("rename")?.(note, "docs/old.md");
    harness.vaultHandlers.get("delete")?.(note);
    harness.vaultHandlers.get("modify")?.(note);
    await Promise.resolve();

    assert.deepEqual(harness.calls, [
        "file-open:docs/a.md",
        "active-leaf-change:leaf",
        "editor-change:docs/a.md",
        "rename:docs/old.md->docs/a.md",
        "delete:docs/a.md",
        "modify:docs/a.md",
    ]);
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
