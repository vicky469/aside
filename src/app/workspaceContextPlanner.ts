import type { MarkdownViewModeType } from "obsidian";

export interface WorkspaceFileTargets<T> {
    activeMarkdownFile: T | null;
    activeSidebarFile: T | null;
    sidebarFile: T | null;
}

export type WorkspaceLeafFileResolver<T> = (path: string) => T | null;

export function resolveWorkspaceTargetInput<T>(
    eventFile: T | null,
    workspaceActiveFile: T | null,
): T | null {
    return eventFile ?? workspaceActiveFile;
}

export function resolveWorkspaceLeafFile<T>(
    leaf: unknown,
    isFile: (value: unknown) => value is T,
    resolveFileByPath?: WorkspaceLeafFileResolver<T>,
): T | null {
    const fileValue = getWorkspaceLeafFileValue(leaf, resolveFileByPath);
    return fileValue.hasValue && isFile(fileValue.value) ? fileValue.value : null;
}

export function resolveWorkspaceLeafTargetInput<T>(
    leaf: unknown,
    _workspaceActiveFile: T | null,
    isFile: (value: unknown) => value is T,
    resolveFileByPath?: WorkspaceLeafFileResolver<T>,
): T | null {
    const fileValue = getWorkspaceLeafFileValue(leaf, resolveFileByPath);
    if (!fileValue.hasValue) {
        return null;
    }

    return isFile(fileValue.value) ? fileValue.value : null;
}

function getWorkspaceLeafFileValue<T>(
    leaf: unknown,
    resolveFileByPath?: WorkspaceLeafFileResolver<T>,
): {
    hasValue: boolean;
    value: unknown;
} {
    if (!leaf || typeof leaf !== "object" || !("view" in leaf)) {
        return {
            hasValue: false,
            value: null,
        };
    }

    const view = leaf.view;
    if (!view || typeof view !== "object") {
        return {
            hasValue: false,
            value: null,
        };
    }

    const stateFilePath = getWorkspaceLeafStateFilePath(leaf);
    if (stateFilePath && resolveFileByPath) {
        const file = resolveFileByPath(stateFilePath);
        return {
            hasValue: true,
            value: file,
        };
    }

    if ("file" in view && view.file !== null && view.file !== undefined) {
        return {
            hasValue: true,
            value: view.file,
        };
    }

    return {
        hasValue: false,
        value: null,
    };
}

function getWorkspaceLeafStateFilePath(leaf: unknown): string | null {
    const getViewState = (leaf as { getViewState?: unknown }).getViewState;
    if (typeof getViewState !== "function") {
        return null;
    }

    let viewState: unknown;
    try {
        viewState = getViewState.call(leaf);
    } catch {
        return null;
    }

    if (!viewState || typeof viewState !== "object") {
        return null;
    }

    const state = (viewState as { state?: unknown }).state;
    if (!state || typeof state !== "object") {
        return null;
    }

    const filePath = (state as { file?: unknown }).file;
    return typeof filePath === "string" && filePath.trim() ? filePath.trim() : null;
}

export function resolveWorkspaceFileTargets<T>(
    file: T | null,
    activeMarkdownFile: T | null,
    activeSidebarFile: T | null,
    isMarkdownCommentableFile: (file: T | null) => file is T,
    isSidebarSupportedFile: (file: T | null) => file is T,
): WorkspaceFileTargets<T> {
    const nextActiveMarkdownFile = isMarkdownCommentableFile(file)
        ? file
        : activeMarkdownFile;
    const nextActiveSidebarFile = isSidebarSupportedFile(file)
        ? file
        : file === null
            ? activeSidebarFile
            : null;
    const sidebarFile = isSidebarSupportedFile(file)
        ? file
        : file === null
            ? activeSidebarFile
            : null;

    return {
        activeMarkdownFile: nextActiveMarkdownFile,
        activeSidebarFile: nextActiveSidebarFile,
        sidebarFile,
    };
}

export function shouldIgnoreWorkspaceLeafChange(viewType: string | null): boolean {
    return viewType === "aside-view";
}

export function shouldIgnoreWorkspaceFileOpen<T>(
    eventFile: T | null,
    workspaceActiveFile: T | null = null,
): boolean {
    return eventFile === null && workspaceActiveFile === null;
}

export interface ResolvedMarkdownViewState {
    mode: MarkdownViewModeType;
    // Obsidian uses mode: "source" for both live preview and source mode.
    // This flag distinguishes raw source mode from live preview.
    sourceMode: boolean;
}

export function resolveIndexLeafMode(options: {
    isMarkdownLeaf: boolean;
    isIndexLeaf: boolean;
    currentViewMode: MarkdownViewModeType;
    isSourceMode?: boolean;
}): ResolvedMarkdownViewState | null {
    if (!options.isMarkdownLeaf) {
        return null;
    }

    if (options.isIndexLeaf) {
        return options.currentViewMode === "preview"
            ? null
            : { mode: "preview", sourceMode: false };
    }

    if (options.currentViewMode === "source" && options.isSourceMode === false) {
        return null;
    }

    return {
        mode: "source",
        sourceMode: false,
    };
}
