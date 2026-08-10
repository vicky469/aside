import { isSidebarListLikeMode } from "./sidebarModeTabs";
import type { IndexSidebarModeScope } from "./indexSidebarState";
import type { SidebarPrimaryMode } from "./viewState";

export type SidebarCardSurface = "note" | "index";

export interface SidebarCardActionState {
    showPin: boolean;
    canEditEntries: boolean;
    canDeleteEntries: boolean;
    enableTopLevelReorder: boolean;
    enableChildEntryMove: boolean;
}

export function resolveSidebarCardActionState(
    surface: SidebarCardSurface,
    mode: SidebarPrimaryMode,
    indexScopeKind: IndexSidebarModeScope["kind"] | null,
): SidebarCardActionState {
    const isCardMode = surface === "index"
        ? mode === "list" || mode === "todo" || mode === "agent"
        : isSidebarListLikeMode(mode);
    if (!isCardMode) {
        return {
            showPin: false,
            canEditEntries: false,
            canDeleteEntries: false,
            enableTopLevelReorder: false,
            enableChildEntryMove: false,
        };
    }

    const canMutateEntries = surface === "note" || indexScopeKind !== "unavailable";
    const canReorder = canMutateEntries
        && (surface === "note" || indexScopeKind === "file");
    return {
        showPin: canMutateEntries,
        canEditEntries: canMutateEntries,
        canDeleteEntries: canMutateEntries,
        enableTopLevelReorder: canReorder,
        enableChildEntryMove: canReorder,
    };
}
