import type { SidebarPrimaryMode } from "./viewState";

export interface SidebarModeTabDefinition {
    mode: SidebarPrimaryMode;
    label: string;
}

export interface SidebarModeAvailability {
    isTagsEnabled: boolean;
    isTodoEnabled: boolean;
    isAgentEnabled: boolean;
    isThoughtTrailEnabled: boolean;
}

export const SHARED_SIDEBAR_MODE_TABS: readonly SidebarModeTabDefinition[] = [
    { mode: "list", label: "List" },
    { mode: "todo", label: "Todo" },
    { mode: "agent", label: "Agent" },
    { mode: "thought-trail", label: "Thought Trail" },
] as const;

export function isSidebarModeAvailable(
    mode: SidebarPrimaryMode,
    availability: SidebarModeAvailability,
): boolean {
    switch (mode) {
        case "tags":
            return false;
        case "todo":
            return availability.isTodoEnabled;
        case "agent":
            return availability.isAgentEnabled;
        case "thought-trail":
            return availability.isThoughtTrailEnabled;
        case "list":
        default:
            return true;
    }
}

export function isSidebarListLikeMode(mode: SidebarPrimaryMode): boolean {
    return mode === "list" || mode === "tags" || mode === "todo" || mode === "agent";
}
