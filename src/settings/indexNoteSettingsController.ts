import type { Plugin, TFile } from "obsidian";
import {
    normalizeAgentRuntimeModePreference,
    normalizeRemoteRuntimeBaseUrl,
    type AgentRuntimeModePreference,
} from "../core/agents/agentRuntimePreferences";
import {
    ALL_COMMENTS_NOTE_PATH,
    LEGACY_ALL_COMMENTS_NOTE_PATH,
    LEGACY_ALL_COMMENTS_NOTE_PATHS,
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

        await this.migrateLegacyGeneratedIndexNoteIfNeeded();
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

    public getRemoteRuntimeBaseUrl(): string {
        return normalizeRemoteRuntimeBaseUrl(this.host.getSettings().remoteRuntimeBaseUrl);
    }

    public isAllCommentsNotePath(filePath: string): boolean {
        return isAllCommentsNotePath(filePath, this.getAllCommentsNotePath());
    }

    public async setIndexNotePath(nextPathInput: string): Promise<void> {
        const settings = this.host.getSettings();
        const previousPath = this.getAllCommentsNotePath();
        const parentPath = getIndexNoteParentPath(normalizeAllCommentsNotePath(nextPathInput));
        const currentIndexFile = this.host.getMarkdownFileByPath(previousPath)
            ?? LEGACY_ALL_COMMENTS_NOTE_PATHS
                .map((path) => this.host.getMarkdownFileByPath(path))
                .find((file): file is TFile => !!file)
            ?? this.host.getMarkdownFileByPath(LEGACY_ALL_COMMENTS_NOTE_PATH);
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

    private async migrateLegacyGeneratedIndexNoteIfNeeded(): Promise<void> {
        const currentPath = this.getAllCommentsNotePath();
        if (currentPath !== ALL_COMMENTS_NOTE_PATH) {
            return;
        }

        if (this.host.getMarkdownFileByPath(currentPath) || await this.adapterPathExists(currentPath)) {
            await this.removeStaleLegacyGeneratedIndexNotes();
            return;
        }

        const legacyFile = LEGACY_ALL_COMMENTS_NOTE_PATHS
            .map((path) => this.host.getMarkdownFileByPath(path))
            .find((file): file is TFile => !!file)
            ?? this.host.getMarkdownFileByPath(LEGACY_ALL_COMMENTS_NOTE_PATH);

        if (!legacyFile || legacyFile.path === currentPath) {
            const legacyPath = await this.findAdapterOnlyLegacyGeneratedIndexNotePath();
            if (!legacyPath || legacyPath === currentPath) {
                return;
            }

            await this.host.app.vault.adapter.rename(legacyPath, currentPath);
            return;
        }

        await this.host.app.fileManager.renameFile(legacyFile, currentPath);
    }

    private async findAdapterOnlyLegacyGeneratedIndexNotePath(): Promise<string | null> {
        for (const legacyPath of LEGACY_ALL_COMMENTS_NOTE_PATHS) {
            if (await this.adapterPathExists(legacyPath)) {
                return legacyPath;
            }
        }

        return await this.adapterPathExists(LEGACY_ALL_COMMENTS_NOTE_PATH)
            ? LEGACY_ALL_COMMENTS_NOTE_PATH
            : null;
    }

    private async adapterPathExists(filePath: string): Promise<boolean> {
        try {
            return await this.host.app.vault.adapter.exists(filePath);
        } catch {
            return false;
        }
    }

    private async removeStaleLegacyGeneratedIndexNotes(): Promise<void> {
        for (const legacyPath of LEGACY_ALL_COMMENTS_NOTE_PATHS) {
            if (!await this.isLegacyGeneratedIndexNote(legacyPath)) {
                continue;
            }

            const legacyFile = this.host.getMarkdownFileByPath(legacyPath);
            if (legacyFile) {
                await this.host.app.fileManager.trashFile(legacyFile);
                continue;
            }

            await this.host.app.vault.adapter.remove(legacyPath);
        }
    }

    private async isLegacyGeneratedIndexNote(filePath: string): Promise<boolean> {
        if (!this.host.getMarkdownFileByPath(filePath) && !await this.adapterPathExists(filePath)) {
            return false;
        }

        try {
            return this.isLegacyGeneratedIndexNoteContent(await this.host.app.vault.adapter.read(filePath));
        } catch {
            return false;
        }
    }

    private isLegacyGeneratedIndexNoteContent(content: string): boolean {
        return content.trimStart().startsWith("![SideNote2 index header image]")
            || content.includes("sidenote2-index-header-caption")
            || content.includes("sidenote2-index-file-filter-link")
            || content.includes("data-sidenote2-file-path");
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

    public async setRemoteRuntimeBaseUrl(nextUrlInput: string): Promise<void> {
        const settings = this.host.getSettings();
        const nextUrl = normalizeRemoteRuntimeBaseUrl(nextUrlInput);
        if (!shouldApplyNormalizedSettingChange({
            currentStoredValue: settings.remoteRuntimeBaseUrl,
            currentNormalizedValue: this.getRemoteRuntimeBaseUrl(),
            nextNormalizedValue: nextUrl,
        })) {
            return;
        }

        this.host.setSettings({
            ...settings,
            remoteRuntimeBaseUrl: nextUrl,
        });
        await this.saveSettings();
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
        this.persistedPluginData = {
            ...persistedData,
        };
        await this.host.saveData(this.persistedPluginData);
    }

}
