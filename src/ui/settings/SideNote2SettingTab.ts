import { App, PluginSettingTab, Setting } from "obsidian";
import {
    getAgentActorById,
    getSupportedAgentActors,
} from "../../core/agents/agentActorRegistry";
import {
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../../core/derived/allCommentsNote";
import {
    DEFAULT_PREFERRED_AGENT_TARGET,
    normalizePreferredAgentTarget,
    type SideNote2AgentTarget,
} from "../../core/config/agentTargets";
import type SideNote2 from "../../main";

export interface SideNote2Settings {
    indexNotePath: string;
    indexHeaderImageUrl: string;
    indexHeaderImageCaption: string;
    preferredAgentTarget: SideNote2AgentTarget;
}

export const DEFAULT_SETTINGS: SideNote2Settings = {
    indexNotePath: normalizeAllCommentsNotePath(""),
    indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(""),
    indexHeaderImageCaption: normalizeAllCommentsNoteImageCaption(null),
    preferredAgentTarget: DEFAULT_PREFERRED_AGENT_TARGET,
};

function getPreferredAgentDescription(target: SideNote2AgentTarget | string): string {
    return getAgentActorById(normalizePreferredAgentTarget(target)).settingsDescription;
}

export default class SideNote2SettingTab extends PluginSettingTab {
    plugin: SideNote2;

    constructor(app: App, plugin: SideNote2) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        const supportedAgents = getSupportedAgentActors();
        if (supportedAgents.length > 1) {
            const preferredAgentSetting = new Setting(containerEl)
                .setName("Preferred agent")
                .setDesc(getPreferredAgentDescription(this.plugin.settings.preferredAgentTarget))
                .addDropdown((dropdown) => {
                    supportedAgents.forEach((actor) => {
                        dropdown.addOption(actor.id, actor.label);
                    });

                    dropdown
                        .setValue(this.plugin.settings.preferredAgentTarget)
                        .onChange(async (value) => {
                            await this.plugin.setPreferredAgentTarget(value);
                            dropdown.setValue(this.plugin.settings.preferredAgentTarget);
                            preferredAgentSetting.setDesc(
                                getPreferredAgentDescription(this.plugin.settings.preferredAgentTarget),
                            );
                        });
                });
        } else {
            new Setting(containerEl)
                .setName("Agent runtime")
                .setDesc(`Current build supports ${supportedAgents[0]?.label ?? "Codex"} only. Additional agents can be enabled later.`);
        }

        new Setting(containerEl)
            .setName("Index header image URL")
            .setDesc("Remote image shown at the top of the generated index note.")
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.indexHeaderImageUrl)
                    .setValue(this.plugin.settings.indexHeaderImageUrl)
                    .onChange(async (value) => {
                        await this.plugin.setIndexHeaderImageUrl(value);
                        text.setValue(this.plugin.settings.indexHeaderImageUrl);
                    })
            );

        new Setting(containerEl)
            .setName("Index header image caption")
            .setDesc("Optional caption shown under the index header image. Leave blank to hide it.")
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.indexHeaderImageCaption)
                    .setValue(this.plugin.settings.indexHeaderImageCaption)
                    .onChange(async (value) => {
                        await this.plugin.setIndexHeaderImageCaption(value);
                        text.setValue(this.plugin.settings.indexHeaderImageCaption);
                    })
            );
    }
}
