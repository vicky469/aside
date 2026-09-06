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
        defaultAgent: overrides.defaultAgent ?? "codex",
        showTodoSidebarTab: overrides.showTodoSidebarTab ?? true,
        showAgentSidebarTab: overrides.showAgentSidebarTab ?? false,
        scriptsEnabled: overrides.scriptsEnabled ?? false,
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

test("loaded settings normalize the default agent and rewrite invalid values", () => {
    const resolved = resolveLoadedSettings({
        indexNotePath: ALL_COMMENTS_NOTE_PATH,
        defaultAgent: " GEMINI ",
    } as unknown as PersistedPluginData, createSettings());

    assert.equal(resolved.settings.defaultAgent, "gemini");
    assert.equal(resolved.shouldRewriteLegacySettings, true);
});

function withPublishDefaults(
    settings: Omit<AsideSettings, keyof typeof DEFAULT_PUBLISH_SETTINGS | "publishedPublicArtifactPaths" | "defaultAgent" | "scriptsEnabled">,
): AsideSettings {
    return {
        ...settings,
        defaultAgent: "codex",
        scriptsEnabled: false,
        publishedPublicArtifactPaths: [],
        ...DEFAULT_PUBLISH_SETTINGS,
    };
}

function withoutScriptsSetting(settings: AsideSettings = createSettings()): PersistedPluginData {
    const loaded: PersistedPluginData = { ...settings };
    delete loaded.scriptsEnabled;
    return loaded;
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
    saveData?: (data: PersistedPluginData) => Promise<void>;
    hasRegisteredVaultScripts?: boolean;
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
        hasRegisteredVaultScripts: () => options.hasRegisteredVaultScripts ?? false,
        loadData: async () => options.loadedData ?? null,
        saveData: async (data: PersistedPluginData) => {
            if (options.saveData) {
                await options.saveData(data);
                return;
            }
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

test("persisted plugin data updates serialize and apply against the latest successful value", async () => {
    const saveCalls: PersistedPluginData[] = [];
    const releases: Array<() => void> = [];
    const harness = createControllerHarness({
        saveData: async (data) => {
            saveCalls.push(data);
            await new Promise<void>((resolve) => releases.push(resolve));
        },
    });

    const agentUpdate = harness.controller.updatePersistedPluginData((data) => ({
        ...data,
        agentRuns: [{ id: "agent-run" }],
    }));
    const scriptUpdate = harness.controller.updatePersistedPluginData((data) => ({
        ...data,
        scriptRuns: [{ id: "script-run" }],
    }));

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(saveCalls.length, 1);
    releases.shift()?.();
    await agentUpdate;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(saveCalls[1], {
        agentRuns: [{ id: "agent-run" }],
        scriptRuns: [{ id: "script-run" }],
    });
    releases.shift()?.();
    await scriptUpdate;
    assert.deepEqual(harness.controller.readPersistedPluginData(), saveCalls[1]);
});

test("a failed persisted plugin data update leaves cached data unchanged and does not poison the queue", async () => {
    let saveAttempt = 0;
    const harness = createControllerHarness({
        saveData: async () => {
            saveAttempt += 1;
            if (saveAttempt === 1) {
                throw new Error("save failed");
            }
        },
    });

    const failedUpdate = harness.controller.updatePersistedPluginData((data) => ({
        ...data,
        agentRuns: [{ id: "lost-agent-run" }],
    }));
    const succeedingUpdate = harness.controller.updatePersistedPluginData((data) => ({
        ...data,
        scriptRuns: [{ id: "script-run" }],
    }));

    await assert.rejects(failedUpdate, /save failed/u);
    await succeedingUpdate;
    assert.deepEqual(harness.controller.readPersistedPluginData(), {
        scriptRuns: [{ id: "script-run" }],
    });
});

test("a queued legacy write patches stale data without overwriting an earlier atomic update", async () => {
    const releases: Array<() => void> = [];
    const saveCalls: PersistedPluginData[] = [];
    const loadedData: PersistedPluginData = {
        ...createSettings(),
        agentRuns: [{ id: "agent-run" }],
    };
    const harness = createControllerHarness({
        loadedData,
        saveData: async (data) => {
            saveCalls.push(data);
            await new Promise<void>((resolve) => releases.push(resolve));
        },
    });
    await harness.controller.loadSettings();
    const staleData = harness.controller.readPersistedPluginData();

    const scriptUpdate = harness.controller.updatePersistedPluginData((data) => ({
        ...data,
        scriptRuns: [{ id: "script-run" }],
    }));
    const legacyWrite = harness.controller.writePersistedPluginData({
        ...staleData,
        showTodoSidebarTab: false,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(saveCalls.length, 1);
    releases.shift()?.();
    await scriptUpdate;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(saveCalls.length, 2);
    releases.shift()?.();
    await legacyWrite;

    const persistedData = harness.controller.readPersistedPluginData();
    assert.deepEqual(persistedData.agentRuns, [{ id: "agent-run" }]);
    assert.deepEqual(persistedData.scriptRuns, [{ id: "script-run" }]);
    assert.equal(persistedData.showTodoSidebarTab, false);
});

test("legacy persisted data patches preserve deletes and detach nested snapshots", async () => {
    const loadedData: PersistedPluginData = {
        ...createSettings(),
        sourceIdentityState: {
            nested: { value: "original" },
        },
        sourceIdentityMigrationVersions: [1],
    };
    const harness = createControllerHarness({ loadedData });
    await harness.controller.loadSettings();
    const readSnapshot = harness.controller.readPersistedPluginData();
    const readState = readSnapshot.sourceIdentityState as { nested: { value: string } };
    readState.nested.value = "mutated read";
    assert.equal(
        (harness.controller.readPersistedPluginData().sourceIdentityState as { nested: { value: string } }).nested.value,
        "original",
    );

    const nextState = { nested: { value: "queued" } };
    const nextData = harness.controller.readPersistedPluginData();
    nextData.sourceIdentityState = nextState;
    delete nextData.sourceIdentityMigrationVersions;
    const write = harness.controller.writePersistedPluginData(nextData);
    nextState.nested.value = "mutated input";
    await write;

    const persistedData = harness.controller.readPersistedPluginData();
    assert.deepEqual(persistedData.sourceIdentityState, {
        nested: { value: "queued" },
    });
    assert.equal(
        Object.prototype.hasOwnProperty.call(persistedData, "sourceIdentityMigrationVersions"),
        false,
    );
});

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
        showAgentSidebarTab: false,
    }));
    assert.equal(resolved.shouldRewriteLegacySettings, true);
});

