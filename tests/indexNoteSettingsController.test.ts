import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import { IndexNoteSettingsController } from "../src/settings/indexNoteSettingsController";
import {
    ALL_COMMENTS_NOTE_PATH,
    LEGACY_ALL_COMMENTS_NOTE_PATH,
} from "../src/core/derived/allCommentsNote";
import {
    DEFAULT_PUBLISH_SETTINGS,
} from "../src/core/publish/publishSettings";
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
        indexNotePath: overrides.indexNotePath ?? ALL_COMMENTS_NOTE_PATH,
        indexHeaderImageUrl: overrides.indexHeaderImageUrl ?? "https://example.com/default.webp",
        indexHeaderImageCaption: overrides.indexHeaderImageCaption ?? "Default caption",
        agentRuntimeMode: overrides.agentRuntimeMode ?? "auto",
        showTodoSidebarTab: overrides.showTodoSidebarTab ?? true,
        showAgentSidebarTab: overrides.showAgentSidebarTab ?? true,
        publishedPublicArtifactPaths: overrides.publishedPublicArtifactPaths ?? [],
        publishEnabled: overrides.publishEnabled ?? DEFAULT_PUBLISH_SETTINGS.publishEnabled,
        publishPagesProjectName: overrides.publishPagesProjectName ?? DEFAULT_PUBLISH_SETTINGS.publishPagesProjectName,
        publishBaseUrl: overrides.publishBaseUrl ?? DEFAULT_PUBLISH_SETTINGS.publishBaseUrl,
        publishAllowedRoot: overrides.publishAllowedRoot ?? DEFAULT_PUBLISH_SETTINGS.publishAllowedRoot,
		publishRemotePurgeEnabled: overrides.publishRemotePurgeEnabled ?? DEFAULT_PUBLISH_SETTINGS.publishRemotePurgeEnabled,
		publishPurgeBrokerUrl: overrides.publishPurgeBrokerUrl ?? DEFAULT_PUBLISH_SETTINGS.publishPurgeBrokerUrl,
		publishPurgeBrokerSecretName: overrides.publishPurgeBrokerSecretName ?? DEFAULT_PUBLISH_SETTINGS.publishPurgeBrokerSecretName,
    };
}

test("loaded settings resolution uses the current index note path for a new install", () => {
    const resolved = resolveLoadedSettings(null, createSettings());

    assert.equal(resolved.settings.indexNotePath, ALL_COMMENTS_NOTE_PATH);
});

test("loaded settings resolution normalizes the configured default for a new install", () => {
    const resolved = resolveLoadedSettings(null, createSettings({ indexNotePath: " rabbit index " }));

    assert.equal(resolved.settings.indexNotePath, "rabbit index.md");
});

test("loaded settings resolution keeps old-schema data on the legacy index note path for migration", () => {
    const resolved = resolveLoadedSettings({}, createSettings());

    assert.equal(resolved.settings.indexNotePath, LEGACY_ALL_COMMENTS_NOTE_PATH);
    assert.equal(resolved.shouldRewriteLegacySettings, true);
});

test("loaded settings resolution treats blank-like persisted index note paths as missing", () => {
    for (const indexNotePath of ["   ", null, undefined]) {
        const resolved = resolveLoadedSettings({
            indexNotePath,
        } as unknown as PersistedPluginData, createSettings());

        assert.equal(resolved.settings.indexNotePath, LEGACY_ALL_COMMENTS_NOTE_PATH);
        assert.equal(resolved.shouldRewriteLegacySettings, true);
    }
});

