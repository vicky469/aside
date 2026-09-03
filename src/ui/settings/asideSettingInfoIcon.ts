import { setIcon, setTooltip } from "obsidian";

export function appendAsideSettingInfoIcon(
    nameEl: HTMLElement,
    description: string,
): HTMLElement {
    const infoIconEl = nameEl.createEl("button", {
        cls: "aside-setting-info-icon",
        attr: {
            "aria-label": description,
            type: "button",
        },
    });
    setIcon(infoIconEl, "info");
    setTooltip(infoIconEl, description, { placement: "top" });
    return infoIconEl;
}
