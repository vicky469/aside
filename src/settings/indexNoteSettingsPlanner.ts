import {
    normalizeAgentRuntimeModePreference,
} from "../core/agents/agentRuntimePreferences";
import {
    DEFAULT_PUBLISH_SETTINGS,
    normalizePublishSettings,
} from "../core/publish/publishSettings";
import {
    normalizePublishedPublicArtifactPaths,
} from "../core/publish/publishedPublicArtifacts";
import {
    isAllCommentsNotePath,
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../core/derived/allCommentsNote";
import {
    type AsideSettings,
} from "../ui/settings/AsideSetting";

export type PersistedPluginData = Partial<AsideSettings> & {
    preferredAgentTarget?: unknown;
    agentRuns?: unknown;
    confirmDelete?: unknown;
    enableDebugMode?: unknown;
    remoteRuntimeBaseUrl?: unknown;
    syncedBundledSidenoteSkillPluginVersion?: unknown;
    sidecarStorageMigrationVersion?: unknown;
    sideNoteSyncEventState?: unknown;
    sideNoteSyncEventMigrationVersions?: unknown;
    sourceIdentityState?: unknown;
    sourceIdentityMigrationVersions?: unknown;
};

export interface LoadedSettingsResolution {
    settings: AsideSettings;
    shouldRewriteLegacySettings: boolean;
}

export type IndexNotePathChangePlan =
    | { kind: "noop"; nextPath: string }
    | { kind: "missing-parent"; nextPath: string; parentPath: string; notice: string }
    | { kind: "conflict"; nextPath: string; notice: string }
    | {
        kind: "apply";
        nextPath: string;
        shouldRenameCurrentIndexFile: boolean;
        shouldRetargetActiveSidebarFile: boolean;
        shouldRetargetDraftHostFile: boolean;
    };

function hasOwn(target: object, key: string): boolean {
    return Boolean(Object.prototype.hasOwnProperty.call(target, key));
}

function normalizeSidebarTabToggle(value: unknown): boolean {
    return typeof value === "boolean" ? value : true;
}

function shouldRewriteNormalizedPublishSettings(loaded: PersistedPluginData | null, normalized: typeof DEFAULT_PUBLISH_SETTINGS): boolean {
    const source = loaded ?? {};
    return (Object.keys(DEFAULT_PUBLISH_SETTINGS) as Array<keyof typeof DEFAULT_PUBLISH_SETTINGS>).some((key) =>
        hasOwn(source, key) && source[key] !== normalized[key]
    );
}

export function resolveLoadedSettings(
    loaded: PersistedPluginData | null,
    defaults: AsideSettings,
): LoadedSettingsResolution {
    const indexNotePath = normalizeAllCommentsNotePath(loaded?.indexNotePath);
    const hasTodoSidebarTabSetting = hasOwn(loaded ?? {}, "showTodoSidebarTab");
    const hasAgentSidebarTabSetting = hasOwn(loaded ?? {}, "showAgentSidebarTab");
    const showTodoSidebarTab = hasTodoSidebarTabSetting
        ? normalizeSidebarTabToggle(loaded?.showTodoSidebarTab)
        : true;
    const showAgentSidebarTab = hasAgentSidebarTabSetting
        ? normalizeSidebarTabToggle(loaded?.showAgentSidebarTab)
        : true;
    const publishSettings = normalizePublishSettings(loaded ?? defaults);

    return {
        settings: {
            indexNotePath,
            indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(loaded?.indexHeaderImageUrl),
            indexHeaderImageCaption: hasOwn(loaded ?? {}, "indexHeaderImageCaption")
                ? normalizeAllCommentsNoteImageCaption(loaded?.indexHeaderImageCaption)
                : defaults.indexHeaderImageCaption,
            agentRuntimeMode: hasOwn(loaded ?? {}, "agentRuntimeMode")
                ? normalizeAgentRuntimeModePreference(loaded?.agentRuntimeMode)
                : defaults.agentRuntimeMode,
            showTodoSidebarTab,
            showAgentSidebarTab,
            publishedPublicArtifactPaths: normalizePublishedPublicArtifactPaths(
                loaded?.publishedPublicArtifactPaths ?? defaults.publishedPublicArtifactPaths,
            ),
            ...publishSettings,
        },
        shouldRewriteLegacySettings: hasOwn(loaded ?? {}, "confirmDelete")
            || hasOwn(loaded ?? {}, "preferredAgentTarget")
            || hasOwn(loaded ?? {}, "enableDebugMode")
            || hasOwn(loaded ?? {}, "remoteRuntimeBaseUrl")
            || hasOwn(loaded ?? {}, "publishWranglerCommand")
            || !hasTodoSidebarTabSetting
            || !hasAgentSidebarTabSetting
            || (hasTodoSidebarTabSetting && typeof loaded?.showTodoSidebarTab !== "boolean")
            || (hasAgentSidebarTabSetting && typeof loaded?.showAgentSidebarTab !== "boolean")
            || (hasOwn(loaded ?? {}, "agentRuntimeMode")
                && normalizeAgentRuntimeModePreference(loaded?.agentRuntimeMode) !== loaded?.agentRuntimeMode)
            || shouldRewriteNormalizedPublishSettings(loaded, publishSettings),
    };
}

export function shouldApplyNormalizedSettingChange(options: {
    currentStoredValue: string;
    currentNormalizedValue: string;
    nextNormalizedValue: string;
}): boolean {
    return !(
        options.nextNormalizedValue === options.currentNormalizedValue
        && options.currentStoredValue === options.nextNormalizedValue
    );
}

export function getIndexNoteParentPath(filePath: string): string {
    const parts = filePath.split("/");
    return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

export function resolveIndexNotePathChange(options: {
    nextPathInput: string;
    currentStoredPath: string;
    previousPath: string;
    parentPath: string;
    parentExists: boolean;
    conflictingFilePath: string | null;
    currentIndexFilePath: string | null;
    activeSidebarFilePath: string | null;
    draftHostFilePath: string | null;
}): IndexNotePathChangePlan {
    const nextPath = normalizeAllCommentsNotePath(options.nextPathInput);
    if (nextPath === options.previousPath && options.currentStoredPath === nextPath) {
        return { kind: "noop", nextPath };
    }

    if (options.parentPath && !options.parentExists) {
        return {
            kind: "missing-parent",
            nextPath,
            parentPath: options.parentPath,
            notice: `Folder does not exist: ${options.parentPath}`,
        };
    }

    if (
        options.conflictingFilePath
        && options.conflictingFilePath !== options.currentIndexFilePath
    ) {
        return {
            kind: "conflict",
            nextPath,
            notice: `${nextPath} already exists. Choose another index note path.`,
        };
    }

    return {
        kind: "apply",
        nextPath,
        shouldRenameCurrentIndexFile: !!options.currentIndexFilePath && options.currentIndexFilePath !== nextPath,
        shouldRetargetActiveSidebarFile: !!options.activeSidebarFilePath
            && isAllCommentsNotePath(options.activeSidebarFilePath, options.previousPath),
        shouldRetargetDraftHostFile: !!options.draftHostFilePath
            && isAllCommentsNotePath(options.draftHostFilePath, options.previousPath),
    };
}
