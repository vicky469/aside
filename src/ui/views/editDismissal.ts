export interface EditDismissalDecision {
    shouldCancelDraft: boolean;
    shouldClearActiveState: boolean;
}

export function decideEditDismissal(
    clickedInsideDraft: boolean,
    clickedCommentItem: boolean,
): EditDismissalDecision {
    if (clickedInsideDraft) {
        return {
            shouldCancelDraft: false,
            shouldClearActiveState: false,
        };
    }

    return {
        shouldCancelDraft: true,
        shouldClearActiveState: !clickedCommentItem,
    };
}
