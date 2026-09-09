import { getNormalizedFilterPath } from "./indexFileFilter";
import {
    INDEX_SIDEBAR_LIST_LIMIT,
    type IndexSidebarLimitNotice,
} from "./indexSidebarListLimit";
import type { IndexSidebarMode } from "./viewState";

export function resolveIndexSidebarGlobalSearchResultLimit(options: {
    mode: IndexSidebarMode;
    rootFilePath: string | null | undefined;
    query: string;
}): number | undefined {
    const isBoundedGlobalMode = options.mode === "todo" || options.mode === "list";
    return isBoundedGlobalMode
        && !getNormalizedFilterPath(options.rootFilePath ?? "")
        && !!options.query.trim()
        ? INDEX_SIDEBAR_LIST_LIMIT
        : undefined;
}

export function buildIndexSidebarGlobalSearchNotice(options: {
    visibleCount: number;
    hiddenCount: number;
    totalCount: number;
    query: string;
    rootFilePath: string | null | undefined;
}): IndexSidebarLimitNotice | null {
    if (
        options.hiddenCount <= 0
        || !options.query.trim()
        || getNormalizedFilterPath(options.rootFilePath ?? "")
    ) {
        return null;
    }
    return {
        primary: `${options.visibleCount} of ${options.totalCount} matches shown.`,
        secondary: "Refine your search or select a file.",
    };
}
