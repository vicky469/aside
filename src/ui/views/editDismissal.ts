export interface EditDismissalDecision {
    shouldSaveDraft: boolean;
    shouldClearActiveState: boolean;
    shouldClearRevealedCommentSelection: boolean;
}

export function decideEditDismissal(
    clickedInsideDraft: boolean,
    clickedCommentItem: boolean,
    clickedSectionChrome: boolean,
): EditDismissalDecision {
    if (clickedInsideDraft) {
        return {
            shouldSaveDraft: false,
            shouldClearActiveState: false,
            shouldClearRevealedCommentSelection: false,
        };
    }

    return {
        shouldSaveDraft: true,
        shouldClearActiveState: !clickedCommentItem,
        shouldClearRevealedCommentSelection: !clickedCommentItem && !clickedSectionChrome,
    };
}
