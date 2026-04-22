import {
    normalizeAgentRuntimeModePreference,
    normalizeRemoteRuntimeBaseUrl,
} from "../core/agents/agentRuntimePreferences";
import {
    isAllCommentsNotePath,
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../core/derived/allCommentsNote";
import {
    type SideNote2Settings,
} from "../ui/settings/SideNote2SettingTab";

export type PersistedPluginData = Partial<SideNote2Settings> & {
    preferredAgentTarget?: unknown;
    agentRuns?: unknown;
    confirmDelete?: unknown;
    enableDebugMode?: unknown;
    syncedBundledSidenoteSkillPluginVersion?: unknown;
};

export interface LoadedSettingsResolution {
    settings: SideNote2Settings;
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

export function resolveLoadedSettings(
    loaded: PersistedPluginData | null,
    defaults: SideNote2Settings,
): LoadedSettingsResolution {
    return {
        settings: {
            indexNotePath: normalizeAllCommentsNotePath(loaded?.indexNotePath),
            indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(loaded?.indexHeaderImageUrl),
            indexHeaderImageCaption: hasOwn(loaded ?? {}, "indexHeaderImageCaption")
                ? normalizeAllCommentsNoteImageCaption(loaded?.indexHeaderImageCaption)
                : defaults.indexHeaderImageCaption,
            agentRuntimeMode: hasOwn(loaded ?? {}, "agentRuntimeMode")
                ? normalizeAgentRuntimeModePreference(loaded?.agentRuntimeMode)
                : defaults.agentRuntimeMode,
            remoteRuntimeBaseUrl: hasOwn(loaded ?? {}, "remoteRuntimeBaseUrl")
                ? normalizeRemoteRuntimeBaseUrl(loaded?.remoteRuntimeBaseUrl)
                : defaults.remoteRuntimeBaseUrl,
        },
        shouldRewriteLegacySettings: hasOwn(loaded ?? {}, "confirmDelete")
            || hasOwn(loaded ?? {}, "preferredAgentTarget")
            || hasOwn(loaded ?? {}, "enableDebugMode"),
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
