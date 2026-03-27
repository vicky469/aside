export interface SidebarClipboardSelectionState {
    isCollapsed: boolean;
    selectedText: string;
    anchorInsideSidebar: boolean;
    focusInsideSidebar: boolean;
}

export function getSelectedSidebarClipboardText(
    selection: SidebarClipboardSelectionState | null,
): string | null {
    if (!selection) {
        return null;
    }

    if (selection.isCollapsed || selection.selectedText.length === 0) {
        return null;
    }

    if (!selection.anchorInsideSidebar || !selection.focusInsideSidebar) {
        return null;
    }

    return selection.selectedText;
}
