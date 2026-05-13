export interface TextSelectionLike {
    isCollapsed: boolean;
    toString(): string;
}

export interface SidebarCommentPointerActionState {
    clickedInteractiveElement: boolean;
    clickedInsideCommentContent: boolean;
    selection: TextSelectionLike | null;
    selectionInsideSidebarCommentContent: boolean;
}

const SIDEBAR_COMMENT_OPEN_BLOCKING_SELECTOR = "button, a, textarea, input, select, [contenteditable='true'], .aside-inline-editor";
const SIDEBAR_COMMENT_CONTENT_REFOCUS_BLOCKING_SELECTOR = "textarea, input, select, [contenteditable='true'], .aside-inline-editor";

export function shouldActivateSidebarComment(
    state: SidebarCommentPointerActionState,
): boolean {
    if (state.clickedInteractiveElement || state.clickedInsideCommentContent) {
        return false;
    }

    if (!state.selection) {
        return true;
    }

    if (!state.selectionInsideSidebarCommentContent) {
        return true;
    }

    return state.selection.isCollapsed && state.selection.toString().length === 0;
}

export function isSidebarCommentOpenBlockingTarget(target: Element | null): boolean {
    return !!target?.closest(SIDEBAR_COMMENT_OPEN_BLOCKING_SELECTOR);
}

export function shouldRefocusSidebarCommentContent(target: Element | null): boolean {
    return !target?.closest(SIDEBAR_COMMENT_CONTENT_REFOCUS_BLOCKING_SELECTOR);
}
