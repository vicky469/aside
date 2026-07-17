import type { SettingDefinitionItem, SettingDefinitionRender } from "obsidian";
import {
    ASIDE_SETTING_CATALOG,
    ASIDE_SETTING_SECTIONS,
    type AsideSettingCatalogContext,
} from "./asideSettingCatalog";

export function getDefinitionAsideSettingKeys(): string[] {
    return ASIDE_SETTING_CATALOG.map((entry) => entry.key);
}

export function getAsideSettingDefinitions(
    context: AsideSettingCatalogContext,
): SettingDefinitionItem[] {
    return ASIDE_SETTING_SECTIONS.map((section) => ({
        type: "group",
        heading: section.heading,
        items: ASIDE_SETTING_CATALOG
            .filter((entry) => entry.section === section.key)
            .map<SettingDefinitionRender>((entry) => ({
                name: entry.name,
                desc: entry.description,
                aliases: [...entry.aliases, ...entry.keywords],
                visible: entry.visible ? () => entry.visible?.(context) !== false : true,
                render: (setting) => {
                    entry.render(setting, context);
                },
            })),
    }));
}
