import { isSidebarListLikeMode } from "./sidebarModeTabs";
import type { SidebarPrimaryMode } from "./viewState";

export type SidebarCardSurface = "note" | "index";

export interface SidebarCardActionState {
    showPin: boolean;
    canEditParent: boolean;
    canDeleteParent: boolean;
    enableTopLevelReorder: boolean;
    enableChildEntryMove: boolean;
}

export function resolveSidebarCardActionState(
    surface: SidebarCardSurface,
    mode: SidebarPrimaryMode,
): SidebarCardActionState {
    const isCardMode = surface === "index"
        ? mode === "list" || mode === "todo" || mode === "agent"
        : isSidebarListLikeMode(mode);
    if (!isCardMode) {
        return {
            showPin: false,
            canEditParent: false,
            canDeleteParent: false,
            enableTopLevelReorder: false,
            enableChildEntryMove: false,
        };
    }

    return {
        showPin: true,
        canEditParent: true,
        canDeleteParent: true,
        enableTopLevelReorder: true,
        enableChildEntryMove: surface === "note",
    };
}
