import { addIcon, WorkspaceLeaf, TFile, TFolder, Notice, Plugin, normalizePath, MarkdownView, FileSystemAdapter, FileView, Platform, getAllTags, requestUrl, type Editor, type View } from "obsidian";
import { Comment, CommentManager, CommentThread, type ReorderPlacement } from "./commentManager";
import { CommentEntryController } from "./comments/commentEntryController";
import {
    CommentAgentController,
    type AgentStreamUpdate,
    type SavedUserEntryEvent,
} from "./agents/commentAgentController";
import { CommentHighlightController } from "./comments/commentHighlightController";
import {
    CommentMutationController,
    type DeleteCommentOptions,
    type MoveCommentEntryOptions,
    type NestCommentThreadOptions,
    type MoveCommentThreadOptions,
    type SaveDraftOptions,
    type SetCommentPinnedOptions,
} from "./comments/commentMutationController";
import type { BatchTagMutationResult } from "./comments/commentBatchTagOperations";
import { CommentNavigationController } from "./comments/commentNavigationController";
import { pickPinnedCommentableFile, pickPreferredFileLeafCandidate, pickSidebarTargetFile, type PreferredFileLeafCandidate } from "./comments/commentNavigationPlanner";
import { CommentPersistenceController } from "./comments/commentPersistenceController";
import type { SetSidebarViewStateOptions } from "./comments/commentSessionController";
import { CommentSessionController } from "./comments/commentSessionController";
import { IndexNoteSettingsController } from "./settings/indexNoteSettingsController";
import type { PersistedPluginData } from "./settings/indexNoteSettingsPlanner";
import { PluginEventRouter } from "./app/pluginEventRouter";
import { PluginLifecycleController } from "./app/pluginLifecycleController";
import { PluginRegistrationController } from "./app/pluginRegistrationController";
import { RefreshCoordinator } from "./app/refreshCoordinator";
import { WorkspaceContextController } from "./app/workspaceContextController";
import type { SidebarUpdateOptions } from "./comments/commentNavigationController";
import { WorkspaceViewController } from "./app/workspaceViewController";
import { AgentRunStore } from "./agents/agentRunStore";
import {
    disposeAgentRuntimeProcesses,
    getClaudeRuntimeDiagnostics as probeClaudeRuntimeDiagnostics,
    getCodexRuntimeDiagnostics as probeCodexRuntimeDiagnostics,
    runAgentRuntime,
    type AgentRuntimeDiagnostics,
} from "./agents/agentRuntimeAdapter";
import {
    resolveAgentRuntimeSelection as resolveAgentRuntimeSelectionPlan,
    type AgentRuntimeSelection,
} from "./agents/agentRuntimeSelection";
import {
    PublicHtmlPublishController,
    type PublicHtmlPublishActionState,
    type PublicHtmlPublishSnapshotFile,
    type PublicHtmlDeploySnapshotResult,
	type PublicHtmlCachePurgeInput,
} from "./publish/publicHtmlPublishController";
import {
    runWranglerPagesDeploy,
    type WranglerRuntimeModules,
} from "./publish/wranglerPagesPublisher";
import {
	purgeRemoteCache,
	readRemoteCachePurgeAuthSecret,
	type RemoteCachePurgeSecretStorage,
} from "./publish/remoteCachePurgeBroker";
import {
	normalizeVaultRelativePublishPath,
} from "./core/publish/publishPath";
import {
	normalizePublishAllowedRoot,
	normalizePublishProjectName,
	derivePublishBaseUrlFromProjectName,
} from "./core/publish/publishSettings";
import {
	removePublishedPublicArtifactPath,
	removePublishedPublicArtifactPathsInFolder,
	renamePublishedPublicArtifactPath as renamePublishedPublicArtifactPathInList,
} from "./core/publish/publishedPublicArtifacts";
import {
    resolvePublicHtmlPairContext,
} from "./core/publish/publishPair";
import type {
    PublicHtmlPairContext,
} from "./core/publish/publishPair";
import type { AgentRunRecord, AgentRunStreamState } from "./core/agents/agentRuns";
import {
    type AgentRuntimeModePreference,
} from "./core/agents/agentRuntimePreferences";
import type { AsideAgentTarget } from "./core/config/agentTargets";
import { getAgentActorById } from "./core/agents/agentActorRegistry";
import { DraftComment, DraftSelection } from "./domain/drafts";
import { parsePromptDeleteSetting } from "./core/config/appConfig";
import { DerivedCommentMetadataManager } from "./core/derived/derivedCommentMetadata";
import {
    isMarkdownCommentableFile,
    isPageNoteCapableFile as isPageNoteCapableSourceFile,
    isSidebarSupportedFile,
} from "./core/rules/commentableFiles";
import { extractWikiLinkPaths } from "./core/text/commentMentions";
import { syncInstalledCodexSkill, type CodexSkillSyncModules } from "./core/codexSkillSync";
import { AggregateCommentIndex } from "./index/AggregateCommentIndex";
import { ParsedNoteCache } from "./cache/ParsedNoteCache";
import { VaultCapabilityIndex, type VaultTagUsage } from "./core/vault/vaultCapabilityIndex";
import { parseNoteComments, ParsedNoteComments } from "./core/storage/noteCommentStorage";
import AsideSetting, {
    DEFAULT_SETTINGS,
    type AsideSettings,
} from "./ui/settings/AsideSetting";
import {
    ASIDE_ICON_ID,
    ASIDE_ICON_SVG,
    ASIDE_REGENERATE_ICON_ID,
    ASIDE_REGENERATE_ICON_SVG,
} from "./ui/asideIcon";
import SupportLogInspectorModal from "./ui/modals/SupportLogInspectorModal";
import AsideView from "./ui/views/AsideView";
import PublicHtmlView from "./ui/views/PublicHtmlView";
import {
    PublicFilePublishActionController,
    type PublicFilePublishActionView,
} from "./ui/views/publicFilePublishActions";
import { shouldShowTransientNotice } from "./ui/notices/noticePolicy";
import {
    AsideLogService,
    type AsideLogLevel,
} from "./logs/logService";
import bundledAsideSkillContent from "../skills/aside/SKILL.md";

interface PublishRuntimeModules extends WranglerRuntimeModules {
    fsPromises: {
        mkdtemp(prefix: string): Promise<string>;
        mkdir(path: string, options: { recursive?: boolean }): Promise<void>;
        writeFile(path: string, contents: string | Uint8Array, encoding?: "utf8"): Promise<void>;
        rm(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void>;
    };
    os: {
        tmpdir(): string;
    };
    path: {
        dirname(path: string): string;
        join(...paths: string[]): string;
    };
}

const SIDE_NOTE_SYNC_EVENT_MIGRATION_VERSION = 2;
const SOURCE_IDENTITY_MIGRATION_VERSION = 1;
const SIDE_NOTE_SYNC_DEVICE_ID_STORAGE_PREFIX = "aside.sync-device-id.v1";

// Helper function to generate SHA256 hash using Web Crypto API (works on mobile)
async function generateHash(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer), (byte) =>
        byte.toString(16).padStart(2, "0")
    ).join("");
}

function generateCommentId(): string {
    return crypto.randomUUID();
}

function getParentPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
    const slashIndex = normalized.lastIndexOf("/");
    if (slashIndex <= 0) {
        return normalized;
    }

    return normalized.slice(0, slashIndex);
}

function getAsidePublishHtmlFromMetadata(frontmatter: unknown): string | null {
    if (!isRecord(frontmatter)) {
        return null;
    }
    const asidePublish = frontmatter.asidePublish;
    if (!isRecord(asidePublish)) {
        return null;
    }
    return typeof asidePublish.html === "string" && asidePublish.html.trim()
        ? asidePublish.html.trim()
        : null;
}

function isMarkdownPublishPath(path: string): boolean {
    return /\.md$/iu.test(path);
}

function isHtmlPublishPath(path: string): boolean {
    return /\.html?$/iu.test(path);
}

