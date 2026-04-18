import type { Plugin, TFile } from "obsidian";
import type { CommentManager } from "../commentManager";
import {
    LEGACY_ALL_COMMENTS_NOTE_PATH,
    isAllCommentsNotePath,
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../core/derived/allCommentsNote";
import {
    normalizePreferredAgentTarget,
    type SideNote2AgentTarget,
} from "../core/config/agentTargets";
import { isAttachmentCommentableFile, isAttachmentCommentablePath } from "../core/rules/commentableFiles";
import {
    buildAttachmentCommentThreads,
    parseAttachmentCommentThreads,
} from "../core/storage/attachmentCommentStorage";
import {
    type SideNote2Settings,
} from "../ui/settings/SideNote2SettingTab";
import {
    getIndexNoteParentPath,
    resolveIndexNotePathChange,
    resolveLoadedSettings,
    shouldApplyNormalizedSettingChange,
    type PersistedPluginData,
} from "./indexNoteSettingsPlanner";

export interface IndexNoteSettingsHost {
    app: Plugin["app"];
    getSettings(): SideNote2Settings;
    setSettings(settings: SideNote2Settings): void;
    getCommentManager(): CommentManager;
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

        const persistedAttachmentThreads = parseAttachmentCommentThreads(loaded?.attachmentComments);
        const existingAttachmentCommentPaths = new Set(
            this.host.getCommentManager()
                .getAllThreads()
                .filter((thread) => isAttachmentCommentablePath(thread.filePath))
                .map((thread) => thread.filePath),
        );
        for (const filePath of existingAttachmentCommentPaths) {
            this.host.getCommentManager().replaceThreadsForFile(filePath, []);
        }
        for (const thread of persistedAttachmentThreads) {
            const file = this.host.getFileByPath(thread.filePath);
            if (!isAttachmentCommentableFile(file)) {
                continue;
            }

            const nextThreads = this.host.getCommentManager().getThreadsForFile(thread.filePath).concat(thread);
            this.host.getCommentManager().replaceThreadsForFile(thread.filePath, nextThreads);
        }

        if (resolved.shouldRewriteLegacySettings) {
            await this.saveSettings();
        }
    }

    public async saveSettings(): Promise<void> {
        await this.writePersistedPluginData({
            ...this.persistedPluginData,
            ...this.host.getSettings(),
            attachmentComments: buildAttachmentCommentThreads(this.host.getCommentManager().getAllThreads()),
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

    public getPreferredAgentTarget(): SideNote2AgentTarget {
        return normalizePreferredAgentTarget(this.host.getSettings().preferredAgentTarget);
    }

    public isAllCommentsNotePath(filePath: string): boolean {
        return isAllCommentsNotePath(filePath, this.getAllCommentsNotePath());
    }

    public async setIndexNotePath(nextPathInput: string): Promise<void> {
        const settings = this.host.getSettings();
        const previousPath = this.getAllCommentsNotePath();
        const parentPath = getIndexNoteParentPath(normalizeAllCommentsNotePath(nextPathInput));
        const currentIndexFile = this.host.getMarkdownFileByPath(previousPath)
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

    public async setPreferredAgentTarget(nextTargetInput: SideNote2AgentTarget | string): Promise<void> {
        const settings = this.host.getSettings();
        const nextTarget = normalizePreferredAgentTarget(nextTargetInput);
        if (!shouldApplyNormalizedSettingChange({
            currentStoredValue: settings.preferredAgentTarget,
            currentNormalizedValue: this.getPreferredAgentTarget(),
            nextNormalizedValue: nextTarget,
        })) {
            return;
        }

        this.host.setSettings({
            ...settings,
            preferredAgentTarget: nextTarget,
        });
        await this.saveSettings();
    }

    public readPersistedPluginData(): PersistedPluginData {
        return {
            ...this.persistedPluginData,
        };
    }

    public async writePersistedPluginData(data: PersistedPluginData): Promise<void> {
        this.persistedPluginData = {
            ...data,
        };
        await this.host.saveData(this.persistedPluginData);
    }

}
