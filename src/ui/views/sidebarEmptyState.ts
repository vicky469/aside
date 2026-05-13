export interface SidebarEmptyStateTextElement {
    createEl(tagName: "p", options: { text: string }): unknown;
}

export interface SidebarEmptyStateContainer {
    empty(): void;
    createDiv(className: string): SidebarEmptyStateTextElement;
}

export const NOTE_SIDEBAR_EMPTY_CREATE_HINT_TEXT = "Use the add button to create a page side note, or select text and right-click \"Add comment to selection\" to add an anchored note.";

export function renderNoSidebarFileEmptyState(containerEl: SidebarEmptyStateContainer): void {
    containerEl.empty();
    const emptyStateEl = containerEl.createDiv("aside-empty-state");
    emptyStateEl.createEl("p", { text: "No markdown file selected." });
    emptyStateEl.createEl("p", { text: "Open a markdown file to see its side notes." });
}