test("loaded settings resolution defaults Todo on and agents off when missing or new", () => {
    for (const loaded of [null, {}]) {
        const resolved = resolveLoadedSettings(loaded, createSettings());

        assert.equal(resolved.settings.showTodoSidebarTab, true);
        assert.equal(resolved.settings.showAgentSidebarTab, false);
        assert.equal(resolved.shouldRewriteLegacySettings, true);
    }
});

test("loaded settings resolution defaults Scripts off for new and side-note-only state", () => {
    const sideNoteOnlyState: PersistedPluginData = {
        ...withoutScriptsSetting(),
        sideNoteSyncEventState: {
            sources: {},
        },
    };

    for (const loaded of [null, sideNoteOnlyState]) {
        const resolved = resolveLoadedSettings(loaded, createSettings());

        assert.equal(resolved.settings.scriptsEnabled, false);
        assert.equal(resolved.shouldRewriteLegacySettings, true);
    }
});

test("loaded settings resolution infers Scripts on from run history or registry evidence", () => {
    const cases: Array<{
        loaded: PersistedPluginData;
        hasRegisteredVaultScripts: boolean;
    }> = [
        {
            loaded: { agentRuns: [{ id: "agent-run" }] },
            hasRegisteredVaultScripts: false,
        },
        {
            loaded: { scriptRuns: [{ id: "script-run" }] },
            hasRegisteredVaultScripts: false,
        },
        {
            loaded: {},
            hasRegisteredVaultScripts: true,
        },
    ];

    for (const { loaded, hasRegisteredVaultScripts } of cases) {
        const resolved = resolveLoadedSettings(loaded, createSettings(), {
            hasRegisteredVaultScripts,
        });

        assert.equal(resolved.settings.scriptsEnabled, true);
        assert.equal(resolved.shouldRewriteLegacySettings, true);
    }
});

test("loaded settings resolution lets explicit Scripts booleans override migration evidence", () => {
    for (const scriptsEnabled of [true, false]) {
        const resolved = resolveLoadedSettings({
            scriptsEnabled,
            agentRuns: [{ id: "agent-run" }],
            scriptRuns: [{ id: "script-run" }],
        }, createSettings(), {
            hasRegisteredVaultScripts: true,
        });

        assert.equal(resolved.settings.scriptsEnabled, scriptsEnabled);
    }
});

test("loaded settings resolution infers and rewrites invalid Scripts state", () => {
    const inferredOn = resolveLoadedSettings({
        scriptsEnabled: "yes" as unknown as boolean,
        scriptRuns: [{ id: "script-run" }],
    }, createSettings());
    const inferredOff = resolveLoadedSettings({
        scriptsEnabled: 1 as unknown as boolean,
    }, createSettings());

    assert.equal(inferredOn.settings.scriptsEnabled, true);
    assert.equal(inferredOn.shouldRewriteLegacySettings, true);
    assert.equal(inferredOff.settings.scriptsEnabled, false);
    assert.equal(inferredOff.shouldRewriteLegacySettings, true);
});

