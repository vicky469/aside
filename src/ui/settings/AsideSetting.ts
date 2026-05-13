import {
    App,
    ButtonComponent,
    FileSystemAdapter,
    Notice,
    PluginSettingTab,
    Setting,
} from "obsidian";
import {
    normalizeAgentRuntimeModePreference,
    normalizeRemoteRuntimeBaseUrl,
    type AgentRuntimeModePreference,
} from "../../core/agents/agentRuntimePreferences";
import {
    resolveAgentRuntimeSelection,
    type AgentRuntimeSelection,
} from "../../agents/agentRuntimeSelection";
import {
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../../core/derived/allCommentsNote";
import type { CodexRuntimeDiagnostics } from "../../agents/agentRuntimeAdapter";
import {
    createCheckingCodexRuntimeDiagnostics,
    getLocalRuntimeOptionStatusPresentation,
    getRemoteRuntimeOptionStatusPresentation,
    type RuntimeOptionStatusPresentation,
} from "./codexRuntimeStatus";
import type Aside from "../../main";

export interface AsideSettings {
    indexNotePath: string;
    indexHeaderImageUrl: string;
    indexHeaderImageCaption: string;
    agentRuntimeMode: AgentRuntimeModePreference;
    remoteRuntimeBaseUrl: string;
}

export const DEFAULT_SETTINGS: AsideSettings = {
    indexNotePath: normalizeAllCommentsNotePath(""),
    indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(""),
    indexHeaderImageCaption: normalizeAllCommentsNoteImageCaption(null),
    agentRuntimeMode: normalizeAgentRuntimeModePreference("auto"),
    remoteRuntimeBaseUrl: normalizeRemoteRuntimeBaseUrl(""),
};

export default class AsideSetting extends PluginSettingTab {
    plugin: Aside;
    private codexStatusRefreshToken = 0;

    constructor(app: App, plugin: Aside) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Agent runtime")
            .setHeading();

        const isDesktopWithFilesystem = this.app.vault.adapter instanceof FileSystemAdapter;
        let localDiagnostics: CodexRuntimeDiagnostics = createCheckingCodexRuntimeDiagnostics();
        let runtimeSelection: AgentRuntimeSelection = this.resolveRuntimeSelection(
            localDiagnostics,
            isDesktopWithFilesystem,
        );
        let localRuntimeButton: ButtonComponent | null = null;
        let remoteRuntimeButton: ButtonComponent | null = null;
        let recheckRuntimeButton: ButtonComponent | null = null;

        const preferredRuntimeSetting = new Setting(containerEl)
            .setName("Preferred runtime")
            .setDesc("Checking runtime availability...");

        const getDisplayedRuntimeMode = (): "local" | "remote" => {
            const storedMode = this.plugin.getAgentRuntimeMode();
            if (storedMode === "local" || storedMode === "remote") {
                return storedMode;
            }

            return runtimeSelection.kind === "resolved" && runtimeSelection.runtime === "openclaw-acp"
                ? "remote"
                : "local";
        };
        const buildRuntimeSelectionDescription = (): string => {
            const storedMode = this.plugin.getAgentRuntimeMode();
            if (storedMode === "auto") {
                const activeLabel = getDisplayedRuntimeMode() === "remote" ? "Remote" : "Local";
                if (runtimeSelection.kind === "resolved") {
                    return `Automatic mode currently resolves to ${activeLabel}. Choose one below to make it explicit.`;
                }

                return `Automatic mode is currently blocked. ${runtimeSelection.notice}`;
            }

            return runtimeSelection.kind === "resolved"
                ? runtimeSelection.ownershipMessage
                : runtimeSelection.notice;
        };
        const updateRuntimeButton = (
            button: ButtonComponent | null,
            mode: "local" | "remote",
            presentation: RuntimeOptionStatusPresentation,
        ): void => {
            if (!button) {
                return;
            }

            const selected = getDisplayedRuntimeMode() === mode;
            button.setButtonText(presentation.label);
            button.setTooltip(presentation.description);
            button.buttonEl.classList.toggle("mod-cta", selected);
            button.buttonEl.setAttribute("aria-pressed", selected ? "true" : "false");
        };
        const renderRuntimeSetting = (): void => {
            preferredRuntimeSetting.setDesc(buildRuntimeSelectionDescription());
            updateRuntimeButton(
                localRuntimeButton,
                "local",
                getLocalRuntimeOptionStatusPresentation(localDiagnostics),
            );
            updateRuntimeButton(
                remoteRuntimeButton,
                "remote",
                getRemoteRuntimeOptionStatusPresentation(this.plugin.getRemoteRuntimeAvailability()),
            );
        };
        const setRuntimeButtonsDisabled = (disabled: boolean): void => {
            localRuntimeButton?.setDisabled(disabled);
            remoteRuntimeButton?.setDisabled(disabled);
            recheckRuntimeButton?.setDisabled(disabled);
        };
        const blurIfAutoFocused = (button: ButtonComponent): void => {
            window.setTimeout(() => {
                if (document.activeElement === button.buttonEl) {
                    button.buttonEl.blur();
                }
            }, 0);
        };
        const refreshRuntimeSetting = async () => {
            const refreshToken = ++this.codexStatusRefreshToken;
            localDiagnostics = createCheckingCodexRuntimeDiagnostics();
            runtimeSelection = this.resolveRuntimeSelection(localDiagnostics, isDesktopWithFilesystem);
            renderRuntimeSetting();
            try {
                localDiagnostics = await this.plugin.getCodexRuntimeDiagnostics();
                if (refreshToken !== this.codexStatusRefreshToken) {
                    return;
                }
            } catch {
                if (refreshToken !== this.codexStatusRefreshToken) {
                    return;
                }
                localDiagnostics = {
                    status: "unavailable",
                    message: "Codex could not be launched from this Obsidian environment.",
                };
            }
            runtimeSelection = this.resolveRuntimeSelection(localDiagnostics, isDesktopWithFilesystem);
            renderRuntimeSetting();
        };
        const persistRuntimeMode = async (mode: "local" | "remote") => {
            setRuntimeButtonsDisabled(true);
            try {
                await this.plugin.setAgentRuntimeMode(mode);
                runtimeSelection = this.resolveRuntimeSelection(localDiagnostics, isDesktopWithFilesystem);
                renderRuntimeSetting();
            } finally {
                setRuntimeButtonsDisabled(false);
            }
        };

        preferredRuntimeSetting.addButton((button) => {
            localRuntimeButton = button;
            button.onClick(async () => {
                await persistRuntimeMode("local");
            });
            blurIfAutoFocused(button);
        });
        preferredRuntimeSetting.addButton((button) => {
            remoteRuntimeButton = button;
            button.onClick(async () => {
                await persistRuntimeMode("remote");
            });
        });
        preferredRuntimeSetting.addButton((button) => {
            recheckRuntimeButton = button;
            button
                .setButtonText("Re-check")
                .onClick(async () => {
                    setRuntimeButtonsDisabled(true);
                    try {
                        await refreshRuntimeSetting();
                    } finally {
                        setRuntimeButtonsDisabled(false);
                    }
                });
        });
        renderRuntimeSetting();
        void refreshRuntimeSetting();

        const hasRemoteBridgeConfig = !!this.plugin.getRemoteRuntimeBaseUrl() || !!this.plugin.getRemoteRuntimeBearerToken();
        const remoteBridgeDetails = containerEl.createEl("details");
        if (hasRemoteBridgeConfig || this.plugin.getAgentRuntimeMode() === "remote") {
            remoteBridgeDetails.open = true;
        }

        remoteBridgeDetails.createEl("summary", { text: "Advanced remote bridge" });
        new Setting(remoteBridgeDetails)
            .setName("Remote bridge base URL")
            .setDesc("Developer-managed bridge endpoint. Use HTTP or HTTPS for localhost and private LAN development.")
            .addText((text) =>
                text
                    .setPlaceholder("https://remote.example.com")
                    .setValue(this.plugin.getRemoteRuntimeBaseUrl())
                    .onChange(async (value) => {
                        await this.plugin.setRemoteRuntimeBaseUrl(value);
                        text.setValue(this.plugin.getRemoteRuntimeBaseUrl());
                        runtimeSelection = this.resolveRuntimeSelection(localDiagnostics, isDesktopWithFilesystem);
                        renderRuntimeSetting();
                    })
            );

        new Setting(remoteBridgeDetails)
            .setName("Remote bridge token")
            .setDesc("Stored only on this device.")
            .addText((text) => {
                text.inputEl.type = "password";
                text
                    .setPlaceholder("Bearer token")
                    .setValue(this.plugin.getRemoteRuntimeBearerToken())
                    .onChange(async (value) => {
                        await this.plugin.setRemoteRuntimeBearerToken(value);
                        text.setValue(this.plugin.getRemoteRuntimeBearerToken());
                        runtimeSelection = this.resolveRuntimeSelection(localDiagnostics, isDesktopWithFilesystem);
                        renderRuntimeSetting();
                    });
            });

        new Setting(remoteBridgeDetails)
            .setName("Test remote bridge")
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

        new Setting(containerEl)
            .setName("Index note")
            .setHeading();

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

    private resolveRuntimeSelection(
        localDiagnostics: CodexRuntimeDiagnostics,
        isDesktopWithFilesystem: boolean,
    ): AgentRuntimeSelection {
        return resolveAgentRuntimeSelection({
            modePreference: this.plugin.getAgentRuntimeMode(),
            isDesktopWithFilesystem,
            localDiagnostics,
            remoteRuntimeBaseUrl: this.plugin.getRemoteRuntimeBaseUrl(),
            remoteRuntimeBearerToken: this.plugin.getRemoteRuntimeBearerToken(),
        });
    }
}
