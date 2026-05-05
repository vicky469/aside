export interface SidebarEmptyStateTextElement {
    createEl(tagName: "p", options: { text: string }): unknown;
}

export interface SidebarEmptyStateContainer {
    empty(): void;
    createDiv(className: string): SidebarEmptyStateTextElement;
}

export function renderNoSidebarFileEmptyState(containerEl: SidebarEmptyStateContainer): void {
    containerEl.empty();
    const emptyStateEl = containerEl.createDiv("sidenote2-empty-state");
    emptyStateEl.createEl("p", { text: "No markdown file selected." });
    emptyStateEl.createEl("p", { text: "Open a markdown file to see its side notes." });
}
