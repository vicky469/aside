import {
    App,
    ButtonComponent,
    PluginSettingTab,
    Setting,
} from "obsidian";
import {
    normalizeAgentRuntimeModePreference,
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
    type RuntimeOptionStatusPresentation,
} from "./codexRuntimeStatus";
import type Aside from "../../main";

export interface AsideSettings {
    indexNotePath: string;
    indexHeaderImageUrl: string;
    indexHeaderImageCaption: string;
    agentRuntimeMode: AgentRuntimeModePreference;
}

export const DEFAULT_SETTINGS: AsideSettings = {
    indexNotePath: normalizeAllCommentsNotePath(""),
    indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(""),
    indexHeaderImageCaption: normalizeAllCommentsNoteImageCaption(null),
    agentRuntimeMode: normalizeAgentRuntimeModePreference("auto"),
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

        let localDiagnostics: CodexRuntimeDiagnostics = createCheckingCodexRuntimeDiagnostics();
        let runtimeSelection: AgentRuntimeSelection = this.resolveRuntimeSelection(localDiagnostics);
        let localRuntimeButton: ButtonComponent | null = null;
        let recheckRuntimeButton: ButtonComponent | null = null;

        const preferredRuntimeSetting = new Setting(containerEl)
            .setName("Preferred runtime")
            .setDesc("Checking runtime availability...");

        const buildRuntimeSelectionDescription = (): string => {
            const storedMode = this.plugin.getAgentRuntimeMode();
            if (storedMode === "auto") {
                if (runtimeSelection.kind === "resolved") {
                    return "Automatic mode currently uses your local Codex setup. Choose Local below to make it explicit.";
                }

                return `Automatic mode is currently blocked. ${runtimeSelection.notice}`;
            }

            return runtimeSelection.kind === "resolved"
                ? runtimeSelection.ownershipMessage
                : runtimeSelection.notice;
        };
        const updateRuntimeButton = (
            button: ButtonComponent | null,
            presentation: RuntimeOptionStatusPresentation,
        ): void => {
            if (!button) {
                return;
            }

            const selected = this.plugin.getAgentRuntimeMode() === "local";
            button.setButtonText(presentation.label);
            button.setTooltip(presentation.description);
            button.buttonEl.classList.toggle("mod-cta", selected);
            button.buttonEl.setAttribute("aria-pressed", selected ? "true" : "false");
        };
        const renderRuntimeSetting = (): void => {
            preferredRuntimeSetting.setDesc(buildRuntimeSelectionDescription());
            updateRuntimeButton(
                localRuntimeButton,
                getLocalRuntimeOptionStatusPresentation(localDiagnostics),
            );
        };
        const setRuntimeButtonsDisabled = (disabled: boolean): void => {
            localRuntimeButton?.setDisabled(disabled);
            recheckRuntimeButton?.setDisabled(disabled);
        };
        const blurIfAutoFocused = (button: ButtonComponent): void => {
            window.setTimeout(() => {
                if (button.buttonEl.ownerDocument.activeElement === button.buttonEl) {
                    button.buttonEl.blur();
                }
            }, 0);
        };
        const refreshRuntimeSetting = async () => {
            const refreshToken = ++this.codexStatusRefreshToken;
            localDiagnostics = createCheckingCodexRuntimeDiagnostics();
            runtimeSelection = this.resolveRuntimeSelection(localDiagnostics);
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
            runtimeSelection = this.resolveRuntimeSelection(localDiagnostics);
            renderRuntimeSetting();
        };
        const persistRuntimeMode = async (mode: "local") => {
            setRuntimeButtonsDisabled(true);
            try {
                await this.plugin.setAgentRuntimeMode(mode);
                runtimeSelection = this.resolveRuntimeSelection(localDiagnostics);
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
    ): AgentRuntimeSelection {
        return resolveAgentRuntimeSelection({
            modePreference: this.plugin.getAgentRuntimeMode(),
            localDiagnostics,
        });
    }
}
