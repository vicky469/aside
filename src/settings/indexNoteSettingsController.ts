import type { Plugin, TFile } from "obsidian";
import {
    normalizeAgentRuntimeModePreference,
    type AgentRuntimeModePreference,
} from "../core/agents/agentRuntimePreferences";
import {
    derivePublishBaseUrlFromProjectName,
    isDefaultPagesPublishBaseUrl,
    normalizePublishProjectName,
    normalizePublishSettings,
    type PublishSettings,
} from "../core/publish/publishSettings";
import {
    isAllCommentsNotePath,
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../core/derived/allCommentsNote";
import {
    type AsideSettings,
} from "../ui/settings/AsideSetting";
import {
    getIndexNoteParentPath,
    resolveIndexNotePathChange,
    resolveLoadedSettings,
    shouldApplyNormalizedSettingChange,
    type PersistedPluginData,
} from "./indexNoteSettingsPlanner";

export interface IndexNoteSettingsHost {
    app: Plugin["app"];
    getSettings(): AsideSettings;
    setSettings(settings: AsideSettings): void;
    getFileByPath(filePath: string): TFile | null;
    getMarkdownFileByPath(filePath: string): TFile | null;
    getActiveSidebarFile(): TFile | null;
    setActiveSidebarFile(file: TFile | null): void;
    getDraftHostFilePath(): string | null;
    setDraftHostFilePath(filePath: string | null): void;
    getSidebarTargetFile(): TFile | null;
    updateSidebarViews(file: TFile | null): Promise<void>;
    refreshAggregateNoteNow(): Promise<void>;
    loadData(): Promise<PersistedPluginData | null>;
    saveData(data: PersistedPluginData): Promise<void>;
    ensureFolder(folderPath: string): Promise<{ ok: true } | { ok: false; notice: string }>;
    showNotice(message: string): void;
}

export class IndexNoteSettingsController {
    private persistedPluginData: PersistedPluginData = {};

    constructor(private readonly host: IndexNoteSettingsHost) {}

    public async loadSettings(): Promise<void> {
        const loaded = await this.host.loadData();
        this.persistedPluginData = loaded ?? {};
        const resolved = resolveLoadedSettings(loaded, this.host.getSettings());
        this.host.setSettings(resolved.settings);

        if (resolved.shouldRewriteLegacySettings) {
            await this.saveSettings();
        }

    }

    public async saveSettings(): Promise<void> {
        await this.writePersistedPluginData({
            ...this.persistedPluginData,
            ...this.host.getSettings(),
        });
    }

    public getAllCommentsNotePath(): string {
        return normalizeAllCommentsNotePath(this.host.getSettings().indexNotePath);
    }

    public getIndexHeaderImageUrl(): string {
        return normalizeAllCommentsNoteImageUrl(this.host.getSettings().indexHeaderImageUrl);
    }

    public getIndexHeaderImageCaption(): string {
        return normalizeAllCommentsNoteImageCaption(this.host.getSettings().indexHeaderImageCaption);
    }

    public getAgentRuntimeMode(): AgentRuntimeModePreference {
        return normalizeAgentRuntimeModePreference(this.host.getSettings().agentRuntimeMode);
    }

    public isAllCommentsNotePath(filePath: string): boolean {
        return isAllCommentsNotePath(filePath, this.getAllCommentsNotePath());
    }

    public async setIndexNotePath(nextPathInput: string): Promise<void> {
        const settings = this.host.getSettings();
        const previousPath = this.getAllCommentsNotePath();
        const parentPath = getIndexNoteParentPath(normalizeAllCommentsNotePath(nextPathInput));
        const currentIndexFile = this.host.getMarkdownFileByPath(previousPath);
        const conflictingFile = this.host.getFileByPath(normalizeAllCommentsNotePath(nextPathInput));

        const plan = resolveIndexNotePathChange({
            nextPathInput,
            currentStoredPath: settings.indexNotePath,
            previousPath,
            parentPath,
            parentExists: parentPath ? !!this.host.app.vault.getAbstractFileByPath(parentPath) : true,
            conflictingFilePath: conflictingFile?.path ?? null,
            currentIndexFilePath: currentIndexFile?.path ?? null,
            activeSidebarFilePath: this.host.getActiveSidebarFile()?.path ?? null,
            draftHostFilePath: this.host.getDraftHostFilePath(),
        });

        if (plan.kind === "noop") {
            return;
        }

        if (plan.kind === "missing-parent" || plan.kind === "conflict") {
            this.host.showNotice(plan.notice);
            return;
        }

        this.host.setSettings({
            ...settings,
            indexNotePath: plan.nextPath,
        });
        await this.saveSettings();

        if (plan.shouldRenameCurrentIndexFile && currentIndexFile) {
            await this.host.app.fileManager.renameFile(currentIndexFile, plan.nextPath);
        }

        if (plan.shouldRetargetActiveSidebarFile) {
            this.host.setActiveSidebarFile(this.host.getMarkdownFileByPath(plan.nextPath));
        }

        if (plan.shouldRetargetDraftHostFile) {
            this.host.setDraftHostFilePath(plan.nextPath);
        }

        await this.host.refreshAggregateNoteNow();
        await this.host.updateSidebarViews(this.host.getSidebarTargetFile());
    }

    public async setIndexHeaderImageUrl(nextUrlInput: string): Promise<void> {
        const settings = this.host.getSettings();
        const nextUrl = normalizeAllCommentsNoteImageUrl(nextUrlInput);
        if (!shouldApplyNormalizedSettingChange({
            currentStoredValue: settings.indexHeaderImageUrl,
            currentNormalizedValue: this.getIndexHeaderImageUrl(),
            nextNormalizedValue: nextUrl,
        })) {
            return;
        }

        this.host.setSettings({
            ...settings,
            indexHeaderImageUrl: nextUrl,
        });
        await this.saveSettings();
        await this.host.refreshAggregateNoteNow();
    }

    public async setIndexHeaderImageCaption(nextCaptionInput: string): Promise<void> {
        const settings = this.host.getSettings();
        const nextCaption = normalizeAllCommentsNoteImageCaption(nextCaptionInput);
        if (!shouldApplyNormalizedSettingChange({
            currentStoredValue: settings.indexHeaderImageCaption,
            currentNormalizedValue: this.getIndexHeaderImageCaption(),
            nextNormalizedValue: nextCaption,
        })) {
            return;
        }

        this.host.setSettings({
            ...settings,
            indexHeaderImageCaption: nextCaption,
        });
        await this.saveSettings();
        await this.host.refreshAggregateNoteNow();
    }

    public async setAgentRuntimeMode(nextModeInput: AgentRuntimeModePreference): Promise<void> {
        const settings = this.host.getSettings();
        const nextMode = normalizeAgentRuntimeModePreference(nextModeInput);
        if (settings.agentRuntimeMode === nextMode) {
            return;
        }

        this.host.setSettings({
            ...settings,
            agentRuntimeMode: nextMode,
        });
        await this.saveSettings();
    }

    public async setShowTodoSidebarTab(visible: boolean): Promise<void> {
        const settings = this.host.getSettings();
        if (settings.showTodoSidebarTab === visible) {
            return;
        }

        this.host.setSettings({
            ...settings,
            showTodoSidebarTab: visible,
        });
        await this.saveSettings();
        await this.host.updateSidebarViews(this.host.getSidebarTargetFile());
    }

    public async setShowAgentSidebarTab(visible: boolean): Promise<void> {
        const settings = this.host.getSettings();
        if (settings.showAgentSidebarTab === visible) {
            return;
        }

        this.host.setSettings({
            ...settings,
            showAgentSidebarTab: visible,
        });
        await this.saveSettings();
        await this.host.updateSidebarViews(this.host.getSidebarTargetFile());
    }

    public async setPublishPagesProjectName(projectName: string): Promise<void> {
        const settings = this.host.getSettings();
        const normalizedProjectName = normalizePublishProjectName(projectName);
        const patch: Partial<PublishSettings> = {
            publishPagesProjectName: projectName,
        };
        if (normalizedProjectName && isDefaultPagesPublishBaseUrl(settings.publishBaseUrl)) {
            patch.publishBaseUrl = derivePublishBaseUrlFromProjectName(normalizedProjectName);
        }

        await this.setPublishSettings(patch);
    }

    public async setPublishEnabled(enabled: boolean): Promise<void> {
        if (enabled) {
            const folderResult = await this.host.ensureFolder("public");
            if (!folderResult.ok) {
                this.host.showNotice(folderResult.notice);
                return;
            }
        }

        await this.setPublishSettings({
            publishEnabled: enabled,
        });
    }

    public async setPublishBaseUrl(baseUrl: string): Promise<void> {
        await this.setPublishSettings({
            publishBaseUrl: baseUrl,
        });
    }

    public async setPublishAllowedRoot(allowedRoot: string): Promise<void> {
        await this.setPublishSettings({
            publishAllowedRoot: allowedRoot,
        });
    }

    public readPersistedPluginData(): PersistedPluginData {
        return {
            ...this.persistedPluginData,
        };
    }

    public async writePersistedPluginData(data: PersistedPluginData): Promise<void> {
        const persistedData = {
            ...data,
        };
        delete persistedData.confirmDelete;
        delete persistedData.enableDebugMode;
        delete persistedData.preferredAgentTarget;
        delete persistedData.remoteRuntimeBaseUrl;
        delete (persistedData as Record<string, unknown>).publishWranglerCommand;
        this.persistedPluginData = {
            ...persistedData,
        };
        await this.host.saveData(this.persistedPluginData);
    }

    private async setPublishSettings(patch: Partial<PublishSettings>): Promise<void> {
        const settings = this.host.getSettings();
        const nextPublishSettings = normalizePublishSettings({
            ...settings,
            ...patch,
        });
        const nextSettings = {
            ...settings,
            ...nextPublishSettings,
        };
        const changed = (Object.keys(nextPublishSettings) as Array<keyof PublishSettings>).some((key) =>
            settings[key] !== nextSettings[key]
        );
        if (!changed) {
            return;
        }

        this.host.setSettings(nextSettings);
        await this.saveSettings();
    }

}
