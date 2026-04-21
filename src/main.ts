import { addIcon, WorkspaceLeaf, TFile, Notice, Plugin, normalizePath, MarkdownView, FileSystemAdapter, requestUrl, type Editor } from "obsidian";
import { Comment, CommentManager, CommentThread, type ReorderPlacement } from "./commentManager";
import { CommentEntryController } from "./control/commentEntryController";
import {
    CommentAgentController,
    type AgentStreamUpdate,
    type SavedUserEntryEvent,
} from "./control/commentAgentController";
import { CommentHighlightController } from "./control/commentHighlightController";
import { CommentMutationController, type SaveDraftOptions } from "./control/commentMutationController";
import { CommentNavigationController } from "./control/commentNavigationController";
import { pickPinnedCommentableFile, pickPreferredFileLeafCandidate, pickSidebarTargetFile, type PreferredFileLeafCandidate } from "./control/commentNavigationPlanner";
import { CommentPersistenceController } from "./control/commentPersistenceController";
import { getResolvedVisibilityForCommentSelection } from "./control/commentSelectionVisibility";
import { CommentSessionController } from "./control/commentSessionController";
import { IndexNoteSettingsController } from "./control/indexNoteSettingsController";
import { PluginLifecycleController } from "./control/pluginLifecycleController";
import { PluginRegistrationController } from "./control/pluginRegistrationController";
import { WorkspaceContextController } from "./control/workspaceContextController";
import { WorkspaceViewController } from "./control/workspaceViewController";
import { AgentRunStore } from "./control/agentRunStore";
import {
    disposeAgentRuntimeProcesses,
    getCodexRuntimeDiagnostics as probeCodexRuntimeDiagnostics,
    runAgentRuntime,
    type CodexRuntimeDiagnostics,
} from "./control/agentRuntimeAdapter";
import {
    getRemoteRuntimeAvailability as getRemoteRuntimeAvailabilitySnapshot,
    resolveAgentRuntimeSelection as resolveAgentRuntimeSelectionPlan,
    type AgentRuntimeSelection,
    type RemoteRuntimeAvailability,
} from "./control/agentRuntimeSelection";
import {
    cancelRemoteRuntimeRun,
    createRemoteRuntimeRequester,
    pollRemoteRuntimeRun,
    probeRemoteRuntimeBridge,
    startRemoteRuntimeRun,
    type RemoteRuntimeHealthEnvelope,
    type RemoteRuntimeResponseEnvelope,
} from "./control/openclawRuntimeBridge";
import { buildLocalSecretStorageKey, LocalSecretStore } from "./control/localSecretStore";
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
import { AggregateCommentIndex } from "./index/AggregateCommentIndex";
import { ParsedNoteCache } from "./cache/ParsedNoteCache";
import { parseNoteComments, ParsedNoteComments } from "./core/storage/noteCommentStorage";
import SideNote2SettingTab, {
    DEFAULT_SETTINGS,
    type SideNote2Settings,
} from "./ui/settings/SideNote2SettingTab";
import {
    SIDE_NOTE2_ICON_ID,
    SIDE_NOTE2_ICON_SVG,
    SIDE_NOTE2_REGENERATE_ICON_ID,
    SIDE_NOTE2_REGENERATE_ICON_SVG,
} from "./ui/sideNote2Icon";
import SupportLogInspectorModal from "./ui/modals/SupportLogInspectorModal";
import SideNote2View from "./ui/views/SideNote2View";
import {
    SideNote2LogService,
    type SideNote2LogLevel,
} from "./logs/logService";

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

