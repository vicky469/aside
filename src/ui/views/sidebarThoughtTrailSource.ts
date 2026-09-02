export type SidebarThoughtTrailSource = "wikilinks" | "tags" | "attachments";

export type SidebarThoughtTrailScope = "Vault" | "File";

export interface SidebarThoughtTrailSourceAvailability {
    wikilinks: boolean;
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

function findSidebarThoughtTrailSourceDefinition(value: unknown): SidebarThoughtTrailSourceDefinition | undefined {
    return SIDEBAR_THOUGHT_TRAIL_SOURCES.find((definition) => definition.id === value);
}

export function normalizeSidebarThoughtTrailSource(value: unknown): SidebarThoughtTrailSource {
    const source = findSidebarThoughtTrailSourceDefinition(value)?.id;
    return source ?? getDefaultSidebarThoughtTrailSource();
}

export function getThoughtTrailSourceDefinition(
    source: SidebarThoughtTrailSource,
): SidebarThoughtTrailSourceDefinition {
    return findSidebarThoughtTrailSourceDefinition(source)
        ?? SIDEBAR_THOUGHT_TRAIL_SOURCES[0];
}

export function isThoughtTrailSourceAvailable(
    source: SidebarThoughtTrailSource,
    availability: SidebarThoughtTrailSourceAvailability,
): boolean {
    return availability[source] === true
        || (
            source === getDefaultSidebarThoughtTrailSource()
            && !SIDEBAR_THOUGHT_TRAIL_SOURCES.some((definition) => availability[definition.id])
        );
}

export function resolveAvailableThoughtTrailSource(
    source: SidebarThoughtTrailSource,
    availability: SidebarThoughtTrailSourceAvailability,
): SidebarThoughtTrailSource {
    if (availability[source] === true) {
        return source;
    }

    return SIDEBAR_THOUGHT_TRAIL_SOURCES.find((definition) => availability[definition.id])?.id
        ?? getDefaultSidebarThoughtTrailSource();
}

/** @deprecated Use getDefaultSidebarThoughtTrailSource instead. */
export function getDefaultThoughtTrailSource(): SidebarThoughtTrailSource {
    return getDefaultSidebarThoughtTrailSource();
}

/** @deprecated Use normalizeSidebarThoughtTrailSource instead. */
export function normalizeThoughtTrailSource(value: unknown): SidebarThoughtTrailSource | null {
    return findSidebarThoughtTrailSourceDefinition(value)?.id ?? null;
}
