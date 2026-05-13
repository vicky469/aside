import { setIcon } from "obsidian";

export interface SidebarSupportButtonOptions {
    filePath: string | null;
    isAllCommentsView: boolean;
    threadCount: number;
}

export interface SidebarSupportButtonHost {
    openSupportLogInspectorModal(context: {
        filePath: string | null;
        surface: "index" | "note";
        threadCount: number;
    }): Promise<void> | void;
}

export function renderSupportButton(
    container: HTMLElement,
    host: SidebarSupportButtonHost,
    options: SidebarSupportButtonOptions,
): void {
    const slot = container.createDiv("aside-support-button-slot");
    renderSupportButtonIn(slot, host, options);
}

export function renderSupportButtonIn(
    container: HTMLElement,
    host: SidebarSupportButtonHost,
    options: SidebarSupportButtonOptions,
): void {
    container.empty();
    const button = container.createEl("button", {
        cls: "clickable-icon aside-support-button",
    });
    button.setAttribute("type", "button");
    button.setAttribute("aria-label", "Open log inspector");
    setIcon(button, "life-buoy");
    button.onclick = () => {
        void host.openSupportLogInspectorModal({
            filePath: options.filePath,
            surface: options.isAllCommentsView ? "index" : "note",
            threadCount: options.threadCount,
        });
    };
}
