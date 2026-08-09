import type { SidebarPrimaryMode } from "./viewState";
import { isSidebarListLikeMode } from "./sidebarModeTabs";

export interface SidebarSecondaryToolbarPlanOptions {
    surface: "note" | "index";
    mode: SidebarPrimaryMode;
    hasNestedComments: boolean;
    hasFileFilterOptions: boolean;
    hasAddPageCommentAction: boolean;
}

export interface SidebarSecondaryToolbarPlan {
    showRow: boolean;
    showFileFilter: boolean;
    showSearch: boolean;
    showPinned: boolean;
    showNested: boolean;
    showDeleted: boolean;
    showAddPageComment: boolean;
}

export function resolveSidebarSecondaryToolbarPlan(
    options: SidebarSecondaryToolbarPlanOptions,
): SidebarSecondaryToolbarPlan {
    const isIndexCardMode = options.surface === "index"
        && (options.mode === "list" || options.mode === "todo" || options.mode === "agent");
    const isNoteListLikeMode = options.surface === "note" && isSidebarListLikeMode(options.mode);
    const isNoteFileMode = options.surface === "note" && options.mode === "list";
    const showSearch = options.surface === "index"
        ? options.mode === "list"
        : isSidebarListLikeMode(options.mode);

    return {
        showRow: options.surface === "index" || isNoteListLikeMode,
        showFileFilter: options.surface === "index",
        showSearch,
        showPinned: isIndexCardMode || isNoteFileMode,
        showNested: options.hasNestedComments && (isIndexCardMode || isNoteListLikeMode),
        showDeleted: isIndexCardMode || isNoteFileMode,
        showAddPageComment: isNoteFileMode && options.hasAddPageCommentAction,
    };
}

export interface NoteToolbarActionStateOptions {
    hasDeletedComments: boolean;
    hasPinnedThreads: boolean;
    noteSidebarMode: SidebarPrimaryMode;
    showDeletedComments: boolean;
    showPinnedThreadsOnly: boolean;
}

export interface NoteToolbarActionState {
    addPageCommentDisabled: boolean;
    deletedDisabled: boolean;
    fileActionsVisible: boolean;
    pinnedDisabled: boolean;
}

export function resolveNoteToolbarActionState(
    options: NoteToolbarActionStateOptions,
): NoteToolbarActionState {
    const isDeletedMode = options.showDeletedComments;
    const isPinnedMode = options.showPinnedThreadsOnly;
    const fileActionsVisible = options.noteSidebarMode === "list";

    return {
        addPageCommentDisabled: isDeletedMode || isPinnedMode,
        deletedDisabled: (isPinnedMode && !isDeletedMode) || (!options.hasDeletedComments && !isDeletedMode),
        fileActionsVisible,
        pinnedDisabled: (isDeletedMode && !isPinnedMode) || (!options.hasPinnedThreads && !isPinnedMode),
    };
}
