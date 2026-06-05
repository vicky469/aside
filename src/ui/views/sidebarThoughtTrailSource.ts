export type SidebarThoughtTrailSource = "wikilinks" | "tags";

export function getDefaultThoughtTrailSource(): SidebarThoughtTrailSource {
    return "wikilinks";
}

export function normalizeThoughtTrailSource(value: unknown): SidebarThoughtTrailSource | null {
    return value === "wikilinks" || value === "tags"
        ? value
        : null;
}

export function resolveAvailableThoughtTrailSource(
    source: SidebarThoughtTrailSource,
    isTagSourceAvailable: boolean,
): SidebarThoughtTrailSource {
    if (source === "tags" && !isTagSourceAvailable) {
        return "wikilinks";
    }

    return source;
}