function withPublishDefaults(
    settings: Omit<AsideSettings, keyof typeof DEFAULT_PUBLISH_SETTINGS | "publishedPublicArtifactPaths">,
): AsideSettings {
    return {
        ...settings,
        publishedPublicArtifactPaths: [],
        ...DEFAULT_PUBLISH_SETTINGS,
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
    renameFileError?: Error;
    saveDataError?: Error;
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
    const createdFolders: string[] = [];

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
            createFolder: async (path: string) => {
                if (filesByPath.has(path)) {
                    throw new Error(`File exists at folder path: ${path}`);
                }
                folderPaths.add(path);
                createdFolders.push(path);
                return { path };
            },
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
                if (options.renameFileError) {
                    throw options.renameFileError;
                }

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
            if (options.saveDataError) {
                throw options.saveDataError;
            }

            savedPayloads.push(data);
        },
        ensureFolder: async (folderPath: string) => {
            if (filesByPath.has(folderPath)) {
                return {
                    ok: false as const,
                    notice: `Cannot enable Publishing because ${folderPath} is a file.`,
                };
            }
            if (folderPaths.has(folderPath)) {
                return { ok: true as const };
            }
            folderPaths.add(folderPath);
            createdFolders.push(folderPath);
            return { ok: true as const };
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
        createdFolders,
        adapterOnlyFilePaths,
        hasFile: (filePath: string) => filesByPath.has(filePath) || adapterOnlyFilePaths.has(filePath),
        hasFolder: (folderPath: string) => folderPaths.has(folderPath),
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

    assert.deepEqual(resolved.settings, withPublishDefaults({
        indexNotePath: "notes/index.md",
        indexHeaderImageUrl: "https://example.com/header.webp",
        indexHeaderImageCaption: "Custom caption",
        agentRuntimeMode: "auto",
        showTodoSidebarTab: true,
        showAgentSidebarTab: true,
    }));
    assert.equal(resolved.shouldRewriteLegacySettings, true);
});

test("loaded settings resolution defaults sidebar tab toggles on and rewrites invalid toggle values", () => {
    const resolved = resolveLoadedSettings({
        showTodoSidebarTab: false,
        showAgentSidebarTab: "no" as unknown as boolean,
    }, createSettings());

    assert.deepEqual(resolved.settings, withPublishDefaults({
        indexNotePath: LEGACY_ALL_COMMENTS_NOTE_PATH,
        indexHeaderImageUrl: "https://ichef.bbci.co.uk/images/ic/1920xn/p02vhq1v.jpg.webp",
        indexHeaderImageCaption: "Default caption",
        agentRuntimeMode: "auto",
        showTodoSidebarTab: false,
        showAgentSidebarTab: true,
    }));
    assert.equal(resolved.shouldRewriteLegacySettings, true);
});

