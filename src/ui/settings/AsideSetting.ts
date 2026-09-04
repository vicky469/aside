import {
    App,
    Component,
    MarkdownRenderer,
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
    resolveDefaultAgentRadioSelection,
} from "./agentRuntimeSettings";
import { resolveDefaultAgentSetupGuideState } from "./defaultAgentSetupGuide";
import { appendAsideSettingInfoIcon } from "./asideSettingInfoIcon";
import { type AsideSettingCatalogContext } from "./asideSettingCatalog";
import { getAsideSettingDefinitions } from "./asideSettingDefinitionsAdapter";
import { renderAsideSettingsHeaderArt } from "./asideSettingsHeaderArt";
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
    private setupGuideMarkdownComponent: Component | null = null;

    constructor(app: App, plugin: Aside) {
        super(app, plugin);
        this.plugin = plugin;
        this.containerEl.addClass("aside-settings-tab");
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                name: "Aside workflow",
                searchable: false,
                render: (setting) => {
                    setting.settingEl.addClass("aside-settings-hero-setting");
                    setting.settingEl.parentElement?.addClass("aside-settings-hero-group");
                    setting.settingEl.empty();
                    renderAsideSettingsHeaderArt(setting.settingEl);
                },
            },
            ...getAsideSettingDefinitions(this.getCatalogContext()),
        ];
    }

    display(): void {
        this.renderLegacySettings();
    }

    hide(): void {
        this.agentStatusRefreshToken += 1;
        this.unloadSetupGuideMarkdownComponent();
        this.containerEl.empty();
    }

    private renderLegacySettings(): void {
        this.agentStatusRefreshToken += 1;
        this.unloadSetupGuideMarkdownComponent();
        this.containerEl.empty();
        renderAsideSettingsHeaderArt(this.containerEl);
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

    private unloadSetupGuideMarkdownComponent(): void {
        this.setupGuideMarkdownComponent?.unload();
        this.setupGuideMarkdownComponent = null;
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
        appendAsideSettingInfoIcon(agentSetting.nameEl, baseDescription);
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

        const setupGuideEl = agentSetting.controlEl.createDiv({
            cls: "aside-default-agent-setup-guide",
        });
        const setupGuideMarkdownEl = setupGuideEl.createDiv({
            cls: "aside-default-agent-setup-guide-markdown",
        });
        const setupGuideRecheckButton = setupGuideEl.createEl("button", {
            cls: "mod-cta aside-default-agent-setup-recheck",
            text: "Recheck availability",
        });
        setupGuideRecheckButton.setAttr("type", "button");
        setupGuideRecheckButton.addEventListener("click", () => {
            void refreshRuntimeSetting();
        });

        const renderSetupGuide = (): void => {
            const guideState = resolveDefaultAgentSetupGuideState(localDiagnosticsByTarget);
            const shouldShowGuide = guideState.kind === "setup-needed"
                || guideState.kind === "desktop-required";
            setupGuideEl.toggleClass("is-visible", shouldShowGuide);
            setupGuideRecheckButton.toggleClass("is-visible", guideState.kind === "setup-needed");
            if (!shouldShowGuide) {
                setupGuideMarkdownEl.empty();
                this.unloadSetupGuideMarkdownComponent();
                return;
            }

            setupGuideMarkdownEl.empty();
            this.unloadSetupGuideMarkdownComponent();
            this.setupGuideMarkdownComponent = new Component();
            this.setupGuideMarkdownComponent.load();
            void MarkdownRenderer.render(
                this.app,
                guideState.markdown,
                setupGuideMarkdownEl,
                "",
                this.setupGuideMarkdownComponent,
            );
        };

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

            renderSetupGuide();
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
