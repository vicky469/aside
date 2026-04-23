import type { CommentThread } from "../../commentManager";
import { parseAgentDirectives } from "../../core/text/agentDirectives";
import type { DraftComment } from "../../domain/drafts";

export type SidebarContentFilter = "all" | "bookmarks" | "agents";

const SIDEBAR_SEARCH_EXACT_MATCH_SCORE = 600;
const SIDEBAR_SEARCH_PREFIX_MATCH_SCORE = 560;
const SIDEBAR_SEARCH_PHRASE_MATCH_SCORE = 520;
const SIDEBAR_SEARCH_SINGLE_TERM_WHOLE_WORD_SCORE = 360;
const SIDEBAR_SEARCH_SINGLE_TERM_SUBSTRING_SCORE = 320;
const SIDEBAR_SEARCH_MULTI_TERM_ORDERED_BASE_SCORE = 440;
const SIDEBAR_SEARCH_MULTI_TERM_UNORDERED_SCORE = 340;
const SIDEBAR_SEARCH_MULTI_TERM_SPREAD_PENALTY_CAP = 80;
const SIDEBAR_SEARCH_SELECTED_TEXT_BONUS = 300;
const SIDEBAR_SEARCH_ENTRY_RECENCY_BONUS = 220;
const SIDEBAR_SEARCH_ENTRY_RECENCY_STEP = 10;
const SIDEBAR_SEARCH_ENTRY_RECENCY_BONUS_FLOOR = 120;

