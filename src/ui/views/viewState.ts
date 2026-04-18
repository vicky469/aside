import { getNormalizedFilterPath, normalizeIndexFileFilterPaths } from "./indexFileFilter";

export type IndexSidebarMode = "list" | "thought-trail" | "agent";
export type IndexAgentOutcomeFilter = "all" | "succeeded" | "failed";

export interface CustomViewState extends Record<string, unknown> {
    filePath: string | null;
    indexSidebarMode?: IndexSidebarMode;
    indexAgentOutcomeFilter?: IndexAgentOutcomeFilter;
    indexFileFilterRootPath?: string | null;
    indexFileFilterPaths?: string[];
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

export function resolveIndexAgentOutcomeFilterFromState(
    state: Pick<CustomViewState, "indexAgentOutcomeFilter">,
): IndexAgentOutcomeFilter | undefined {
    if (!Object.prototype.hasOwnProperty.call(state, "indexAgentOutcomeFilter")) {
        return undefined;
    }

    return state.indexAgentOutcomeFilter === "succeeded" || state.indexAgentOutcomeFilter === "failed"
        ? state.indexAgentOutcomeFilter
        : "all";
}
