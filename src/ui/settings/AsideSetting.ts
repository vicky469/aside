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
import { getSupportedAgentActors } from "../../core/agents/agentActorRegistry";
import type { AsideAgentTarget } from "../../core/config/agentTargets";
import {
    resolveAgentRuntimeSelection,
    type AgentRuntimeSelection,
} from "../../agents/agentRuntimeSelection";
import {
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../../core/derived/allCommentsNote";
import type { AgentRuntimeDiagnostics } from "../../agents/agentRuntimeAdapter";
import {
    createCheckingAgentRuntimeDiagnostics,
    createCheckingCodexRuntimeDiagnostics,
    getAgentRuntimeStatusPresentation,
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
    private agentStatusRefreshToken = 0;

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

        const supportedActors = getSupportedAgentActors();
        const localDiagnosticsByTarget = new Map<AsideAgentTarget, AgentRuntimeDiagnostics>(
            supportedActors.map((actor) => [actor.id, createCheckingAgentRuntimeDiagnostics(actor.id)]),
        );
        let runtimeSelection: AgentRuntimeSelection = this.resolveRuntimeSelection(
            "codex",
            localDiagnosticsByTarget.get("codex") ?? createCheckingCodexRuntimeDiagnostics(),
        );
        let localRuntimeButton: ButtonComponent | null = null;
        let recheckRuntimeButton: ButtonComponent | null = null;
        const runtimeStatusSettings = new Map<AsideAgentTarget, Setting>();

        const preferredRuntimeSetting = new Setting(containerEl)
            .setName("Preferred runtime")
            .setDesc("Checking runtime availability...");

        for (const actor of supportedActors) {
            const setting = new Setting(containerEl)
                .setName(`${actor.label} CLI`)
                .setDesc(createCheckingAgentRuntimeDiagnostics(actor.id).message);
            runtimeStatusSettings.set(actor.id, setting);
        }

        const getAggregateDiagnostics = (): AgentRuntimeDiagnostics => {
            const diagnostics = supportedActors.map((actor) =>
                localDiagnosticsByTarget.get(actor.id) ?? createCheckingAgentRuntimeDiagnostics(actor.id)
            );
            const available = diagnostics.find((item) => item.status === "available");
            if (available) {
                return {
                    status: "available",
                    message: "At least one local Aside agent is available.",
                };
            }

            const checking = diagnostics.find((item) => item.status === "checking");
            if (checking) {
                return {
                    status: "checking",
                    message: "Checking local Aside agent runtimes...",
                };
            }

            return diagnostics[0] ?? {
                status: "unavailable",
                message: "Local Aside agent execution is unavailable on this device.",
            };
        };

        const buildRuntimeSelectionDescription = (): string => {
            const storedMode = this.plugin.getAgentRuntimeMode();
            if (storedMode === "auto") {
                if (runtimeSelection.kind === "resolved") {
                    return "Automatic mode uses the local provider named in each explicit agent mention. Choose Local below to make it explicit.";
                }

                return `Automatic mode is currently blocked. ${runtimeSelection.notice}`;
            }

            return "Local mode uses the provider named in each explicit agent mention. Availability is shown below.";
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
            const aggregateDiagnostics = getAggregateDiagnostics();
            runtimeSelection = this.resolveRuntimeSelection("codex", aggregateDiagnostics);
            preferredRuntimeSetting.setDesc(buildRuntimeSelectionDescription());
            updateRuntimeButton(
                localRuntimeButton,
                getLocalRuntimeOptionStatusPresentation(aggregateDiagnostics),
            );
            for (const actor of supportedActors) {
                const diagnostics = localDiagnosticsByTarget.get(actor.id)
                    ?? createCheckingAgentRuntimeDiagnostics(actor.id);
                const presentation = getAgentRuntimeStatusPresentation(actor.id, diagnostics);
                runtimeStatusSettings.get(actor.id)?.setDesc(presentation.description);
            }
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
            const refreshToken = ++this.agentStatusRefreshToken;
            for (const actor of supportedActors) {
                localDiagnosticsByTarget.set(actor.id, createCheckingAgentRuntimeDiagnostics(actor.id));
            }
            renderRuntimeSetting();
            try {
                const nextDiagnostics = await Promise.all(supportedActors.map(async (actor) => {
                    try {
                        return {
                            target: actor.id,
                            diagnostics: await this.plugin.getAgentRuntimeDiagnostics(actor.id),
                        };
                    } catch {
                        return {
                            target: actor.id,
                            diagnostics: {
                                status: "unavailable",
                                message: `${actor.label} could not be launched from this Obsidian environment.`,
                            } satisfies AgentRuntimeDiagnostics,
                        };
                    }
                }));
                if (refreshToken !== this.agentStatusRefreshToken) {
                    return;
                }
                for (const item of nextDiagnostics) {
                    localDiagnosticsByTarget.set(item.target, item.diagnostics);
                }
            } catch {
                // Each provider probe handles its own failure above.
            }
            renderRuntimeSetting();
        };
        const persistRuntimeMode = async (mode: "local") => {
            setRuntimeButtonsDisabled(true);
            try {
                await this.plugin.setAgentRuntimeMode(mode);
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
        target: AsideAgentTarget,
        localDiagnostics: AgentRuntimeDiagnostics,
    ): AgentRuntimeSelection {
        return resolveAgentRuntimeSelection({
            target,
            modePreference: this.plugin.getAgentRuntimeMode(),
            localDiagnostics,
        });
    }
}
