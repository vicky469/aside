import type { Setting } from "obsidian";
import {
    ASIDE_SETTING_CATALOG,
    ASIDE_SETTING_SECTIONS,
    getAsideSettingSurfaceKeys,
    isAsideSettingEntryVisible,
    renderAsideSettingSectionControl,
    type AsideSettingCatalogContext,
} from "./asideSettingCatalog";

export function getLegacyAsideSettingKeys(): string[] {
    return getAsideSettingSurfaceKeys();
}

export function renderLegacyAsideSettings(
    containerEl: HTMLElement,
    context: AsideSettingCatalogContext,
    createSetting: (container: HTMLElement) => Setting,
): void {
    for (const section of ASIDE_SETTING_SECTIONS) {
        const entries = ASIDE_SETTING_CATALOG.filter((entry) =>
            entry.section === section.key && isAsideSettingEntryVisible(entry, context));
        if (!section.control && entries.length === 0) {
            continue;
        }

        createSetting(containerEl)
            .setName(section.heading)
            .setHeading();

        if (section.control) {
            const controlSetting = createSetting(containerEl)
                .setName(section.control.name)
                .setDesc(section.control.description);
            renderAsideSettingSectionControl(controlSetting, section, context);
        }

        for (const entry of entries) {
            const setting = createSetting(containerEl)
                .setName(entry.name);
            if (entry.key !== "default-agent") {
                setting.setDesc(entry.description);
            }
            entry.render(setting, context);
        }
    }
}
