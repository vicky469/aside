import {
    App,
    PluginSettingTab,
    Setting,
    type SettingDefinitionItem,
} from "obsidian";
import {
    normalizeAgentRuntimeModePreference,
    type AgentRuntimeModePreference,
} from "../../core/agents/agentRuntimePreferences";
import {
    DEFAULT_PUBLISH_SETTINGS,
    type PublishSettings,
} from "../../core/publish/publishSettings";
import { getSupportedAgentActors } from "../../core/agents/agentActorRegistry";
import type { AsideAgentTarget } from "../../core/config/agentTargets";
import {
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../../core/derived/allCommentsNote";
import type { AgentRuntimeDiagnostics } from "../../agents/agentRuntimeAdapter";
import { createCheckingAgentRuntimeDiagnostics } from "./codexRuntimeStatus";
import {
    formatAgentRuntimeStatusLines,
    shouldRenderAgentRuntimeStatus,
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
    showTodoSidebarTab: boolean;
    showAgentSidebarTab: boolean;
    publishedPublicArtifactPaths: string[];
}

export const DEFAULT_SETTINGS: AsideSettings = {
    indexNotePath: normalizeAllCommentsNotePath(""),
    indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(""),
    indexHeaderImageCaption: normalizeAllCommentsNoteImageCaption(null),
    agentRuntimeMode: normalizeAgentRuntimeModePreference("auto"),
    showTodoSidebarTab: true,
    showAgentSidebarTab: true,
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
            renderAgentRuntimeStatus: (setting, baseDescription) => {
                setting.setDesc(this.getAgentTabDescription(baseDescription));
                if (shouldRenderAgentRuntimeStatus(this.plugin.settings)) {
                    this.renderAgentRuntimeStatus(setting, baseDescription);
                }
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

    private getAgentTabDescription(
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

    private renderAgentRuntimeStatus(
        agentTabSetting: Setting,
        baseDescription: string,
    ): void {
        const supportedActors = getSupportedAgentActors();
        const localDiagnosticsByTarget = new Map<AsideAgentTarget, AgentRuntimeDiagnostics>(
            supportedActors.map((actor) => [actor.id, createCheckingAgentRuntimeDiagnostics(actor.id)]),
        );

        const getStatusBadge = (diagnostics: AgentRuntimeDiagnostics): string => {
            switch (diagnostics.status) {
                case "available": return "✅";
                case "checking": return "...";
                default: return "❌";
            }
        };

        const renderRuntimeSetting = (): void => {
            agentTabSetting.setDesc(this.getAgentTabDescription(
                baseDescription,
                formatAgentRuntimeStatusLines(
                    supportedActors.map((actor) => {
                        const diagnostics = localDiagnosticsByTarget.get(actor.id)
                            ?? createCheckingAgentRuntimeDiagnostics(actor.id);
                        return {
                            directive: actor.directive,
                            statusBadge: getStatusBadge(diagnostics),
                        };
                    }),
                ),
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