// Main plugin class
export default class SideNote2 extends Plugin {
    commentManager!: CommentManager;
    settings: SideNote2Settings = DEFAULT_SETTINGS;
    private logService: SideNote2LogService | null = null;
    private supportLogLocationAvailable: boolean | null = null;
    private runtime: "local" | "release" = "release";
    private readonly remoteRuntimeRequester = createRemoteRuntimeRequester({
        primaryRequester: requestUrl,
        fetcher: typeof globalThis.fetch === "function"
            ? globalThis.fetch.bind(globalThis)
            : undefined,
    });
    private readonly localSecretStore = new LocalSecretStore(
        buildLocalSecretStorageKey(this.manifest.id, this.app.vault.getName()),
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
        refreshCommentViews: () => this.workspaceViewController.refreshCommentViews(),
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
        setDraftComment: (draftComment, hostFilePath) => this.commentSessionController.setDraftComment(draftComment, hostFilePath),
        activateViewAndHighlightComment: (commentId) => this.activateViewAndHighlightComment(commentId),
        createCommentId: () => generateCommentId(),
        hashText: (text) => generateHash(text),
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
        activateViewAndHighlightComment: (commentId) => this.activateViewAndHighlightComment(commentId),
        activateIndexComment: (commentId, indexFilePath, sourceFilePath) =>
            this.activateIndexComment(commentId, indexFilePath, sourceFilePath),
        log: (level, area, event, payload) => this.logEvent(level, area, event, payload),
    });
    private readonly commentMutationController: CommentMutationController = new CommentMutationController({
        getAllCommentsNotePath: () => this.getAllCommentsNotePath(),
        getSidebarTargetFilePath: () => this.getSidebarTargetFile()?.path ?? null,
        getDraftComment: () => this.commentSessionController.getDraftComment(),
        getSavingDraftCommentId: () => this.commentSessionController.getSavingDraftCommentId(),
        shouldShowResolvedComments: () => this.commentSessionController.shouldShowResolvedComments(),
        setShowResolvedComments: (showResolved) => this.setShowResolvedComments(showResolved),
        setDraftComment: (draftComment, hostFilePath) => this.commentSessionController.setDraftComment(draftComment, hostFilePath),
        setDraftCommentValue: (draftComment) => this.commentSessionController.setDraftCommentValue(draftComment),
        clearDraftState: () => this.commentSessionController.clearDraftState(),
        setSavingDraftCommentId: (commentId) => this.commentSessionController.setSavingDraftCommentId(commentId),
        refreshCommentViews: () => this.workspaceViewController.refreshCommentViews(),
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
        isAllCommentsNotePath: (filePath) => this.isAllCommentsNotePath(filePath),
        isCommentableFile: (file): file is TFile => this.isCommentableFile(file),
        isMarkdownEditorFocused: (file) => this.workspaceViewController.isMarkdownEditorFocused(file),
        getCommentManager: () => this.commentManager,
        getAggregateCommentIndex: () => this.aggregateCommentIndex,
        createCommentId: () => generateCommentId(),
        hashText: (text) => generateHash(text),
        syncDerivedCommentLinksForFile: (file, noteContent, comments) =>
            this.derivedCommentMetadataManager.syncDerivedCommentLinksForFile(file, noteContent, comments),
        refreshCommentViews: () => this.workspaceViewController.refreshCommentViews(),
        refreshAllCommentsSidebarViews: () => this.workspaceViewController.refreshAllCommentsSidebarViews(),
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
        loadData: () => this.loadData(),
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
        deleteComment: (commentId: string, options?: { skipCommentViewRefresh?: boolean }): Promise<void> =>
            this.commentMutationController.deleteComment(commentId, options),
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
        ensureSidebarView: () => this.commentNavigationController.ensureSidebarView(),
        getCommentManager: () => this.commentManager,
        getAggregateCommentIndex: () => this.aggregateCommentIndex,
        clearParsedNoteCache: (filePath) => this.clearParsedNoteCache(filePath),
        clearDerivedCommentLinksForFile: (filePath) => this.derivedCommentMetadataManager.clearDerivedCommentLinksForFile(filePath),
        isCommentableFile: (file): file is TFile => this.isCommentableFile(file),
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
    private readonly pluginRegistrationController = new PluginRegistrationController({
        manifestId: this.manifest.id,
        iconId: SIDE_NOTE2_ICON_ID,
        registerView: (viewType, creator) => {
            this.registerView(viewType, (leaf) => creator(leaf) as SideNote2View);
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
        createSidebarView: (leaf) => new SideNote2View(leaf as WorkspaceLeaf, this),
        startDraftFromEditorSelection: (editor, file) =>
            this.commentEntryController.startDraftFromEditorSelection(editor as unknown as Editor, file),
        highlightCommentById: (filePath, commentId) => this.highlightCommentById(filePath, commentId),
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
        updateSidebarViews: (file) => this.updateSidebarViews(file),
        refreshEditorDecorations: () => this.refreshEditorDecorations(),
    });
    private activeMarkdownFile: TFile | null = null;
    private activeSidebarFile: TFile | null = null;
    private aggregateCommentIndex = new AggregateCommentIndex();
    private parsedNoteCache = new ParsedNoteCache(20);

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
        this.logService = new SideNote2LogService({
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
        addIcon(SIDE_NOTE2_ICON_ID, SIDE_NOTE2_ICON_SVG);
        addIcon(SIDE_NOTE2_REGENERATE_ICON_ID, SIDE_NOTE2_REGENERATE_ICON_SVG);

        this.commentManager = new CommentManager([]);
        await this.loadSettings();
        this.commentAgentController.initialize();
        await this.commentAgentController.reconcilePendingRunsFromPreviousSession();
        await this.logEvent("info", "startup", "startup.settings.loaded", {
            indexNotePath: this.getAllCommentsNotePath(),
        });
        this.derivedCommentMetadataManager.installMetadataCacheAugmentation();
        const activeFile = this.app.workspace.getActiveFile();
        this.workspaceContextController.initializeActiveFiles(activeFile);
        await this.workspaceViewController.loadVisibleFiles();

        this.registerEditorExtension([
            this.commentHighlightController.createLivePreviewManagedBlockPlugin(),
            this.commentHighlightController.createEditorHighlightPlugin(),
            this.commentHighlightController.createAllCommentsLivePreviewLinkPlugin(),
        ]);

        // Also highlight commented text inside rendered Markdown (Live Preview/Reading view)
        this.commentHighlightController.registerMarkdownPreviewHighlights(this);
        if (this.app.workspace.layoutReady) {
            await this.pluginLifecycleController.handleLayoutReady();
        } else {
            this.app.workspace.onLayoutReady(async () => {
                await this.pluginLifecycleController.handleLayoutReady();
            });
        }

        this.pluginRegistrationController.register();

        // Listen for active leaf changes to update the comment view
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                this.workspaceContextController.handleFileOpen(file);
            })
        );

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                this.workspaceContextController.handleActiveLeafChange(leaf);
            })
        );

        // Keep cached comment paths aligned with renamed notes.
        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                this.pluginLifecycleController.handleFileRename(file instanceof TFile ? file : null, oldPath);
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                this.pluginLifecycleController.handleFileDelete(file instanceof TFile ? file : null);
            })
        );

        // Keep in-memory comments in sync with their managed appendix section.
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                await this.pluginLifecycleController.handleFileModify(file instanceof TFile ? file : null);
            })
        );

        // Live editor change - refresh decorations while edits are in flight.
        this.registerEvent(
            this.app.workspace.on('editor-change', (_editor, info) => {
                this.pluginLifecycleController.handleEditorChange(info?.file?.path);
            })
        );

        this.addSettingTab(new SideNote2SettingTab(this.app, this));
    }

    onunload() {
        void this.logEvent("info", "startup", "startup.unload");
        disposeAgentRuntimeProcesses();
        this.commentAgentController.dispose();
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

    public async setRemoteRuntimeBearerToken(nextTokenInput: string): Promise<void> {
        const nextToken = normalizeRemoteRuntimeBearerToken(nextTokenInput);
        this.localSecretStore.writeSecrets({
            remoteRuntimeBearerToken: nextToken,
        });
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
        level: SideNote2LogLevel,
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

    public getRuntimeWorkingDirectory(filePath: string): string | null {
        if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
            return null;
        }

        const vaultRootPath = this.app.vault.adapter.getBasePath();
        const electronRequire = typeof window !== "undefined"
            ? (window as Window & {
                require?: (moduleName: string) => unknown;
            }).require
            : undefined;
        if (typeof electronRequire !== "function") {
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
     * Activate the SideNote2 view, highlight a specific comment, and focus the draft
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

    private async updateSidebarViews(file: TFile | null): Promise<void> {
        await this.commentNavigationController.updateSidebarViews(file);
    }

    public shouldShowResolvedComments(): boolean {
        return this.commentSessionController.shouldShowResolvedComments();
    }

    public async setShowResolvedComments(showResolved: boolean): Promise<boolean> {
        const changed = await this.commentSessionController.setShowResolvedComments(showResolved);
        if (!changed) {
            return false;
        }

        await this.refreshAggregateNoteNow();
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

    public async setShowDeletedComments(showDeleted: boolean): Promise<boolean> {
        return this.commentSessionController.setShowDeletedComments(showDeleted);
    }

    public async setShowNestedComments(showNested: boolean): Promise<boolean> {
        return this.commentSessionController.setShowNestedComments(showNested);
    }

    public async setShowNestedCommentsForThread(threadId: string, showNested: boolean): Promise<boolean> {
        return this.commentSessionController.setShowNestedCommentsForThread(threadId, showNested);
    }

    private async persistCommentsForFile(
        file: TFile,
        options: { immediateAggregateRefresh?: boolean } = {},
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

    private async highlightCommentById(filePath: string, commentId: string) {
        await this.ensureCommentSelectionVisible(commentId, filePath);
        await this.commentNavigationController.highlightCommentById(filePath, commentId);
    }

    private async openCommentById(filePath: string, commentId: string) {
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

    public updateDraftCommentBookmarkState(commentId: string, isBookmark: boolean) {
        this.commentSessionController.updateDraftCommentBookmarkState(commentId, isBookmark);
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
     * Activate the SideNote2 view - open it in the right sidebar if not already open
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
        await this.refreshAggregateNoteNow();

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

    async editComment(commentId: string, newCommentText: string): Promise<boolean> {
        return this.commentMutationController.editComment(commentId, newCommentText);
    }

    async deleteComment(commentId: string) {
        await this.commentAgentController.cancelRunsForComment(commentId);
        await this.commentMutationController.deleteComment(commentId);
    }

    async restoreComment(commentId: string) {
        await this.commentMutationController.restoreComment(commentId);
    }

    async clearDeletedCommentsForFile(filePath: string): Promise<boolean> {
        return this.commentMutationController.clearDeletedCommentsForFile(filePath);
    }

    async resolveComment(commentId: string) {
        await this.commentMutationController.resolveComment(commentId);
    }

    async unresolveComment(commentId: string) {
        await this.commentMutationController.unresolveComment(commentId);
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
            console.error("[SideNote2] Failed to reveal support log file location.", error);
            await this.logEvent("warn", "support", "support.log.file.location.open.error", {
                filePath: relativePath,
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

        new SupportLogInspectorModal(this.app, {
            fileName: "Log Inspector",
            logContent: "",
            locateLogFile,
        }).open();
    }
}