function getSafeLocalStorage(): Storage | null {
    if (typeof window === "undefined") {
        return null;
    }

    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPersistedPluginData(value: unknown): value is PersistedPluginData {
    return isRecord(value);
}

function getNodeRequire(): ((moduleName: string) => unknown) | null {
    if (typeof window === "undefined") {
        return null;
    }

    const electronRequire = (window as Window & {
        require?: (moduleName: string) => unknown;
    }).require;
    return typeof electronRequire === "function"
        ? electronRequire
        : null;
}

function openExternalUrl(url: string): void {
    const electronRequire = getNodeRequire();
    if (electronRequire) {
        try {
            const electronModule = electronRequire("electron") as {
                shell?: {
                    openExternal?: (targetUrl: string) => Promise<void> | void;
                };
            };
            const shell = electronModule.shell;
            if (typeof shell?.openExternal === "function") {
                void Promise.resolve(shell.openExternal(url)).catch(() => {
                    window.open(url, "_blank", "noopener");
                });
                return;
            }
        } catch {
            // Fall back to the browser opener below.
        }
    }

    window.open(url, "_blank", "noopener");
}

function getProcessEnv(): Record<string, string | undefined> {
    const candidate = typeof window === "undefined"
        ? undefined
        : (window as Window & {
            process?: {
                env?: Record<string, string | undefined>;
            };
        }).process;
    return candidate?.env ?? {};
}

// Main plugin class
export default class Aside extends Plugin {
    commentManager!: CommentManager;
    settings: AsideSettings = DEFAULT_SETTINGS;
    private logService: AsideLogService | null = null;
    private supportLogLocationAvailable: boolean | null = null;
    private runtime: "local" | "release" = "release";
    private unloaded = false;
    private readonly vaultCapabilityIndex = new VaultCapabilityIndex();
    private readonly workspaceViewController: WorkspaceViewController = new WorkspaceViewController({
        app: this.app,
        isSidebarSupportedFile: (file): file is TFile => isSidebarSupportedFile(file, this.getAllCommentsNotePath()),
        isAllCommentsNotePath: (filePath) => this.isAllCommentsNotePath(filePath),
        ensureIndexedCommentsLoaded: () => this.ensureIndexedCommentsLoaded(),
        refreshAggregateNoteNow: () => this.refreshAggregateNoteNow(),
        hasPendingAggregateRefresh: () => this.commentPersistenceController.hasPendingAggregateRefresh(),
        loadCommentsForFile: (file) => this.loadCommentsForFile(file),
    });
    private readonly commentSessionController = new CommentSessionController({
        refreshCommentViews: (options) => this.workspaceViewController.refreshCommentViews(options),
        refreshEditorDecorations: () => this.refreshEditorDecorations(),
        refreshMarkdownPreviews: () => this.workspaceViewController.refreshMarkdownPreviews(),
        clearMarkdownSelection: (filePath) => this.workspaceViewController.clearMarkdownSelection(filePath),
    });
    private readonly commentEntryController = new CommentEntryController({
        getAllCommentsNotePath: () => this.getAllCommentsNotePath(),
        getFileByPath: (filePath) => this.workspaceViewController.getFileByPath(filePath),
        isCommentableFile: (file): file is TFile => this.isCommentableFile(file),
        isPageNoteCapableFile: (file): file is TFile => this.isPageNoteCapableFile(file),
        loadCommentsForFile: (file) => this.loadCommentsForFile(file),
        getKnownCommentById: (commentId) => this.getKnownCommentById(commentId),
        getKnownThreadIdByCommentId: (commentId) => this.getKnownThreadById(commentId)?.id ?? null,
        markDraftFileActive: (file) => this.markDraftFileActive(file),
        setDraftComment: (draftComment, hostFilePath, options) =>
            this.commentSessionController.setDraftComment(draftComment, hostFilePath, options),
        activateViewAndHighlightComment: (commentId) => this.activateViewAndHighlightComment(commentId),
        createCommentId: () => generateCommentId(),
        showNotice: (message) => {
            this.showNotice(message, "draft", "draft.notice");
        },
        log: (level, area, event, payload) => this.logEvent(level, area, event, payload),
    });
    private readonly commentHighlightController = new CommentHighlightController({
        app: this.app,
        getCommentsForFile: (filePath) => this.commentManager.getCommentsForFile(filePath),
        getMarkdownViewForEditorView: (editorView) => this.workspaceViewController.getMarkdownViewForEditorView(editorView),
        getMarkdownViewForFile: (file) => this.workspaceViewController.getMarkdownViewForFile(file),
        getMarkdownFileByPath: (path) => this.workspaceViewController.getMarkdownFileByPath(path),
        getCurrentNoteContent: (file) => this.workspaceViewController.getCurrentNoteContent(file),
        getParsedNoteComments: (filePath, noteContent) => this.getParsedNoteComments(filePath, noteContent),
        isAllCommentsNotePath: (path) => this.isAllCommentsNotePath(path),
        getDraftForFile: (filePath) => this.commentSessionController.getDraftForFile(filePath),
        getRevealedCommentId: (filePath) => this.commentSessionController.getRevealedCommentId(filePath),
        getIndexFileScopeRootPath: (indexFilePath) => this.getIndexFileScopeRootPath(indexFilePath),
        activateViewAndHighlightComment: (commentId) => this.activateViewAndHighlightComment(commentId),
        activateIndexComment: (commentId, indexFilePath, sourceFilePath) =>
            this.activateIndexComment(commentId, indexFilePath, sourceFilePath),
        activateIndexFileScope: (indexFilePath, sourceFilePath) =>
            this.activateIndexFileScope(indexFilePath, sourceFilePath),
        log: (level, area, event, payload) => this.logEvent(level, area, event, payload),
    });
    private readonly commentMutationController: CommentMutationController = new CommentMutationController({
        getAllCommentsNotePath: () => this.getAllCommentsNotePath(),
        getSidebarTargetFilePath: () => this.getSidebarTargetFile()?.path ?? null,
        getDraftComment: () => this.commentSessionController.getDraftComment(),
        getSavingDraftCommentId: () => this.commentSessionController.getSavingDraftCommentId(),
        setDraftComment: (draftComment, hostFilePath, options) =>
            this.commentSessionController.setDraftComment(draftComment, hostFilePath, options),
        setDraftCommentValue: (draftComment) => this.commentSessionController.setDraftCommentValue(draftComment),
        clearDraftState: () => this.commentSessionController.clearDraftState(),
        setSavingDraftCommentId: (commentId) => this.commentSessionController.setSavingDraftCommentId(commentId),
        refreshCommentViews: (options) => this.workspaceViewController.refreshCommentViews(options),
        refreshEditorDecorations: () => this.refreshEditorDecorations(),
        getKnownCommentById: (commentId) => this.getKnownCommentById(commentId),
        getLoadedCommentById: (commentId) => this.commentManager.getCommentById(commentId) ?? null,
        getFileByPath: (filePath) => this.workspaceViewController.getFileByPath(filePath),
        getCurrentNoteContent: (file) => this.workspaceViewController.getCurrentNoteContent(file),
        getCurrentSelectionForFile: (file) => this.getCurrentSelectionForFile(file),
        isCommentableFile: (file): file is TFile => this.isCommentableFile(file),
        isPageNoteCapableFile: (file): file is TFile => this.isPageNoteCapableFile(file),
        loadCommentsForFile: (file) => this.loadCommentsForFile(file),
        persistCommentsForFile: (file, options) => this.persistCommentsForFile(file, options),
        getCommentManager: () => this.commentManager,
        activateViewAndHighlightComment: (commentId) => this.activateViewAndHighlightComment(commentId),
        openMoveTargetFile: async (file) => {
            const targetLeaf = this.commentNavigationController.getOpenFileLeaf(file.path)
                ?? this.app.workspace.getLeaf("tab");
            if (!(targetLeaf.view instanceof FileView) || targetLeaf.view.file?.path !== file.path) {
                await targetLeaf.openFile(file);
            }
            this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
        },
        hashText: (text) => generateHash(text),
        showNotice: (message) => {
            this.showNotice(message, "draft", "draft.notice");
        },
        now: () => Date.now(),
        handleSavedUserEntry: (event: SavedUserEntryEvent): Promise<void> => this.handleSavedUserEntry(event),
        log: (level, area, event, payload) => this.logEvent(level, area, event, payload),
    });
    private readonly derivedCommentMetadataManager = new DerivedCommentMetadataManager(this.app);
    private readonly commentNavigationController = new CommentNavigationController({
        app: this.app,
        getSidebarTargetFile: () => this.getSidebarTargetFile(),
        getDraftComment: () => this.commentSessionController.getDraftComment(),
        getKnownCommentById: (commentId) => this.getKnownCommentById(commentId),
        isAllCommentsNotePath: (filePath) => this.isAllCommentsNotePath(filePath),
        setRevealedCommentState: (filePath, commentId) => this.commentSessionController.setRevealedCommentState(filePath, commentId),
        getFileByPath: (path) => this.workspaceViewController.getFileByPath(path),
        loadCommentsForFile: (file) => this.loadCommentsForFile(file),
        getLoadedCommentById: (commentId) => this.commentManager.getCommentById(commentId),
        showNotice: (message) => {
            this.showNotice(message, "navigation", "navigation.notice");
        },
        log: (level, area, event, payload) => this.logEvent(level, area, event, payload),
    });
    private commentPersistenceController: CommentPersistenceController = new CommentPersistenceController({
        app: this.app,
        getAllCommentsNotePath: () => this.getAllCommentsNotePath(),
        getIndexHeaderImageUrl: () => this.getIndexHeaderImageUrl(),
        getIndexHeaderImageCaption: () => this.getIndexHeaderImageCaption(),
        getMarkdownViewForFile: (file) => this.workspaceViewController.getMarkdownViewForFile(file),
        getMarkdownFileByPath: (filePath) => this.workspaceViewController.getMarkdownFileByPath(filePath),
        getCurrentNoteContent: (file) => this.workspaceViewController.getCurrentNoteContent(file),
        getStoredNoteContent: (file) => this.workspaceViewController.getStoredNoteContent(file),
        getParsedNoteComments: (filePath, noteContent) => this.getParsedNoteComments(filePath, noteContent),
        getPluginDataDirPath: () => this.getPluginDataDirPath(),
        getSideNoteSyncDeviceId: () => this.getSideNoteSyncDeviceId(),
        readPersistedPluginData: () => this.indexNoteSettingsController.readPersistedPluginData(),
        loadPersistedPluginData: () => this.loadCurrentData(),
        writePersistedPluginData: (data) => this.indexNoteSettingsController.writePersistedPluginData(data),
        isAllCommentsNotePath: (filePath) => this.isAllCommentsNotePath(filePath),
        isCommentableFile: (file): file is TFile => this.isCommentableFile(file),
        isPageNoteCapableFile: (file): file is TFile => this.isPageNoteCapableFile(file),
        isMarkdownEditorFocused: (file) => this.workspaceViewController.isMarkdownEditorFocused(file),
        getCommentManager: () => this.commentManager,
        getAggregateCommentIndex: () => this.aggregateCommentIndex,
        createCommentId: () => generateCommentId(),
        hashText: (text) => generateHash(text),
        syncDerivedCommentLinksForFile: (file, noteContent, comments) =>
            this.derivedCommentMetadataManager.syncDerivedCommentLinksForFile(file, noteContent, comments),
        refreshCommentViews: (options) => this.workspaceViewController.refreshCommentViews(options),
        refreshAllCommentsSidebarViews: (options) => this.workspaceViewController.refreshAllCommentsSidebarViews(options),
        refreshEditorDecorations: () => this.refreshEditorDecorations(),
        refreshMarkdownPreviews: () => this.workspaceViewController.refreshMarkdownPreviews(),
        getCommentMentionedPageLabels: (comment) => this.getCommentMentionedPageLabels(comment),
        syncIndexNoteLeafMode: (leaf) => this.syncIndexNoteLeafMode(leaf),
        log: (level, area, event, payload) => this.logEvent(level, area, event, payload),
    });
    private readonly indexNoteSettingsController = new IndexNoteSettingsController({
        app: this.app,
        getSettings: () => this.settings,
        setSettings: (settings) => {
            this.settings = settings;
        },
        getFileByPath: (filePath) => this.workspaceViewController.getFileByPath(filePath),
        getMarkdownFileByPath: (filePath) => this.workspaceViewController.getMarkdownFileByPath(filePath),
        getActiveSidebarFile: () => this.activeSidebarFile,
        setActiveSidebarFile: (file) => {
            this.activeSidebarFile = file;
        },
        getDraftHostFilePath: () => this.commentSessionController.getDraftHostFilePath(),
        setDraftHostFilePath: (filePath) => this.commentSessionController.setDraftHostFilePath(filePath),
        getSidebarTargetFile: () => this.getSidebarTargetFile(),
        updateSidebarViews: (file) => this.updateSidebarViews(file),
        refreshAggregateNoteNow: () => this.refreshAggregateNoteNow(),
        loadData: () => this.loadCurrentData(),
        saveData: (data) => this.saveData(data),
        ensureFolder: (folderPath) => this.ensureVaultFolder(folderPath),
        showNotice: (message) => {
            this.showNotice(message, "index", "index.notice");
        },
    });
    private readonly agentRunStore = new AgentRunStore({
        readPersistedPluginData: () => this.indexNoteSettingsController.readPersistedPluginData(),
        writePersistedPluginData: (data) => this.indexNoteSettingsController.writePersistedPluginData(data),
    });
    private readonly commentAgentController: CommentAgentController = new CommentAgentController({
        createCommentId: () => generateCommentId(),
        now: () => Date.now(),
        getPluginVersion: () => this.manifest.version,
        getVaultRootPath: () => this.getVaultRootPath(),
        refreshCommentViews: () => this.workspaceViewController.refreshCommentViews(),
        getRuntimeWorkingDirectory: (filePath: string) => this.getRuntimeWorkingDirectory(filePath),
        getCommentManager: () => this.commentManager,
        getFileByPath: (filePath) => this.workspaceViewController.getFileByPath(filePath),
        isCommentableFile: (file): file is TFile => this.isCommentableFile(file),
        getCurrentNoteContent: (file) => this.workspaceViewController.getCurrentNoteContent(file),
        loadCommentsForFile: (file) => this.loadCommentsForFile(file),
        hashText: (text) => generateHash(text),
        persistCommentsForFile: (file, options) => this.persistCommentsForFile(file, options),
        appendThreadEntry: (
            threadId: string,
            entry: {
                id: string;
                body: string;
                timestamp: number;
            },
            options?: {
                insertAfterCommentId?: string;
                skipCommentViewRefresh?: boolean;
            },
        ): Promise<boolean> => this.commentMutationController.appendThreadEntry(threadId, entry, options),
        editComment: (commentId: string, newCommentText: string, options?: { skipCommentViewRefresh?: boolean }): Promise<boolean> =>
            this.commentMutationController.editComment(commentId, newCommentText, options),
        deleteComment: async (commentId: string, options?: { skipCommentViewRefresh?: boolean }): Promise<void> => {
            await this.commentMutationController.deleteComment(
                commentId,
                options?.skipCommentViewRefresh
                    ? { skipPersistedViewRefresh: true }
                    : undefined,
            );
        },
        runAgentRuntime: (invocation) => runAgentRuntime(invocation),
        resolveAgentRuntimeSelection: (target) => this.resolveAgentRuntimeSelection(target),
        showNotice: (message) => {
            this.showNotice(message, "agents", "agents.notice");
        },
        log: (level, area, event, payload) => this.logEvent(level, area, event, payload),
    }, this.agentRunStore);
    private readonly publicHtmlPublishController = new PublicHtmlPublishController({
        getSettings: () => this.settings,
        getVaultConfigDir: () => this.app.vault.configDir,
        listMarkdownFiles: (rootPath) => {
            const folderPath = normalizePath(rootPath.replace(/\/+$/u, ""));
            const folder = this.app.vault.getAbstractFileByPath(folderPath);
            return Promise.resolve(folder instanceof TFolder
                ? this.vaultCapabilityIndex.listMarkdownFilesInFolder(folder).map((file) => file.path)
                : []);
        },
        fileExists: (filePath) => Promise.resolve(this.getVaultFileByPath(filePath) !== null),
        readVaultFile: async (filePath) => {
            const file = this.getVaultFileByPath(filePath);
            if (!file) {
                throw new Error(`Missing vault file: ${filePath}`);
            }
            return this.app.vault.cachedRead(file);
        },
        readVaultBinaryFile: async (filePath) => {
            const file = this.getVaultFileByPath(filePath);
            if (!file) {
                throw new Error(`Missing vault file: ${filePath}`);
            }
            return this.app.vault.readBinary(file);
        },
        writeVaultFile: async (filePath, contents) => {
            const file = this.getVaultFileByPath(filePath);
            if (!file) {
                throw new Error(`Missing vault file: ${filePath}`);
            }
            await this.app.vault.modify(file, contents);
        },
        getPublishedArtifactPaths: () => this.settings.publishedPublicArtifactPaths,
        setPublishedArtifactPaths: (paths) => this.setPublishedPublicArtifactPaths(paths),
        deploySnapshot: (files) => this.publishSnapshotArtifacts(files),
        purgePublicUrlFromCache: (url) => this.purgePublishedPublicUrlCache(url),
    });
    private readonly publicFilePublishActionController = new PublicFilePublishActionController({
        getAllowedRoot: () => this.settings.publishAllowedRoot,
        getPublishActionStates: (file) => this.publicHtmlPublishController.getFileActionStates(file.path),
        runPublishAction: (file, actionKind) => this.runPublicHtmlPublishAction(file, actionKind),
        showNotice: (message) => {
            this.showNotice(message, "publish", "publish.notice");
        },
    });
    private readonly pluginLifecycleController = new PluginLifecycleController({
        app: this.app,
        getCommentManager: () => this.commentManager,
        getAggregateCommentIndex: () => this.aggregateCommentIndex,
        renameStoredComments: (previousFilePath, nextFilePath) =>
            this.commentPersistenceController.renameStoredComments(previousFilePath, nextFilePath),
        deleteStoredComments: (filePath) => this.commentPersistenceController.deleteStoredComments(filePath),
        deleteStoredCommentsInFolder: (folderPath) =>
            this.commentPersistenceController.deleteStoredCommentsInFolder(folderPath),
        renamePublishedPublicArtifactPath: (previousFilePath, nextFilePath) =>
            this.renamePublishedPublicArtifactPath(previousFilePath, nextFilePath),
        deletePublishedPublicArtifactPath: (filePath) => this.deletePublishedPublicArtifactPath(filePath),
        deletePublishedPublicArtifactPathsInFolder: (folderPath) =>
            this.deletePublishedPublicArtifactPathsInFolder(folderPath),
        clearParsedNoteCache: (filePath) => this.clearParsedNoteCache(filePath),
        clearDerivedCommentLinksForFile: (filePath) => this.derivedCommentMetadataManager.clearDerivedCommentLinksForFile(filePath),
        isCommentableFile: (file): file is TFile => file instanceof TFile && this.isCommentableFile(file),
        isPageNoteCapableFile: (file): file is TFile => file instanceof TFile && this.isPageNoteCapableFile(file),
        loadCommentsForFile: (file) => this.loadCommentsForFile(file),
        refreshCommentViews: () => this.workspaceViewController.refreshCommentViews(),
        refreshEditorDecorations: () => this.refreshEditorDecorations(),
        refreshAggregateNoteNow: () => this.refreshAggregateNoteNow(),
        scheduleAggregateNoteRefresh: () => this.scheduleAggregateNoteRefresh(),
        syncIndexNoteViewClasses: () => this.syncIndexNoteViewClasses(),
        handleMarkdownFileModified: (file) => this.commentPersistenceController.handleMarkdownFileModified(file),
        detachSidebarViews: () => {
            this.app.workspace.detachLeavesOfType("aside-view");
        },
        scheduleTimer: (callback, ms) => window.setTimeout(callback, ms),
        clearTimer: (timerId) => window.clearTimeout(timerId),
        warn: (message, error) => {
            this.warn(message, error, "startup", "startup.warn");
        },
        log: (level, area, event, payload) => this.logEvent(level, area, event, payload),
    });
    private readonly refreshCoordinator = new RefreshCoordinator({
        replaySyncedSideNoteEvents: (targetNotePath) =>
            this.commentPersistenceController.replaySyncedSideNoteEvents(targetNotePath),
        refreshCommentViews: (options) => this.workspaceViewController.refreshCommentViews(options),
        scheduleAggregateNoteRefresh: () => this.scheduleAggregateNoteRefresh(),
    });
    private readonly pluginRegistrationController = new PluginRegistrationController({
        manifestId: this.manifest.id,
        iconId: ASIDE_ICON_ID,
        registerView: (viewType, creator) => {
            this.registerView(viewType, (leaf) => creator(leaf) as View);
        },
        registerExtensions: (extensions, viewType) => {
            this.registerExtensions(extensions, viewType);
        },
        registerObsidianProtocolHandler: (action, handler) => {
            this.registerObsidianProtocolHandler(action, handler);
        },
        addCommand: (command) => {
            this.addCommand(command);
        },
        registerEditorMenu: (handler) => {
            this.registerEvent(this.app.workspace.on("editor-menu", handler));
        },
        addRibbonIcon: (icon, title, callback) => {
            this.addRibbonIcon(icon, title, callback);
        },
        createSidebarView: (leaf) => new AsideView(leaf as WorkspaceLeaf, this),
        createPublicHtmlView: (leaf) => new PublicHtmlView(leaf as WorkspaceLeaf, {
            getResourcePath: (file) => this.app.vault.getResourcePath(file),
        }),
        startDraftFromEditorSelection: (editor, file) =>
            this.commentEntryController.startDraftFromEditorSelection(editor as unknown as Editor, file),
        openCommentById: (filePath, commentId) => this.openCommentById(filePath, commentId),
        openIndexNote: () => this.openIndexNote(),
    });
    private readonly workspaceContextController = new WorkspaceContextController({
        app: this.app,
        getActiveMarkdownFile: () => this.activeMarkdownFile,
        getActiveSidebarFile: () => this.activeSidebarFile,
        setWorkspaceFiles: (activeMarkdownFile, activeSidebarFile) => {
            this.activeMarkdownFile = activeMarkdownFile;
            this.activeSidebarFile = activeSidebarFile;
        },
        isAllCommentsNotePath: (path) => this.isAllCommentsNotePath(path),
        isMarkdownCommentableFile: (file): file is TFile => isMarkdownCommentableFile(file, this.getAllCommentsNotePath()),
        isSidebarSupportedFile: (file): file is TFile => isSidebarSupportedFile(file, this.getAllCommentsNotePath()),
        getPublicMarkdownPropertiesHiddenRoot: () => this.settings.publishAllowedRoot,
        syncSidebarFile: (file) => this.workspaceViewController.syncSidebarFile(file),
        updateSidebarViews: (file, options) => this.updateSidebarViews(file, options),
        refreshEditorDecorations: () => this.refreshEditorDecorations(),
    });
    private readonly pluginEventRouter = new PluginEventRouter({
        app: this.app,
        registerEvent: (eventRef) => {
            this.registerEvent(eventRef);
        },
        isTFile: (value): value is TFile => value instanceof TFile,
        handleLayoutReady: () => this.pluginLifecycleController.handleLayoutReady(),
        handleFileOpen: (file) => {
            this.workspaceContextController.handleFileOpen(file);
            this.syncPublicFilePublishActions();
        },
        handleActiveLeafChange: (leaf) => {
            this.workspaceContextController.handleActiveLeafChange(leaf);
            this.syncPublicFilePublishActions();
        },
        handleFileRename: async (file, oldPath) => {
            if (file) {
                this.vaultCapabilityIndex.rename(file, oldPath, this.getVaultFileTags(file));
            } else {
                this.vaultCapabilityIndex.remove(oldPath);
            }
            await this.pluginLifecycleController.handleFileRename(file, oldPath);
            this.syncIndexNoteViewClasses();
            this.syncPublicFilePublishActions();
        },
        handleFileDelete: async (file) => {
            if (file) {
                this.vaultCapabilityIndex.remove(file.path);
            }
            await this.pluginLifecycleController.handleFileDelete(file);
            this.syncIndexNoteViewClasses();
            this.syncPublicFilePublishActions();
        },
        handleFileModify: async (file) => {
            await this.pluginLifecycleController.handleFileModify(file);
            this.syncPublicFilePublishActions();
        },
        handleEditorChange: (filePath) => {
            this.pluginLifecycleController.handleEditorChange(filePath);
        },
    });
    private activeMarkdownFile: TFile | null = null;
    private activeSidebarFile: TFile | null = null;
    private aggregateCommentIndex = new AggregateCommentIndex();
    private parsedNoteCache = new ParsedNoteCache(20);
    private sideNoteSyncDeviceId: string | null = null;

    private async detectRuntimeMode(): Promise<"local" | "release"> {
        const pluginRootRelativePath = normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`);
        const packageJsonPath = normalizePath(`${pluginRootRelativePath}/package.json`);
        const sourceEntryPath = normalizePath(`${pluginRootRelativePath}/src/main.ts`);

        try {
            const [hasPackageJson, hasSourceEntry] = await Promise.all([
                this.app.vault.adapter.exists(packageJsonPath),
                this.app.vault.adapter.exists(sourceEntryPath),
            ]);
            return hasPackageJson && hasSourceEntry ? "local" : "release";
        } catch {
            return "release";
        }
    }

    async onload() {
        this.unloaded = false;
        this.runtime = await this.detectRuntimeMode();
        this.logService = new AsideLogService({
            adapter: this.app.vault.adapter,
            pluginVersion: this.manifest.version,
            pluginDirPath: this.manifest.dir ?? normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`),
            pluginDirRelativePath: normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`),
            vaultRootPath: this.app.vault.adapter instanceof FileSystemAdapter
                ? this.app.vault.adapter.getBasePath()
                : null,
        });
        await this.logService.initialize();
        await this.logEvent("info", "startup", "startup.load.begin", {
            runtime: this.runtime,
            pluginVersion: this.manifest.version,
        });
        this.commentPersistenceController = this.commentPersistenceController.reviveForLoad();
        addIcon(ASIDE_ICON_ID, ASIDE_ICON_SVG);
        addIcon(ASIDE_REGENERATE_ICON_ID, ASIDE_REGENERATE_ICON_SVG);

        this.commentManager = new CommentManager([]);
        await this.loadSettings();
        this.vaultCapabilityIndex.seed(
            this.app.vault.getMarkdownFiles(),
            (file) => this.getVaultFileTags(file),
        );
        this.registerEvent(this.app.vault.on("create", (file) => {
            if (file instanceof TFile) {
                this.vaultCapabilityIndex.upsert(file, this.getVaultFileTags(file));
            }
        }));
        this.registerEvent(this.app.metadataCache.on("changed", (file, _data, cache) => {
            this.vaultCapabilityIndex.upsert(file, getAllTags(cache) ?? []);
        }));
        this.pluginRegistrationController.register();
        this.registerEditorExtension([
            this.commentHighlightController.createEditorHighlightPlugin(),
            this.commentHighlightController.createAllCommentsLivePreviewLinkPlugin(),
        ]);

        // Also highlight commented text inside rendered Markdown (Live Preview/Reading view)
        this.commentHighlightController.registerMarkdownPreviewHighlights(this);
        await this.syncInstalledSidenoteSkill();
        this.commentAgentController.initialize();
        await this.commentAgentController.reconcilePendingRunsFromPreviousSession();
        await this.logEvent("info", "startup", "startup.settings.loaded", {
            indexNotePath: this.getAllCommentsNotePath(),
        });
        this.derivedCommentMetadataManager.installMetadataCacheAugmentation();
        const activeFile = this.app.workspace.getActiveFile();
        this.workspaceContextController.initializeActiveFiles(activeFile);
        await this.pluginEventRouter.register();
        this.syncPublicFilePublishActions();
        this.addSettingTab(new AsideSetting(this.app, this));
        void this.runStartupPersistenceMaintenance();
    }

    onunload() {
        this.unloaded = true;
        void this.logEvent("info", "startup", "startup.unload");
        disposeAgentRuntimeProcesses();
        this.commentAgentController.dispose();
        this.commentPersistenceController.dispose();
        this.pluginLifecycleController.handleUnload();
        this.publicFilePublishActionController.clear();
        this.derivedCommentMetadataManager.restoreMetadataCacheAugmentation();
        this.derivedCommentMetadataManager.clearAllDerivedCommentLinks();
        void this.logService?.flush();
    }

    private async runStartupPersistenceMaintenance(): Promise<void> {
        try {
            await this.ensureSideNoteSyncEventsMigrated();
            if (this.unloaded) {
                return;
            }
            await this.ensureSourceIdentitiesMigrated();
            if (this.unloaded) {
                return;
            }
        } catch (error) {
            this.warn(
                "Failed to finish Aside startup maintenance.",
                error,
                "startup",
                "startup.maintenance.warn",
            );
        }
    }

    async loadSettings() {
        await this.indexNoteSettingsController.loadSettings();
    }

    async saveSettings() {
        await this.indexNoteSettingsController.saveSettings();
    }

    async onExternalSettingsChange() {
        await this.loadSettings();
        this.agentRunStore.load();
        const appliedEventCount = await this.refreshCoordinator.handleExternalPluginDataChange();
        await this.logEvent("info", "persistence", "sync.plugin-data.external-settings", {
            appliedEventCount,
        });
    }

    public readPersistedPluginData() {
        return this.indexNoteSettingsController.readPersistedPluginData();
    }

    public getAllCommentsNotePath(): string {
        return this.indexNoteSettingsController.getAllCommentsNotePath();
    }

    public getIndexHeaderImageUrl(): string {
        return this.indexNoteSettingsController.getIndexHeaderImageUrl();
    }

    public getIndexHeaderImageCaption(): string {
        return this.indexNoteSettingsController.getIndexHeaderImageCaption();
    }

    public getAgentRuntimeMode(): AgentRuntimeModePreference {
        return this.indexNoteSettingsController.getAgentRuntimeMode();
    }

    public async setAgentRuntimeMode(nextMode: AgentRuntimeModePreference): Promise<void> {
        await this.indexNoteSettingsController.setAgentRuntimeMode(nextMode);
    }

    public async setShowTodoSidebarTab(visible: boolean): Promise<void> {
        await this.indexNoteSettingsController.setShowTodoSidebarTab(visible);
    }

    public async setShowAgentSidebarTab(visible: boolean): Promise<void> {
        await this.indexNoteSettingsController.setShowAgentSidebarTab(visible);
    }

    public async setPublishEnabled(enabled: boolean): Promise<void> {
		if (enabled) {
			const configuredProjectName = normalizePublishProjectName(this.settings.publishPagesProjectName);
			const nextProjectName = configuredProjectName || normalizePublishProjectName(this.app.vault.getName());
			if (nextProjectName && this.settings.publishPagesProjectName !== nextProjectName) {
				await this.setPublishPagesProjectName(nextProjectName);
			}

			if (!this.settings.publishBaseUrl) {
				await this.setPublishBaseUrl(derivePublishBaseUrlFromProjectName(
					nextProjectName,
				));
			}
		}
        await this.indexNoteSettingsController.setPublishEnabled(enabled);
        this.syncPublicFilePublishActions();
    }

    public async setPublishPagesProjectName(projectName: string): Promise<void> {
        await this.indexNoteSettingsController.setPublishPagesProjectName(projectName);
    }

    public async setPublishBaseUrl(baseUrl: string): Promise<void> {
        await this.indexNoteSettingsController.setPublishBaseUrl(baseUrl);
        this.syncPublicFilePublishActions();
    }

    public async setPublishAllowedRoot(allowedRoot: string): Promise<void> {
        await this.indexNoteSettingsController.setPublishAllowedRoot(allowedRoot);
        this.syncIndexNoteViewClasses();
        this.syncPublicFilePublishActions();
    }

	public async setPublishRemotePurgeEnabled(enabled: boolean): Promise<void> {
		await this.indexNoteSettingsController.setPublishRemotePurgeEnabled(enabled);
		this.syncPublicFilePublishActions();
	}

	public async setPublishPurgeBrokerUrl(url: string): Promise<void> {
		await this.indexNoteSettingsController.setPublishPurgeBrokerUrl(url);
		this.syncPublicFilePublishActions();
	}

	public async setPublishPurgeBrokerSecretName(secretName: string): Promise<void> {
		await this.indexNoteSettingsController.setPublishPurgeBrokerSecretName(secretName);
		this.syncPublicFilePublishActions();
	}

    private async storeResolvedPublishPagesProjectName(projectName: string): Promise<void> {
        const normalizedProjectName = normalizePublishProjectName(projectName);
        if (!normalizedProjectName || this.settings.publishPagesProjectName === normalizedProjectName) {
            return;
        }

        await this.setPublishPagesProjectName(normalizedProjectName);
    }

    private async setPublishedPublicArtifactPaths(paths: string[]): Promise<void> {
        this.settings = {
            ...this.settings,
            publishedPublicArtifactPaths: [...paths],
        };
        await this.saveSettings();
        this.syncPublicFilePublishActions();
    }

    private arePublishedPublicArtifactPathsEqual(nextPaths: string[]): boolean {
        const currentPaths = this.settings.publishedPublicArtifactPaths;
        return currentPaths.length === nextPaths.length
            && currentPaths.every((path, index) => path === nextPaths[index]);
    }

    private async updatePublishedPublicArtifactPaths(nextPaths: string[]): Promise<void> {
        if (this.arePublishedPublicArtifactPathsEqual(nextPaths)) {
            return;
        }

        await this.setPublishedPublicArtifactPaths(nextPaths);
    }

    private async renamePublishedPublicArtifactPath(previousFilePath: string, nextFilePath: string): Promise<void> {
        await this.updatePublishedPublicArtifactPaths(renamePublishedPublicArtifactPathInList(
            this.settings.publishedPublicArtifactPaths,
            previousFilePath,
            nextFilePath,
            this.settings.publishAllowedRoot,
        ));
    }

    private async deletePublishedPublicArtifactPath(filePath: string): Promise<void> {
        await this.updatePublishedPublicArtifactPaths(removePublishedPublicArtifactPath(
            this.settings.publishedPublicArtifactPaths,
            filePath,
        ));
    }

    private async deletePublishedPublicArtifactPathsInFolder(folderPath: string): Promise<void> {
        await this.updatePublishedPublicArtifactPaths(removePublishedPublicArtifactPathsInFolder(
            this.settings.publishedPublicArtifactPaths,
            folderPath,
        ));
    }

    private isPublicFilePublishActionView(value: unknown): value is PublicFilePublishActionView {
        if (!value || typeof value !== "object") {
            return false;
        }
        const candidate = value as {
            file?: unknown;
            addAction?: unknown;
        };
        return (candidate.file === null || candidate.file instanceof TFile)
            && typeof candidate.addAction === "function";
    }

    private syncPublicFilePublishActions(): void {
        const views: PublicFilePublishActionView[] = [];
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (this.isPublicFilePublishActionView(leaf.view)) {
                views.push(leaf.view);
            }
        });
        void this.publicFilePublishActionController.refreshViews(views);
    }

    private getPublicHtmlPairContext(filePath: string): PublicHtmlPairContext | null {
        const normalizedPathResult = normalizeVaultRelativePublishPath(filePath);
        if (!normalizedPathResult.ok) {
            return null;
        }
        const normalizedPath = normalizedPathResult.path;
        const allowedRoot = normalizePublishAllowedRoot(this.settings.publishAllowedRoot);
        if (!normalizedPath.startsWith(allowedRoot)) {
            return null;
        }

        if (isMarkdownPublishPath(normalizedPath)) {
            const file = this.getVaultFileByPath(normalizedPath);
            const htmlPath = file
                ? getAsidePublishHtmlFromMetadata(this.app.metadataCache.getFileCache(file)?.frontmatter)
                : null;
            const normalizedHtmlPath = htmlPath ? normalizeVaultRelativePublishPath(htmlPath) : null;
            if (normalizedHtmlPath?.ok && normalizedHtmlPath.path.startsWith(allowedRoot) && isHtmlPublishPath(normalizedHtmlPath.path)) {
                return {
                    sourcePath: normalizedPath,
                    htmlPath: normalizedHtmlPath.path,
                    displayPath: normalizedHtmlPath.path,
                    paths: [normalizedPath, normalizedHtmlPath.path],
                };
            }
        }

        if (isHtmlPublishPath(normalizedPath)) {
            for (const markdownFile of this.vaultCapabilityIndex.listMarkdownFiles()) {
                if (!markdownFile.path.startsWith(allowedRoot)) {
                    continue;
                }
                const htmlPath = getAsidePublishHtmlFromMetadata(
                    this.app.metadataCache.getFileCache(markdownFile)?.frontmatter,
                );
                const normalizedHtmlPath = htmlPath ? normalizeVaultRelativePublishPath(htmlPath) : null;
                if (normalizedHtmlPath?.ok && normalizedHtmlPath.path === normalizedPath) {
                    return {
                        sourcePath: markdownFile.path,
                        htmlPath: normalizedPath,
                        displayPath: normalizedPath,
                        paths: [markdownFile.path, normalizedPath],
                    };
                }
            }
        }

        return resolvePublicHtmlPairContext({
            filePath,
            allowedRoot,
        });
    }

    private async runPublicHtmlPublishAction(
        file: TFile,
        actionKind: PublicHtmlPublishActionState["kind"],
    ): Promise<void> {
        if (actionKind === "disabled") {
            return;
        }

        const actionStates = await this.publicHtmlPublishController.getFileActionStates(file.path);
        const actionState = actionStates.find((state) => state.kind === actionKind) ?? actionStates[0];
        if (!actionState) {
            this.showNotice("Unable to inspect publish state.", "publish", "publish.html.action.missing", {
                vaultRelativePath: file.path,
            });
            return;
        }
        if (actionState.disabled) {
            this.showNotice(actionState.notice, "publish", "publish.html.action.disabled", {
                vaultRelativePath: file.path,
            });
            return;
        }

        if (actionKind === "open-published") {
            if (!actionState.url) {
                this.showNotice("Published link is unavailable. Publish this file first.", "publish", "publish.html.open.missing-url", {
                    vaultRelativePath: file.path,
                });
                return;
            }
            openExternalUrl(actionState.url);
            this.showNotice("Opened published link.", "publish", "publish.html.opened", {
                vaultRelativePath: file.path,
                url: actionState.url,
            });
            return;
        }

        const result = actionKind === "unpublish"
            ? await this.publicHtmlPublishController.unpublishFile(file.path)
            : actionKind === "update-publish"
                ? await this.publicHtmlPublishController.updatePublishedFile(file.path)
                : await this.publicHtmlPublishController.publishFile(file.path);
        if (!result.ok) {
            this.showNotice(result.notice, "publish", "publish.html.action.failed", {
                vaultRelativePath: file.path,
            });
            return;
        }

        const actionLabel = actionKind === "unpublish"
            ? "Unpublished"
            : actionKind === "update-publish"
                ? "Updated"
                : "Published";
        this.showNotice(
            result.notice ?? `${actionLabel}: ${result.url}`,
            "publish",
            actionKind === "unpublish"
                ? "publish.html.unpublished"
                : actionKind === "update-publish"
                    ? "publish.html.updated"
                    : "publish.html.published",
            {
                vaultRelativePath: file.path,
                url: result.url,
            },
        );
        this.syncPublicFilePublishActions();
    }

    public getAgentRuns(): AgentRunRecord[] {
        return this.commentAgentController.getAgentRuns();
    }

    public getLatestAgentRunForThread(threadId: string): AgentRunRecord | null {
        return this.commentAgentController.getLatestAgentRunForThread(threadId);
    }

    public getActiveAgentStreamForThread(threadId: string): AgentRunStreamState | null {
        return this.commentAgentController.getActiveAgentStreamForThread(threadId);
    }

    public subscribeToAgentStreamUpdates(listener: (update: AgentStreamUpdate) => void): () => void {
        return this.commentAgentController.subscribeToStreamUpdates(listener);
    }

    public isAllCommentsNotePath(filePath: string): boolean {
        return this.indexNoteSettingsController.isAllCommentsNotePath(filePath);
    }

    public async setIndexNotePath(nextPathInput: string): Promise<void> {
        await this.indexNoteSettingsController.setIndexNotePath(nextPathInput);
    }

    public async setIndexHeaderImageUrl(nextUrlInput: string): Promise<void> {
        await this.indexNoteSettingsController.setIndexHeaderImageUrl(nextUrlInput);
    }

    public async setIndexHeaderImageCaption(nextCaptionInput: string): Promise<void> {
        await this.indexNoteSettingsController.setIndexHeaderImageCaption(nextCaptionInput);
    }

    public async getAgentRuntimeDiagnostics(target: AsideAgentTarget): Promise<AgentRuntimeDiagnostics> {
        const actor = getAgentActorById(target);
        if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
            return {
                status: "unsupported",
                message: `Built-in ${actor.directive} requires desktop Obsidian with a filesystem-backed vault.`,
            };
        }

        switch (actor.runtimeStrategy) {
            case "codex-cli":
                return probeCodexRuntimeDiagnostics();
            case "claude-cli":
                return probeClaudeRuntimeDiagnostics();
            case "unsupported":
            default:
                return {
                    status: "unsupported",
                    message: actor.unsupportedNotice ?? `${actor.label} is not supported in this build.`,
                };
        }
    }

    public async getCodexRuntimeDiagnostics(): Promise<AgentRuntimeDiagnostics> {
        return this.getAgentRuntimeDiagnostics("codex");
    }

    public async resolveAgentRuntimeSelection(target: AsideAgentTarget): Promise<AgentRuntimeSelection> {
        return resolveAgentRuntimeSelectionPlan({
            target,
            modePreference: this.getAgentRuntimeMode(),
            localDiagnostics: await this.getAgentRuntimeDiagnostics(target),
        });
    }

    public async retryAgentRun(runId: string): Promise<boolean> {
        return this.commentAgentController.retryRun(runId);
    }

    public async retryAgentPromptForComment(commentId: string, filePath: string): Promise<boolean> {
        return this.commentAgentController.retryPromptForComment(commentId, filePath);
    }

    public async cancelAgentRun(runId: string): Promise<boolean> {
        return this.commentAgentController.cancelRun(runId);
    }

    public async shouldConfirmDelete(): Promise<boolean> {
        const appConfigPath = normalizePath(`${this.app.vault.configDir}/app.json`);

        try {
            if (!(await this.app.vault.adapter.exists(appConfigPath))) {
                return true;
            }

            const appConfig = await this.app.vault.adapter.read(appConfigPath);
            return parsePromptDeleteSetting(appConfig) ?? true;
        } catch (error) {
            this.warn("Failed to read Obsidian app config for promptDelete.", error, "startup", "startup.app-config.warn");
            return true;
        }
    }

    public async logEvent(
        level: AsideLogLevel,
        area: string,
        event: string,
        payload?: Record<string, unknown>,
    ): Promise<void> {
        await this.logService?.log(level, area, event, payload);
    }

    public getLogSessionId(): string {
        return this.logService?.getSessionId() ?? "unknown";
    }

    public isLocalRuntime(): boolean {
        return this.runtime === "local";
    }

    public getVaultRootPath(): string | null {
        return this.app.vault.adapter instanceof FileSystemAdapter
            ? this.app.vault.adapter.getBasePath()
            : null;
    }

    private getPluginDataDirPath(): string {
        return this.manifest.dir ?? normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`);
    }

    private async loadCurrentData(): Promise<PersistedPluginData | null> {
        const currentData: unknown = await this.loadData();
        return isPersistedPluginData(currentData) ? currentData : null;
    }

    private getSideNoteSyncDeviceId(): string {
        if (this.sideNoteSyncDeviceId) {
            return this.sideNoteSyncDeviceId;
        }

        const storage = getSafeLocalStorage();
        const storageKey = `${SIDE_NOTE_SYNC_DEVICE_ID_STORAGE_PREFIX}.${this.manifest.id}.${this.app.vault.getName()}`;
        const storedDeviceId = storage?.getItem(storageKey);
        if (storedDeviceId && storedDeviceId.trim()) {
            this.sideNoteSyncDeviceId = storedDeviceId;
            return storedDeviceId;
        }

        const nextDeviceId = generateCommentId();
        storage?.setItem(storageKey, nextDeviceId);
        this.sideNoteSyncDeviceId = nextDeviceId;
        return nextDeviceId;
    }

    private getSideNoteSyncEventMigrationVersion(): number | null {
        const persistedData = this.indexNoteSettingsController.readPersistedPluginData();
        const migrationVersions = isRecord(persistedData.sideNoteSyncEventMigrationVersions)
            ? persistedData.sideNoteSyncEventMigrationVersions
            : {};
        const deviceMigrationVersion = migrationVersions[this.getSideNoteSyncDeviceId()];
        return typeof deviceMigrationVersion === "number"
            ? deviceMigrationVersion
            : null;
    }

    private async setSideNoteSyncEventMigrationVersion(version: number): Promise<void> {
        const persistedData = this.indexNoteSettingsController.readPersistedPluginData();
        const deviceId = this.getSideNoteSyncDeviceId();
        const migrationVersions = isRecord(persistedData.sideNoteSyncEventMigrationVersions)
            ? persistedData.sideNoteSyncEventMigrationVersions
            : {};
        if (migrationVersions[deviceId] === version) {
            return;
        }

        await this.indexNoteSettingsController.writePersistedPluginData({
            ...persistedData,
            sideNoteSyncEventMigrationVersions: {
                ...migrationVersions,
                [deviceId]: version,
            },
        });
    }

    private async ensureSideNoteSyncEventsMigrated(): Promise<void> {
        if (this.getSideNoteSyncEventMigrationVersion() === SIDE_NOTE_SYNC_EVENT_MIGRATION_VERSION) {
            return;
        }

        try {
            await this.logEvent("info", "persistence", "sync.plugin-data.migrate.startup.begin", {
                version: SIDE_NOTE_SYNC_EVENT_MIGRATION_VERSION,
            });
            await this.commentPersistenceController.migrateSidecarsToSyncedPluginDataOnStartup();
            await this.setSideNoteSyncEventMigrationVersion(SIDE_NOTE_SYNC_EVENT_MIGRATION_VERSION);
            await this.logEvent("info", "persistence", "sync.plugin-data.migrate.startup.success", {
                version: SIDE_NOTE_SYNC_EVENT_MIGRATION_VERSION,
            });
        } catch (error) {
            this.warn(
                "Failed to migrate Aside sidecar data into synced plugin data.",
                error,
                "persistence",
                "sync.plugin-data.migrate.startup.warn",
            );
        }
    }

    private getSourceIdentityMigrationVersion(): number | null {
        const persistedData = this.indexNoteSettingsController.readPersistedPluginData();
        const migrationVersions = isRecord(persistedData.sourceIdentityMigrationVersions)
            ? persistedData.sourceIdentityMigrationVersions
            : {};
        const deviceMigrationVersion = migrationVersions[this.getSideNoteSyncDeviceId()];
        return typeof deviceMigrationVersion === "number"
            ? deviceMigrationVersion
            : null;
    }

    private async setSourceIdentityMigrationVersion(version: number): Promise<void> {
        const persistedData = this.indexNoteSettingsController.readPersistedPluginData();
        const deviceId = this.getSideNoteSyncDeviceId();
        const migrationVersions = isRecord(persistedData.sourceIdentityMigrationVersions)
            ? persistedData.sourceIdentityMigrationVersions
            : {};
        if (migrationVersions[deviceId] === version) {
            return;
        }

        await this.indexNoteSettingsController.writePersistedPluginData({
            ...persistedData,
            sourceIdentityMigrationVersions: {
                ...migrationVersions,
                [deviceId]: version,
            },
        });
    }

    private async ensureSourceIdentitiesMigrated(): Promise<void> {
        if (this.getSourceIdentityMigrationVersion() === SOURCE_IDENTITY_MIGRATION_VERSION) {
            return;
        }

        try {
            await this.logEvent("info", "persistence", "source-identity.migrate.startup.begin", {
                version: SOURCE_IDENTITY_MIGRATION_VERSION,
            });
            await this.commentPersistenceController.migrateSourceIdentitiesOnStartup();
            await this.setSourceIdentityMigrationVersion(SOURCE_IDENTITY_MIGRATION_VERSION);
            await this.logEvent("info", "persistence", "source-identity.migrate.startup.success", {
                version: SOURCE_IDENTITY_MIGRATION_VERSION,
            });
        } catch (error) {
            this.warn(
                "Failed to migrate Aside source identities.",
                error,
                "persistence",
                "source-identity.migrate.startup.warn",
            );
        }
    }

    private getSyncedBundledSidenoteSkillPluginVersion(): string | null {
        const persistedData = this.indexNoteSettingsController.readPersistedPluginData();
        return typeof persistedData.syncedBundledSidenoteSkillPluginVersion === "string"
            ? persistedData.syncedBundledSidenoteSkillPluginVersion
            : null;
    }

    private async setSyncedBundledSidenoteSkillPluginVersion(pluginVersion: string): Promise<void> {
        const persistedData = this.indexNoteSettingsController.readPersistedPluginData();
        if (persistedData.syncedBundledSidenoteSkillPluginVersion === pluginVersion) {
            return;
        }

        await this.indexNoteSettingsController.writePersistedPluginData({
            ...persistedData,
            syncedBundledSidenoteSkillPluginVersion: pluginVersion,
        });
    }

    private getCodexSkillSyncModules(): CodexSkillSyncModules | null {
        const nodeRequire = getNodeRequire();
        if (!nodeRequire) {
            return null;
        }

        try {
            return {
                fsPromises: nodeRequire("node:fs/promises") as CodexSkillSyncModules["fsPromises"],
                os: nodeRequire("node:os") as CodexSkillSyncModules["os"],
                path: nodeRequire("node:path") as CodexSkillSyncModules["path"],
            };
        } catch {
            return null;
        }
    }

    private getPublishRuntimeModules(): PublishRuntimeModules | null {
        const nodeRequire = getNodeRequire();
        if (!nodeRequire || !(this.app.vault.adapter instanceof FileSystemAdapter)) {
            return null;
        }

        try {
            return {
                childProcess: nodeRequire("node:child_process") as PublishRuntimeModules["childProcess"],
                fsPromises: nodeRequire("node:fs/promises") as PublishRuntimeModules["fsPromises"],
                os: nodeRequire("node:os") as PublishRuntimeModules["os"],
                path: nodeRequire("node:path") as PublishRuntimeModules["path"],
            };
        } catch {
            return null;
        }
    }

    private async syncInstalledSidenoteSkill(): Promise<void> {
        if (this.runtime !== "release" || !(this.app.vault.adapter instanceof FileSystemAdapter)) {
            return;
        }

        const modules = this.getCodexSkillSyncModules();
        if (!modules) {
            return;
        }

        try {
            const result = await syncInstalledCodexSkill({
                modules,
                env: getProcessEnv(),
                skillName: "aside",
                skillContent: bundledAsideSkillContent,
                pluginVersion: this.manifest.version,
                previouslySyncedPluginVersion: this.getSyncedBundledSidenoteSkillPluginVersion(),
            });

            if (result.kind === "updated" || result.kind === "current") {
                await this.setSyncedBundledSidenoteSkillPluginVersion(this.manifest.version);
            }

            if (result.kind === "updated") {
                await this.logEvent("info", "startup", "startup.codex-skill.updated", {
                    pluginVersion: this.manifest.version,
                    skillPath: result.skillFilePath,
                });
                return;
            }

            if (result.kind === "current") {
                await this.logEvent("info", "startup", "startup.codex-skill.current", {
                    pluginVersion: this.manifest.version,
                    skillPath: result.skillFilePath,
                });
                return;
            }

            if (result.kind === "already-synced") {
                await this.logEvent("info", "startup", "startup.codex-skill.already-synced", {
                    pluginVersion: this.manifest.version,
                    skillPath: result.skillFilePath,
                });
                return;
            }

            await this.logEvent("info", "startup", "startup.codex-skill.not-installed", {
                pluginVersion: this.manifest.version,
                skillPath: result.skillFilePath,
            });
        } catch (error) {
            this.warn(
                "Failed to refresh the installed Aside Codex skill.",
                error,
                "startup",
                "startup.codex-skill.warn",
            );
        }
    }

    private async ensureVaultFolder(folderPath: string): Promise<{ ok: true } | { ok: false; notice: string }> {
        const existing = this.app.vault.getAbstractFileByPath(folderPath);
        if (existing) {
            if (existing instanceof TFile) {
                return {
                    ok: false,
                    notice: `Cannot enable Publishing because ${folderPath} is a file.`,
                };
            }
            return { ok: true };
        }

        try {
            await this.app.vault.createFolder(folderPath);
            return { ok: true };
        } catch (error) {
            const message = error instanceof Error && error.message.trim()
                ? error.message.trim()
                : `Unable to create folder: ${folderPath}`;
            return {
                ok: false,
                notice: `Unable to create ${folderPath}: ${message}`,
            };
        }
    }

    private getVaultFileByPath(filePath: string): TFile | null {
        const abstractFile = this.app.vault.getAbstractFileByPath(normalizePath(filePath));
        return abstractFile instanceof TFile ? abstractFile : null;
    }

    private getVaultFileTags(file: TFile): readonly string[] {
        const cache = this.app.metadataCache.getFileCache(file);
        return cache ? getAllTags(cache) ?? [] : [];
    }

    public getIndexedMarkdownFiles(): TFile[] {
        return this.vaultCapabilityIndex.listMarkdownFiles();
    }

    public getIndexedMarkdownFilePaths(excludedPath?: string): string[] {
        return this.vaultCapabilityIndex.listMarkdownFilePaths(excludedPath);
    }

    public getIndexedVaultTagUsage(): VaultTagUsage[] {
        return this.vaultCapabilityIndex.listTagUsage();
    }

    private async handleSavedUserEntry(event: SavedUserEntryEvent): Promise<void> {
        await this.commentAgentController.handleSavedUserEntry(event);
    }

    private async publishSnapshotArtifacts(files: PublicHtmlPublishSnapshotFile[]): Promise<PublicHtmlDeploySnapshotResult> {
        const modules = this.getPublishRuntimeModules();
        const vaultRootPath = this.getVaultRootPath();
        if (!modules || !vaultRootPath) {
            return {
                ok: false,
                notice: "Publishing requires desktop Obsidian with a filesystem-backed vault.",
            };
        }

        const stagedFiles: PublicHtmlPublishSnapshotFile[] = [];
        for (const file of files) {
            const normalizedPath = normalizeVaultRelativePublishPath(file.vaultRelativePath);
            if (!normalizedPath.ok) {
                return {
                    ok: false,
                    notice: "Selected publish path must stay inside the current vault.",
                };
            }
            stagedFiles.push({
                vaultRelativePath: normalizedPath.path,
                contents: file.contents,
            });
        }

        let stagingDirPath: string | null = null;
        try {
            stagingDirPath = await modules.fsPromises.mkdtemp(
                modules.path.join(modules.os.tmpdir(), "aside-public-publish-"),
            );
            for (const file of stagedFiles) {
                const stagedFilePath = modules.path.join(
                    stagingDirPath,
                    ...file.vaultRelativePath.split("/").filter(Boolean),
                );
                await modules.fsPromises.mkdir(modules.path.dirname(stagedFilePath), { recursive: true });
                if (typeof file.contents === "string") {
                    await modules.fsPromises.writeFile(stagedFilePath, file.contents, "utf8");
                } else {
                    await modules.fsPromises.writeFile(stagedFilePath, new Uint8Array(file.contents));
                }
            }

            const deployResult = await runWranglerPagesDeploy(modules, {
                stagingDirPath,
                projectName: this.settings.publishPagesProjectName,
                publishBaseUrl: this.settings.publishBaseUrl,
                cwd: vaultRootPath,
                env: getProcessEnv(),
            });
            await this.storeResolvedPublishPagesProjectName(deployResult.projectName);
            if (!deployResult.ok) {
                void this.logEvent("warn", "publish", "publish.public-html.wrangler.failed", {
                    fileCount: stagedFiles.length,
                    vaultRelativePaths: stagedFiles.map((file) => file.vaultRelativePath),
                    notice: deployResult.notice,
                });
                return {
                    ok: false,
                    notice: deployResult.notice,
                };
            }

            return { ok: true };
        } catch (error) {
            const message = error instanceof Error && error.message.trim()
                ? error.message.trim()
                : "Unable to stage or deploy the publish snapshot.";
            void this.logEvent("error", "publish", "publish.public-html.runtime.error", {
                fileCount: stagedFiles.length,
                vaultRelativePaths: stagedFiles.map((file) => file.vaultRelativePath),
                error: message,
            });
            return {
                ok: false,
                notice: message,
            };
        } finally {
            if (stagingDirPath) {
                try {
                    await modules.fsPromises.rm(stagingDirPath, { recursive: true, force: true });
                } catch (error) {
                    this.warn(
                        "Failed to remove Aside public publish staging directory.",
                        error,
                        "publish",
                        "publish.public-html.cleanup.warn",
                    );
                }
            }
        }
    }

	private async purgePublishedPublicUrlCache(input: PublicHtmlCachePurgeInput): Promise<{ ok: true } | { ok: false; notice: string }> {
		const appWithSecretStorage = this.app as typeof this.app & {
			secretStorage?: RemoteCachePurgeSecretStorage;
		};
		const authSecret = readRemoteCachePurgeAuthSecret(
			appWithSecretStorage.secretStorage,
			this.settings.publishPurgeBrokerSecretName,
		);
		const result = await purgeRemoteCache(
			(options) => requestUrl(options),
			{
				brokerUrl: this.settings.publishPurgeBrokerUrl,
				authSecret,
				publicUrl: input.url,
				sourcePath: input.sourcePath,
				event: input.event,
			},
			{
				now: () => new Date(),
				createNonce: () => {
					const bytes = new Uint8Array(16);
					window.crypto.getRandomValues(bytes);
					return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
				},
			},
		);
        if (!result.ok) {
            void this.logEvent("warn", "publish", "publish.public-html.cache-purge.failed", {
				url: input.url,
				sourcePath: input.sourcePath,
				event: input.event,
                notice: result.notice,
            });
        }
        return result;
    }

    public getRuntimeWorkingDirectory(filePath: string): string | null {
        if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
            return null;
        }

        const vaultRootPath = this.app.vault.adapter.getBasePath();
        const electronRequire = getNodeRequire();
        if (!electronRequire) {
            return vaultRootPath;
        }

        try {
            const nodePath = electronRequire("node:path") as {
                dirname(value: string): string;
                join(...parts: string[]): string;
            };
            const nodeFs = electronRequire("node:fs") as {
                existsSync(path: string): boolean;
            };
            const noteFullPath = this.app.vault.adapter.getFullPath(filePath);
            let currentDirectory = nodePath.dirname(noteFullPath);
            while (currentDirectory.startsWith(vaultRootPath)) {
                if (nodeFs.existsSync(nodePath.join(currentDirectory, ".git"))) {
                    return currentDirectory;
                }

                if (currentDirectory === vaultRootPath) {
                    break;
                }

                const parentDirectory = nodePath.dirname(currentDirectory);
                if (parentDirectory === currentDirectory) {
                    break;
                }
                currentDirectory = parentDirectory;
            }

            return nodePath.dirname(noteFullPath).startsWith(vaultRootPath)
                ? nodePath.dirname(noteFullPath)
                : vaultRootPath;
        } catch {
            return vaultRootPath;
        }
    }

    private showNotice(
        message: string,
        area: string,
        event: string,
        payload?: Record<string, unknown>,
    ): void {
        if (shouldShowTransientNotice({ message, area, event })) {
            new Notice(message);
        }
        void this.logEvent("warn", area, event, {
            ...payload,
            message,
        });
    }

    private warn(
        message: string,
        error: unknown,
        area: string,
        event: string,
    ): void {
        void this.logEvent("warn", area, event, {
            message,
            error,
        });
    }

    public getRevealedCommentId(filePath: string): string | null {
        return this.commentSessionController.getRevealedCommentId(filePath);
    }

    /**
     * Activate the Aside view, highlight a specific comment, and focus the draft
     */
    async activateViewAndHighlightComment(commentId: string) {
        await this.ensureCommentSelectionVisible(commentId);
        await this.commentNavigationController.activateViewAndHighlightComment(commentId);
    }

    async activateIndexComment(commentId: string, indexFilePath: string, sourceFilePath?: string) {
        await this.ensureCommentSelectionVisible(commentId, sourceFilePath);
        await this.syncIndexCommentHighlightPair(commentId, indexFilePath);

        const indexFile = this.workspaceViewController.getFileByPath(indexFilePath);
        await this.commentNavigationController.syncSidebarSelection(commentId, indexFile, {
            indexScopeRootFilePath: sourceFilePath ?? undefined,
        });
    }

    async activateIndexFileScope(indexFilePath: string, sourceFilePath: string) {
        const sourceFile = this.workspaceViewController.getMarkdownFileByPath(sourceFilePath);
        if (!sourceFile) {
            this.showNotice(`Unable to open ${sourceFilePath}.`, "index", "index.file.open.error", {
                indexFilePath,
                sourceFilePath,
            });
            return;
        }

        const indexFile = this.workspaceViewController.getMarkdownFileByPath(indexFilePath);
        if (Platform.isMobile || Platform.isMobileApp) {
            await this.commentNavigationController.revealSidebarView(true);
        } else {
            await this.commentNavigationController.ensureSidebarView(true);
        }
        await this.commentNavigationController.syncIndexFileFilter(indexFile, sourceFile.path);
    }

    private getIndexFileScopeRootPath(indexFilePath: string): string | null {
        let selectedRootPath: string | null = null;
        for (const leaf of this.app.workspace.getLeavesOfType("aside-view")) {
            if (!(leaf.view instanceof AsideView)) {
                continue;
            }

            if (leaf.view.getCurrentFile()?.path !== indexFilePath) {
                continue;
            }

            selectedRootPath = leaf.view.getIndexFileFilterRootPath();
            break;
        }

        return selectedRootPath;
    }

    public async revealIndexCommentFromSidebar(commentId: string, indexFilePath: string) {
        await this.ensureCommentSelectionVisible(commentId);
        this.commentSessionController.setRevealedCommentState(
            indexFilePath,
            commentId,
            { refreshMarkdownPreviews: false },
        );
        await this.commentHighlightController.revealIndexPreviewSelection(indexFilePath, commentId);
    }

    public async syncIndexCommentHighlightPair(commentId: string, indexFilePath: string) {
        await this.ensureCommentSelectionVisible(commentId);
        this.commentSessionController.setRevealedCommentState(
            indexFilePath,
            commentId,
            { refreshMarkdownPreviews: false },
        );
        this.commentHighlightController.syncIndexPreviewSelection(indexFilePath, commentId);
    }

    public syncIndexPreviewFileScope(indexFilePath: string): void {
        this.commentHighlightController.syncIndexPreviewFileScope(indexFilePath);
    }

    public getPinnedMarkdownFile(): TFile | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (isMarkdownCommentableFile(activeFile, this.getAllCommentsNotePath())) {
            return activeFile;
        }

        return this.activeMarkdownFile;
    }

    public getPinnedCommentableFile(): TFile | null {
        return pickPinnedCommentableFile(
            this.app.workspace.getActiveFile(),
            this.activeSidebarFile,
            this.activeMarkdownFile,
            (file): file is TFile => this.isPageNoteCapableFile(file),
        );
    }

    public getSidebarTargetFile(): TFile | null {
        return pickSidebarTargetFile(
            this.app.workspace.getActiveFile(),
            this.activeSidebarFile,
            (file): file is TFile => isSidebarSupportedFile(file, this.getAllCommentsNotePath()),
        );
    }

    public isSidebarSupportedFile(file: TFile | null): file is TFile {
        return isSidebarSupportedFile(file, this.getAllCommentsNotePath());
    }

    public getPreferredFileLeaf(filePath?: string): WorkspaceLeaf | null {
        return this.commentNavigationController.getPreferredFileLeaf(filePath);
    }

    private async syncIndexNoteLeafMode(leaf: WorkspaceLeaf | null): Promise<void> {
        await this.workspaceContextController.syncIndexNoteLeafMode(leaf);
    }

    private syncIndexNoteViewClasses(): void {
        this.workspaceContextController.syncIndexNoteViewClasses();
    }

    private isCommentableFile(file: TFile | null): file is TFile {
        return isMarkdownCommentableFile(file, this.getAllCommentsNotePath());
    }

    private isPageNoteCapableFile(file: TFile | null): file is TFile {
        return isPageNoteCapableSourceFile(file, this.getAllCommentsNotePath());
    }

    private getParsedNoteComments(filePath: string, noteContent: string): ParsedNoteComments {
        return this.parsedNoteCache.getOrParse(filePath, noteContent, parseNoteComments);
    }

    private clearParsedNoteCache(filePath: string) {
        this.parsedNoteCache.clear(filePath);
    }

    async loadCommentsForFile(file: TFile | null): Promise<Comment[]> {
        if (!file) {
            return [];
        }

        const pairContext = this.getPublicHtmlPairContext(file.path);
        if (!pairContext) {
            return this.commentPersistenceController.loadCommentsForFile(file);
        }

        const comments = await this.commentPersistenceController.loadCommentsForFile(file);
        for (const pairedPath of pairContext.paths) {
            if (pairedPath === file.path) {
                continue;
            }
            const pairedFile = this.getVaultFileByPath(pairedPath);
            if (pairedFile && this.isPageNoteCapableFile(pairedFile)) {
                await this.commentPersistenceController.loadCommentsForFile(pairedFile);
            }
        }
        return comments;
    }

    public async ensureIndexedCommentsLoaded(): Promise<void> {
        await this.commentPersistenceController.ensureIndexedCommentsLoaded();
    }

    private async updateSidebarViews(file: TFile | null, options: SidebarUpdateOptions = {}): Promise<void> {
        await this.commentNavigationController.updateSidebarViews(file, options);
    }

    public shouldShowNestedComments(): boolean {
        return this.commentSessionController.shouldShowNestedComments();
    }

    public shouldShowNestedCommentsForThread(threadId: string): boolean {
        return this.commentSessionController.shouldShowNestedCommentsForThread(threadId);
    }

    public shouldShowDeletedComments(): boolean {
        return this.commentSessionController.shouldShowDeletedComments();
    }

    public async setShowDeletedComments(
        showDeleted: boolean,
        options: SetSidebarViewStateOptions = {},
    ): Promise<boolean> {
        return this.commentSessionController.setShowDeletedComments(showDeleted, options);
    }

    public async setShowNestedComments(
        showNested: boolean,
        options: SetSidebarViewStateOptions = {},
    ): Promise<boolean> {
        return this.commentSessionController.setShowNestedComments(showNested, options);
    }

    public async setShowNestedCommentsForThread(
        threadId: string,
        showNested: boolean,
        options: SetSidebarViewStateOptions = {},
    ): Promise<boolean> {
        return this.commentSessionController.setShowNestedCommentsForThread(threadId, showNested, options);
    }

    public async persistCommentsForFile(
        file: TFile,
        options: {
            immediateAggregateRefresh?: boolean;
            skipCommentViewRefresh?: boolean;
            refreshEditorDecorations?: boolean;
            refreshMarkdownPreviews?: boolean;
        } = {},
    ): Promise<void> {
        await this.commentPersistenceController.persistCommentsForFile(file, options);
    }

    private scheduleAggregateNoteRefresh() {
        this.commentPersistenceController.scheduleAggregateNoteRefresh();
    }

    private async refreshAggregateNoteNow(): Promise<void> {
        await this.commentPersistenceController.refreshAggregateNoteNow();
    }

    private getCommentMentionedPageLabels(comment: Comment): string[] {
        const seenPaths = new Set<string>();
        const labels: string[] = [];

        for (const linkPath of extractWikiLinkPaths(comment.comment ?? "")) {
            const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, comment.filePath);
            if (!(linkedFile instanceof TFile) || linkedFile.path === comment.filePath) {
                continue;
            }

            if (seenPaths.has(linkedFile.path)) {
                continue;
            }

            seenPaths.add(linkedFile.path);
            labels.push(this.app.metadataCache.fileToLinktext(linkedFile, comment.filePath, true));
        }

        return labels;
    }

    public async revealComment(comment: Comment) {
        await this.ensureCommentSelectionVisible(comment.id, comment.filePath);
        await this.commentNavigationController.revealComment(comment);
    }

    public clearRevealedCommentSelection(): void {
        this.commentSessionController.clearRevealedCommentSelection();
    }

    public async openCommentById(filePath: string | null, commentId: string) {
        await this.ensureCommentSelectionVisible(commentId, filePath);
        await this.commentNavigationController.openCommentById(filePath, commentId);
    }

    public getDraftForFile(filePath: string): DraftComment | null {
        return this.commentSessionController.getDraftForFile(filePath);
    }

    public getDraftForView(filePath: string): DraftComment | null {
        return this.commentSessionController.getDraftForView(filePath);
    }

    public getAllIndexedComments(): Comment[] {
        return this.aggregateCommentIndex.getAllComments();
    }

    public getAllIndexedThreads(): CommentThread[] {
        return this.aggregateCommentIndex.getAllThreads();
    }

    public getIndexedCommentVersion(): number {
        return this.aggregateCommentIndex.getVersion();
    }

    public getIndexedThreadCount(): number {
        return this.aggregateCommentIndex.getThreadCount();
    }

    public getThreadsForFile(filePath: string, options: { includeDeleted?: boolean } = {}): CommentThread[] {
        const pairContext = this.getPublicHtmlPairContext(filePath);
        return pairContext
            ? this.commentManager.getThreadsForFiles(pairContext.paths, options)
            : this.commentManager.getThreadsForFile(filePath, options);
    }

    public getCommentById(commentId: string): Comment | null {
        return this.getKnownCommentById(commentId);
    }

    public getThreadById(commentId: string): CommentThread | null {
        return this.getKnownThreadById(commentId);
    }

    public getCommentManager(): CommentManager {
        return this.commentManager;
    }

    public async reorderThreadsForFile(
        filePath: string,
        movedThreadId: string,
        targetThreadId: string,
        placement: ReorderPlacement,
    ): Promise<boolean> {
        const file = this.workspaceViewController.getFileByPath(filePath);
        if (!this.isCommentableFile(file)) {
            return false;
        }

        await this.loadCommentsForFile(file);
        const changed = this.commentManager.reorderThreadsForFile(file.path, movedThreadId, targetThreadId, placement);
        if (!changed) {
            return false;
        }

        await this.persistCommentsForFile(file, { immediateAggregateRefresh: true });
        return true;
    }

    public async reorderThreadEntries(
        filePath: string,
        threadId: string,
        movedEntryId: string,
        targetEntryId: string,
        placement: ReorderPlacement,
    ): Promise<boolean> {
        const file = this.workspaceViewController.getFileByPath(filePath);
        if (!this.isCommentableFile(file)) {
            return false;
        }

        await this.loadCommentsForFile(file);
        const changed = this.commentManager.reorderThreadEntries(threadId, movedEntryId, targetEntryId, placement);
        if (!changed) {
            return false;
        }

        await this.persistCommentsForFile(file, { immediateAggregateRefresh: true });
        return true;
    }

    public isSavingDraft(commentId: string): boolean {
        return this.commentSessionController.isSavingDraft(commentId);
    }

    public updateDraftCommentText(commentId: string, commentText: string) {
        this.commentSessionController.updateDraftCommentText(commentId, commentText);
    }

    public async cancelDraft(commentId?: string) {
        await this.commentSessionController.cancelDraft(commentId);
    }

    public async startEditDraft(
        commentId: string,
        hostFilePath: string | null = this.getSidebarTargetFile()?.path ?? null,
    ) {
        await this.ensureCommentSelectionVisible(commentId);
        await this.commentMutationController.startEditDraft(commentId, hostFilePath);
    }

    public async saveDraft(commentId: string, options?: SaveDraftOptions) {
        await this.commentMutationController.saveDraft(commentId, options);
    }

    public async startPageCommentDraft(file: TFile | null = this.getPinnedCommentableFile()) {
        await this.commentEntryController.startPageCommentDraft(file);
    }

    public async startAppendEntryDraft(
        threadId: string,
        hostFilePath: string | null = this.getSidebarTargetFile()?.path ?? null,
    ) {
        await this.ensureCommentSelectionVisible(threadId);
        await this.commentEntryController.startAppendEntryDraft(threadId, hostFilePath);
    }

    public async reanchorCommentThreadToCurrentSelection(commentId: string): Promise<boolean> {
        return this.commentMutationController.reanchorCommentThreadToCurrentSelection(commentId);
    }

    public async moveCommentThreadToFile(
        threadId: string,
        targetFilePath: string,
        options?: MoveCommentThreadOptions,
    ): Promise<boolean> {
        return this.commentMutationController.moveCommentThreadToFile(threadId, targetFilePath, options);
    }

    public async moveCommentEntryToThread(
        commentId: string,
        targetThreadId: string,
        options?: MoveCommentEntryOptions,
    ): Promise<boolean> {
        return this.commentMutationController.moveCommentEntryToThread(commentId, targetThreadId, options);
    }

    public async nestCommentThreadUnderThread(
        sourceThreadId: string,
        targetThreadId: string,
        options?: NestCommentThreadOptions,
    ): Promise<boolean> {
        return this.commentMutationController.nestCommentThreadUnderThread(sourceThreadId, targetThreadId, options);
    }

    private markDraftFileActive(file: TFile) {
        if (isMarkdownCommentableFile(file, this.getAllCommentsNotePath())) {
            this.activeMarkdownFile = file;
        }
        this.activeSidebarFile = file;
    }

    private getKnownCommentById(commentId: string): Comment | null {
        return this.commentManager.getCommentById(commentId)
            ?? this.aggregateCommentIndex.getCommentById(commentId);
    }

    private getKnownThreadById(commentId: string): CommentThread | null {
        return this.commentManager.getThreadById(commentId)
            ?? this.aggregateCommentIndex.getThreadById(commentId);
    }

    private async loadKnownCommentSelectionTarget(
        commentId: string,
        filePath?: string | null,
    ): Promise<Comment | null> {
        let comment = this.getKnownCommentById(commentId);
        if (!comment && filePath) {
            const file = this.workspaceViewController.getFileByPath(filePath);
            if (this.isCommentableFile(file)) {
                await this.loadCommentsForFile(file);
                comment = this.getKnownCommentById(commentId);
            }
        }

        return comment;
    }

    private async ensureCommentSelectionVisible(_commentId: string, _filePath?: string | null): Promise<void> {
        // no-op: resolved visibility removed
    }

    /**
     * Activate the Aside view - open it in the right sidebar if not already open
     * @param skipViewUpdate If true, skips updating the view's active file (use when view was just refreshed)
     */
    async activateView(skipViewUpdate = false) {
        await this.commentNavigationController.activateView(skipViewUpdate);
    }

    private getPreferredMarkdownLeafByPath(filePath: string): WorkspaceLeaf | null {
        const workspace = this.app.workspace;
        const activeLeaf = workspace.getActiveViewOfType(MarkdownView)?.leaf ?? null;
        const recentLeaf = workspace.getMostRecentLeaf(workspace.rootSplit);
        const candidates: PreferredFileLeafCandidate<WorkspaceLeaf>[] = [];

        workspace.iterateAllLeaves((leaf) => {
            if (!(leaf.view instanceof MarkdownView)) {
                return;
            }

            candidates.push({
                value: leaf,
                filePath: leaf.view.file?.path ?? null,
                eligible: true,
                active: leaf === activeLeaf,
                recent: leaf === recentLeaf,
            });
        });

        return pickPreferredFileLeafCandidate(candidates, filePath);
    }

    async openIndexNote() {
        const indexFilePath = this.getAllCommentsNotePath();
        await this.refreshAggregateNoteNow();
        if (!this.workspaceViewController.getMarkdownFileByPath(indexFilePath)) {
            this.showNotice(`Unable to open ${indexFilePath}.`, "index", "index.open.error", {
                filePath: indexFilePath,
            });
            return;
        }

        const workspace = this.app.workspace;
        let indexLeaf = this.getPreferredMarkdownLeafByPath(indexFilePath);
        if (indexLeaf && indexLeaf.view instanceof MarkdownView && indexLeaf.view.file?.path === indexFilePath) {
            workspace.setActiveLeaf(indexLeaf, { focus: true });
        } else {
            await workspace.openLinkText(indexFilePath, "", "tab");
            indexLeaf = this.getPreferredMarkdownLeafByPath(indexFilePath);
        }

        await this.commentNavigationController.activateView(false);

        if (indexLeaf && indexLeaf.view instanceof MarkdownView && indexLeaf.view.file?.path === indexFilePath) {
            workspace.setActiveLeaf(indexLeaf, { focus: true });
        }
    }

    async addComment(newComment: Comment): Promise<boolean> {
        return this.commentMutationController.addComment(newComment);
    }

    async appendTextToThread(
        threadId: string,
        commentText: string,
    ): Promise<boolean> {
        return this.commentMutationController.appendThreadEntry(threadId, {
            id: generateCommentId(),
            body: commentText,
            timestamp: Date.now(),
        });
    }

    async editComment(commentId: string, newCommentText: string): Promise<boolean> {
        return this.commentMutationController.editComment(commentId, newCommentText);
    }

    async applyTagToThreads(
        filePath: string,
        selectedThreadIds: readonly string[],
        normalizedTagText: string,
    ): Promise<BatchTagMutationResult> {
        return this.commentMutationController.applyTagToThreads(filePath, selectedThreadIds, normalizedTagText);
    }

    async removeTagFromThreads(
        filePath: string,
        selectedThreadIds: readonly string[],
        normalizedTagText: string,
        targetTagTextForNotice: string,
    ): Promise<BatchTagMutationResult> {
        return this.commentMutationController.removeTagFromThreads(
            filePath,
            selectedThreadIds,
            normalizedTagText,
            targetTagTextForNotice,
        );
    }

    async deleteComment(
        commentId: string,
        options?: DeleteCommentOptions,
    ): Promise<boolean> {
        await this.commentAgentController.cancelRunsForComment(commentId);
        return this.commentMutationController.deleteComment(commentId, options);
    }

    async restoreComment(commentId: string): Promise<boolean> {
        return this.commentMutationController.restoreComment(commentId);
    }

    async clearDeletedCommentsForFile(filePath: string): Promise<boolean> {
        return this.commentMutationController.clearDeletedCommentsForFile(filePath);
    }

    async clearDeletedComment(commentId: string): Promise<boolean> {
        return this.commentMutationController.clearDeletedComment(commentId);
    }

    async setCommentPinnedState(
        commentId: string,
        isPinned: boolean,
        options?: SetCommentPinnedOptions,
    ): Promise<boolean> {
        return this.commentMutationController.setCommentPinnedState(commentId, isPinned, options);
    }

    private getCurrentSelectionForFile(file: TFile): DraftSelection | null {
        const markdownView = this.workspaceViewController.getMarkdownViewForFile(file);
        if (!markdownView || markdownView.file?.path !== file.path) {
            return null;
        }

        const selectedText = markdownView.editor.getSelection();
        if (!selectedText.trim()) {
            return null;
        }

        const start = markdownView.editor.getCursor("from");
        const end = markdownView.editor.getCursor("to");
        return {
            file,
            selectedText,
            startLine: start.line,
            startChar: start.ch,
            endLine: end.line,
            endChar: end.ch,
        };
    }

    /**
     * Refresh editor-side highlight decorations after comment or draft changes.
     */
    refreshEditorDecorations() {
        this.commentHighlightController.refreshEditorDecorations();
    }

    private async resolveCurrentLogAttachment() {
        return this.logService?.getCurrentLogAttachment() ?? null;
    }

    public canLocateSupportLogFileLocation(): boolean {
        if (this.supportLogLocationAvailable !== null) {
            return this.supportLogLocationAvailable;
        }

        if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
            this.supportLogLocationAvailable = false;
            return false;
        }

        const electronRequire = typeof window !== "undefined"
            ? (window as Window & {
                require?: (moduleName: string) => unknown;
            }).require
            : undefined;
        if (typeof electronRequire !== "function") {
            this.supportLogLocationAvailable = false;
            return false;
        }

        try {
            const electronModule = electronRequire("electron") as {
                shell?: {
                    showItemInFolder?: (filePath: string) => void;
                    openPath?: (filePath: string) => Promise<string>;
                };
            };
            const shell = electronModule.shell;
            this.supportLogLocationAvailable = typeof shell?.showItemInFolder === "function"
                || typeof shell?.openPath === "function";
            return this.supportLogLocationAvailable;
        } catch {
            this.supportLogLocationAvailable = false;
            return false;
        }
    }

    public async openSupportLogFileLocation(relativePath: string): Promise<boolean> {
        if (!this.canLocateSupportLogFileLocation()) {
            return false;
        }

        const electronRequire = typeof window !== "undefined"
            ? (window as Window & {
                require?: (moduleName: string) => unknown;
            }).require
            : undefined;
        if (typeof electronRequire !== "function" || !(this.app.vault.adapter instanceof FileSystemAdapter)) {
            this.supportLogLocationAvailable = false;
            return false;
        }

        try {
            const electronModule = electronRequire("electron") as {
                shell?: {
                    showItemInFolder?: (filePath: string) => void;
                    openPath?: (filePath: string) => Promise<string>;
                };
            };
            const fullPath = this.app.vault.adapter.getFullPath(relativePath);
            const folderPath = getParentPath(fullPath);
            const openPath = electronModule.shell?.openPath;
            const showItemInFolder = electronModule.shell?.showItemInFolder;
            if (typeof openPath === "function") {
                const openResult = await openPath(folderPath);
                if (openResult) {
                    throw new Error(openResult);
                }
            } else if (typeof showItemInFolder === "function") {
                showItemInFolder(fullPath);
            } else {
                throw new Error("Electron shell.openPath and shell.showItemInFolder are unavailable.");
            }

            await this.logEvent("info", "support", "support.log.file.location.opened", {
                filePath: relativePath,
            });
            return true;
        } catch (error) {
            this.supportLogLocationAvailable = false;
            console.error("[Aside] Failed to reveal support log file location.", error);
            await this.logEvent("warn", "support", "support.log.file.location.open.error", {
                filePath: relativePath,
                error,
            });
            return false;
        }
    }

    public async openSidecarDataFolder(): Promise<boolean> {
        if (!this.canLocateSupportLogFileLocation()) {
            return false;
        }

        const electronRequire = typeof window !== "undefined"
            ? (window as Window & {
                require?: (moduleName: string) => unknown;
            }).require
            : undefined;
        if (typeof electronRequire !== "function" || !(this.app.vault.adapter instanceof FileSystemAdapter)) {
            return false;
        }

        try {
            const electronModule = electronRequire("electron") as {
                shell?: {
                    showItemInFolder?: (filePath: string) => void;
                    openPath?: (filePath: string) => Promise<string>;
                };
            };
            const pluginDirPath = this.getPluginDataDirPath();
            const sidecarDirPath = normalizePath(`${pluginDirPath}/sidenotes/by-note`);
            const fullPath = this.app.vault.adapter.getFullPath(sidecarDirPath);
            const openPath = electronModule.shell?.openPath;
            const showItemInFolder = electronModule.shell?.showItemInFolder;
            if (typeof openPath === "function") {
                const openResult = await openPath(fullPath);
                if (openResult) {
                    throw new Error(openResult);
                }
            } else if (typeof showItemInFolder === "function") {
                showItemInFolder(fullPath);
            } else {
                throw new Error("Electron shell.openPath and shell.showItemInFolder are unavailable.");
            }

            await this.logEvent("info", "support", "support.sidecar.folder.opened", {
                folderPath: sidecarDirPath,
            });
            return true;
        } catch (error) {
            console.error("[Aside] Failed to reveal sidecar data folder.", error);
            await this.logEvent("warn", "support", "support.sidecar.folder.open.error", {
                error,
            });
            return false;
        }
    }

    public async openSupportLogInspectorModal(context: {
        filePath: string | null;
        surface: "index" | "note";
        threadCount: number;
    }): Promise<void> {
        if (!this.isLocalRuntime()) {
            return;
        }

        await this.logEvent("info", "support", "support.debugger.opened", {
            filePath: context.filePath,
            surface: context.surface,
            threadCount: context.threadCount,
        });

        const attachedLog = await this.resolveCurrentLogAttachment();
        const locateLogFile = attachedLog && this.canLocateSupportLogFileLocation()
            ? () => this.openSupportLogFileLocation(attachedLog.relativePath)
            : undefined;

        const openDataFolder = this.canLocateSupportLogFileLocation()
            ? () => this.openSidecarDataFolder()
            : undefined;

        new SupportLogInspectorModal(this.app, {
            fileName: "Log Inspector",
            logContent: "",
            locateLogFile,
            openDataFolder,
        }).open();
    }
}