test("index note path planner distinguishes noop, missing parent, conflict, and apply cases", () => {
    assert.deepEqual(resolveIndexNotePathChange({
        nextPathInput: ALL_COMMENTS_NOTE_PATH,
        currentStoredPath: ALL_COMMENTS_NOTE_PATH,
        previousPath: ALL_COMMENTS_NOTE_PATH,
        parentPath: "",
        parentExists: true,
        conflictingFilePath: null,
        currentIndexFilePath: ALL_COMMENTS_NOTE_PATH,
        activeSidebarFilePath: null,
        draftHostFilePath: null,
    }), {
        kind: "noop",
        nextPath: ALL_COMMENTS_NOTE_PATH,
    });

    assert.deepEqual(resolveIndexNotePathChange({
        nextPathInput: "docs/new-index",
        currentStoredPath: ALL_COMMENTS_NOTE_PATH,
        previousPath: ALL_COMMENTS_NOTE_PATH,
        parentPath: "docs",
        parentExists: false,
        conflictingFilePath: null,
        currentIndexFilePath: ALL_COMMENTS_NOTE_PATH,
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
        currentStoredPath: ALL_COMMENTS_NOTE_PATH,
        previousPath: ALL_COMMENTS_NOTE_PATH,
        parentPath: "docs",
        parentExists: true,
        conflictingFilePath: "docs/new-index.md",
        currentIndexFilePath: ALL_COMMENTS_NOTE_PATH,
        activeSidebarFilePath: null,
        draftHostFilePath: null,
    }), {
        kind: "conflict",
        nextPath: "docs/new-index.md",
        notice: "docs/new-index.md already exists. Choose another index note path.",
    });

    assert.deepEqual(resolveIndexNotePathChange({
        nextPathInput: "docs/new-index",
        currentStoredPath: ALL_COMMENTS_NOTE_PATH,
        previousPath: ALL_COMMENTS_NOTE_PATH,
        parentPath: "docs",
        parentExists: true,
        conflictingFilePath: null,
        currentIndexFilePath: ALL_COMMENTS_NOTE_PATH,
        activeSidebarFilePath: ALL_COMMENTS_NOTE_PATH,
        draftHostFilePath: ALL_COMMENTS_NOTE_PATH,
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

    assert.deepEqual(harness.getSettings(), withPublishDefaults({
        indexNotePath: "docs/index.md",
        indexHeaderImageUrl: "https://example.com/header.webp",
        indexHeaderImageCaption: "Header",
        agentRuntimeMode: "auto",
        showTodoSidebarTab: true,
        showAgentSidebarTab: true,
    }));
    assert.equal(harness.savedPayloads.length, 1);
    assert.equal("preferredAgentTarget" in harness.savedPayloads[0], false);
    assert.equal("confirmDelete" in harness.savedPayloads[0], false);
    assert.equal("enableDebugMode" in harness.savedPayloads[0], false);
});

test("index note settings controller migrates a persisted legacy index note on load", async () => {
    const harness = createControllerHarness({
        settings: createSettings({ indexNotePath: LEGACY_ALL_COMMENTS_NOTE_PATH }),
        loadedData: createSettings({ indexNotePath: LEGACY_ALL_COMMENTS_NOTE_PATH }),
        files: [LEGACY_ALL_COMMENTS_NOTE_PATH],
        activeSidebarFilePath: LEGACY_ALL_COMMENTS_NOTE_PATH,
        draftHostFilePath: LEGACY_ALL_COMMENTS_NOTE_PATH,
    });

    await harness.controller.loadSettings();

    assert.equal(harness.getSettings().indexNotePath, ALL_COMMENTS_NOTE_PATH);
    assert.deepEqual(harness.renamedFiles, [{
        from: LEGACY_ALL_COMMENTS_NOTE_PATH,
        to: ALL_COMMENTS_NOTE_PATH,
    }]);
    assert.equal(harness.savedPayloads.length, 1);
    assert.equal(harness.savedPayloads[0].indexNotePath, ALL_COMMENTS_NOTE_PATH);
    assert.equal(harness.getActiveSidebarFile()?.path, ALL_COMMENTS_NOTE_PATH);
    assert.equal(harness.getDraftHostFilePath(), ALL_COMMENTS_NOTE_PATH);
    assert.equal(harness.getRefreshAggregateNoteCount(), 1);
    assert.deepEqual(harness.refreshedTargets, [ALL_COMMENTS_NOTE_PATH]);
});

test("index note settings controller recovers an unconfigured legacy index note on a new install", async () => {
    const harness = createControllerHarness({
        loadedData: null,
        files: [LEGACY_ALL_COMMENTS_NOTE_PATH],
    });

    await harness.controller.loadSettings();

    assert.equal(harness.getSettings().indexNotePath, ALL_COMMENTS_NOTE_PATH);
    assert.deepEqual(harness.renamedFiles, [{
        from: LEGACY_ALL_COMMENTS_NOTE_PATH,
        to: ALL_COMMENTS_NOTE_PATH,
    }]);
    assert.equal(harness.savedPayloads.length, 1);
    assert.equal(harness.savedPayloads[0].indexNotePath, ALL_COMMENTS_NOTE_PATH);
    assert.equal(harness.getRefreshAggregateNoteCount(), 1);
});

test("index note settings controller recovers legacy notes from blank-like persisted paths", async () => {
    for (const indexNotePath of ["   ", null, undefined]) {
        const harness = createControllerHarness({
            loadedData: {
                ...createSettings(),
                indexNotePath,
            } as unknown as PersistedPluginData,
            files: [LEGACY_ALL_COMMENTS_NOTE_PATH],
        });

        await harness.controller.loadSettings();

        assert.equal(harness.getSettings().indexNotePath, ALL_COMMENTS_NOTE_PATH);
        assert.deepEqual(harness.renamedFiles, [{
            from: LEGACY_ALL_COMMENTS_NOTE_PATH,
            to: ALL_COMMENTS_NOTE_PATH,
        }]);
        assert.equal(harness.savedPayloads.length, 1);
        assert.equal(harness.savedPayloads[0].indexNotePath, ALL_COMMENTS_NOTE_PATH);
    }
});

test("index note settings controller preserves legacy state when startup migration rename fails", async () => {
    const harness = createControllerHarness({
        settings: createSettings({ indexNotePath: LEGACY_ALL_COMMENTS_NOTE_PATH }),
        loadedData: createSettings({ indexNotePath: LEGACY_ALL_COMMENTS_NOTE_PATH }),
        files: [LEGACY_ALL_COMMENTS_NOTE_PATH],
        activeSidebarFilePath: LEGACY_ALL_COMMENTS_NOTE_PATH,
        draftHostFilePath: LEGACY_ALL_COMMENTS_NOTE_PATH,
        renameFileError: new Error("rename failed"),
    });

    await assert.doesNotReject(() => harness.controller.loadSettings());

    assert.equal(harness.getSettings().indexNotePath, LEGACY_ALL_COMMENTS_NOTE_PATH);
    assert.deepEqual(harness.savedPayloads, []);
    assert.deepEqual(harness.renamedFiles, []);
    assert.equal(harness.hasFile(LEGACY_ALL_COMMENTS_NOTE_PATH), true);
    assert.equal(harness.hasFile(ALL_COMMENTS_NOTE_PATH), false);
    assert.equal(harness.getActiveSidebarFile()?.path, LEGACY_ALL_COMMENTS_NOTE_PATH);
    assert.equal(harness.getDraftHostFilePath(), LEGACY_ALL_COMMENTS_NOTE_PATH);
    assert.deepEqual(harness.notices, [
        "Unable to rename Aside index.md to 🐰 Aside Index.md.",
    ]);
    assert.equal(harness.getRefreshAggregateNoteCount(), 0);
    assert.deepEqual(harness.refreshedTargets, []);
});

test("index note settings controller rolls back startup migration when persistence fails", async () => {
    const harness = createControllerHarness({
        settings: createSettings({ indexNotePath: LEGACY_ALL_COMMENTS_NOTE_PATH }),
        loadedData: createSettings({ indexNotePath: LEGACY_ALL_COMMENTS_NOTE_PATH }),
        files: [LEGACY_ALL_COMMENTS_NOTE_PATH],
        activeSidebarFilePath: LEGACY_ALL_COMMENTS_NOTE_PATH,
        draftHostFilePath: LEGACY_ALL_COMMENTS_NOTE_PATH,
        saveDataError: new Error("save failed"),
    });

    await assert.doesNotReject(() => harness.controller.loadSettings());

    assert.equal(harness.getSettings().indexNotePath, LEGACY_ALL_COMMENTS_NOTE_PATH);
    assert.equal(
        harness.controller.readPersistedPluginData().indexNotePath,
        LEGACY_ALL_COMMENTS_NOTE_PATH,
    );
    assert.equal(harness.hasFile(LEGACY_ALL_COMMENTS_NOTE_PATH), true);
    assert.equal(harness.hasFile(ALL_COMMENTS_NOTE_PATH), false);
    assert.deepEqual(harness.renamedFiles, [{
        from: LEGACY_ALL_COMMENTS_NOTE_PATH,
        to: ALL_COMMENTS_NOTE_PATH,
    }, {
        from: ALL_COMMENTS_NOTE_PATH,
        to: LEGACY_ALL_COMMENTS_NOTE_PATH,
    }]);
    assert.equal(harness.getActiveSidebarFile()?.path, LEGACY_ALL_COMMENTS_NOTE_PATH);
    assert.equal(harness.getDraftHostFilePath(), LEGACY_ALL_COMMENTS_NOTE_PATH);
    assert.deepEqual(harness.savedPayloads, []);
    assert.equal(harness.getRefreshAggregateNoteCount(), 0);
    assert.deepEqual(harness.refreshedTargets, []);
    assert.deepEqual(harness.notices, [
        "Unable to rename Aside index.md to 🐰 Aside Index.md.",
    ]);
});

test("index note settings controller keeps the legacy index active when the rabbit path already exists", async () => {
    const harness = createControllerHarness({
        settings: createSettings({ indexNotePath: LEGACY_ALL_COMMENTS_NOTE_PATH }),
        loadedData: createSettings({ indexNotePath: LEGACY_ALL_COMMENTS_NOTE_PATH }),
        files: [LEGACY_ALL_COMMENTS_NOTE_PATH, ALL_COMMENTS_NOTE_PATH],
        activeSidebarFilePath: LEGACY_ALL_COMMENTS_NOTE_PATH,
    });

    await harness.controller.loadSettings();

    assert.equal(harness.getSettings().indexNotePath, LEGACY_ALL_COMMENTS_NOTE_PATH);
    assert.deepEqual(harness.renamedFiles, []);
    assert.deepEqual(harness.notices, [
        "Unable to rename Aside index.md because 🐰 Aside Index.md already exists.",
    ]);
    assert.equal(harness.getActiveSidebarFile()?.path, LEGACY_ALL_COMMENTS_NOTE_PATH);
    assert.equal(harness.savedPayloads.length, 0);
    assert.equal(harness.getRefreshAggregateNoteCount(), 0);
});

test("loaded settings resolution drops legacy remote runtime settings", () => {
    const resolved = resolveLoadedSettings({
        agentRuntimeMode: " remote " as unknown as AsideSettings["agentRuntimeMode"],
        remoteRuntimeBaseUrl: " https://remote.example.com/api/ ",
    }, createSettings());

    assert.deepEqual(resolved.settings, withPublishDefaults({
        indexNotePath: LEGACY_ALL_COMMENTS_NOTE_PATH,
        indexHeaderImageUrl: "https://ichef.bbci.co.uk/images/ic/1920xn/p02vhq1v.jpg.webp",
        indexHeaderImageCaption: "Default caption",
        agentRuntimeMode: "auto",
        showTodoSidebarTab: true,
        showAgentSidebarTab: true,
    }));
    assert.equal(resolved.shouldRewriteLegacySettings, true);
});

test("index note settings controller saves local runtime setting without aggregate refreshes", async () => {
    const harness = createControllerHarness();

    await harness.controller.setAgentRuntimeMode("local");

    assert.deepEqual(harness.getSettings(), withPublishDefaults({
        indexNotePath: ALL_COMMENTS_NOTE_PATH,
        indexHeaderImageUrl: "https://example.com/default.webp",
        indexHeaderImageCaption: "Default caption",
        agentRuntimeMode: "local",
        showTodoSidebarTab: true,
        showAgentSidebarTab: true,
    }));
    assert.equal(harness.getRefreshAggregateNoteCount(), 0);
    assert.deepEqual(harness.savedPayloads.at(-1), withPublishDefaults({
        indexNotePath: ALL_COMMENTS_NOTE_PATH,
        indexHeaderImageUrl: "https://example.com/default.webp",
        indexHeaderImageCaption: "Default caption",
        agentRuntimeMode: "local",
        showTodoSidebarTab: true,
        showAgentSidebarTab: true,
    }));
});

test("index note settings controller saves sidebar tab toggles and refreshes open sidebars", async () => {
    const harness = createControllerHarness({
        activeSidebarFilePath: "docs/source.md",
        files: ["docs/source.md"],
    });

    await harness.controller.setShowTodoSidebarTab(false);
    await harness.controller.setShowAgentSidebarTab(false);

    assert.deepEqual(harness.getSettings(), withPublishDefaults({
        indexNotePath: ALL_COMMENTS_NOTE_PATH,
        indexHeaderImageUrl: "https://example.com/default.webp",
        indexHeaderImageCaption: "Default caption",
        agentRuntimeMode: "auto",
        showTodoSidebarTab: false,
        showAgentSidebarTab: false,
    }));
    assert.deepEqual(harness.refreshedTargets, ["docs/source.md", "docs/source.md"]);
    assert.deepEqual(harness.savedPayloads.at(-1), withPublishDefaults({
        indexNotePath: ALL_COMMENTS_NOTE_PATH,
        indexHeaderImageUrl: "https://example.com/default.webp",
        indexHeaderImageCaption: "Default caption",
        agentRuntimeMode: "auto",
        showTodoSidebarTab: false,
        showAgentSidebarTab: false,
    }));
});

test("loaded settings resolution normalizes publish settings and rewrites changed values", () => {
    const resolved = resolveLoadedSettings({
        publishEnabled: true,
        publishPagesProjectName: " Publish-Site ",
        publishBaseUrl: " https://lean-startup.pages.dev/ ",
        publishAllowedRoot: " share ",
        publishWranglerCommand: " wrangler ",
    } as PersistedPluginData, createSettings());

    assert.equal(resolved.settings.publishPagesProjectName, "lean-startup");
    assert.equal(resolved.settings.publishBaseUrl, "https://lean-startup.pages.dev");
    assert.equal(resolved.settings.publishAllowedRoot, "public/");
    assert.equal(resolved.settings.publishEnabled, true);
    assert.equal("publishWranglerCommand" in resolved.settings, false);
    assert.equal(resolved.shouldRewriteLegacySettings, true);
});

test("loaded settings resolution defaults publishing off and public root for new settings", () => {
    const resolved = resolveLoadedSettings({}, createSettings());

    assert.equal(resolved.settings.publishEnabled, false);
    assert.equal(resolved.settings.publishAllowedRoot, "public/");
});

test("index note settings controller saves publish settings without aggregate refreshes", async () => {
    const harness = createControllerHarness();

    await harness.controller.setPublishBaseUrl(" https://lean-startup.pages.dev/ ");
    await harness.controller.setPublishAllowedRoot(" share ");

    assert.equal(harness.getSettings().publishPagesProjectName, "lean-startup");
    assert.equal(harness.getSettings().publishBaseUrl, "https://lean-startup.pages.dev");
    assert.equal(harness.getSettings().publishAllowedRoot, "public/");
    assert.equal(harness.getSettings().publishEnabled, false);
    assert.equal("publishWranglerCommand" in harness.getSettings(), false);
    assert.equal(harness.getRefreshAggregateNoteCount(), 0);
    assert.deepEqual(harness.savedPayloads.at(-1), createSettings({
        publishPagesProjectName: "lean-startup",
        publishBaseUrl: "https://lean-startup.pages.dev",
        publishAllowedRoot: "public/",
    }));
});

test("index note settings controller moves generated pages.dev URL when project name changes", async () => {
    const harness = createControllerHarness({
        settings: createSettings({
            publishPagesProjectName: "old-project",
            publishBaseUrl: "https://old-project.pages.dev",
        }),
    });

    await harness.controller.setPublishPagesProjectName("new-project");

    assert.equal(harness.getSettings().publishPagesProjectName, "new-project");
    assert.equal(harness.getSettings().publishBaseUrl, "https://new-project.pages.dev");
});

test("index note settings controller keeps custom publish URL when project name changes", async () => {
    const harness = createControllerHarness({
        settings: createSettings({
            publishPagesProjectName: "old-project",
            publishBaseUrl: "https://publish.example.com",
        }),
    });

    await harness.controller.setPublishPagesProjectName("new-project");

    assert.equal(harness.getSettings().publishPagesProjectName, "new-project");
    assert.equal(harness.getSettings().publishBaseUrl, "https://publish.example.com");
});

test("index note settings controller creates public folder when publishing is enabled", async () => {
    const harness = createControllerHarness();

    await harness.controller.setPublishEnabled(true);

    assert.equal(harness.getSettings().publishEnabled, true);
    assert.deepEqual(harness.createdFolders, ["public"]);
    assert.equal(harness.hasFolder("public"), true);
    assert.equal(harness.savedPayloads.at(-1)?.publishEnabled, true);
});

test("index note settings controller preserves existing public folder when publishing is enabled", async () => {
    const harness = createControllerHarness({
        files: ["public/example.md"],
    });

    await harness.controller.setPublishEnabled(true);

    assert.equal(harness.getSettings().publishEnabled, true);
    assert.deepEqual(harness.createdFolders, []);
    assert.equal(harness.hasFolder("public"), true);
});

test("index note settings controller renames the index note and retargets sidebar and draft hosts", async () => {
    const harness = createControllerHarness({
        settings: createSettings(),
        files: [ALL_COMMENTS_NOTE_PATH, "docs/source.md"],
        activeSidebarFilePath: ALL_COMMENTS_NOTE_PATH,
        draftHostFilePath: ALL_COMMENTS_NOTE_PATH,
    });

    await harness.controller.setIndexNotePath("docs/renamed-index");

    assert.equal(harness.getSettings().indexNotePath, "docs/renamed-index.md");
    assert.deepEqual(harness.renamedFiles, [{
        from: ALL_COMMENTS_NOTE_PATH,
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
        files: [ALL_COMMENTS_NOTE_PATH],
    });
    await missingFolderHarness.controller.setIndexNotePath("missing/new-index");

    assert.deepEqual(missingFolderHarness.notices, ["Folder does not exist: missing"]);
    assert.equal(missingFolderHarness.savedPayloads.length, 0);

    const conflictHarness = createControllerHarness({
        files: [ALL_COMMENTS_NOTE_PATH, "docs/index.md"],
    });
    await conflictHarness.controller.setIndexNotePath("docs/index");

    assert.deepEqual(conflictHarness.notices, [
        "docs/index.md already exists. Choose another index note path.",
    ]);
    assert.equal(conflictHarness.savedPayloads.length, 0);
});