test("loaded settings resolution preserves explicit agent tab booleans", () => {
    const visible = resolveLoadedSettings({
        showAgentSidebarTab: true,
    }, createSettings());
    const hidden = resolveLoadedSettings({
        showAgentSidebarTab: false,
    }, createSettings());

    assert.equal(visible.settings.showAgentSidebarTab, true);
    assert.equal(hidden.settings.showAgentSidebarTab, false);
});

test("loaded settings resolution defaults an invalid agent tab toggle off and rewrites it", () => {
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
        showAgentSidebarTab: false,
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
        showAgentSidebarTab: false,
    }));
    assert.equal(harness.savedPayloads.length, 1);
    assert.equal("preferredAgentTarget" in harness.savedPayloads[0], false);
    assert.equal("confirmDelete" in harness.savedPayloads[0], false);
    assert.equal("enableDebugMode" in harness.savedPayloads[0], false);
});

test("index note settings controller uses registered vault scripts as migration evidence", async () => {
    const harness = createControllerHarness({
        loadedData: withoutScriptsSetting(),
        hasRegisteredVaultScripts: true,
    });

    await harness.controller.loadSettings();

    assert.equal(harness.getSettings().scriptsEnabled, true);
    assert.equal(harness.savedPayloads.at(-1)?.scriptsEnabled, true);
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
        showAgentSidebarTab: false,
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
        showAgentSidebarTab: false,
    }));
    assert.equal(harness.getRefreshAggregateNoteCount(), 0);
    assert.deepEqual(harness.savedPayloads.at(-1), withPublishDefaults({
        indexNotePath: ALL_COMMENTS_NOTE_PATH,
        indexHeaderImageUrl: "https://example.com/default.webp",
        indexHeaderImageCaption: "Default caption",
        agentRuntimeMode: "local",
        showTodoSidebarTab: true,
        showAgentSidebarTab: false,
    }));
});

test("index note settings controller persists the default agent", async () => {
    const harness = createControllerHarness();

    await harness.controller.setDefaultAgent("claude");

    assert.equal(harness.getSettings().defaultAgent, "claude");
    assert.equal(harness.savedPayloads.at(-1)?.defaultAgent, "claude");
});

