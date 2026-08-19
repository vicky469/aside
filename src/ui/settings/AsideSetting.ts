import {
    App,
    PluginSettingTab,
    SecretComponent,
    Setting,
    type SettingDefinitionItem,
} from "obsidian";
import {
    normalizeAgentRuntimeModePreference,
    type AgentRuntimeModePreference,
} from "../../core/agents/agentRuntimePreferences";
import {
    DEFAULT_FEATURE_FLAGS,
    type FeatureFlags,
} from "../../core/config/featureFlags";
import {
    DEFAULT_PUBLISH_SETTINGS,
    type PublishSettings,
} from "../../core/publish/publishSettings";
import {
    DEFAULT_ASIDE_AGENT_ACTOR_ID,
    getSupportedAgentActors,
} from "../../core/agents/agentActorRegistry";
import {
    resolveDefaultAgentSelection,
} from "../../core/agents/defaultAgentSelection";
import type { AsideAgentTarget } from "../../core/config/agentTargets";
import {
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../../core/derived/allCommentsNote";
import type { AgentRuntimeDiagnostics } from "../../agents/agentRuntimeAdapter";
import { createCheckingAgentRuntimeDiagnostics } from "./codexRuntimeStatus";
import {
    buildDefaultAgentOptions,
    formatDefaultAgentFallback,
    resolveDefaultAgentRadioSelection,
} from "./agentRuntimeSettings";
import { type AsideSettingCatalogContext } from "./asideSettingCatalog";
import { getAsideSettingDefinitions } from "./asideSettingDefinitionsAdapter";
import { renderLegacyAsideSettings } from "./asideSettingLegacyAdapter";
import type Aside from "../../main";

export interface AsideSettings extends PublishSettings {
    indexNotePath: string;
    indexHeaderImageUrl: string;
    indexHeaderImageCaption: string;
    agentRuntimeMode: AgentRuntimeModePreference;
    defaultAgent: AsideAgentTarget;
    showTodoSidebarTab: boolean;
    showAgentSidebarTab: boolean;
    featureFlags: FeatureFlags;
    publishedPublicArtifactPaths: string[];
}

export const DEFAULT_SETTINGS: AsideSettings = {
    indexNotePath: normalizeAllCommentsNotePath(""),
    indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(""),
    indexHeaderImageCaption: normalizeAllCommentsNoteImageCaption(null),
    agentRuntimeMode: normalizeAgentRuntimeModePreference("auto"),
    defaultAgent: DEFAULT_ASIDE_AGENT_ACTOR_ID,
    showTodoSidebarTab: true,
    showAgentSidebarTab: true,
    featureFlags: DEFAULT_FEATURE_FLAGS,
    publishedPublicArtifactPaths: [],
    ...DEFAULT_PUBLISH_SETTINGS,
};

export default class AsideSetting extends PluginSettingTab {
    plugin: Aside;
    private agentStatusRefreshToken = 0;

    constructor(app: App, plugin: Aside) {
        super(app, plugin);
        this.plugin = plugin;
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        return getAsideSettingDefinitions(this.getCatalogContext());
    }

    display(): void {
        this.renderLegacySettings();
    }

    private renderLegacySettings(): void {
        this.agentStatusRefreshToken += 1;
        this.containerEl.empty();
        renderLegacyAsideSettings(
            this.containerEl,
            this.getCatalogContext(),
            (container) => new Setting(container),
        );
    }

    private getCatalogContext(): AsideSettingCatalogContext {
        return {
            plugin: this.plugin,
            refresh: () => this.refreshSettings(),
            renderDefaultAgentSettings: (setting, baseDescription) => {
                this.renderDefaultAgentSettings(setting, baseDescription);
            },
            renderPurgeBrokerSecret: (setting) => {
                setting.addComponent((containerEl) => {
                    const component = new SecretComponent(this.app, containerEl);
                    component
                        .setValue(this.plugin.settings.publishPurgeBrokerSecretName)
                        .onChange((value) => {
                            void this.plugin.setPublishPurgeBrokerSecretName(value).then(() => {
                                component.setValue(this.plugin.settings.publishPurgeBrokerSecretName);
                            });
                        });
                    return component;
                });
            },
        };
    }

    private refreshSettings(): void {
        const update: unknown = Reflect.get(this, "update");
        if (typeof update === "function") {
            Reflect.apply(update, this, []);
            return;
        }
        this.renderLegacySettings();
    }

    private getAgentSettingsDescription(
        baseDescription: string,
        supplementalLines?: string[],
    ): string | DocumentFragment {
        if (!supplementalLines?.length) {
            return baseDescription;
        }

        const fragment = createFragment();
        fragment.append(baseDescription);
        for (const line of supplementalLines) {
            const lineEl = createDiv();
            lineEl.addClass("aside-default-agent-fallback");
            lineEl.textContent = line;
            fragment.append(lineEl);
        }
        return fragment;
    }

    private renderDefaultAgentSettings(
        agentSetting: Setting,
        baseDescription: string,
    ): void {
        const supportedActors = getSupportedAgentActors();
        const localDiagnosticsByTarget = new Map<AsideAgentTarget, AgentRuntimeDiagnostics>(
            supportedActors.map((actor) => [actor.id, createCheckingAgentRuntimeDiagnostics(actor.id)]),
        );
        agentSetting.settingEl.addClass("aside-default-agent-setting");
        const groupEl = agentSetting.controlEl.createDiv({
            cls: "aside-default-agent-radio-group",
            attr: {
                role: "radiogroup",
                "aria-label": "Default agent",
            },
        });
        const radioRows = new Map<AsideAgentTarget, {
            rowEl: HTMLLabelElement;
            inputEl: HTMLInputElement;
            statusEl: HTMLSpanElement;
        }>();

        for (const actor of supportedActors) {
            const rowEl = groupEl.createEl("label", {
                cls: "aside-default-agent-option",
            });
            const inputEl = rowEl.createEl("input", {
                type: "radio",
                attr: {
                    name: "aside-default-agent",
                    value: actor.id,
                },
            });
            rowEl.createSpan({
                cls: "aside-default-agent-option-name",
                text: actor.label,
            });
            const statusEl = rowEl.createSpan({
                cls: "aside-default-agent-option-status",
            });
            inputEl.addEventListener("change", () => {
                const options = buildDefaultAgentOptions(
                    this.plugin.settings.defaultAgent,
                    localDiagnosticsByTarget,
                );
                const target = resolveDefaultAgentRadioSelection(options, actor.id);
                if (!inputEl.checked || !target) {
                    renderRuntimeSetting();
                    return;
                }
                void this.plugin.setDefaultAgent(target).then(
                    renderRuntimeSetting,
                    renderRuntimeSetting,
                );
            });
            radioRows.set(actor.id, { rowEl, inputEl, statusEl });
        }

        const renderRuntimeSetting = (): void => {
            const options = buildDefaultAgentOptions(
                this.plugin.settings.defaultAgent,
                localDiagnosticsByTarget,
            );
            for (const option of options) {
                const row = radioRows.get(option.target);
                if (!row) {
                    continue;
                }
                row.inputEl.checked = option.selected;
                row.inputEl.disabled = option.disabled;
                row.rowEl.toggleClass("is-selected", option.selected);
                row.rowEl.toggleClass("is-disabled", option.disabled);
                row.rowEl.toggleClass("is-checking", option.status === "checking");
                row.rowEl.toggleClass("is-available", option.status === "available");
                row.rowEl.toggleClass("is-unavailable", option.status === "unavailable");
                row.statusEl.textContent = option.statusLabel;
            }

            const selection = resolveDefaultAgentSelection(
                this.plugin.settings.defaultAgent,
                localDiagnosticsByTarget,
            );
            const fallbackLine = selection.kind === "fallback"
                ? formatDefaultAgentFallback(selection.preferredAgent, selection.selectedAgent)
                : "";
            agentSetting.setDesc(this.getAgentSettingsDescription(
                baseDescription,
                fallbackLine ? [fallbackLine] : undefined,
            ));
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
        void refreshRuntimeSetting();
    }

}
