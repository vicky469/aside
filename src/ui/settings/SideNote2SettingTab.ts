import { App, PluginSettingTab, Setting } from "obsidian";
import { setDebugEnabled } from "../../debug";
import type SideNote2 from "../../main";

export interface SideNote2Settings {
    enableDebugMode: boolean;
}

export const DEFAULT_SETTINGS: SideNote2Settings = {
    enableDebugMode: false,
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
    }
}
