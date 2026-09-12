import type { Setting } from "obsidian";
import type Aside from "../../main";
import { getSupportedAgentActors } from "../../core/agents/agentActorRegistry";
import { PDF_TO_MARKDOWN_DIRECTIVE } from "../../core/text/pdfToMarkdownDirective";
import {
    ALL_COMMENTS_NOTE_IMAGE_CAPTION,
    ALL_COMMENTS_NOTE_IMAGE_URL,
} from "../../core/derived/allCommentsNote";

export type AsideSettingSection = "agents" | "sidebar" | "publishing" | "index-note";

export interface AsideSettingCatalogContext {
    plugin: Aside;
    refresh(): void;
    renderDefaultAgentSettings(setting: Setting, baseDescription: string): void;
    renderPurgeBrokerSecret(setting: Setting): void;
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

export interface AsideSettingSectionControl {
    key: string;
    name: string;
    description: string;
    aliases: readonly string[];
    keywords: readonly string[];
    getValue(context: AsideSettingCatalogContext): boolean;
    setValue(context: AsideSettingCatalogContext, value: boolean): Promise<void>;
}

export interface AsideSettingSectionDefinition {
    key: AsideSettingSection;
    heading: string;
    control?: AsideSettingSectionControl;
}

export const ASIDE_SETTING_SECTIONS: ReadonlyArray<AsideSettingSectionDefinition> = [
    { key: "sidebar", heading: "Sidebar tabs" },
    {
        key: "agents",
        heading: "Scripts (advanced)",
        control: {
            key: "scripts-enabled",
            name: "Enable scripts",
            description: "Create and run trusted local scripts with your local agent.",
            aliases: ["vault scripts"],
            keywords: ["agent", "commands", "automation"],
            getValue: ({ plugin }) => plugin.settings.scriptsEnabled,
            setValue: async (context, value) => {
                await context.plugin.setScriptsEnabled(value);
            },
        },
    },
    {
        key: "publishing",
        heading: "Publishing (advanced)",
        control: {
            key: "publish-enabled",
            name: "Enable publishing",
            description: "Show advanced publish controls for supported files in the public folder.",
            aliases: ["Cloudflare Pages"],
            keywords: ["public folder", "deploy"],
            getValue: ({ plugin }) => plugin.settings.publishEnabled,
            setValue: async (context, value) => {
                await context.plugin.setPublishEnabled(value);
            },
        },
    },
    { key: "index-note", heading: "Index note" },
];

const PUBLISH_PROJECT_NAME_PLACEHOLDER = "publish-site";

function getPublishHost(baseUrl: string): string {
    try {
        return new URL(baseUrl).hostname;
    } catch {
        return "Not configured";
    }
}

function isRemotePurgeSettingVisible(context: AsideSettingCatalogContext): boolean {
    return context.plugin.settings.publishRemotePurgeEnabled;
}

const DEFAULT_AGENT_SETTING_DESCRIPTION = `Preferred local agent for /create-script, /update-script, and ${PDF_TO_MARKDOWN_DIRECTIVE}.`;

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
        aliases: getSupportedAgentActors().map((actor) => `${actor.label} tab`),
        keywords: ["local agent", "assistant"],
        render: (setting, context) => {
            setting.addToggle((toggle) => toggle
                .setValue(context.plugin.settings.showAgentSidebarTab)
                .onChange(async (value) => {
                    await context.plugin.setShowAgentSidebarTab(value);
                    toggle.setValue(context.plugin.settings.showAgentSidebarTab);
                    context.refresh();
                }));
        },
    },
    {
        key: "default-agent",
        section: "agents",
        name: "Default agent",
        description: DEFAULT_AGENT_SETTING_DESCRIPTION,
        aliases: getSupportedAgentActors().map((actor) => actor.label),
        keywords: ["runtime", "availability", "fallback"],
        render: (setting, context) => {
            context.renderDefaultAgentSettings(
                setting,
                DEFAULT_AGENT_SETTING_DESCRIPTION,
            );
        },
    },
    {
        key: "publish-base-url",
        section: "publishing",
        name: "Publishing URL",
        description: "Canonical public address for published files. Prefer your custom domain.",
        aliases: ["public URL", "custom domain"],
        keywords: ["https", "Pages address"],
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
        description: "Existing Cloudflare Pages project to upload to. Leave blank to resolve it from the publishing URL.",
        aliases: ["Pages project"],
        keywords: ["Cloudflare", "deployment"],
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
        key: "publish-remote-purge-enabled",
        section: "publishing",
        name: "Remote cache purge",
        description: "Purge cached custom-domain pages after unpublish and republish.",
        aliases: ["cache invalidation"],
        keywords: ["Cloudflare", "unpublish", "republish"],
        render: (setting, context) => {
            setting.addToggle((toggle) => toggle
                .setValue(context.plugin.settings.publishRemotePurgeEnabled)
                .onChange(async (value) => {
                    await context.plugin.setPublishRemotePurgeEnabled(value);
                    toggle.setValue(context.plugin.settings.publishRemotePurgeEnabled);
                    context.refresh();
                }));
        },
    },
    {
        key: "publish-purge-broker-url",
        section: "publishing",
        name: "Purge broker URL",
        description: "HTTPS endpoint for the deployed Aside cache purge broker.",
        aliases: ["Worker endpoint"],
        keywords: ["Cloudflare", "cache API"],
        visible: isRemotePurgeSettingVisible,
        render: (setting, { plugin }) => {
            setting.addText((text) => text
                .setPlaceholder("Purge broker URL")
                .setValue(plugin.settings.publishPurgeBrokerUrl)
                .onChange(async (value) => {
                    await plugin.setPublishPurgeBrokerUrl(value);
                    text.setValue(plugin.settings.publishPurgeBrokerUrl);
                }));
        },
    },
    {
        key: "publish-purge-broker-secret",
        section: "publishing",
        name: "Purge broker auth secret",
        description: "Select or create the broker secret in Obsidian SecretStorage.",
        aliases: ["broker credential"],
        keywords: ["authentication", "SecretStorage"],
        visible: isRemotePurgeSettingVisible,
        render: (setting, context) => {
            context.renderPurgeBrokerSecret(setting);
        },
    },
    {
        key: "publish-purge-allowed-host",
        section: "publishing",
        name: "Purge allowed host",
        description: "Host derived from the configured publishing URL.",
        aliases: ["custom domain host"],
        keywords: ["cache scope", "security"],
        visible: isRemotePurgeSettingVisible,
        render: (setting, { plugin }) => {
            setting.setDesc(getPublishHost(plugin.settings.publishBaseUrl));
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

export function isAsideSettingSectionEnabled(
    section: AsideSettingSectionDefinition,
    context: AsideSettingCatalogContext,
): boolean {
    return section.control?.getValue(context) ?? true;
}

export function isAsideSettingEntryVisible(
    entry: AsideSettingCatalogEntry,
    context: AsideSettingCatalogContext,
): boolean {
    const section = ASIDE_SETTING_SECTIONS.find((candidate) => candidate.key === entry.section);
    if (!section) {
        return false;
    }
    return isAsideSettingSectionEnabled(section, context)
        && entry.visible?.(context) !== false;
}

export function getAsideSettingSurfaceKeys(): string[] {
    return ASIDE_SETTING_SECTIONS.flatMap((section) => [
        ...(section.control ? [section.control.key] : []),
        ...ASIDE_SETTING_CATALOG
            .filter((entry) => entry.section === section.key)
            .map((entry) => entry.key),
    ]);
}

export function renderAsideSettingSectionControl(
    setting: Setting,
    section: AsideSettingSectionDefinition,
    context: AsideSettingCatalogContext,
): void {
    const control = section.control;
    if (!control) {
        return;
    }
    setting.addToggle((toggle) => toggle
        .setValue(control.getValue(context))
        .onChange(async (value) => {
            try {
                await control.setValue(context, value);
            } finally {
                toggle.setValue(control.getValue(context));
                context.refresh();
            }
        }));
}
