export interface NoteToolbarActionStateOptions {
    hasDeletedComments: boolean;
    hasPinnedThreads: boolean;
    showDeletedComments: boolean;
    showPinnedThreadsOnly: boolean;
}

export interface NoteToolbarActionState {
    addPageCommentDisabled: boolean;
    deletedDisabled: boolean;
    pinnedDisabled: boolean;
}

export function resolveNoteToolbarActionState(
    options: NoteToolbarActionStateOptions,
): NoteToolbarActionState {
    const isDeletedMode = options.showDeletedComments;
    const isPinnedMode = options.showPinnedThreadsOnly;

    return {
        addPageCommentDisabled: isDeletedMode || isPinnedMode,
        deletedDisabled: (isPinnedMode && !isDeletedMode) || (!options.hasDeletedComments && !isDeletedMode),
        pinnedDisabled: (isDeletedMode && !isPinnedMode) || (!options.hasPinnedThreads && !isPinnedMode),
    };
}
