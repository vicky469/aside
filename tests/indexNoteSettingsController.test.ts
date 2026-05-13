import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import { IndexNoteSettingsController } from "../src/settings/indexNoteSettingsController";
import {
    resolveIndexNotePathChange,
    resolveLoadedSettings,
    shouldApplyNormalizedSettingChange,
    type PersistedPluginData,
} from "../src/settings/indexNoteSettingsPlanner";
import type { AsideSettings } from "../src/ui/settings/AsideSetting";

function createFile(path: string): TFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
        extension: path.split(".").pop() ?? "",
    } as TFile;
}

function createSettings(overrides: Partial<AsideSettings> = {}): AsideSettings {
    return {
        indexNotePath: overrides.indexNotePath ?? "Aside index.md",
        indexHeaderImageUrl: overrides.indexHeaderImageUrl ?? "https://example.com/default.webp",
        indexHeaderImageCaption: overrides.indexHeaderImageCaption ?? "Default caption",
        agentRuntimeMode: overrides.agentRuntimeMode ?? "auto",
        remoteRuntimeBaseUrl: overrides.remoteRuntimeBaseUrl ?? "",
    };
}

function createControllerHarness(options: {
    settings?: AsideSettings;
    files?: string[];
    adapterFiles?: string[];
    fileContents?: Record<string, string>;
    activeSidebarFilePath?: string | null;
    draftHostFilePath?: string | null;
    loadedData?: PersistedPluginData | null;
} = {}) {
    let settings = options.settings ?? createSettings();
    let activeSidebarFile = options.activeSidebarFilePath ? createFile(options.activeSidebarFilePath) : null;
    let draftHostFilePath = options.draftHostFilePath ?? null;
    const savedPayloads: PersistedPluginData[] = [];
    const notices: string[] = [];
    const refreshedTargets: Array<string | null> = [];
    let refreshAggregateNoteCount = 0;
    const renamedFiles: Array<{ from: string; to: string }> = [];
    const adapterRenamedFiles: Array<{ from: string; to: string }> = [];
    const deletedFiles: string[] = [];
    const adapterRemovedFiles: string[] = [];

    const folderPaths = new Set<string>();
    const filesByPath = new Map<string, TFile>();
    const adapterOnlyFilePaths = new Set(options.adapterFiles ?? []);
    const fileContents = new Map(Object.entries(options.fileContents ?? {}));
    for (const filePath of options.files ?? []) {
        const file = createFile(filePath);
        filesByPath.set(file.path, file);
        if (!fileContents.has(file.path)) {
            fileContents.set(file.path, "");
        }
        const segments = filePath.split("/");
        for (let index = 1; index < segments.length; index += 1) {
            folderPaths.add(segments.slice(0, index).join("/"));
        }
    }
    for (const filePath of adapterOnlyFilePaths) {
        if (!fileContents.has(filePath)) {
            fileContents.set(filePath, "");
        }
    }

    const app = {
        vault: {
            getAbstractFileByPath: (path: string) => filesByPath.get(path) ?? (folderPaths.has(path) ? { path } : null),
            adapter: {
                exists: async (path: string) => filesByPath.has(path) || adapterOnlyFilePaths.has(path),
                read: async (path: string) => {
                    if (!filesByPath.has(path) && !adapterOnlyFilePaths.has(path)) {
                        throw new Error(`Missing adapter file: ${path}`);
                    }
                    return fileContents.get(path) ?? "";
                },
                rename: async (previousPath: string, nextPath: string) => {
                    if (!adapterOnlyFilePaths.has(previousPath) && !filesByPath.has(previousPath)) {
                        throw new Error(`Missing adapter file: ${previousPath}`);
                    }

                    adapterRenamedFiles.push({ from: previousPath, to: nextPath });
                    fileContents.set(nextPath, fileContents.get(previousPath) ?? "");
                    fileContents.delete(previousPath);
                    adapterOnlyFilePaths.delete(previousPath);
                    adapterOnlyFilePaths.add(nextPath);
                },
                remove: async (path: string) => {
                    if (!adapterOnlyFilePaths.has(path) && !filesByPath.has(path)) {
                        throw new Error(`Missing adapter file: ${path}`);
                    }
                    adapterRemovedFiles.push(path);
                    adapterOnlyFilePaths.delete(path);
                    filesByPath.delete(path);
                    fileContents.delete(path);
                },
            },
        },
        fileManager: {
            trashFile: async (file: TFile) => {
                deletedFiles.push(file.path);
                filesByPath.delete(file.path);
                fileContents.delete(file.path);
            },
            renameFile: async (file: TFile, nextPath: string) => {
                renamedFiles.push({ from: file.path, to: nextPath });
                fileContents.set(nextPath, fileContents.get(file.path) ?? "");
                fileContents.delete(file.path);
                filesByPath.delete(file.path);
                file.path = nextPath;
                file.basename = nextPath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? nextPath;
                file.extension = nextPath.split(".").pop() ?? "";
                filesByPath.set(nextPath, file);
                const segments = nextPath.split("/");
                for (let index = 1; index < segments.length; index += 1) {
                    folderPaths.add(segments.slice(0, index).join("/"));
                }
            },
        },
    } as unknown as ConstructorParameters<typeof IndexNoteSettingsController>[0]["app"];

    const host = {
        app,
        getSettings: () => settings,
        setSettings: (nextSettings: AsideSettings) => {
            settings = nextSettings;
        },
        getFileByPath: (filePath: string) => filesByPath.get(filePath) ?? null,
        getMarkdownFileByPath: (filePath: string) => {
            const file = filesByPath.get(filePath) ?? null;
            return file?.extension === "md" ? file : null;
        },
        getActiveSidebarFile: () => activeSidebarFile,
        setActiveSidebarFile: (file: TFile | null) => {
            activeSidebarFile = file;
        },
        getDraftHostFilePath: () => draftHostFilePath,
        setDraftHostFilePath: (filePath: string | null) => {
            draftHostFilePath = filePath;
        },
        getSidebarTargetFile: () => activeSidebarFile,
        updateSidebarViews: async (file: TFile | null) => {
            refreshedTargets.push(file?.path ?? null);
        },
        refreshAggregateNoteNow: async () => {
            refreshAggregateNoteCount += 1;
        },
        loadData: async () => options.loadedData ?? null,
        saveData: async (data: PersistedPluginData) => {
            savedPayloads.push(data);
        },
        showNotice: (message: string) => {
            notices.push(message);
        },
    };

    return {
        controller: new IndexNoteSettingsController(host),
        getSettings: () => settings,
        getActiveSidebarFile: () => activeSidebarFile,
        getDraftHostFilePath: () => draftHostFilePath,
        savedPayloads,
        notices,
        refreshedTargets,
        getRefreshAggregateNoteCount: () => refreshAggregateNoteCount,
        renamedFiles,
        adapterRenamedFiles,
        deletedFiles,
        adapterRemovedFiles,
        adapterOnlyFilePaths,
        hasFile: (filePath: string) => filesByPath.has(filePath) || adapterOnlyFilePaths.has(filePath),
    };
}

