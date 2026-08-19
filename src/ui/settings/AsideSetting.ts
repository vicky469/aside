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
    formatAgentRuntimeStatusLines,
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
        runtimeStatusLines?: string[],
    ): string | DocumentFragment {
        if (!runtimeStatusLines?.length) {
            return baseDescription;
        }

        const fragment = createFragment();
        fragment.append(baseDescription);
        for (const line of runtimeStatusLines) {
            const lineEl = createDiv();
            lineEl.addClass("aside-agent-runtime-status-line");
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
        let selectEl: HTMLSelectElement | null = null;

        agentSetting.addDropdown((dropdown) => {
            for (const actor of supportedActors) {
                dropdown.addOption(actor.id, actor.label);
            }
            dropdown
                .setValue(this.plugin.settings.defaultAgent)
                .onChange(async (value) => {
                    await this.plugin.setDefaultAgent(value as AsideAgentTarget);
                    dropdown.setValue(this.plugin.settings.defaultAgent);
                    renderRuntimeSetting();
                });
            selectEl = dropdown.selectEl;
        });

        const getStatusBadge = (diagnostics: AgentRuntimeDiagnostics): string => {
            switch (diagnostics.status) {
                case "available": return "✅";
                case "checking": return "...";
                default: return "❌";
            }
        };

        const renderRuntimeSetting = (): void => {
            if (selectEl) {
                for (const option of buildDefaultAgentOptions(
                    this.plugin.settings.defaultAgent,
                    localDiagnosticsByTarget,
                )) {
                    const optionEl = Array.from(selectEl.options)
                        .find((candidate) => candidate.value === option.target);
                    if (!optionEl) {
                        continue;
                    }
                    optionEl.disabled = !option.available;
                    optionEl.text = option.available
                        ? option.label
                        : `${option.label} (unavailable)`;
                }
                selectEl.value = this.plugin.settings.defaultAgent;
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
                [
                    ...formatAgentRuntimeStatusLines(
                    supportedActors.map((actor) => {
                        const diagnostics = localDiagnosticsByTarget.get(actor.id)
                            ?? createCheckingAgentRuntimeDiagnostics(actor.id);
                        return {
                            label: actor.label,
                            statusBadge: getStatusBadge(diagnostics),
                        };
                    }),
                    ),
                    ...(fallbackLine ? [fallbackLine] : []),
                ],
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
