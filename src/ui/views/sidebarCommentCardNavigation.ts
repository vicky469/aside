export type SidebarCommentCardOpenAction = "reveal-index" | "select-only" | "open-editor";

export function getSidebarCommentCardOpenAction(options: {
    isIndexView: boolean;
    isNonDesktopClient: boolean;
    isPinnedMarkdownFileSidebar: boolean;
}): SidebarCommentCardOpenAction {
    if (options.isIndexView) {
        return "reveal-index";
    }

    if (options.isNonDesktopClient) {
        return "select-only";
    }

    return "open-editor";
}
