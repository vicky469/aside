import type { SidebarPrimaryMode } from "./viewState";

export interface SidebarModeTabDefinition {
    mode: SidebarPrimaryMode;
    label: string;
}

export interface SidebarModeTabGroup {
    scope: "local" | "global";
    tabs: SidebarModeTabDefinition[];
}

export interface SidebarModeAvailability {
    isTagsEnabled: boolean;
    isTodoEnabled: boolean;
    isAgentEnabled: boolean;
    isThoughtTrailEnabled: boolean;
}

export interface SidebarModeVisibility {
    showTodoSidebarTab: boolean;
    showAgentSidebarTab: boolean;
}

type SidebarModeTabOptions = SidebarModeAvailability & Partial<SidebarModeVisibility>;

export type SidebarModeTabSurface = "note" | "index";

export const SHARED_SIDEBAR_MODE_TABS: readonly SidebarModeTabDefinition[] = [
    { mode: "list", label: "List" },
    { mode: "todo", label: "Todo" },
    { mode: "agent", label: "Agent" },
    { mode: "thought-trail", label: "Thought Trail" },
] as const;

export const TAGS_SIDEBAR_MODE_TAB: SidebarModeTabDefinition = { mode: "tags", label: "Tags" };

export function getSidebarModeTabs(options: SidebarModeTabOptions): SidebarModeTabDefinition[] {
    const showTodoSidebarTab = options.showTodoSidebarTab ?? true;
    const showAgentSidebarTab = options.showAgentSidebarTab ?? true;
    const optionalTabs = SHARED_SIDEBAR_MODE_TABS.slice(1).filter((tab) => {
        if (tab.mode === "todo") {
            return showTodoSidebarTab;
        }
        if (tab.mode === "agent") {
            return showAgentSidebarTab;
        }
        return true;
    });

    return [
        SHARED_SIDEBAR_MODE_TABS[0],
        ...(options.isTagsEnabled ? [TAGS_SIDEBAR_MODE_TAB] : []),
        ...optionalTabs,
    ];
}

export function getSidebarModeTabGroups(
    availability: SidebarModeTabOptions,
    surface: SidebarModeTabSurface,
): SidebarModeTabGroup[] {
    const tabByMode = new Map(getSidebarModeTabs(availability).map((tab) => [tab.mode, tab]));
    const groupModes: Array<{
        scope: SidebarModeTabGroup["scope"];
        modes: SidebarPrimaryMode[];
    }> = surface === "index"
        ? [
            { scope: "local", modes: ["list"] },
            { scope: "global", modes: ["todo", "agent", "thought-trail"] },
        ]
        : [
            { scope: "local", modes: ["list", "tags", "todo", "agent"] },
            { scope: "global", modes: ["thought-trail"] },
        ];

    return groupModes
        .map((group) => ({
            scope: group.scope,
            tabs: group.modes
                .map((mode) => tabByMode.get(mode))
                .filter((tab): tab is SidebarModeTabDefinition => !!tab),
        }))
        .filter((group) => group.tabs.length > 0);
}

export function isSidebarModeAvailable(
    mode: SidebarPrimaryMode,
    availability: SidebarModeAvailability,
): boolean {
    switch (mode) {
        case "tags":
            return availability.isTagsEnabled;
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

export function resolveModeWithSidebarModeVisibility(
    mode: SidebarPrimaryMode,
    visibility: SidebarModeVisibility,
): SidebarPrimaryMode {
    if (mode === "todo" && !visibility.showTodoSidebarTab) {
        return "list";
    }
    if (mode === "agent" && !visibility.showAgentSidebarTab) {
        return "list";
    }

    return mode;
}

export function isSidebarListLikeMode(mode: SidebarPrimaryMode): boolean {
    return mode === "list" || mode === "tags" || mode === "todo" || mode === "agent";
}

export function shouldRenderSidebarFilePinAction(surface: SidebarModeTabSurface): boolean {
    return surface === "note";
}

export function shouldRenderSidebarFileMoveAction(surface: SidebarModeTabSurface): boolean {
    return surface === "note";
}
