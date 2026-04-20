import { getNormalizedFilterPath, normalizeIndexFileFilterPaths } from "./indexFileFilter";

export type SidebarPrimaryMode = "list" | "thought-trail";
export type IndexSidebarMode = SidebarPrimaryMode;
export type NoteSidebarMode = SidebarPrimaryMode;

export interface CustomViewState extends Record<string, unknown> {
    filePath: string | null;
    indexSidebarMode?: IndexSidebarMode;
    noteSidebarMode?: NoteSidebarMode;
    indexFileFilterRootPath?: string | null;
    indexFileFilterPaths?: string[];
}

export function normalizeSidebarPrimaryMode(value: unknown): SidebarPrimaryMode | null {
    return value === "list" || value === "thought-trail"
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
