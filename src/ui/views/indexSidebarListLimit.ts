export const INDEX_SIDEBAR_LIST_LIMIT = 100;

export interface IndexSidebarListWindow<T> {
    visibleItems: T[];
    hiddenCount: number;
}

export interface IndexSidebarLimitNotice {
    primary: string;
    secondary: string;
}

export function buildIndexSidebarLimitNotice(options: {
    visibleCount: number;
    hiddenCount: number;
}): IndexSidebarLimitNotice | null {
    if (options.hiddenCount <= 0) {
        return null;
    }
    return {
        primary: `${options.visibleCount} shown, ${options.hiddenCount} hidden.`,
        secondary: "Use files to filter the index to see more.",
    };
}

export function limitIndexSidebarListItems<T>(
    items: readonly T[],
    limit = INDEX_SIDEBAR_LIST_LIMIT,
): IndexSidebarListWindow<T> {
    if (limit < 0) {
        limit = 0;
    }

    return {
        visibleItems: items.slice(0, limit),
        hiddenCount: Math.max(0, items.length - limit),
    };
}