test("loaded settings resolution normalizes persisted values and marks legacy confirmDelete for rewrite", () => {
    const resolved = resolveLoadedSettings({
        enableDebugMode: true,
        indexNotePath: " notes/index ",
        indexHeaderImageUrl: " https://example.com/header.webp ",
        indexHeaderImageCaption: " Custom caption ",
        preferredAgentTarget: " CLAUDE ",
        confirmDelete: true,
    }, createSettings());

    assert.deepEqual(resolved.settings, {
        indexNotePath: "notes/index.md",
        indexHeaderImageUrl: "https://example.com/header.webp",
        indexHeaderImageCaption: "Custom caption",
        agentRuntimeMode: "auto",
        remoteRuntimeBaseUrl: "",
    });
    assert.equal(resolved.shouldRewriteLegacySettings, true);
});

test("index note path planner distinguishes noop, missing parent, conflict, and apply cases", () => {
    assert.deepEqual(resolveIndexNotePathChange({
        nextPathInput: "Aside index.md",
        currentStoredPath: "Aside index.md",
        previousPath: "Aside index.md",
        parentPath: "",
        parentExists: true,
        conflictingFilePath: null,
        currentIndexFilePath: "Aside index.md",
        activeSidebarFilePath: null,
        draftHostFilePath: null,
    }), {
        kind: "noop",
        nextPath: "Aside index.md",
    });

    assert.deepEqual(resolveIndexNotePathChange({
        nextPathInput: "docs/new-index",
        currentStoredPath: "Aside index.md",
        previousPath: "Aside index.md",
        parentPath: "docs",
        parentExists: false,
        conflictingFilePath: null,
        currentIndexFilePath: "Aside index.md",
        activeSidebarFilePath: null,
        draftHostFilePath: null,
    }), {
        kind: "missing-parent",
        nextPath: "docs/new-index.md",
        parentPath: "docs",
        notice: "Folder does not exist: docs",
    });

    assert.deepEqual(resolveIndexNotePathChange({
        nextPathInput: "docs/new-index",
        currentStoredPath: "Aside index.md",
        previousPath: "Aside index.md",
        parentPath: "docs",
        parentExists: true,
        conflictingFilePath: "docs/new-index.md",
        currentIndexFilePath: "Aside index.md",
        activeSidebarFilePath: null,
        draftHostFilePath: null,
    }), {
        kind: "conflict",
        nextPath: "docs/new-index.md",
        notice: "docs/new-index.md already exists. Choose another index note path.",
    });

    assert.deepEqual(resolveIndexNotePathChange({
        nextPathInput: "docs/new-index",
        currentStoredPath: "Aside index.md",
        previousPath: "Aside index.md",
        parentPath: "docs",
        parentExists: true,
        conflictingFilePath: null,
        currentIndexFilePath: "Aside index.md",
        activeSidebarFilePath: "Aside index.md",
        draftHostFilePath: "Aside comments.md",
    }), {
        kind: "apply",
        nextPath: "docs/new-index.md",
        shouldRenameCurrentIndexFile: true,
        shouldRetargetActiveSidebarFile: true,
        shouldRetargetDraftHostFile: true,
    });
});