test("index note settings controller saves sidebar tab toggles and refreshes open sidebars", async () => {
    const harness = createControllerHarness({
        settings: createSettings({ showAgentSidebarTab: true }),
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

test("index note settings controller persists Scripts changes and ignores unchanged state", async () => {
    const harness = createControllerHarness();

    await harness.controller.setScriptsEnabled(false);
    assert.equal(harness.savedPayloads.length, 0);

    await harness.controller.setScriptsEnabled(true);

    assert.equal(harness.getSettings().scriptsEnabled, true);
    assert.equal(harness.savedPayloads.length, 1);
    assert.equal(harness.savedPayloads[0]?.scriptsEnabled, true);
});

test("capability setters restore persisted state after save failure", async () => {
    const harness = createControllerHarness({
        saveDataError: new Error("save failed"),
    });

    await assert.rejects(harness.controller.setScriptsEnabled(true), /save failed/u);
    assert.equal(harness.getSettings().scriptsEnabled, false);

    await assert.rejects(harness.controller.setPublishEnabled(true), /save failed/u);
    assert.equal(harness.getSettings().publishEnabled, false);
});

test("overlapping Scripts changes persist the final requested value", async () => {
    const saveCalls: PersistedPluginData[] = [];
    const releases: Array<() => void> = [];
    const harness = createControllerHarness({
        loadedData: createSettings({ scriptsEnabled: false }),
        saveData: async (data) => {
            saveCalls.push(data);
            await new Promise<void>((resolve) => releases.push(resolve));
        },
    });
    await harness.controller.loadSettings();

    const enable = harness.controller.setScriptsEnabled(true);
    const disable = harness.controller.setScriptsEnabled(false);

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(saveCalls.map((data) => data.scriptsEnabled), [true]);
    releases.shift()?.();
    await enable;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(saveCalls.map((data) => data.scriptsEnabled), [true, false]);
    releases.shift()?.();
    await disable;

    assert.equal(harness.getSettings().scriptsEnabled, false);
    assert.equal(harness.controller.readPersistedPluginData().scriptsEnabled, false);
});

test("overlapping Publishing changes persist the final requested value", async () => {
    const saveCalls: PersistedPluginData[] = [];
    const releases: Array<() => void> = [];
    const harness = createControllerHarness({
        loadedData: createSettings({ publishEnabled: false }),
        saveData: async (data) => {
            saveCalls.push(data);
            await new Promise<void>((resolve) => releases.push(resolve));
        },
    });
    await harness.controller.loadSettings();

    const enable = harness.controller.setPublishEnabled(true);
    const disable = harness.controller.setPublishEnabled(false);

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(saveCalls.map((data) => data.publishEnabled), [true]);
    releases.shift()?.();
    await enable;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(saveCalls.map((data) => data.publishEnabled), [true, false]);
    releases.shift()?.();
    await disable;

    assert.equal(harness.getSettings().publishEnabled, false);
    assert.equal(harness.controller.readPersistedPluginData().publishEnabled, false);
});

test("a failed capability write cannot restore stale state over a later capability request", async () => {
    const saveCalls: PersistedPluginData[] = [];
    const pendingSaves: Array<{
        resolve: () => void;
        reject: (error: Error) => void;
    }> = [];
    const harness = createControllerHarness({
        loadedData: createSettings({
            scriptsEnabled: false,
            publishEnabled: false,
        }),
        saveData: async (data) => {
            saveCalls.push(data);
            await new Promise<void>((resolve, reject) => pendingSaves.push({ resolve, reject }));
        },
    });
    await harness.controller.loadSettings();

    const enableScripts = harness.controller.setScriptsEnabled(true);
    const enablePublishing = harness.controller.setPublishEnabled(true);

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(saveCalls.length, 1);
    pendingSaves.shift()?.reject(new Error("save failed"));
    await assert.rejects(enableScripts, /save failed/u);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(saveCalls.length, 2);
    assert.equal(saveCalls[1]?.scriptsEnabled, false);
    assert.equal(saveCalls[1]?.publishEnabled, true);
    pendingSaves.shift()?.resolve();
    await enablePublishing;

    assert.equal(harness.getSettings().scriptsEnabled, false);
    assert.equal(harness.getSettings().publishEnabled, true);
    assert.equal(harness.controller.readPersistedPluginData().scriptsEnabled, false);
    assert.equal(harness.controller.readPersistedPluginData().publishEnabled, true);
});

test("disabling capabilities preserves run history and publishing configuration", async () => {
    const agentRuns = [{ id: "agent-run" }];
    const scriptRuns = [{ id: "script-run" }];
    const publishBaseUrl = "https://publish.example.com";
    const harness = createControllerHarness({
        loadedData: {
            ...createSettings({
                scriptsEnabled: true,
                publishEnabled: true,
                publishBaseUrl,
            }),
            agentRuns,
            scriptRuns,
        },
    });
    await harness.controller.loadSettings();

    await harness.controller.setScriptsEnabled(false);
    await harness.controller.setPublishEnabled(false);

    assert.deepEqual(harness.savedPayloads.at(-1)?.agentRuns, agentRuns);
    assert.deepEqual(harness.savedPayloads.at(-1)?.scriptRuns, scriptRuns);
    assert.equal(harness.savedPayloads.at(-1)?.publishBaseUrl, publishBaseUrl);
    assert.equal(harness.savedPayloads.at(-1)?.scriptsEnabled, false);
    assert.equal(harness.savedPayloads.at(-1)?.publishEnabled, false);
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

test("loaded settings resolution drops legacy feature flags", () => {
    const resolved = resolveLoadedSettings({
        featureFlags: {
            publish: true,
        },
    } as unknown as PersistedPluginData, createSettings());

    assert.equal("featureFlags" in resolved.settings, false);
    assert.equal(resolved.shouldRewriteLegacySettings, true);
});

test("settings load removes legacy feature flags without disturbing current data", async () => {
    const persistedSettings = {
        ...createSettings({
            indexHeaderImageCaption: "Keep this caption",
            publishPagesProjectName: "publish-example-com",
            publishBaseUrl: "https://publish.example.com",
        }),
        featureFlags: {
            publish: true,
        },
    } as unknown as PersistedPluginData;
    const harness = createControllerHarness({
        loadedData: persistedSettings,
    });

    await harness.controller.loadSettings();

    assert.equal("featureFlags" in harness.getSettings(), false);
    assert.equal(harness.savedPayloads.length, 1);
    assert.equal("featureFlags" in (harness.savedPayloads[0] ?? {}), false);
    assert.equal(harness.savedPayloads[0]?.indexHeaderImageCaption, "Keep this caption");
    assert.equal(harness.savedPayloads[0]?.publishBaseUrl, "https://publish.example.com");
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
