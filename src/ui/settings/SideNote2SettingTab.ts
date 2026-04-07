import { App, PluginSettingTab, Setting } from "obsidian";
import {
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../../core/derived/allCommentsNote";
import { setDebugEnabled } from "../../debug";
import type SideNote2 from "../../main";

export interface SideNote2Settings {
    enableDebugMode: boolean;
    indexNotePath: string;
    indexHeaderImageUrl: string;
    indexHeaderImageCaption: string;
    lastMigratedNoteCommentStorageVersion: string | null;
}

export const DEFAULT_SETTINGS: SideNote2Settings = {
    enableDebugMode: false,
    indexNotePath: normalizeAllCommentsNotePath(""),
    indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(""),
    indexHeaderImageCaption: normalizeAllCommentsNoteImageCaption(null),
    lastMigratedNoteCommentStorageVersion: null,
};

export default class SideNote2SettingTab extends PluginSettingTab {
    plugin: SideNote2;

    constructor(app: App, plugin: SideNote2) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Index header image URL")
            .setDesc("Remote image shown at the top of the generated SideNote2 index note.")
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

        new Setting(containerEl)
            .setName("Debug mode")
            .setDesc("Enable debug logging and counters. Output goes to browser console.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enableDebugMode)
                    .onChange(async (value) => {
                        this.plugin.settings.enableDebugMode = value;
                        await this.plugin.saveSettings();
                        setDebugEnabled(value);
                    })
            );

        new Setting(containerEl)
            .setName("Vault agent support")
            .setDesc("SideNote2 auto-manages a SideNote2 block in the vault root AGENTS.md for agent routing. Use remove only right before uninstalling. If the plugin stays enabled, the block will be recreated the next time SideNote2 starts.")
            .addButton((button) =>
                button
                    .setButtonText("Sync AGENTS.md")
                    .onClick(async () => {
                        button.setDisabled(true);
                        try {
                            await this.plugin.syncVaultAgentsFile();
                        } finally {
                            button.setDisabled(false);
                        }
                    })
            )
            .addButton((button) =>
                button
                    .setWarning()
                    .setButtonText("Remove from vault")
                    .setTooltip("Cleanup before uninstalling SideNote2.")
                    .onClick(async () => {
                        button.setDisabled(true);
                        try {
                            await this.plugin.removeVaultAgentSupport();
                        } finally {
                            button.setDisabled(false);
                        }
                    })
            );
    }
}