test("normalized setting change helper ignores no-op writes after normalization", () => {
    assert.equal(shouldApplyNormalizedSettingChange({
        currentStoredValue: "https://example.com/header.webp",
        currentNormalizedValue: "https://example.com/header.webp",
        nextNormalizedValue: "https://example.com/header.webp",
    }), false);

    assert.equal(shouldApplyNormalizedSettingChange({
        currentStoredValue: " https://example.com/header.webp ",
        currentNormalizedValue: "https://example.com/header.webp",
        nextNormalizedValue: "https://example.com/header.webp",
    }), true);
});

test("index note settings controller rewrites legacy settings", async () => {
    const harness = createControllerHarness({
        loadedData: {
            enableDebugMode: true,
            indexNotePath: " docs/index ",
            indexHeaderImageUrl: " https://example.com/header.webp ",
            indexHeaderImageCaption: " Header ",
            preferredAgentTarget: " claude ",
            confirmDelete: true,
        },
    });

    await harness.controller.loadSettings();

    assert.deepEqual(harness.getSettings(), {
        indexNotePath: "docs/index.md",
        indexHeaderImageUrl: "https://example.com/header.webp",
        indexHeaderImageCaption: "Header",
        agentRuntimeMode: "auto",
        remoteRuntimeBaseUrl: "",
    });
    assert.equal(harness.savedPayloads.length, 1);
    assert.equal("preferredAgentTarget" in harness.savedPayloads[0], false);
    assert.equal("confirmDelete" in harness.savedPayloads[0], false);
    assert.equal("enableDebugMode" in harness.savedPayloads[0], false);
});

test("index note settings controller migrates legacy generated index notes to Aside index", async () => {
    const harness = createControllerHarness({
        files: ["SideNote2 index.md"],
        loadedData: {
            indexNotePath: "SideNote2 index.md",
        },
    });

    await harness.controller.loadSettings();

    assert.equal(harness.getSettings().indexNotePath, "Aside index.md");
    assert.deepEqual(harness.renamedFiles, [{
        from: "SideNote2 index.md",
        to: "Aside index.md",
    }]);
    assert.equal(harness.savedPayloads.length, 1);
    assert.equal(harness.savedPayloads[0].indexNotePath, "Aside index.md");
});

test("index note settings controller migrates adapter-visible legacy generated index notes", async () => {
    const harness = createControllerHarness({
        adapterFiles: ["SideNote2 index.md"],
        loadedData: {
            indexNotePath: "Aside index.md",
        },
    });

    await harness.controller.loadSettings();

    assert.equal(harness.getSettings().indexNotePath, "Aside index.md");
    assert.deepEqual(harness.renamedFiles, []);
    assert.deepEqual(harness.adapterRenamedFiles, [{
        from: "SideNote2 index.md",
        to: "Aside index.md",
    }]);
    assert.equal(harness.adapterOnlyFilePaths.has("SideNote2 index.md"), false);
    assert.equal(harness.adapterOnlyFilePaths.has("Aside index.md"), true);
});

test("index note settings controller removes stale generated legacy index notes", async () => {
    const harness = createControllerHarness({
        files: ["Aside index.md", "SideNote2 index.md"],
        fileContents: {
            "Aside index.md": "![Aside index header image](https://example.com/aside.webp)\n",
            "SideNote2 index.md": [
                "![SideNote2 index header image](https://example.com/legacy.webp)",
                "<div class=\"sidenote2-index-header-caption\"></div>",
            ].join("\n"),
        },
        loadedData: {
            indexNotePath: "Aside index.md",
        },
    });

    await harness.controller.loadSettings();

    assert.equal(harness.hasFile("Aside index.md"), true);
    assert.equal(harness.hasFile("SideNote2 index.md"), false);
    assert.deepEqual(harness.deletedFiles, ["SideNote2 index.md"]);
    assert.deepEqual(harness.renamedFiles, []);
});

