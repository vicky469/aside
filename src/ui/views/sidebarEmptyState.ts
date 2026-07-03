export interface SidebarEmptyStateTextElement {
    createEl(tagName: "p", options: { text: string }): unknown;
}

export interface SidebarEmptyStateContainer {
    empty(): void;
    createDiv(className: string): SidebarEmptyStateTextElement;
}

export type SidebarEmptyStateReason = "unsupported-file";

export const NOTE_SIDEBAR_EMPTY_CREATE_HINT_TEXT = "Use + to add a page note, or select text and choose Add comment to selection.";

export function renderNoSidebarFileEmptyState(
    containerEl: SidebarEmptyStateContainer,
    reason: SidebarEmptyStateReason | null = null,
): void {
    containerEl.empty();
    const emptyStateEl = containerEl.createDiv("aside-empty-state");
    if (reason === "unsupported-file") {
        emptyStateEl.createEl("p", { text: "Unsupported file type" });
        emptyStateEl.createEl("p", { text: "Open a markdown note to see its side notes." });
        return;
    }

    emptyStateEl.createEl("p", { text: "No markdown file selected" });
    emptyStateEl.createEl("p", { text: "Open a note to see its side notes." });
}
