// @todo Design global Index search as a separate surface from these file-scoped sidebar tabs.

import type { CommentThread } from "../../commentManager";
import {
    rankSidebarSearchResults,
    type RankedSidebarSearchResult,
} from "./sidebarContentFilter";
import {
    buildIndexSidebarGlobalSearchNotice,
    resolveIndexSidebarGlobalSearchResultLimit,
} from "./indexSidebarGlobalSearch";
import type { IndexSidebarLimitNotice } from "./indexSidebarListLimit";
import type { IndexSidebarMode } from "./viewState";

export interface IndexSidebarSearchWindow<T> extends RankedSidebarSearchResult<T> {
    notice: IndexSidebarLimitNotice | null;
}

export function buildIndexSidebarSearchWindow<
    T extends Pick<CommentThread, "selectedText" | "entries">
>(options: {
    threads: readonly T[];
    query: string;
    mode: IndexSidebarMode;
    rootFilePath: string | null | undefined;
}): IndexSidebarSearchWindow<T> {
    const limit = resolveIndexSidebarGlobalSearchResultLimit({
        mode: options.mode,
        rootFilePath: options.rootFilePath,
        query: options.query,
    });
    const result = rankSidebarSearchResults(options.threads, options.query, { limit });
    return {
        ...result,
        notice: buildIndexSidebarGlobalSearchNotice({
            visibleCount: result.items.length,
            hiddenCount: result.hiddenMatchCount,
            totalCount: result.totalMatchCount,
            query: options.query,
            rootFilePath: options.rootFilePath,
        }),
    };
}

export function includeActiveDraftHostInIndexSearchWindow<T extends Pick<CommentThread, "id">>(
    searchResults: readonly T[],
    eligibleThreads: readonly T[],
    activeDraftHostThreadId: string | null | undefined,
): T[] {
    const items = searchResults.slice();
    if (!activeDraftHostThreadId || items.some((thread) => thread.id === activeDraftHostThreadId)) {
        return items;
    }

    const activeDraftHost = eligibleThreads.find((thread) => thread.id === activeDraftHostThreadId);
    if (activeDraftHost) {
        items.push(activeDraftHost);
    }
    return items;
}