test("index note settings controller keeps non-generated legacy-named notes", async () => {
    const harness = createControllerHarness({
        files: ["Aside index.md", "SideNote2 index.md"],
        fileContents: {
            "Aside index.md": "![Aside index header image](https://example.com/aside.webp)\n",
            "SideNote2 index.md": "Personal note, not generated output.",
        },
        loadedData: {
            indexNotePath: "Aside index.md",
        },
    });

    await harness.controller.loadSettings();

    assert.equal(harness.hasFile("Aside index.md"), true);
    assert.equal(harness.hasFile("SideNote2 index.md"), true);
    assert.deepEqual(harness.deletedFiles, []);
    assert.deepEqual(harness.adapterRemovedFiles, []);
});

test("loaded settings resolution normalizes runtime settings", () => {
    const resolved = resolveLoadedSettings({
        agentRuntimeMode: " remote " as unknown as AsideSettings["agentRuntimeMode"],
        remoteRuntimeBaseUrl: " https://remote.example.com/api/ ",
    }, createSettings());

    assert.deepEqual(resolved.settings, {
        indexNotePath: "Aside index.md",
        indexHeaderImageUrl: "https://ichef.bbci.co.uk/images/ic/1920xn/p02vhq1v.jpg.webp",
        indexHeaderImageCaption: "Default caption",
        agentRuntimeMode: "remote",
        remoteRuntimeBaseUrl: "https://remote.example.com/api",
    });
});

test("index note settings controller saves runtime settings without aggregate refreshes", async () => {
    const harness = createControllerHarness();

    await harness.controller.setAgentRuntimeMode("remote");
    await harness.controller.setRemoteRuntimeBaseUrl(" https://remote.example.com/api/ ");

    assert.deepEqual(harness.getSettings(), {
        indexNotePath: "Aside index.md",
        indexHeaderImageUrl: "https://example.com/default.webp",
        indexHeaderImageCaption: "Default caption",
        agentRuntimeMode: "remote",
        remoteRuntimeBaseUrl: "https://remote.example.com/api",
    });
    assert.equal(harness.getRefreshAggregateNoteCount(), 0);
    assert.deepEqual(harness.savedPayloads.at(-1), {
        indexNotePath: "Aside index.md",
        indexHeaderImageUrl: "https://example.com/default.webp",
        indexHeaderImageCaption: "Default caption",
        agentRuntimeMode: "remote",
        remoteRuntimeBaseUrl: "https://remote.example.com/api",
    });
});

test("index note settings controller renames the index note and retargets sidebar and draft hosts", async () => {
    const harness = createControllerHarness({
        settings: createSettings({ indexNotePath: "Aside index.md" }),
        files: ["Aside index.md", "docs/source.md"],
        activeSidebarFilePath: "Aside index.md",
        draftHostFilePath: "Aside comments.md",
    });

    await harness.controller.setIndexNotePath("docs/renamed-index");

    assert.equal(harness.getSettings().indexNotePath, "docs/renamed-index.md");
    assert.deepEqual(harness.renamedFiles, [{
        from: "Aside index.md",
        to: "docs/renamed-index.md",
    }]);
    assert.equal(harness.getActiveSidebarFile()?.path, "docs/renamed-index.md");
    assert.equal(harness.getDraftHostFilePath(), "docs/renamed-index.md");
    assert.equal(harness.getRefreshAggregateNoteCount(), 1);
    assert.deepEqual(harness.refreshedTargets, ["docs/renamed-index.md"]);
    assert.equal(harness.savedPayloads.length, 1);
});

test("index note settings controller rejects invalid folder and file conflicts", async () => {
    const missingFolderHarness = createControllerHarness({
        files: ["Aside index.md"],
    });
    await missingFolderHarness.controller.setIndexNotePath("missing/new-index");

    assert.deepEqual(missingFolderHarness.notices, ["Folder does not exist: missing"]);
    assert.equal(missingFolderHarness.savedPayloads.length, 0);

    const conflictHarness = createControllerHarness({
        files: ["Aside index.md", "docs/index.md"],
    });
    await conflictHarness.controller.setIndexNotePath("docs/index");

    assert.deepEqual(conflictHarness.notices, [
        "docs/index.md already exists. Choose another index note path.",
    ]);
    assert.equal(conflictHarness.savedPayloads.length, 0);
});
