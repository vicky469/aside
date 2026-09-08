import type { SettingDefinitionItem, SettingDefinitionRender } from "obsidian";
import {
    ASIDE_SETTING_CATALOG,
    ASIDE_SETTING_SECTIONS,
    getAsideSettingSurfaceKeys,
    isAsideSettingEntryVisible,
    renderAsideSettingSectionControl,
    type AsideSettingCatalogContext,
} from "./asideSettingCatalog";

export function getDefinitionAsideSettingKeys(): string[] {
    return getAsideSettingSurfaceKeys();
}

export function getAsideSettingDefinitions(
    context: AsideSettingCatalogContext,
): SettingDefinitionItem[] {
    return ASIDE_SETTING_SECTIONS.map((section) => {
        const entries = ASIDE_SETTING_CATALOG
            .filter((entry) => entry.section === section.key);
        const controlItems: SettingDefinitionRender[] = section.control ? [{
            name: section.control.name,
            desc: section.control.description,
            aliases: [...section.control.aliases, ...section.control.keywords],
            visible: true,
            render: (setting) => {
                renderAsideSettingSectionControl(setting, section, context);
            },
        }] : [];

        return {
            type: "group",
            heading: section.heading,
            visible: true,
            items: [
                ...controlItems,
                ...entries.map<SettingDefinitionRender>((entry) => ({
                    name: entry.name,
                    desc: entry.key === "default-agent" ? "" : entry.description,
                    aliases: [...entry.aliases, ...entry.keywords],
                    visible: () => isAsideSettingEntryVisible(entry, context),
                    render: (setting) => {
                        entry.render(setting, context);
                    },
                })),
            ],
        };
    });
}
