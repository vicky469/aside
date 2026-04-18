import { App, PluginSettingTab, Setting } from "obsidian";
import {
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../../core/derived/allCommentsNote";
import type { CodexRuntimeDiagnostics } from "../../control/agentRuntimeAdapter";
import type SideNote2 from "../../main";

export interface SideNote2Settings {
    indexNotePath: string;
    indexHeaderImageUrl: string;
    indexHeaderImageCaption: string;
}

export const DEFAULT_SETTINGS: SideNote2Settings = {
    indexNotePath: normalizeAllCommentsNotePath(""),
    indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(""),
    indexHeaderImageCaption: normalizeAllCommentsNoteImageCaption(null),
};

export default class SideNote2SettingTab extends PluginSettingTab {
    plugin: SideNote2;
    private codexStatusRefreshToken = 0;

    constructor(app: App, plugin: SideNote2) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Built-in agent")
            .setDesc("Type @codex in a side note to use the built-in assistant for the thread: ask questions, draft, organize, tag, automate, and more.");

        const codexStatusSetting = new Setting(containerEl)
            .setName("Codex status")
            .setDesc("Checking whether @codex is available...");

        const statusDescriptionEl = codexStatusSetting.descEl;
        const applyCodexStatus = (diagnostics: CodexRuntimeDiagnostics) => {
            statusDescriptionEl.empty();
            statusDescriptionEl.setText(diagnostics.message);
        };

        const refreshCodexStatus = async () => {
            const refreshToken = ++this.codexStatusRefreshToken;
            applyCodexStatus({
                status: "checking",
                message: "Checking whether @codex is available...",
            });
            const diagnostics = await this.plugin.getCodexRuntimeDiagnostics();
            if (refreshToken !== this.codexStatusRefreshToken) {
                return;
            }

            applyCodexStatus(diagnostics);
        };

        codexStatusSetting.addButton((button) =>
            button
                .setButtonText("Re-check")
                .onClick(async () => {
                    await refreshCodexStatus();
                })
        );
        void refreshCodexStatus();

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
