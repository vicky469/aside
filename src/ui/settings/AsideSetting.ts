import {
    App,
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
import type Aside from "../../main";

export interface AsideSettings {
    indexNotePath: string;
    indexHeaderImageUrl: string;
    indexHeaderImageCaption: string;
    agentRuntimeMode: AgentRuntimeModePreference;
    showTodoSidebarTab: boolean;
    showAgentSidebarTab: boolean;
}

export const DEFAULT_SETTINGS: AsideSettings = {
    indexNotePath: normalizeAllCommentsNotePath(""),
    indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(""),
    indexHeaderImageCaption: normalizeAllCommentsNoteImageCaption(null),
    agentRuntimeMode: normalizeAgentRuntimeModePreference("auto"),
    showTodoSidebarTab: true,
    showAgentSidebarTab: true,
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
        this.agentStatusRefreshToken += 1;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Sidebar tabs")
            .setHeading();

        new Setting(containerEl)
            .setName("Show todo tab")
            .setDesc("Show the todo sidebar tab for @todo side notes.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showTodoSidebarTab)
                    .onChange(async (value) => {
                        await this.plugin.setShowTodoSidebarTab(value);
                        toggle.setValue(this.plugin.settings.showTodoSidebarTab);
                    })
            );

        const getAgentTabDescription = (runtimeStatusLines?: string[]): string | DocumentFragment => {
            const baseDescription = "Show the agent sidebar tab for local agent replies.";
            if (!runtimeStatusLines?.length) {
                return baseDescription;
            }

            const fragment = document.createDocumentFragment();
            fragment.append(baseDescription);
            for (const line of runtimeStatusLines) {
                const lineEl = document.createElement("div");
                lineEl.addClass("aside-agent-runtime-status-line");
                lineEl.textContent = line;
                fragment.append(lineEl);
            }
            return fragment;
        };

        const agentTabSetting = new Setting(containerEl)
            .setName("Show agent tab")
            .setDesc(getAgentTabDescription())
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showAgentSidebarTab)
                    .onChange(async (value) => {
                        await this.plugin.setShowAgentSidebarTab(value);
                        toggle.setValue(this.plugin.settings.showAgentSidebarTab);
                        this.display();
                    })
            );

        if (shouldRenderAgentRuntimeStatus(this.plugin.settings)) {
            this.renderAgentRuntimeStatus(agentTabSetting, getAgentTabDescription);
        }

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

    private renderAgentRuntimeStatus(
        agentTabSetting: Setting,
        getAgentTabDescription: (runtimeStatusLines?: string[]) => string | DocumentFragment,
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
            agentTabSetting.setDesc(getAgentTabDescription(
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
