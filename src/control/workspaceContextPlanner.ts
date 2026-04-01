import type { MarkdownViewModeType } from "obsidian";

export interface WorkspaceFileTargets<T> {
    activeMarkdownFile: T | null;
    activeSidebarFile: T | null;
    sidebarFile: T | null;
}

export function resolveWorkspaceFileTargets<T>(
    file: T | null,
    activeMarkdownFile: T | null,
    isMarkdownCommentableFile: (file: T | null) => file is T,
    isSidebarSupportedFile: (file: T | null) => file is T,
): WorkspaceFileTargets<T> {
    const nextActiveMarkdownFile = isMarkdownCommentableFile(file)
        ? file
        : activeMarkdownFile;
    const nextActiveSidebarFile = isSidebarSupportedFile(file)
        ? file
        : null;

    return {
        activeMarkdownFile: nextActiveMarkdownFile,
        activeSidebarFile: nextActiveSidebarFile,
        sidebarFile: nextActiveSidebarFile,
    };
}

export function shouldIgnoreWorkspaceLeafChange(viewType: string | null): boolean {
    return viewType === "sidenote2-view";
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
