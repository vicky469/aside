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

        const getStatusBadge = (diagnostics: AgentRuntimeDiagnostics): string => {
            switch (diagnostics.status) {
                case "available": return "✅";
                case "checking": return "...";
                default: return "❌";
            }
        };

        const runtimeStatusSetting = new Setting(containerEl)
            .setDesc(
                supportedActors
                    .map((actor) => `${actor.directive} ${getStatusBadge(createCheckingAgentRuntimeDiagnostics(actor.id))}`)
                    .join("  "),
            );

        const renderRuntimeSetting = (): void => {
            runtimeStatusSetting.setDesc(
                supportedActors
                    .map((actor) => {
                        const diagnostics = localDiagnosticsByTarget.get(actor.id)
                            ?? createCheckingAgentRuntimeDiagnostics(actor.id);
                        return `${actor.directive} ${getStatusBadge(diagnostics)}`;
                    })
                    .join("  "),
            );
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

}
