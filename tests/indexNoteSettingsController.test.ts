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
import type { SideNote2Settings } from "../src/ui/settings/SideNote2Setting";

function createFile(path: string): TFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
        extension: path.split(".").pop() ?? "",
    } as TFile;
}

function createSettings(overrides: Partial<SideNote2Settings> = {}): SideNote2Settings {
    return {
        indexNotePath: overrides.indexNotePath ?? "SideNote2 index.md",
        indexHeaderImageUrl: overrides.indexHeaderImageUrl ?? "https://example.com/default.webp",
        indexHeaderImageCaption: overrides.indexHeaderImageCaption ?? "Default caption",
        agentRuntimeMode: overrides.agentRuntimeMode ?? "auto",
        remoteRuntimeBaseUrl: overrides.remoteRuntimeBaseUrl ?? "",
    };
}

function createControllerHarness(options: {
    settings?: SideNote2Settings;
    files?: string[];
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

    const folderPaths = new Set<string>();
    const filesByPath = new Map<string, TFile>();
    for (const filePath of options.files ?? []) {
        const file = createFile(filePath);
        filesByPath.set(file.path, file);
        const segments = filePath.split("/");
        for (let index = 1; index < segments.length; index += 1) {
            folderPaths.add(segments.slice(0, index).join("/"));
        }
    }

    const app = {
        vault: {
            getAbstractFileByPath: (path: string) => filesByPath.get(path) ?? (folderPaths.has(path) ? { path } : null),
        },
        fileManager: {
            renameFile: async (file: TFile, nextPath: string) => {
                renamedFiles.push({ from: file.path, to: nextPath });
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
        setSettings: (nextSettings: SideNote2Settings) => {
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
        nextPathInput: "SideNote2 index.md",
        currentStoredPath: "SideNote2 index.md",
        previousPath: "SideNote2 index.md",
        parentPath: "",
        parentExists: true,
        conflictingFilePath: null,
        currentIndexFilePath: "SideNote2 index.md",
        activeSidebarFilePath: null,
        draftHostFilePath: null,
    }), {
        kind: "noop",
        nextPath: "SideNote2 index.md",
    });

    assert.deepEqual(resolveIndexNotePathChange({
        nextPathInput: "docs/new-index",
        currentStoredPath: "SideNote2 index.md",
        previousPath: "SideNote2 index.md",
        parentPath: "docs",
        parentExists: false,
        conflictingFilePath: null,
        currentIndexFilePath: "SideNote2 index.md",
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
        currentStoredPath: "SideNote2 index.md",
        previousPath: "SideNote2 index.md",
        parentPath: "docs",
        parentExists: true,
        conflictingFilePath: "docs/new-index.md",
        currentIndexFilePath: "SideNote2 index.md",
        activeSidebarFilePath: null,
        draftHostFilePath: null,
    }), {
        kind: "conflict",
        nextPath: "docs/new-index.md",
        notice: "docs/new-index.md already exists. Choose another index note path.",
    });

    assert.deepEqual(resolveIndexNotePathChange({
        nextPathInput: "docs/new-index",
        currentStoredPath: "SideNote2 index.md",
        previousPath: "SideNote2 index.md",
        parentPath: "docs",
        parentExists: true,
        conflictingFilePath: null,
        currentIndexFilePath: "SideNote2 index.md",
        activeSidebarFilePath: "SideNote2 index.md",
        draftHostFilePath: "SideNote2 comments.md",
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

test("loaded settings resolution normalizes runtime settings", () => {
    const resolved = resolveLoadedSettings({
        agentRuntimeMode: " remote " as unknown as SideNote2Settings["agentRuntimeMode"],
        remoteRuntimeBaseUrl: " https://remote.example.com/api/ ",
    }, createSettings());

    assert.deepEqual(resolved.settings, {
        indexNotePath: "SideNote2 index.md",
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
        indexNotePath: "SideNote2 index.md",
        indexHeaderImageUrl: "https://example.com/default.webp",
        indexHeaderImageCaption: "Default caption",
        agentRuntimeMode: "remote",
        remoteRuntimeBaseUrl: "https://remote.example.com/api",
    });
    assert.equal(harness.getRefreshAggregateNoteCount(), 0);
    assert.deepEqual(harness.savedPayloads.at(-1), {
        indexNotePath: "SideNote2 index.md",
        indexHeaderImageUrl: "https://example.com/default.webp",
        indexHeaderImageCaption: "Default caption",
        agentRuntimeMode: "remote",
        remoteRuntimeBaseUrl: "https://remote.example.com/api",
    });
});

test("index note settings controller renames the index note and retargets sidebar and draft hosts", async () => {
    const harness = createControllerHarness({
        settings: createSettings({ indexNotePath: "SideNote2 index.md" }),
        files: ["SideNote2 index.md", "docs/source.md"],
        activeSidebarFilePath: "SideNote2 index.md",
        draftHostFilePath: "SideNote2 comments.md",
    });

    await harness.controller.setIndexNotePath("docs/renamed-index");

    assert.equal(harness.getSettings().indexNotePath, "docs/renamed-index.md");
    assert.deepEqual(harness.renamedFiles, [{
        from: "SideNote2 index.md",
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
        files: ["SideNote2 index.md"],
    });
    await missingFolderHarness.controller.setIndexNotePath("missing/new-index");

    assert.deepEqual(missingFolderHarness.notices, ["Folder does not exist: missing"]);
    assert.equal(missingFolderHarness.savedPayloads.length, 0);

    const conflictHarness = createControllerHarness({
        files: ["SideNote2 index.md", "docs/index.md"],
    });
    await conflictHarness.controller.setIndexNotePath("docs/index");

    assert.deepEqual(conflictHarness.notices, [
        "docs/index.md already exists. Choose another index note path.",
    ]);
    assert.equal(conflictHarness.savedPayloads.length, 0);
});
