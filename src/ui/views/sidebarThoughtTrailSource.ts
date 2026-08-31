export type SidebarThoughtTrailSource = "wikilinks" | "tags" | "attachments";

export type SidebarThoughtTrailScope = "Vault" | "File";

export interface SidebarThoughtTrailSourceAvailability {
    tags: boolean;
    attachments: boolean;
}

export interface SidebarThoughtTrailSourceDefinition {
    id: SidebarThoughtTrailSource;
    label: string;
    scope: SidebarThoughtTrailScope;
}

export const SIDEBAR_THOUGHT_TRAIL_SOURCES: readonly SidebarThoughtTrailSourceDefinition[] = [
    { id: "wikilinks", label: "Wikilinks", scope: "Vault" },
    { id: "tags", label: "Tags", scope: "Vault" },
    { id: "attachments", label: "Attachments", scope: "File" },
];

export function getDefaultSidebarThoughtTrailSource(): SidebarThoughtTrailSource {
    return "wikilinks";
}

export function normalizeSidebarThoughtTrailSource(value: unknown): SidebarThoughtTrailSource {
    const source = SIDEBAR_THOUGHT_TRAIL_SOURCES.find((definition) => definition.id === value)?.id;
    return source ?? getDefaultSidebarThoughtTrailSource();
}

export function getThoughtTrailSourceDefinition(
    source: SidebarThoughtTrailSource,
): SidebarThoughtTrailSourceDefinition {
    return SIDEBAR_THOUGHT_TRAIL_SOURCES.find((definition) => definition.id === source)
        ?? SIDEBAR_THOUGHT_TRAIL_SOURCES[0];
}

export function isThoughtTrailSourceAvailable(
    source: SidebarThoughtTrailSource,
    availability: SidebarThoughtTrailSourceAvailability,
): boolean {
    if (source === "wikilinks") {
        return true;
    }

    return availability[source];
}

export function resolveAvailableThoughtTrailSource(
    source: SidebarThoughtTrailSource,
    availability: SidebarThoughtTrailSourceAvailability,
): SidebarThoughtTrailSource {
    return isThoughtTrailSourceAvailable(source, availability)
        ? source
        : getDefaultSidebarThoughtTrailSource();
}

/** @deprecated Use getDefaultSidebarThoughtTrailSource instead. */
export function getDefaultThoughtTrailSource(): SidebarThoughtTrailSource {
    return getDefaultSidebarThoughtTrailSource();
}

/** @deprecated Use normalizeSidebarThoughtTrailSource instead. */
export function normalizeThoughtTrailSource(value: unknown): SidebarThoughtTrailSource {
    return normalizeSidebarThoughtTrailSource(value);
}