function normalizeSidebarSearchText(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function matchesNormalizedSidebarSearchValue(value: string | null | undefined, normalizedQuery: string): boolean {
    if (!normalizedQuery) {
        return true;
    }

    if (!value) {
        return false;
    }

    return normalizeSidebarSearchText(value).includes(normalizedQuery);
}

function escapeSidebarSearchRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNormalizedSidebarSearchTerms(normalizedQuery: string): string[] {
    if (!normalizedQuery) {
        return [];
    }

    return Array.from(new Set(normalizedQuery.split(" ").filter(Boolean)));
}

function hasWholeWordSidebarSearchMatch(value: string, term: string): boolean {
    return new RegExp(`(^|[^a-z0-9])${escapeSidebarSearchRegExp(term)}([^a-z0-9]|$)`).test(value);
}

function findOrderedSidebarSearchTermPositions(value: string, terms: readonly string[]): number[] | null {
    const positions: number[] = [];
    let nextStart = 0;

    for (const term of terms) {
        const position = value.indexOf(term, nextStart);
        if (position === -1) {
            return null;
        }

        positions.push(position);
        nextStart = position + term.length;
    }

    return positions;
}

function getNormalizedSidebarSearchValueScore(value: string | null | undefined, normalizedQuery: string): number {
    if (!normalizedQuery || !value) {
        return 0;
    }

    const normalizedValue = normalizeSidebarSearchText(value);
    if (!normalizedValue) {
        return 0;
    }

    if (normalizedValue === normalizedQuery) {
        return SIDEBAR_SEARCH_EXACT_MATCH_SCORE;
    }

    if (normalizedValue.startsWith(normalizedQuery)) {
        return SIDEBAR_SEARCH_PREFIX_MATCH_SCORE;
    }

    if (normalizedValue.includes(normalizedQuery)) {
        return SIDEBAR_SEARCH_PHRASE_MATCH_SCORE;
    }

    const queryTerms = getNormalizedSidebarSearchTerms(normalizedQuery);
    if (queryTerms.length === 0) {
        return 0;
    }

    if (queryTerms.length === 1) {
        return normalizedValue.includes(queryTerms[0])
            ? hasWholeWordSidebarSearchMatch(normalizedValue, queryTerms[0])
                ? SIDEBAR_SEARCH_SINGLE_TERM_WHOLE_WORD_SCORE
                : SIDEBAR_SEARCH_SINGLE_TERM_SUBSTRING_SCORE
            : 0;
    }

    if (!queryTerms.every((term) => normalizedValue.includes(term))) {
        return 0;
    }

    const orderedPositions = findOrderedSidebarSearchTermPositions(normalizedValue, queryTerms);
    if (!orderedPositions) {
        return SIDEBAR_SEARCH_MULTI_TERM_UNORDERED_SCORE;
    }

    const spread = orderedPositions[orderedPositions.length - 1] - orderedPositions[0];
    return SIDEBAR_SEARCH_MULTI_TERM_ORDERED_BASE_SCORE
        - Math.min(SIDEBAR_SEARCH_MULTI_TERM_SPREAD_PENALTY_CAP, spread);
}

function getSidebarSearchEntryBonus(entryIndex: number, entryCount: number): number {
    const recencyOffset = entryCount - entryIndex - 1;
    return Math.max(
        SIDEBAR_SEARCH_ENTRY_RECENCY_BONUS_FLOOR,
        SIDEBAR_SEARCH_ENTRY_RECENCY_BONUS - recencyOffset * SIDEBAR_SEARCH_ENTRY_RECENCY_STEP,
    );
}

export function getSidebarThreadSearchScore<T extends Pick<CommentThread, "selectedText" | "entries">>(
    thread: T,
    query: string,
): number {
    const normalizedQuery = normalizeSidebarSearchText(query);
    if (!normalizedQuery) {
        return 0;
    }

    let bestScore = 0;
    const selectedTextScore = getNormalizedSidebarSearchValueScore(thread.selectedText, normalizedQuery);
    if (selectedTextScore > 0) {
        bestScore = selectedTextScore + SIDEBAR_SEARCH_SELECTED_TEXT_BONUS;
    }

    for (let index = 0; index < thread.entries.length; index += 1) {
        const entryScore = getNormalizedSidebarSearchValueScore(thread.entries[index]?.body, normalizedQuery);
        if (entryScore === 0) {
            continue;
        }

        bestScore = Math.max(bestScore, entryScore + getSidebarSearchEntryBonus(index, thread.entries.length));
    }

    return bestScore;
}

export function isBookmarkThread(thread: Pick<CommentThread, "isBookmark">): boolean {
    return thread.isBookmark === true;
}

export function isAgentThread(thread: Pick<CommentThread, "entries">): boolean {
    return thread.entries.some((entry) => parseAgentDirectives(entry.body).matchedTargets.length > 0);
}

export function matchesSidebarContentFilter(
    thread: Pick<CommentThread, "entries" | "isBookmark">,
    filter: SidebarContentFilter,
): boolean {
    switch (filter) {
        case "bookmarks":
            return isBookmarkThread(thread);
        case "agents":
            return isAgentThread(thread);
        case "all":
        default:
            return true;
    }
}

export function filterThreadsBySidebarContentFilter<T extends Pick<CommentThread, "entries" | "isBookmark">>(
    threads: readonly T[],
    filter: SidebarContentFilter,
): T[] {
    return threads.filter((thread) => matchesSidebarContentFilter(thread, filter));
}

export function filterThreadsByPinnedSidebarThreadIds<T extends Pick<CommentThread, "id">>(
    threads: readonly T[],
    pinnedThreadIds: ReadonlySet<string>,
): T[] {
    if (pinnedThreadIds.size === 0) {
        return threads.slice();
    }

    return threads.filter((thread) => pinnedThreadIds.has(thread.id));
}

export function filterThreadsByPinnedSidebarViewState<T extends Pick<CommentThread, "id">>(
    threads: readonly T[],
    pinnedThreadIds: ReadonlySet<string>,
    showPinnedThreadsOnly: boolean,
): T[] {
    if (!showPinnedThreadsOnly) {
        return threads.slice();
    }

    if (pinnedThreadIds.size === 0) {
        return [];
    }

    return filterThreadsByPinnedSidebarThreadIds(threads, pinnedThreadIds);
}

export function toggleSidebarContentFilterState(
    currentFilter: SidebarContentFilter,
    requestedFilter: SidebarContentFilter,
    pinnedThreadIds: ReadonlySet<string> = new Set(),
): {
    filter: SidebarContentFilter;
    pinnedThreadIds: Set<string>;
} {
    const nextFilter = currentFilter === requestedFilter ? "all" : requestedFilter;
    return {
        filter: nextFilter,
        pinnedThreadIds: new Set(pinnedThreadIds),
    };
}

export function toggleDeletedSidebarViewState(options: {
    showDeleted: boolean;
    showResolved: boolean;
    contentFilter: SidebarContentFilter;
    showPinnedThreadsOnly: boolean;
    pinnedThreadIds: ReadonlySet<string>;
    searchQuery: string;
    searchInputValue: string;
}): {
    showDeleted: boolean;
    showResolved: boolean;
    contentFilter: SidebarContentFilter;
    showPinnedThreadsOnly: boolean;
    pinnedThreadIds: Set<string>;
    searchQuery: string;
    searchInputValue: string;
} {
    if (options.showDeleted) {
        return {
            showDeleted: false,
            showResolved: options.showResolved,
            contentFilter: options.contentFilter,
            showPinnedThreadsOnly: options.showPinnedThreadsOnly,
            pinnedThreadIds: new Set(options.pinnedThreadIds),
            searchQuery: options.searchQuery,
            searchInputValue: options.searchInputValue,
        };
    }

    return {
        showDeleted: true,
        showResolved: false,
        contentFilter: "all",
        showPinnedThreadsOnly: false,
        pinnedThreadIds: new Set(options.pinnedThreadIds),
        searchQuery: "",
        searchInputValue: "",
    };
}

export function matchesSidebarThreadSearchQuery<T extends Pick<CommentThread, "selectedText" | "entries">>(
    thread: T,
    query: string,
): boolean {
    const normalizedQuery = normalizeSidebarSearchText(query);
    if (!normalizedQuery) {
        return true;
    }

    return getSidebarThreadSearchScore(thread, normalizedQuery) > 0;
}

export function rankThreadsBySidebarSearchQuery<T extends Pick<CommentThread, "selectedText" | "entries">>(
    threads: readonly T[],
    query: string,
): T[] {
    const normalizedQuery = normalizeSidebarSearchText(query);
    if (!normalizedQuery) {
        return threads.slice();
    }

    return threads
        .map((thread, index) => ({
            thread,
            index,
            score: getSidebarThreadSearchScore(thread, normalizedQuery),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map((candidate) => candidate.thread);
}

export function filterThreadsBySidebarSearchQuery<T extends Pick<CommentThread, "selectedText" | "entries">>(
    threads: readonly T[],
    query: string,
): T[] {
    return rankThreadsBySidebarSearchQuery(threads, query);
}

export function matchesSidebarDraftSearchQuery(
    draft: Pick<DraftComment, "selectedText" | "comment">,
    query: string,
): boolean {
    const normalizedQuery = normalizeSidebarSearchText(query);
    if (!normalizedQuery) {
        return true;
    }

    return matchesNormalizedSidebarSearchValue(draft.selectedText, normalizedQuery)
        || matchesNormalizedSidebarSearchValue(draft.comment, normalizedQuery);
}

export function countBookmarkThreads<T extends Pick<CommentThread, "isBookmark">>(threads: readonly T[]): number {
    return threads.filter((thread) => isBookmarkThread(thread)).length;
}

export function countAgentThreads<T extends Pick<CommentThread, "entries">>(threads: readonly T[]): number {
    return threads.filter((thread) => isAgentThread(thread)).length;
}

export function unlockSidebarContentFilterForDraft(
    filter: SidebarContentFilter,
    draft: Pick<DraftComment, "mode"> | null,
): SidebarContentFilter {
    return draft?.mode === "new" ? "all" : filter;
}
