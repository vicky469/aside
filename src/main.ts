import { addIcon, WorkspaceLeaf, TFile, Notice, Plugin, normalizePath, type Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { Comment, CommentManager } from "./commentManager";
import { CommentEntryController } from "./control/commentEntryController";
import { CommentHighlightController } from "./control/commentHighlightController";
import { CommentMutationController } from "./control/commentMutationController";
import { CommentNavigationController } from "./control/commentNavigationController";
import { pickPinnedCommentableFile, pickSidebarTargetFile } from "./control/commentNavigationPlanner";
import { CommentPersistenceController } from "./control/commentPersistenceController";
import { CommentSessionController } from "./control/commentSessionController";
import { IndexNoteSettingsController } from "./control/indexNoteSettingsController";
import { PluginLifecycleController } from "./control/pluginLifecycleController";
import { PluginRegistrationController } from "./control/pluginRegistrationController";
import { WorkspaceContextController } from "./control/workspaceContextController";
import { WorkspaceViewController } from "./control/workspaceViewController";
import { DraftComment } from "./domain/drafts";
import { parsePromptDeleteSetting } from "./core/config/appConfig";
import { DerivedCommentMetadataManager } from "./core/derived/derivedCommentMetadata";
import { isAttachmentCommentableFile, isAttachmentCommentablePath, isMarkdownCommentableFile, isSidebarSupportedFile } from "./core/rules/commentableFiles";
import { extractWikiLinkPaths } from "./core/text/commentMentions";
import { AggregateCommentIndex } from "./index/AggregateCommentIndex";
import { ParsedNoteCache } from "./cache/ParsedNoteCache";
import { parseNoteComments, ParsedNoteComments } from "./core/storage/noteCommentStorage";
import SideNote2SettingTab, { DEFAULT_SETTINGS, SideNote2Settings } from "./ui/settings/SideNote2SettingTab";
import { SIDE_NOTE2_ICON_ID, SIDE_NOTE2_ICON_SVG } from "./ui/sideNote2Icon";
import SideNote2View from "./ui/views/SideNote2View";
import { debugLog, initializeDebug, setDebugEnabled } from "./debug";

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

// Main plugin class
export default class SideNote2 extends Plugin {
    commentManager!: CommentManager;
    settings: SideNote2Settings = DEFAULT_SETTINGS;
    private readonly workspaceViewController = new WorkspaceViewController({
        app: this.app,
        isSidebarSupportedFile: (file): file is TFile => isSidebarSupportedFile(file, this.getAllCommentsNotePath()),
        isAllCommentsNotePath: (filePath) => this.isAllCommentsNotePath(filePath),
        ensureIndexedCommentsLoaded: () => this.ensureIndexedCommentsLoaded(),
        refreshAggregateNoteNow: () => this.refreshAggregateNoteNow(),
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
        isCommentableFile: (file): file is TFile => this.isCommentableFile(file),
        loadCommentsForFile: (file) => this.loadCommentsForFile(file),
        markDraftFileActive: (file) => this.markDraftFileActive(file),
        setDraftComment: (draftComment, hostFilePath) => this.commentSessionController.setDraftComment(draftComment, hostFilePath),
        activateViewAndHighlightComment: (commentId) => this.activateViewAndHighlightComment(commentId),
        createCommentId: () => generateCommentId(),
        hashText: (text) => generateHash(text),
        showNotice: (message) => {
            new Notice(message);
        },
    });
    private readonly commentHighlightController = new CommentHighlightController({
        app: this.app,
        getCommentsForFile: (filePath) => this.commentManager.getCommentsForFile(filePath),
        getMarkdownViewForEditorView: (editorView) => this.workspaceViewController.getMarkdownViewForEditorView(editorView),
        getMarkdownFileByPath: (path) => this.workspaceViewController.getMarkdownFileByPath(path),
        getCurrentNoteContent: (file) => this.workspaceViewController.getCurrentNoteContent(file),
        getParsedNoteComments: (filePath, noteContent) => this.getParsedNoteComments(filePath, noteContent),
        isAllCommentsNotePath: (path) => this.isAllCommentsNotePath(path),
        shouldShowResolvedComments: () => this.commentSessionController.shouldShowResolvedComments(),
        getDraftForFile: (filePath) => this.commentSessionController.getDraftForFile(filePath),
        getRevealedCommentId: (filePath) => this.commentSessionController.getRevealedCommentId(filePath),
        activateViewAndHighlightComment: (commentId) => this.activateViewAndHighlightComment(commentId),
    });
    private readonly commentMutationController = new CommentMutationController({
        getAllCommentsNotePath: () => this.getAllCommentsNotePath(),
        getSidebarTargetFilePath: () => this.getSidebarTargetFile()?.path ?? null,
        getDraftComment: () => this.commentSessionController.getDraftComment(),
        getSavingDraftCommentId: () => this.commentSessionController.getSavingDraftCommentId(),
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
        isCommentableFile: (file): file is TFile => this.isCommentableFile(file),
        loadCommentsForFile: (file) => this.loadCommentsForFile(file),
        persistCommentsForFile: (file, options) => this.persistCommentsForFile(file, options),
        getCommentManager: () => this.commentManager,
        activateViewAndHighlightComment: (commentId) => this.activateViewAndHighlightComment(commentId),
        showNotice: (message) => {
            new Notice(message);
        },
        now: () => Date.now(),
    });
    private readonly derivedCommentMetadataManager = new DerivedCommentMetadataManager(this.app);
    private readonly commentNavigationController = new CommentNavigationController({
        app: this.app,
        getSidebarTargetFile: () => this.getSidebarTargetFile(),
        getDraftComment: () => this.commentSessionController.getDraftComment(),
        getKnownCommentById: (commentId) => this.getKnownCommentById(commentId),
        setRevealedCommentState: (filePath, commentId) => this.commentSessionController.setRevealedCommentState(filePath, commentId),
        getFileByPath: (path) => this.workspaceViewController.getFileByPath(path),
        isCommentableFile: (file): file is TFile => this.isCommentableFile(file),
        loadCommentsForFile: (file) => this.loadCommentsForFile(file),
        getLoadedCommentById: (commentId) => this.commentManager.getCommentById(commentId),
        showNotice: (message) => {
            new Notice(message);
        },
    });
    private readonly commentPersistenceController = new CommentPersistenceController({
        app: this.app,
        getAllCommentsNotePath: () => this.getAllCommentsNotePath(),
        getIndexHeaderImageUrl: () => this.getIndexHeaderImageUrl(),
        getIndexHeaderImageCaption: () => this.getIndexHeaderImageCaption(),
        getMarkdownViewForFile: (file) => this.workspaceViewController.getMarkdownViewForFile(file),
        getMarkdownFileByPath: (filePath) => this.workspaceViewController.getMarkdownFileByPath(filePath),
        getCurrentNoteContent: (file) => this.workspaceViewController.getCurrentNoteContent(file),
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
        refreshEditorDecorations: () => this.refreshEditorDecorations(),
        getCommentMentionedPageLabels: (comment) => this.getCommentMentionedPageLabels(comment),
        syncIndexNoteLeafMode: (leaf) => this.syncIndexNoteLeafMode(leaf),
        saveSettings: () => this.saveSettings(),
    });
    private readonly indexNoteSettingsController = new IndexNoteSettingsController({
        app: this.app,
        getSettings: () => this.settings,
        setSettings: (settings) => {
            this.settings = settings;
        },
        getCommentManager: () => this.commentManager,
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
            new Notice(message);
        },
    });
    private readonly pluginLifecycleController = new PluginLifecycleController({
        app: this.app,
        getCommentManager: () => this.commentManager,
        getAggregateCommentIndex: () => this.aggregateCommentIndex,
        clearParsedNoteCache: (filePath) => this.clearParsedNoteCache(filePath),
        clearDerivedCommentLinksForFile: (filePath) => this.derivedCommentMetadataManager.clearDerivedCommentLinksForFile(filePath),
        isCommentableFile: (file): file is TFile => this.isCommentableFile(file),
        isAttachmentCommentableFile: (file): file is TFile => isAttachmentCommentableFile(file),
        isAttachmentCommentablePath: (filePath) => isAttachmentCommentablePath(filePath),
        saveSettings: () => this.saveSettings(),
        loadCommentsForFile: (file) => this.loadCommentsForFile(file),
        refreshCommentViews: () => this.workspaceViewController.refreshCommentViews(),
        refreshEditorDecorations: () => this.refreshEditorDecorations(),
        scheduleAggregateNoteRefresh: () => this.scheduleAggregateNoteRefresh(),
        syncIndexNoteViewClasses: () => this.syncIndexNoteViewClasses(),
        handleMarkdownFileModified: (file) => this.commentPersistenceController.handleMarkdownFileModified(file),
        scheduleTimer: (callback, ms) => window.setTimeout(callback, ms),
        clearTimer: (timerId) => window.clearTimeout(timerId),
        warn: (message, error) => {
            console.warn(message, error);
        },
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
        activateView: () => this.activateView(),
    });
    private readonly workspaceContextController = new WorkspaceContextController({
        app: this.app,
        getActiveMarkdownFile: () => this.activeMarkdownFile,
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
    async onload() {
        initializeDebug();
        debugLog("plugin.onload", { version: this.manifest.version });
        addIcon(SIDE_NOTE2_ICON_ID, SIDE_NOTE2_ICON_SVG);

        this.commentManager = new CommentManager([]);
        await this.loadSettings();
        setDebugEnabled(this.settings.enableDebugMode);
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
        this.app.workspace.onLayoutReady(async () => {
            await this.pluginLifecycleController.handleLayoutReady();
        });

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
        this.pluginLifecycleController.clearPendingEditorRefreshes();
        this.derivedCommentMetadataManager.restoreMetadataCacheAugmentation();
        this.derivedCommentMetadataManager.clearAllDerivedCommentLinks();
    }

    async loadSettings() {
        await this.indexNoteSettingsController.loadSettings();
    }

    async saveSettings() {
        await this.indexNoteSettingsController.saveSettings();
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

    public async shouldConfirmDelete(): Promise<boolean> {
        const appConfigPath = normalizePath(`${this.app.vault.configDir}/app.json`);

        try {
            if (!(await this.app.vault.adapter.exists(appConfigPath))) {
                return true;
            }

            const appConfig = await this.app.vault.adapter.read(appConfigPath);
            return parsePromptDeleteSetting(appConfig) ?? true;
        } catch (error) {
            console.warn("Failed to read Obsidian app config for promptDelete.", error);
            return true;
        }
    }

    public getRevealedCommentId(filePath: string): string | null {
        return this.commentSessionController.getRevealedCommentId(filePath);
    }

    /**
     * Activate the SideNote2 view, highlight a specific comment, and focus the draft
     */
    async activateViewAndHighlightComment(commentId: string) {
        await this.commentNavigationController.activateViewAndHighlightComment(commentId);
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
        return isMarkdownCommentableFile(file, this.getAllCommentsNotePath()) || isAttachmentCommentableFile(file);
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

    public async setShowResolvedComments(showResolved: boolean) {
        await this.commentSessionController.setShowResolvedComments(showResolved);
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
        await this.commentNavigationController.revealComment(comment);
    }

    public clearRevealedCommentSelection(): void {
        this.commentSessionController.clearRevealedCommentSelection();
    }

    private async highlightCommentById(filePath: string, commentId: string) {
        await this.commentNavigationController.highlightCommentById(filePath, commentId);
    }

    private async openCommentById(filePath: string, commentId: string) {
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
        await this.commentMutationController.startEditDraft(commentId, hostFilePath);
    }

    public async saveDraft(commentId: string) {
        await this.commentMutationController.saveDraft(commentId);
    }

    public async startPageCommentDraft(file: TFile | null = this.getPinnedCommentableFile()) {
        await this.commentEntryController.startPageCommentDraft(file);
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

    /**
     * Activate the SideNote2 view - open it in the right sidebar if not already open
     * @param skipViewUpdate If true, skips updating the view's active file (use when view was just refreshed)
     */
    async activateView(skipViewUpdate = false) {
        await this.commentNavigationController.activateView(skipViewUpdate);
    }

    async addComment(newComment: Comment): Promise<boolean> {
        return this.commentMutationController.addComment(newComment);
    }

    async editComment(commentId: string, newCommentText: string): Promise<boolean> {
        return this.commentMutationController.editComment(commentId, newCommentText);
    }

    async deleteComment(commentId: string) {
        await this.commentMutationController.deleteComment(commentId);
    }

    async resolveComment(commentId: string) {
        await this.commentMutationController.resolveComment(commentId);
    }

    async unresolveComment(commentId: string) {
        await this.commentMutationController.unresolveComment(commentId);
    }

    /**
     * Refresh editor-side highlight decorations after comment or draft changes.
     */
    refreshEditorDecorations() {
        this.commentHighlightController.refreshEditorDecorations();
    }
}
