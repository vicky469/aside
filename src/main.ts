import { addIcon, WorkspaceLeaf, TFile, Notice, Plugin, normalizePath, MarkdownView, FileSystemAdapter, requestUrl, FileView, Platform, type Editor } from "obsidian";
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
    type MoveCommentThreadOptions,
    type ResolveCommentOptions,
    type SaveDraftOptions,
    type SetCommentPinnedOptions,
} from "./comments/commentMutationController";
import { CommentNavigationController } from "./comments/commentNavigationController";
import { pickPinnedCommentableFile, pickPreferredFileLeafCandidate, pickSidebarTargetFile, type PreferredFileLeafCandidate } from "./comments/commentNavigationPlanner";
import { CommentPersistenceController } from "./comments/commentPersistenceController";
import type { SetSidebarViewStateOptions } from "./comments/commentSessionController";
import { getResolvedVisibilityForCommentSelection } from "./comments/commentSelectionVisibility";
import { CommentSessionController } from "./comments/commentSessionController";
import { IndexNoteSettingsController } from "./settings/indexNoteSettingsController";
import type { PersistedPluginData } from "./settings/indexNoteSettingsPlanner";
import { PluginEventRouter } from "./app/pluginEventRouter";
import { PluginLifecycleController } from "./app/pluginLifecycleController";
import { PluginRegistrationController } from "./app/pluginRegistrationController";
import { RefreshCoordinator } from "./app/refreshCoordinator";
import { WorkspaceContextController } from "./app/workspaceContextController";
import { WorkspaceViewController } from "./app/workspaceViewController";
import { AgentRunStore } from "./agents/agentRunStore";
import {
    disposeAgentRuntimeProcesses,
    getCodexRuntimeDiagnostics as probeCodexRuntimeDiagnostics,
    runAgentRuntime,
    type CodexRuntimeDiagnostics,
} from "./agents/agentRuntimeAdapter";
import {
    getRemoteRuntimeAvailability as getRemoteRuntimeAvailabilitySnapshot,
    resolveAgentRuntimeSelection as resolveAgentRuntimeSelectionPlan,
    type AgentRuntimeSelection,
    type RemoteRuntimeAvailability,
} from "./agents/agentRuntimeSelection";
import {
    cancelRemoteRuntimeRun,
    createRemoteRuntimeRequester,
    pollRemoteRuntimeRun,
    probeRemoteRuntimeBridge,
    startRemoteRuntimeRun,
    type RemoteRuntimeHealthEnvelope,
    type RemoteRuntimeResponseEnvelope,
} from "./agents/openclawRuntimeBridge";
import { buildLocalSecretStorageKey, LocalSecretStore } from "./settings/localSecretStore";
import type { AgentRunRecord, AgentRunStreamState } from "./core/agents/agentRuns";
import {
    normalizeRemoteRuntimeBearerToken,
    type AgentRuntimeModePreference,
} from "./core/agents/agentRuntimePreferences";
import { DraftComment, DraftSelection } from "./domain/drafts";
import { parsePromptDeleteSetting } from "./core/config/appConfig";
import { DerivedCommentMetadataManager } from "./core/derived/derivedCommentMetadata";
import { isMarkdownCommentableFile, isSidebarSupportedFile } from "./core/rules/commentableFiles";
import { extractWikiLinkPaths } from "./core/text/commentMentions";
import { syncInstalledCodexSkill, type CodexSkillSyncModules } from "./core/codexSkillSync";
import { AggregateCommentIndex } from "./index/AggregateCommentIndex";
import { ParsedNoteCache } from "./cache/ParsedNoteCache";
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
import {
    AsideLogService,
    type AsideLogLevel,
} from "./logs/logService";
import bundledAsideSkillContent from "../skills/aside/SKILL.md";

const LEGACY_PLUGIN_ID = "side-note2";
const SIDECAR_STORAGE_MIGRATION_VERSION = 2;
const SIDE_NOTE_SYNC_EVENT_MIGRATION_VERSION = 2;
const SOURCE_IDENTITY_MIGRATION_VERSION = 1;
const SIDE_NOTE_SYNC_DEVICE_ID_STORAGE_PREFIX = "aside.sync-device-id.v1";
const LEGACY_SIDE_NOTE_SYNC_DEVICE_ID_STORAGE_PREFIX = "sidenote2.sync-device-id.v1";

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

type RemoteRuntimeFetchFallback = NonNullable<Parameters<typeof createRemoteRuntimeRequester>[0]["fetcher"]>;

