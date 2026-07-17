import type { Setting } from "obsidian";
import type Aside from "../../main";
import {
    ALL_COMMENTS_NOTE_IMAGE_CAPTION,
    ALL_COMMENTS_NOTE_IMAGE_URL,
} from "../../core/derived/allCommentsNote";

export type AsideSettingSection = "sidebar" | "publishing" | "index-note";

export interface AsideSettingCatalogContext {
    plugin: Aside;
    refresh(): void;
    renderAgentRuntimeStatus(setting: Setting, baseDescription: string): void;
}

export interface AsideSettingCatalogEntry {
    key: string;
    section: AsideSettingSection;
    name: string;
    description: string;
    aliases: readonly string[];
    keywords: readonly string[];
    visible?(context: AsideSettingCatalogContext): boolean;
    render(setting: Setting, context: AsideSettingCatalogContext): void;
}

export const ASIDE_SETTING_SECTIONS: ReadonlyArray<{
    key: AsideSettingSection;
    heading: string;
}> = [
    { key: "sidebar", heading: "Sidebar tabs" },
    { key: "publishing", heading: "Publishing (experimental)" },
    { key: "index-note", heading: "Index note" },
];

const PUBLISH_PROJECT_NAME_PLACEHOLDER = "publish-site";

export const ASIDE_SETTING_CATALOG: readonly AsideSettingCatalogEntry[] = [
    {
        key: "show-todo-tab",
        section: "sidebar",
        name: "Show todo tab",
        description: "Show the todo sidebar tab for @todo side notes.",
        aliases: ["todo sidebar"],
        keywords: ["follow-up", "tasks"],
        render: (setting, { plugin }) => {
            setting.addToggle((toggle) => toggle
                .setValue(plugin.settings.showTodoSidebarTab)
                .onChange(async (value) => {
                    await plugin.setShowTodoSidebarTab(value);
                    toggle.setValue(plugin.settings.showTodoSidebarTab);
                }));
        },
    },
    {
        key: "show-agent-tab",
        section: "sidebar",
        name: "Show agent tab",
        description: "Show the agent sidebar tab for local agent replies.",
        aliases: ["Codex tab", "Claude tab"],
        keywords: ["local agent", "assistant"],
        render: (setting, context) => {
            setting.addToggle((toggle) => toggle
                .setValue(context.plugin.settings.showAgentSidebarTab)
                .onChange(async (value) => {
                    await context.plugin.setShowAgentSidebarTab(value);
                    toggle.setValue(context.plugin.settings.showAgentSidebarTab);
                    context.refresh();
                }));
            context.renderAgentRuntimeStatus(setting, "Show the agent sidebar tab for local agent replies.");
        },
    },
    {
        key: "publish-enabled",
        section: "publishing",
        name: "Enable publishing",
        description: "Show experimental publish controls for supported files in the public folder.",
        aliases: ["Cloudflare Pages"],
        keywords: ["public folder", "deploy"],
        render: (setting, context) => {
            setting.addToggle((toggle) => toggle
                .setValue(context.plugin.settings.publishEnabled)
                .onChange(async (value) => {
                    await context.plugin.setPublishEnabled(value);
                    toggle.setValue(context.plugin.settings.publishEnabled);
                    context.refresh();
                }));
        },
    },
    {
        key: "publish-base-url",
        section: "publishing",
        name: "Publishing URL",
        description: "Canonical public address for published files. Prefer your custom domain.",
        aliases: ["public URL", "custom domain"],
        keywords: ["https", "Pages address"],
        visible: ({ plugin }) => plugin.settings.publishEnabled,
        render: (setting, context) => {
            setting.addText((text) => text
                .setPlaceholder("https://publish.example.com")
                .setValue(context.plugin.settings.publishBaseUrl)
                .onChange(async (value) => {
                    await context.plugin.setPublishBaseUrl(value);
                    text.setValue(context.plugin.settings.publishBaseUrl);
                    context.refresh();
                }));
        },
    },
    {
        key: "publish-project-name",
        section: "publishing",
        name: "Project name",
        description: "Change to your preferred name or keep the default.",
        aliases: ["Pages project"],
        keywords: ["Cloudflare", "deployment"],
        visible: ({ plugin }) => plugin.settings.publishEnabled,
        render: (setting, context) => {
            setting.addText((text) => text
                .setPlaceholder(PUBLISH_PROJECT_NAME_PLACEHOLDER)
                .setValue(context.plugin.settings.publishPagesProjectName)
                .onChange(async (value) => {
                    await context.plugin.setPublishPagesProjectName(value);
                    text.setValue(context.plugin.settings.publishPagesProjectName);
                }));
        },
    },
    {
        key: "index-header-image-url",
        section: "index-note",
        name: "Index header image URL",
        description: "Remote image shown at the top of the generated index note.",
        aliases: ["index banner"],
        keywords: ["image", "remote URL"],
        render: (setting, { plugin }) => {
            setting.addText((text) => text
                .setPlaceholder(ALL_COMMENTS_NOTE_IMAGE_URL)
                .setValue(plugin.settings.indexHeaderImageUrl)
                .onChange(async (value) => {
                    await plugin.setIndexHeaderImageUrl(value);
                    text.setValue(plugin.settings.indexHeaderImageUrl);
                }));
        },
    },
    {
        key: "index-header-image-caption",
        section: "index-note",
        name: "Index header image caption",
        description: "Optional caption shown under the index header image. Leave blank to hide it.",
        aliases: ["image caption"],
        keywords: ["index note", "banner text"],
        render: (setting, { plugin }) => {
            setting.addText((text) => text
                .setPlaceholder(ALL_COMMENTS_NOTE_IMAGE_CAPTION)
                .setValue(plugin.settings.indexHeaderImageCaption)
                .onChange(async (value) => {
                    await plugin.setIndexHeaderImageCaption(value);
                    text.setValue(plugin.settings.indexHeaderImageCaption);
                }));
        },
    },
];
