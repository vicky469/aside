import type { Setting } from "obsidian";
import {
    ASIDE_SETTING_CATALOG,
    ASIDE_SETTING_SECTIONS,
    type AsideSettingCatalogContext,
} from "./asideSettingCatalog";

export function getLegacyAsideSettingKeys(): string[] {
    return ASIDE_SETTING_CATALOG.map((entry) => entry.key);
}

export function renderLegacyAsideSettings(
    containerEl: HTMLElement,
    context: AsideSettingCatalogContext,
    createSetting: (container: HTMLElement) => Setting,
): void {
    for (const section of ASIDE_SETTING_SECTIONS) {
        const entries = ASIDE_SETTING_CATALOG.filter((entry) =>
            entry.section === section.key && entry.visible?.(context) !== false);
        if (entries.length === 0) {
            continue;
        }

        createSetting(containerEl)
            .setName(section.heading)
            .setHeading();

        for (const entry of entries) {
            const setting = createSetting(containerEl)
                .setName(entry.name)
                .setDesc(entry.description);
            entry.render(setting, context);
        }
    }
}