function getFetchFallback(): RemoteRuntimeFetchFallback | undefined {
    if (typeof window === "undefined" || typeof window.fetch !== "function") {
        return undefined;
    }

    return (input, init) => window.fetch(input, init);
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
    private readonly remoteRuntimeRequester = createRemoteRuntimeRequester({
        primaryRequester: requestUrl,
        fetcher: getFetchFallback(),
    });
    private readonly localSecretStore = new LocalSecretStore(
        buildLocalSecretStorageKey(this.manifest.id, this.app.vault.getName()),
        [buildLocalSecretStorageKey(LEGACY_PLUGIN_ID, this.app.vault.getName(), {
            namespace: "sidenote2",
        })],
        getSafeLocalStorage(),
    );
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
        shouldShowResolvedComments: () => this.commentSessionController.shouldShowResolvedComments(),
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
        shouldShowResolvedComments: () => this.commentSessionController.shouldShowResolvedComments(),
        setShowResolvedComments: (showResolved, options) => this.setShowResolvedComments(showResolved, options),
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
        handleSavedUserEntry: (event: SavedUserEntryEvent): Promise<void> => this.commentAgentController.handleSavedUserEntry(event),
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
    private readonly commentPersistenceController: CommentPersistenceController = new CommentPersistenceController({
        app: this.app,
        getAllCommentsNotePath: () => this.getAllCommentsNotePath(),
        getIndexHeaderImageUrl: () => this.getIndexHeaderImageUrl(),
        getIndexHeaderImageCaption: () => this.getIndexHeaderImageCaption(),
        shouldShowResolvedComments: () => this.commentSessionController.shouldShowResolvedComments(),
        getMarkdownViewForFile: (file) => this.workspaceViewController.getMarkdownViewForFile(file),
        getMarkdownFileByPath: (filePath) => this.workspaceViewController.getMarkdownFileByPath(filePath),
        getCurrentNoteContent: (file) => this.workspaceViewController.getCurrentNoteContent(file),
        getStoredNoteContent: (file) => this.workspaceViewController.getStoredNoteContent(file),
        getParsedNoteComments: (filePath, noteContent) => this.getParsedNoteComments(filePath, noteContent),
        getPluginDataDirPath: () => this.getPluginDataDirPath(),
        getLegacyPluginDataDirPaths: () => this.getLegacyPluginDataDirPaths(),
        getSideNoteSyncDeviceId: () => this.getSideNoteSyncDeviceId(),
        readPersistedPluginData: () => this.indexNoteSettingsController.readPersistedPluginData(),
        loadPersistedPluginData: () => this.loadDataWithLegacyFallback(),
        writePersistedPluginData: (data) => this.indexNoteSettingsController.writePersistedPluginData(data),
        isAllCommentsNotePath: (filePath) => this.isAllCommentsNotePath(filePath),
        isCommentableFile: (file): file is TFile => this.isCommentableFile(file),
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
        loadData: () => this.loadDataWithLegacyFallback(),
        saveData: (data) => this.saveData(data),
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
        resolveAgentRuntimeSelection: () => this.resolveAgentRuntimeSelection(),
        startRemoteRuntimeRun: (options) => this.startRemoteRuntimeRun(options),
        pollRemoteRuntimeRun: (runId, afterCursor, waitMs) => this.pollRemoteRuntimeRun(runId, afterCursor, waitMs),
        cancelRemoteRuntimeRun: (runId) => this.cancelRemoteRuntimeRun(runId),
        showNotice: (message) => {
            this.showNotice(message, "agents", "agents.notice");
        },
        log: (level, area, event, payload) => this.logEvent(level, area, event, payload),
    }, this.agentRunStore);
    private readonly pluginLifecycleController = new PluginLifecycleController({
        app: this.app,
        ensureSidebarView: () => this.commentNavigationController.ensureSidebarView(true),
        getCommentManager: () => this.commentManager,
        getAggregateCommentIndex: () => this.aggregateCommentIndex,
        renameStoredComments: (previousFilePath, nextFilePath) =>
            this.commentPersistenceController.renameStoredComments(previousFilePath, nextFilePath),
        deleteStoredComments: (filePath) => this.commentPersistenceController.deleteStoredComments(filePath),
        clearParsedNoteCache: (filePath) => this.clearParsedNoteCache(filePath),
        clearDerivedCommentLinksForFile: (filePath) => this.derivedCommentMetadataManager.clearDerivedCommentLinksForFile(filePath),
        isCommentableFile: (file): file is TFile => file instanceof TFile && this.isCommentableFile(file),
        loadCommentsForFile: (file) => this.loadCommentsForFile(file),
        refreshCommentViews: () => this.workspaceViewController.refreshCommentViews(),
        refreshEditorDecorations: () => this.refreshEditorDecorations(),
        refreshAggregateNoteNow: () => this.refreshAggregateNoteNow(),
        scheduleAggregateNoteRefresh: () => this.scheduleAggregateNoteRefresh(),
        syncIndexNoteViewClasses: () => this.syncIndexNoteViewClasses(),
        handleMarkdownFileModified: (file) => this.commentPersistenceController.handleMarkdownFileModified(file),
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
            this.registerView(viewType, (leaf) => creator(leaf) as AsideView);
        },
        registerObsidianProtocolHandler: (action, handler) => {
            this.registerObsidianProtocolHandler(action, handler);
        },
        removeCommand: (commandId) => {
            this.removeCommand(commandId);
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
        startDraftFromEditorSelection: (editor, file) =>
            this.commentEntryController.startDraftFromEditorSelection(editor as unknown as Editor, file),
        highlightCommentById: (filePath, commentId) => this.highlightCommentById(filePath, commentId),
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
        },
        handleActiveLeafChange: (leaf) => {
            this.workspaceContextController.handleActiveLeafChange(leaf);
        },
        handleFileRename: (file, oldPath) => this.pluginLifecycleController.handleFileRename(file, oldPath),
        handleFileDelete: (file) => this.pluginLifecycleController.handleFileDelete(file),
        handleFileModify: (file) => this.pluginLifecycleController.handleFileModify(file),
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
        addIcon(ASIDE_ICON_ID, ASIDE_ICON_SVG);
        addIcon(ASIDE_REGENERATE_ICON_ID, ASIDE_REGENERATE_ICON_SVG);

        this.commentManager = new CommentManager([]);
        await this.loadSettings();
        await this.ensureSidecarStorageMigrated();
        await this.ensureSideNoteSyncEventsMigrated();
        await this.ensureSourceIdentitiesMigrated();
        await this.commentPersistenceController.replaySyncedSideNoteEvents();
        this.pluginRegistrationController.register();
        this.registerEditorExtension([
            this.commentHighlightController.createLivePreviewManagedBlockPlugin(),
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
        this.addSettingTab(new AsideSetting(this.app, this));
        void this.workspaceViewController.loadVisibleFiles().catch((error) => {
            this.warn("Failed to preload visible Aside comments during startup.", error, "startup", "startup.visible-files.preload.warn");
        });
    }

    onunload() {
        void this.logEvent("info", "startup", "startup.unload");
        disposeAgentRuntimeProcesses();
        this.commentAgentController.dispose();
        this.commentPersistenceController.dispose();
        this.pluginLifecycleController.clearPendingEditorRefreshes();
        this.derivedCommentMetadataManager.restoreMetadataCacheAugmentation();
        this.derivedCommentMetadataManager.clearAllDerivedCommentLinks();
        void this.logService?.flush();
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

    public getRemoteRuntimeBaseUrl(): string {
        return this.indexNoteSettingsController.getRemoteRuntimeBaseUrl();
    }

    public getRemoteRuntimeBearerToken(): string {
        return this.localSecretStore.readSecrets().remoteRuntimeBearerToken ?? "";
    }

    public async setAgentRuntimeMode(nextMode: AgentRuntimeModePreference): Promise<void> {
        await this.indexNoteSettingsController.setAgentRuntimeMode(nextMode);
    }

    public async setRemoteRuntimeBaseUrl(nextUrlInput: string): Promise<void> {
        await this.indexNoteSettingsController.setRemoteRuntimeBaseUrl(nextUrlInput);
    }

    public setRemoteRuntimeBearerToken(nextTokenInput: string): Promise<void> {
        const nextToken = normalizeRemoteRuntimeBearerToken(nextTokenInput);
        this.localSecretStore.writeSecrets({
            remoteRuntimeBearerToken: nextToken,
        });
        return Promise.resolve();
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

    public async getCodexRuntimeDiagnostics(): Promise<CodexRuntimeDiagnostics> {
        if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
            return {
                status: "unsupported",
                message: "Built-in @codex requires desktop Obsidian with a filesystem-backed vault.",
            };
        }

        return probeCodexRuntimeDiagnostics();
    }

    public getRemoteRuntimeAvailability(): RemoteRuntimeAvailability {
        return getRemoteRuntimeAvailabilitySnapshot({
            remoteRuntimeBaseUrl: this.getRemoteRuntimeBaseUrl(),
            remoteRuntimeBearerToken: this.getRemoteRuntimeBearerToken(),
        });
    }

    public async resolveAgentRuntimeSelection(): Promise<AgentRuntimeSelection> {
        return resolveAgentRuntimeSelectionPlan({
            modePreference: this.getAgentRuntimeMode(),
            isDesktopWithFilesystem: this.app.vault.adapter instanceof FileSystemAdapter,
            localDiagnostics: await this.getCodexRuntimeDiagnostics(),
            remoteRuntimeBaseUrl: this.getRemoteRuntimeBaseUrl(),
            remoteRuntimeBearerToken: this.getRemoteRuntimeBearerToken(),
        });
    }

    public async startRemoteRuntimeRun(options: {
        agent: string;
        promptText: string;
        metadata: Record<string, unknown>;
    }): Promise<RemoteRuntimeResponseEnvelope> {
        return startRemoteRuntimeRun(this.remoteRuntimeRequester, {
            baseUrl: this.getRemoteRuntimeBaseUrl(),
            bearerToken: this.getRemoteRuntimeBearerToken(),
            agent: options.agent,
            promptText: options.promptText,
            metadata: options.metadata,
        });
    }

    public async pollRemoteRuntimeRun(runId: string, afterCursor?: string | null, waitMs?: number): Promise<RemoteRuntimeResponseEnvelope> {
        return pollRemoteRuntimeRun(this.remoteRuntimeRequester, {
            baseUrl: this.getRemoteRuntimeBaseUrl(),
            bearerToken: this.getRemoteRuntimeBearerToken(),
            runId,
            afterCursor,
            waitMs,
        });
    }

    public async cancelRemoteRuntimeRun(runId: string): Promise<RemoteRuntimeResponseEnvelope> {
        return cancelRemoteRuntimeRun(this.remoteRuntimeRequester, {
            baseUrl: this.getRemoteRuntimeBaseUrl(),
            bearerToken: this.getRemoteRuntimeBearerToken(),
            runId,
        });
    }

    public async probeRemoteRuntimeBridge(): Promise<RemoteRuntimeHealthEnvelope> {
        return probeRemoteRuntimeBridge(this.remoteRuntimeRequester, {
            baseUrl: this.getRemoteRuntimeBaseUrl(),
            bearerToken: this.getRemoteRuntimeBearerToken(),
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

    private getLegacyPluginDataDirPaths(): string[] {
        const legacyDirPath = normalizePath(`${this.app.vault.configDir}/plugins/${LEGACY_PLUGIN_ID}`);
        const currentDirPath = this.getPluginDataDirPath();
        return legacyDirPath === currentDirPath ? [] : [legacyDirPath];
    }

    private async loadDataWithLegacyFallback(): Promise<PersistedPluginData | null> {
        const currentData: unknown = await this.loadData();
        if (isPersistedPluginData(currentData)) {
            return currentData;
        }

        for (const legacyDirPath of this.getLegacyPluginDataDirPaths()) {
            const legacyDataPath = normalizePath(`${legacyDirPath}/data.json`);
            try {
                if (!(await this.app.vault.adapter.exists(legacyDataPath))) {
                    continue;
                }

                const legacyData: unknown = JSON.parse(await this.app.vault.adapter.read(legacyDataPath));
                if (!isPersistedPluginData(legacyData)) {
                    continue;
                }

                await this.saveData(legacyData);
                return legacyData;
            } catch (error) {
                this.warn(
                    "Failed to migrate legacy SideNote2 plugin data into Aside.",
                    error,
                    "persistence",
                    "storage.plugin-data.legacy-migrate.warn",
                );
            }
        }

        return null;
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

        const legacyStorageKey = `${LEGACY_SIDE_NOTE_SYNC_DEVICE_ID_STORAGE_PREFIX}.${LEGACY_PLUGIN_ID}.${this.app.vault.getName()}`;
        const legacyStoredDeviceId = storage?.getItem(legacyStorageKey);
        if (legacyStoredDeviceId && legacyStoredDeviceId.trim()) {
            storage?.setItem(storageKey, legacyStoredDeviceId);
            this.sideNoteSyncDeviceId = legacyStoredDeviceId;
            return legacyStoredDeviceId;
        }

        const nextDeviceId = generateCommentId();
        storage?.setItem(storageKey, nextDeviceId);
        this.sideNoteSyncDeviceId = nextDeviceId;
        return nextDeviceId;
    }

    private getSidecarStorageMigrationVersion(): number | null {
        const persistedData = this.indexNoteSettingsController.readPersistedPluginData();
        return typeof persistedData.sidecarStorageMigrationVersion === "number"
            ? persistedData.sidecarStorageMigrationVersion
            : null;
    }

    private async setSidecarStorageMigrationVersion(version: number): Promise<void> {
        const persistedData = this.indexNoteSettingsController.readPersistedPluginData();
        if (persistedData.sidecarStorageMigrationVersion === version) {
            return;
        }

        await this.indexNoteSettingsController.writePersistedPluginData({
            ...persistedData,
            sidecarStorageMigrationVersion: version,
        });
    }

    private async ensureSidecarStorageMigrated(): Promise<void> {
        if (this.getSidecarStorageMigrationVersion() === SIDECAR_STORAGE_MIGRATION_VERSION) {
            return;
        }

        try {
            await this.logEvent("info", "persistence", "storage.note.migrate.startup.begin", {
                version: SIDECAR_STORAGE_MIGRATION_VERSION,
            });
            await this.commentPersistenceController.migrateLegacyInlineCommentsOnStartup();
            await this.setSidecarStorageMigrationVersion(SIDECAR_STORAGE_MIGRATION_VERSION);
            await this.logEvent("info", "persistence", "storage.note.migrate.startup.success", {
                version: SIDECAR_STORAGE_MIGRATION_VERSION,
            });
        } catch (error) {
            this.warn(
                "Failed to migrate legacy Aside note storage into sidecar files.",
                error,
                "persistence",
                "storage.note.migrate.startup.warn",
            );
        }
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
        new Notice(message);
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
            (file): file is TFile => this.isCommentableFile(file),
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

    private getParsedNoteComments(filePath: string, noteContent: string): ParsedNoteComments {
        return this.parsedNoteCache.getOrParse(filePath, noteContent, parseNoteComments);
    }

    private clearParsedNoteCache(filePath: string) {
        this.parsedNoteCache.clear(filePath);
    }

    async loadCommentsForFile(file: TFile | null): Promise<Comment[]> {
        return this.commentPersistenceController.loadCommentsForFile(file);
    }

    public async ensureIndexedCommentsLoaded(): Promise<void> {
        await this.commentPersistenceController.ensureIndexedCommentsLoaded();
    }

    private async updateSidebarViews(file: TFile | null, options: { skipDataRefresh?: boolean } = {}): Promise<void> {
        await this.commentNavigationController.updateSidebarViews(file, options);
    }

    public shouldShowResolvedComments(): boolean {
        return this.commentSessionController.shouldShowResolvedComments();
    }

    public async setShowResolvedComments(
        showResolved: boolean,
        options: {
            deferAggregateRefresh?: boolean;
            skipCommentViewRefresh?: boolean;
        } = {},
    ): Promise<boolean> {
        const changed = await this.commentSessionController.setShowResolvedComments(showResolved, {
            skipCommentViewRefresh: options.skipCommentViewRefresh,
        });
        if (!changed) {
            return false;
        }

        if (options.deferAggregateRefresh) {
            this.scheduleAggregateNoteRefresh();
        } else {
            await this.refreshAggregateNoteNow();
        }
        return true;
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

    private async highlightCommentById(filePath: string | null, commentId: string) {
        await this.ensureCommentSelectionVisible(commentId, filePath);
        await this.commentNavigationController.highlightCommentById(filePath, commentId);
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

    public getThreadsForFile(filePath: string, options: { includeDeleted?: boolean } = {}): CommentThread[] {
        return this.commentManager.getThreadsForFile(filePath, options);
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

    private async ensureCommentSelectionVisible(commentId: string, filePath?: string | null): Promise<void> {
        const comment = await this.loadKnownCommentSelectionTarget(commentId, filePath);

        const nextShowResolved = getResolvedVisibilityForCommentSelection(
            comment,
            this.commentSessionController.shouldShowResolvedComments(),
        );
        if (nextShowResolved !== null) {
            await this.setShowResolvedComments(nextShowResolved);
        }
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

    async resolveComment(
        commentId: string,
        options?: ResolveCommentOptions,
    ): Promise<boolean> {
        return this.commentMutationController.resolveComment(commentId, options);
    }

    async setCommentPinnedState(
        commentId: string,
        isPinned: boolean,
        options?: SetCommentPinnedOptions,
    ): Promise<boolean> {
        return this.commentMutationController.setCommentPinnedState(commentId, isPinned, options);
    }

    async unresolveComment(
        commentId: string,
        options?: ResolveCommentOptions,
    ): Promise<boolean> {
        return this.commentMutationController.unresolveComment(commentId, options);
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
