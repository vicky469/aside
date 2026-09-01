import { setIcon, setTooltip } from "obsidian";

export function appendAsideSettingInfoIcon(
    nameEl: HTMLElement,
    description: string,
): HTMLElement {
    const infoIconEl = nameEl.createSpan({
        cls: "aside-setting-info-icon",
        attr: {
            "aria-label": description,
            role: "img",
        },
    });
    setIcon(infoIconEl, "info");
    setTooltip(infoIconEl, description, { placement: "top" });
    return infoIconEl;
}
