import { App, Notice, PluginSettingTab, Setting } from "obsidian";
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
    getCodexRuntimeStatusPresentationForSelection,
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
            try {
                const selection = await this.plugin.resolveAgentRuntimeSelection();
                if (refreshToken !== this.codexStatusRefreshToken) {
                    return;
                }

                const presentation = getCodexRuntimeStatusPresentationForSelection(selection);
                codexStatusSetting.setName(presentation.title);
                codexStatusSetting.setDesc(presentation.description);
            } catch {
                const diagnostics = await this.plugin.getCodexRuntimeDiagnostics();
                if (refreshToken !== this.codexStatusRefreshToken) {
                    return;
                }

                applyCodexStatus(diagnostics);
            }
        };
        codexStatusSetting.addButton((button) => {
            button
                .setButtonText("Re-check")
                .onClick(async () => {
                    await refreshCodexStatus();
                });

            // Obsidian can land initial focus on the first settings action button.
            // Clear that one-time autofocus so the row does not render as highlighted on open.
            window.setTimeout(() => {
                if (document.activeElement === button.buttonEl) {
                    button.buttonEl.blur();
                }
            }, 0);
        });
        void refreshCodexStatus();

        const hasRemoteBridgeConfig = !!this.plugin.getRemoteRuntimeBaseUrl() || !!this.plugin.getRemoteRuntimeBearerToken();
        const remoteBridgeDetails = containerEl.createEl("details");
        if (hasRemoteBridgeConfig) {
            remoteBridgeDetails.open = true;
        }

        remoteBridgeDetails.createEl("summary", { text: "Advanced Remote Bridge" });
        new Setting(remoteBridgeDetails)
            .setName("Remote bridge base URL")
            .setDesc("Developer-managed bridge endpoint. Use HTTPS, or HTTP only for localhost and private LAN development.")
            .addText((text) =>
                text
                    .setPlaceholder("https://remote.example.com")
                    .setValue(this.plugin.getRemoteRuntimeBaseUrl())
                    .onChange(async (value) => {
                        await this.plugin.setRemoteRuntimeBaseUrl(value);
                        text.setValue(this.plugin.getRemoteRuntimeBaseUrl());
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
                    });
            });

        new Setting(remoteBridgeDetails)
            .setName("Test remote bridge")
            .setDesc("Checks the bridge from inside Obsidian on this device.")
            .addButton((button) =>
                button
                    .setButtonText("Test connection")
                    .onClick(async () => {
                        button.setDisabled(true);
                        try {
                            const result = await this.plugin.probeRemoteRuntimeBridge();
                            if (result.ok) {
                                new Notice(`Remote bridge reachable: ${result.publicBaseUrl ?? result.status ?? "ok"}`);
                            } else {
                                new Notice(`Remote bridge responded with HTTP ${result.httpStatus}.`);
                            }
                        } catch (error) {
                            const message = error instanceof Error && error.message.trim()
                                ? error.message.trim()
                                : "Remote bridge test failed.";
                            new Notice(message, 10000);
                        } finally {
                            button.setDisabled(false);
                        }
                    })
            );

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
