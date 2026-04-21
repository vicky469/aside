import { App, PluginSettingTab, Setting } from "obsidian";
import {
    normalizeAgentRuntimeModePreference,
    normalizeRemoteRuntimeBaseUrl,
    type AgentRuntimeModePreference,
} from "../../core/agents/agentRuntimePreferences";
import {
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../../core/derived/allCommentsNote";
import type { CodexRuntimeDiagnostics } from "../../control/agentRuntimeAdapter";
import {
    createCheckingCodexRuntimeDiagnostics,
    getCodexRuntimeStatusPresentation,
} from "./codexRuntimeStatus";
import type SideNote2 from "../../main";

export interface SideNote2Settings {
    indexNotePath: string;
    indexHeaderImageUrl: string;
    indexHeaderImageCaption: string;
    agentRuntimeMode: AgentRuntimeModePreference;
    remoteRuntimeBaseUrl: string;
}

export const DEFAULT_SETTINGS: SideNote2Settings = {
    indexNotePath: normalizeAllCommentsNotePath(""),
    indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(""),
    indexHeaderImageCaption: normalizeAllCommentsNoteImageCaption(null),
    agentRuntimeMode: normalizeAgentRuntimeModePreference("auto"),
    remoteRuntimeBaseUrl: normalizeRemoteRuntimeBaseUrl(""),
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

        containerEl.createEl("h2", { text: "Agent Runtime" });

        const codexStatusSetting = new Setting(containerEl)
            .setName("Codex runtime: Checking...")
            .setDesc("Checking whether @codex is available...");
        const applyCodexStatus = (diagnostics: CodexRuntimeDiagnostics) => {
            const presentation = getCodexRuntimeStatusPresentation(diagnostics);
            codexStatusSetting.setName(presentation.title);
            codexStatusSetting.setDesc(presentation.description);
        };
        const refreshCodexStatus = async () => {
            const refreshToken = ++this.codexStatusRefreshToken;
            applyCodexStatus(createCheckingCodexRuntimeDiagnostics());
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

        const hasRemoteBridgeConfig = !!this.plugin.getRemoteRuntimeBaseUrl() || !!this.plugin.getRemoteRuntimeBearerToken();
        const remoteBridgeDetails = containerEl.createEl("details");
        if (hasRemoteBridgeConfig) {
            remoteBridgeDetails.open = true;
        }

        remoteBridgeDetails.createEl("summary", { text: "Advanced Remote Bridge" });
        remoteBridgeDetails.createEl("p", {
            text: "Use this only for developer-managed remote testing. This is not OpenAI account sign-in or subscription detection.",
        });

        const remoteStatusSetting = new Setting(remoteBridgeDetails)
            .setName("Remote bridge: Not configured")
            .setDesc("Remote bridge is not configured.");
        const applyRemoteStatus = () => {
            const availability = this.plugin.getRemoteRuntimeAvailability();
            remoteStatusSetting.setName(
                availability.status === "available"
                    ? "Remote bridge: Available"
                    : "Remote bridge: Not configured",
            );
            remoteStatusSetting.setDesc(availability.message);
        };
        applyRemoteStatus();

        new Setting(remoteBridgeDetails)
            .setName("Remote bridge base URL")
            .setDesc("Developer-managed bridge endpoint. Use HTTPS, or HTTP only for localhost development.")
            .addText((text) =>
                text
                    .setPlaceholder("https://remote.example.com")
                    .setValue(this.plugin.getRemoteRuntimeBaseUrl())
                    .onChange(async (value) => {
                        await this.plugin.setRemoteRuntimeBaseUrl(value);
                        text.setValue(this.plugin.getRemoteRuntimeBaseUrl());
                        applyRemoteStatus();
                    })
            );

        new Setting(remoteBridgeDetails)
            .setName("Remote bridge token")
            .setDesc("Stored only on this device. For developer-managed remote testing only.")
            .addText((text) => {
                text.inputEl.type = "password";
                text
                    .setPlaceholder("Bearer token")
                    .setValue(this.plugin.getRemoteRuntimeBearerToken())
                    .onChange(async (value) => {
                        await this.plugin.setRemoteRuntimeBearerToken(value);
                        text.setValue(this.plugin.getRemoteRuntimeBearerToken());
                        applyRemoteStatus();
                    });
            });

        containerEl.createEl("h2", { text: "Index Note" });

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
