import { getNormalizedFilterPath, normalizeIndexFileFilterPaths } from "./indexFileFilter";

export type SidebarPrimaryMode = "list" | "tags" | "todo" | "agent" | "thought-trail";
export type IndexSidebarMode = SidebarPrimaryMode;
export type NoteSidebarMode = SidebarPrimaryMode;

export interface CommentTagProjection {
    filePath: string;
    threadId: string;
    tagRaw: string;
    tagKey: string;
}

export interface FileTagIndex {
    filePath: string;
    threadIdsByTag: Map<string, Set<string>>;
    tagsByThreadId: Map<string, Set<string>>;
    tagsByDisplay: Map<string, string>;
}

export interface BatchTagFlowState {
    isOpen: boolean;
    isApplying: boolean;
    query: string;
    selectedTagKey: string | null;
    selectedTagText: string | null;
    candidateTagTexts: readonly string[];
    failures: readonly {
        threadId: string;
        reason: string;
        message: string;
    }[];
}

export interface NoteSidebarTagsUiState {
    mode: SidebarPrimaryMode;
    searchQuery: string;
    searchInputValue: string;
    selectedThreadIds: readonly string[];
    visibleTagFilterKey: string | null;
    batchTagFlow: BatchTagFlowState;
}

export interface PinnedSidebarFileState {
    threadIds: string[];
    showPinnedThreadsOnly: boolean;
}

export interface CustomViewState extends Record<string, unknown> {
    filePath: string | null;
    indexSidebarMode?: IndexSidebarMode;
    noteSidebarMode?: NoteSidebarMode;
    indexFileFilterRootPath?: string | null;
    indexFileFilterPaths?: string[];
    pinnedSidebarStateByFilePath?: Record<string, PinnedSidebarFileState>;
    pinnedSidebarFilePath?: string | null;
}

export function normalizeSidebarPrimaryMode(value: unknown): SidebarPrimaryMode | null {
    return value === "list" || value === "tags" || value === "todo" || value === "agent" || value === "thought-trail"
        ? value
        : null;
}

export function normalizeIndexSidebarMode(value: unknown): IndexSidebarMode | null {
    return value === "list" || value === "tags" || value === "todo" || value === "agent" || value === "thought-trail"
        ? value
        : null;
}

export function normalizeIndexFileFilterRootPath(filePath: string | null | undefined): string | null {
    if (!filePath) {
        return null;
    }

    return normalizeIndexFileFilterPaths([filePath])[0] ?? null;
}

export function resolveIndexFileFilterRootPathFromState(state: Pick<CustomViewState, "indexFileFilterRootPath" | "indexFileFilterPaths">): string | null | undefined {
    if (Object.prototype.hasOwnProperty.call(state, "indexFileFilterRootPath")) {
        return typeof state.indexFileFilterRootPath === "string" || state.indexFileFilterRootPath === null
            ? normalizeIndexFileFilterRootPath(state.indexFileFilterRootPath)
            : null;
    }

    if (Object.prototype.hasOwnProperty.call(state, "indexFileFilterPaths")) {
        for (const filePath of state.indexFileFilterPaths ?? []) {
            if (typeof filePath !== "string") {
                continue;
            }

            const normalized = getNormalizedFilterPath(filePath);
            if (normalized) {
                return normalized;
            }
        }

        return null;
    }

    return undefined;
}

export function resolvePinnedSidebarFilePathFromState(
    state: Pick<CustomViewState, "pinnedSidebarFilePath">,
): string | null | undefined {
    if (!hasOwn(state, "pinnedSidebarFilePath")) {
        return undefined;
    }

    if (typeof state.pinnedSidebarFilePath === "string" || state.pinnedSidebarFilePath === null) {
        return normalizeIndexFileFilterRootPath(state.pinnedSidebarFilePath);
    }

    return null;
}

export function shouldIgnorePinnedSidebarActiveFileUpdate(options: {
    pinnedSidebarFilePath: string | null;
    nextFilePath: string | null;
}): boolean {
    return options.pinnedSidebarFilePath !== null
        && options.nextFilePath !== options.pinnedSidebarFilePath;
}

function hasOwn(target: object, key: string): boolean {
    return Boolean(Object.prototype.hasOwnProperty.call(target, key));
}

function normalizePinnedSidebarThreadIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const uniqueThreadIds = new Set<string>();
    for (const candidate of value) {
        if (typeof candidate !== "string") {
            continue;
        }

        const normalized = candidate.trim();
        if (!normalized) {
            continue;
        }

        uniqueThreadIds.add(normalized);
    }

    return Array.from(uniqueThreadIds);
}

export function resolvePinnedSidebarStateByFilePathFromState(
    state: Pick<CustomViewState, "pinnedSidebarStateByFilePath">,
): Record<string, PinnedSidebarFileState> | undefined {
    if (!hasOwn(state, "pinnedSidebarStateByFilePath")) {
        return undefined;
    }

    const rawState = state.pinnedSidebarStateByFilePath;
    if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
        return {};
    }

    const normalizedState: Record<string, PinnedSidebarFileState> = {};
    for (const [filePath, rawFileState] of Object.entries(rawState)) {
        const normalizedFilePath = getNormalizedFilterPath(filePath);
        if (!normalizedFilePath || !rawFileState || typeof rawFileState !== "object" || Array.isArray(rawFileState)) {
            continue;
        }

        const threadIds = normalizePinnedSidebarThreadIds(
            (rawFileState as { threadIds?: unknown }).threadIds,
        );
        const showPinnedThreadsOnly = (rawFileState as { showPinnedThreadsOnly?: unknown }).showPinnedThreadsOnly === true;
        if (threadIds.length === 0 && !showPinnedThreadsOnly) {
            continue;
        }

        normalizedState[normalizedFilePath] = {
            threadIds,
            showPinnedThreadsOnly,
        };
    }

    return normalizedState;
}
