import type { SidebarPrimaryMode } from "./viewState";

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
