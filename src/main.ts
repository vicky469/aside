import { addIcon, FileView, WorkspaceLeaf, TFile, MarkdownView, Notice, Plugin, normalizePath } from "obsidian";
import type { MarkdownViewModeType } from "obsidian";
import type { CachedMetadata } from "obsidian";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Range, StateEffect } from "@codemirror/state";
import { Comment, CommentManager } from "./commentManager";
import { getPageCommentLabel, isAnchoredComment, isPageComment } from "./core/commentAnchors";
import { DraftComment, DraftSelection } from "./domain/drafts";
import { parsePromptDeleteSetting } from "./core/appConfig";
import {
    buildAllCommentsNoteContent,
    findCommentLocationTargetInMarkdownLine,
    isAllCommentsNotePath,
    LEGACY_ALL_COMMENTS_NOTE_PATH,
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "./core/allCommentsNote";
import { buildAttachmentComments, parseAttachmentComments } from "./core/attachmentCommentStorage";
import { pickExactTextMatch, resolveAnchorRange } from "./core/anchorResolver";
import { isAttachmentCommentableFile, isAttachmentCommentablePath, isMarkdownCommentableFile, isSidebarSupportedFile, isSidebarSupportedPath } from "./core/commentableFiles";
import { buildDerivedCommentLinks, extractWikiLinkPaths } from "./core/commentMentions";
import { buildEditorHighlightRanges } from "./core/editorHighlightRanges";
import { chooseCommentStateForOpenEditor, shouldDeferManagedCommentPersist, syncLoadedCommentsForCurrentNote } from "./core/commentSyncPolicy";
import { AggregateCommentIndex } from "./index/AggregateCommentIndex";
import { ParsedNoteCache } from "./cache/ParsedNoteCache";
import { getManagedSectionEdit, getManagedSectionLineRange, getManagedSectionStartLine, parseNoteComments, ParsedNoteComments, serializeNoteComments, sortCommentsByPosition } from "./core/noteCommentStorage";
import SideNote2SettingTab, { DEFAULT_SETTINGS, SideNote2Settings } from "./ui/settings/SideNote2SettingTab";
import { SIDE_NOTE2_ICON_ID, SIDE_NOTE2_ICON_SVG } from "./ui/sideNote2Icon";
import SideNote2View from "./ui/views/SideNote2View";
import { debugCount, debugLog, initializeDebug, setDebugEnabled } from "./debug";

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

const forceHighlightRefreshEffect = StateEffect.define<null>();
const derivedMetadataCacheMarker = Symbol("sideNote2DerivedMetadata");

type MutableMetadataCache = {
    getCache(path: string): CachedMetadata | null;
    getFileCache(file: TFile): CachedMetadata | null;
    resolvedLinks: Record<string, Record<string, number>>;
    unresolvedLinks: Record<string, Record<string, number>>;
    trigger(name: string, ...data: unknown[]): void;
};

type DerivedMetadataCache = CachedMetadata & {
    [derivedMetadataCacheMarker]?: true;
};

type PersistedPluginData = Partial<SideNote2Settings> & {
    attachmentComments?: unknown;
};

// Main plugin class
export default class SideNote2 extends Plugin {
    commentManager: CommentManager;
    settings: SideNote2Settings = DEFAULT_SETTINGS;
    private editorUpdateTimers: Record<string, number> = {};
    private readonly duplicateAddWindowMs = 800;
    private lastAddFingerprint: { key: string; at: number } | null = null;
    private activeMarkdownFile: TFile | null = null;
    private activeSidebarFile: TFile | null = null;
    private draftComment: DraftComment | null = null;
    private draftHostFilePath: string | null = null;
    private savingDraftCommentId: string | null = null;
    private aggregateRefreshTimer: number | null = null;
    private aggregateRefreshPromise: Promise<void> | null = null;
    private aggregateRefreshQueued = false;
    private aggregateIndexInitialized = false;
    private aggregateIndexInitializationPromise: Promise<void> | null = null;
    private aggregateCommentIndex = new AggregateCommentIndex();
    private parsedNoteCache = new ParsedNoteCache(20);
    private readonly pendingCommentPersistTimers: Record<string, number> = {};
    private readonly derivedCommentLinksByFilePath = new Map<string, ReturnType<typeof buildDerivedCommentLinks>>();
    private readonly derivedCommentLinkSignaturesByFilePath = new Map<string, string>();
    private originalMetadataGetCache: ((path: string) => CachedMetadata | null) | null = null;
    private originalMetadataGetFileCache: ((file: TFile) => CachedMetadata | null) | null = null;
    private showResolvedComments = false;
    private revealedCommentState: { filePath: string; commentId: string } | null = null;
    private static readonly INDEX_NOTE_VIEW_CLASS = "sidenote2-index-note-view";

    async onload() {
        initializeDebug();
        debugLog("plugin.onload", { version: this.manifest.version });
        addIcon(SIDE_NOTE2_ICON_ID, SIDE_NOTE2_ICON_SVG);

        this.commentManager = new CommentManager([]);
        await this.loadSettings();
        setDebugEnabled(this.settings.enableDebugMode);
        this.installMetadataCacheAugmentation();
        const activeFile = this.app.workspace.getActiveFile();
        if (isMarkdownCommentableFile(activeFile, this.getAllCommentsNotePath())) {
            this.activeMarkdownFile = activeFile;
        }
        if (activeFile instanceof TFile && isSidebarSupportedPath(activeFile.path, this.getAllCommentsNotePath())) {
            this.activeSidebarFile = activeFile;
        }
        await this.loadVisibleFiles();

        this.registerEditorExtension([
            this.createLivePreviewManagedBlockPlugin(),
            this.createEditorHighlightPlugin(),
            this.createAllCommentsLivePreviewLinkPlugin(),
        ]);

        // Also highlight commented text inside rendered Markdown (Live Preview/Reading view)
        this.registerMarkdownPreviewHighlights();
        this.app.workspace.onLayoutReady(async () => {
            await this.refreshCommentViews();
            this.refreshEditorDecorations();
            this.scheduleAggregateNoteRefresh();
            this.syncIndexNoteViewClasses();
        });

        this.registerView("sidenote2-view", (leaf) => new SideNote2View(leaf, this));
        this.registerObsidianProtocolHandler("side-note2-comment", (params) => {
            const filePath = typeof params.file === "string" ? params.file : null;
            const commentId = typeof params.commentId === "string" ? params.commentId : null;
            if (!(filePath && commentId)) {
                return;
            }

            void this.openCommentById(filePath, commentId);
        });
        this.removeCommand(`${this.manifest.id}:activate-view`);

        this.addCommand({
            id: "add-comment-to-selection",
            name: "Add comment to selection",
            icon: SIDE_NOTE2_ICON_ID,
            editorCallback: async (editor, view) => {
                const file = view.file;
                const selection = editor.getSelection();
                if (!(file && selection.trim().length > 0)) {
                    new Notice("Please select some text to add a comment.");
                    return;
                }

                const cursorStart = editor.getCursor("from");
                const cursorEnd = editor.getCursor("to");
                await this.startNewCommentDraft({
                    file,
                    selectedText: selection,
                    startLine: cursorStart.line,
                    startChar: cursorStart.ch,
                    endLine: cursorEnd.line,
                    endChar: cursorEnd.ch,
                });
            },
        });

        // Add context menu item to editor
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                // Only add if selection exists
                if (editor.somethingSelected()) {
                    menu.addItem((item) => {
                        item.setTitle("Add comment to selection")
                            .setIcon(SIDE_NOTE2_ICON_ID)
                            .onClick(async () => {
                                const selection = editor.getSelection();
                                const file = view.file;

                                if (!(file && selection.trim().length > 0)) {
                                    new Notice("Please select some text to add a comment.");
                                    return;
                                }

                                const cursorStart = editor.getCursor("from");
                                const cursorEnd = editor.getCursor("to");
                                await this.startNewCommentDraft({
                                    file,
                                    selectedText: selection,
                                    startLine: cursorStart.line,
                                    startChar: cursorStart.ch,
                                    endLine: cursorEnd.line,
                                    endChar: cursorEnd.ch,
                                });
                            });
                    });
                }
            })
        );

        // Add ribbon icon to open SideNote2 in sidebar
        this.addRibbonIcon(SIDE_NOTE2_ICON_ID, "SideNote2: Open in Sidebar", () => {
            this.activateView();
        });

        // Listen for active leaf changes to update the comment view
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                void this.syncIndexNoteLeafMode(this.app.workspace.activeLeaf);
                this.syncIndexNoteViewClasses();

                const sidebarFile = isSidebarSupportedFile(file, this.getAllCommentsNotePath()) ? file : null;
                if (isMarkdownCommentableFile(file, this.getAllCommentsNotePath())) {
                    this.activeMarkdownFile = file;
                }
                this.activeSidebarFile = sidebarFile;

                const syncPromise = this.syncSidebarFile(sidebarFile);

                void syncPromise.finally(async () => {
                    await this.updateSidebarViews(sidebarFile);
                    this.refreshEditorDecorations();
                });
            })
        );

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                // Ignore focus changes inside the SideNote2 pane itself. Re-rendering on those
                // clicks recreates the row DOM and can eat the first action-menu click.
                if (leaf?.view instanceof SideNote2View) {
                    return;
                }

                const file = this.getFileForLeaf(leaf);
                void this.syncIndexNoteLeafMode(leaf);
                this.syncIndexNoteViewClasses();
                const sidebarFile = isSidebarSupportedFile(file, this.getAllCommentsNotePath()) ? file : null;
                if (isMarkdownCommentableFile(file, this.getAllCommentsNotePath())) {
                    this.activeMarkdownFile = file;
                }
                this.activeSidebarFile = sidebarFile;

                const syncPromise = this.syncSidebarFile(sidebarFile);

                void syncPromise.finally(async () => {
                    await this.updateSidebarViews(sidebarFile);
                    this.refreshEditorDecorations();
                });
            })
        );

        // Keep cached comment paths aligned with renamed notes.
        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                if (file instanceof TFile) {
                    this.commentManager.renameFile(oldPath, file.path);
                    this.clearParsedNoteCache(oldPath);
                    this.clearParsedNoteCache(file.path);
                    this.aggregateCommentIndex.renameFile(oldPath, file.path);
                    this.clearDerivedCommentLinksForFile(oldPath);
                    if (isAttachmentCommentablePath(oldPath) || isAttachmentCommentableFile(file)) {
                        void this.saveSettings();
                    }
                    void this.loadCommentsForFile(file);
                    // Update views
                    this.app.workspace.getLeavesOfType("sidenote2-view").forEach(leaf => {
                        if (leaf.view instanceof SideNote2View) {
                            void leaf.view.renderComments();
                        }
                    });
                    this.refreshEditorDecorations();
                    this.scheduleAggregateNoteRefresh();
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                if (!(file instanceof TFile) || !this.isCommentableFile(file)) {
                    return;
                }

                this.commentManager.replaceCommentsForFile(file.path, []);
                this.clearParsedNoteCache(file.path);
                this.aggregateCommentIndex.deleteFile(file.path);
                this.clearDerivedCommentLinksForFile(file.path);
                if (isAttachmentCommentableFile(file)) {
                    void this.saveSettings();
                }
                this.scheduleAggregateNoteRefresh();
            })
        );

        // Keep in-memory comments in sync with their managed appendix section.
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (!(file instanceof TFile) || file.extension !== 'md') {
                    return;
                }

                try {
                    const fileContent = await this.getCurrentNoteContent(file);
                    const parsed = await this.syncFileCommentsFromContent(file, fileContent);
                    const syncedComments = parsed.comments;
                    const rewrittenContent = serializeNoteComments(parsed.mainContent, syncedComments);

                    if (shouldDeferManagedCommentPersist({
                        isEditorFocused: this.isMarkdownEditorFocused(file),
                        fileContent,
                        rewrittenContent,
                    })) {
                        this.scheduleDeferredCommentPersist(file);
                        await this.refreshCommentViews();
                        this.refreshEditorDecorations();
                        this.scheduleAggregateNoteRefresh();
                        return;
                    }

                    if (rewrittenContent !== fileContent) {
                        await this.writeCommentsForFile(file);
                        return;
                    }

                    this.clearPendingCommentPersistTimer(file.path);
                    await this.refreshCommentViews();
                    this.refreshEditorDecorations();
                    this.scheduleAggregateNoteRefresh();
                } catch (error) {
                    console.error("Error syncing note-backed comments:", error);
                }
            })
        );

        // Live editor change - refresh decorations while edits are in flight.
        this.registerEvent(
            this.app.workspace.on('editor-change', (_editor, info) => {
                const filePath = info?.file?.path;
                if (!filePath) return;

                const run = () => {
                    try {
                        // Only refresh decorations here. Comment pruning happens on file modify,
                        // which avoids destructive deletes during an in-progress edit gesture.
                        this.refreshEditorDecorations();
                    } catch (e) {
                        console.warn('Failed to refresh decorations on editor-change', e);
                    }
                };

                // Debounce per file to avoid excessive work while typing
                if (this.editorUpdateTimers[filePath]) {
                    window.clearTimeout(this.editorUpdateTimers[filePath]);
                }
                this.editorUpdateTimers[filePath] = window.setTimeout(run, 250);
            })
        );

        this.addSettingTab(new SideNote2SettingTab(this.app, this));
    }

    onunload() {
        this.restoreMetadataCacheAugmentation();
        this.clearAllDerivedCommentLinks();
    }

    async loadSettings() {
        const loaded = await this.loadData() as PersistedPluginData | null;
        this.settings = {
            enableDebugMode: typeof loaded?.enableDebugMode === "boolean"
                ? loaded.enableDebugMode
                : DEFAULT_SETTINGS.enableDebugMode,
            indexNotePath: normalizeAllCommentsNotePath(loaded?.indexNotePath),
            indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(loaded?.indexHeaderImageUrl),
            indexHeaderImageCaption: Object.prototype.hasOwnProperty.call(loaded ?? {}, "indexHeaderImageCaption")
                ? normalizeAllCommentsNoteImageCaption(loaded?.indexHeaderImageCaption)
                : DEFAULT_SETTINGS.indexHeaderImageCaption,
        };

        const persistedAttachmentComments = parseAttachmentComments(loaded?.attachmentComments);
        const existingAttachmentCommentPaths = new Set(
            this.commentManager
                .getAllComments()
                .filter((comment) => isAttachmentCommentablePath(comment.filePath))
                .map((comment) => comment.filePath),
        );
        for (const filePath of existingAttachmentCommentPaths) {
            this.commentManager.replaceCommentsForFile(filePath, []);
        }
        for (const comment of persistedAttachmentComments) {
            const file = this.getFileByPath(comment.filePath);
            if (!isAttachmentCommentableFile(file)) {
                continue;
            }

            const nextComments = this.commentManager.getCommentsForFile(comment.filePath).concat(comment);
            this.commentManager.replaceCommentsForFile(comment.filePath, nextComments);
        }

        if (loaded && Object.prototype.hasOwnProperty.call(loaded, "confirmDelete")) {
            await this.saveSettings();
        }
    }

    async saveSettings() {
        await this.saveData({
            ...this.settings,
            attachmentComments: buildAttachmentComments(this.commentManager.getAllComments()),
        });
    }

    public getAllCommentsNotePath(): string {
        return normalizeAllCommentsNotePath(this.settings.indexNotePath);
    }

    public getIndexHeaderImageUrl(): string {
        return normalizeAllCommentsNoteImageUrl(this.settings.indexHeaderImageUrl);
    }

    public getIndexHeaderImageCaption(): string {
        return normalizeAllCommentsNoteImageCaption(this.settings.indexHeaderImageCaption);
    }

    public isAllCommentsNotePath(filePath: string): boolean {
        return isAllCommentsNotePath(filePath, this.getAllCommentsNotePath());
    }

    public async setIndexNotePath(nextPathInput: string): Promise<void> {
        const nextPath = normalizeAllCommentsNotePath(nextPathInput);
        const previousPath = this.getAllCommentsNotePath();
        if (nextPath === previousPath && this.settings.indexNotePath === nextPath) {
            return;
        }

        const parentPath = nextPath.includes("/")
            ? normalizePath(nextPath.split("/").slice(0, -1).join("/"))
            : "";
        if (parentPath) {
            const parent = this.app.vault.getAbstractFileByPath(parentPath);
            if (!parent) {
                new Notice(`Folder does not exist: ${parentPath}`);
                return;
            }
        }

        const currentIndexFile = this.getMarkdownFileByPath(previousPath)
            ?? this.getMarkdownFileByPath(LEGACY_ALL_COMMENTS_NOTE_PATH);
        const conflictingFile = this.getFileByPath(nextPath);
        if (conflictingFile && conflictingFile.path !== currentIndexFile?.path) {
            new Notice(`${nextPath} already exists. Choose another index note path.`);
            return;
        }

        this.settings.indexNotePath = nextPath;
        await this.saveSettings();

        if (currentIndexFile && currentIndexFile.path !== nextPath) {
            await this.app.fileManager.renameFile(currentIndexFile, nextPath);
        }

        if (this.activeSidebarFile && isAllCommentsNotePath(this.activeSidebarFile.path, previousPath)) {
            this.activeSidebarFile = this.getMarkdownFileByPath(nextPath);
        }

        if (this.draftHostFilePath && isAllCommentsNotePath(this.draftHostFilePath, previousPath)) {
            this.draftHostFilePath = nextPath;
        }

        await this.refreshAggregateNoteNow();
        await this.updateSidebarViews(this.getSidebarTargetFile());
    }

    public async setIndexHeaderImageUrl(nextUrlInput: string): Promise<void> {
        const nextUrl = normalizeAllCommentsNoteImageUrl(nextUrlInput);
        if (
            nextUrl === this.getIndexHeaderImageUrl() &&
            this.settings.indexHeaderImageUrl === nextUrl
        ) {
            return;
        }

        this.settings.indexHeaderImageUrl = nextUrl;
        await this.saveSettings();
        await this.refreshAggregateNoteNow();
    }

    public async setIndexHeaderImageCaption(nextCaptionInput: string): Promise<void> {
        const nextCaption = normalizeAllCommentsNoteImageCaption(nextCaptionInput);
        if (
            nextCaption === this.getIndexHeaderImageCaption() &&
            this.settings.indexHeaderImageCaption === nextCaption
        ) {
            return;
        }

        this.settings.indexHeaderImageCaption = nextCaption;
        await this.saveSettings();
        await this.refreshAggregateNoteNow();
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

    private setRevealedCommentState(filePath: string, commentId: string): void {
        if (
            this.revealedCommentState?.filePath === filePath &&
            this.revealedCommentState.commentId === commentId
        ) {
            return;
        }

        this.revealedCommentState = { filePath, commentId };
        this.refreshEditorDecorations();
        this.refreshMarkdownPreviews();
    }

    public getRevealedCommentId(filePath: string): string | null {
        return this.revealedCommentState?.filePath === filePath
            ? this.revealedCommentState.commentId
            : null;
    }

    /**
     * Activate the SideNote2 view, highlight a specific comment, and focus the draft
     */
    async activateViewAndHighlightComment(commentId: string) {
        const comment = this.draftComment?.id === commentId
            ? this.draftComment
            : this.getKnownCommentById(commentId);
        if (comment) {
            this.setRevealedCommentState(comment.filePath, comment.id);
        }

        // Skip view update if we have a draft (view was just refreshed by setDraftComment)
        const skipViewUpdate = this.draftComment !== null;
        await this.activateView(skipViewUpdate);
        // Find the SideNote2View, highlight and focus the comment
        const leaves = this.app.workspace.getLeavesOfType("sidenote2-view");
        for (const leaf of leaves) {
            if (leaf.view instanceof SideNote2View) {
                await leaf.view.highlightAndFocusDraft(commentId);
            }
        }
    }

    private getOpenSidebarFiles(): TFile[] {
        const files = new Map<string, TFile>();
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof FileView && isSidebarSupportedFile(leaf.view.file, this.getAllCommentsNotePath())) {
                files.set(leaf.view.file.path, leaf.view.file);
            }
        });
        return Array.from(files.values());
    }

    public getPinnedMarkdownFile(): TFile | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (isMarkdownCommentableFile(activeFile, this.getAllCommentsNotePath())) {
            return activeFile;
        }

        return this.activeMarkdownFile;
    }

    public getPinnedCommentableFile(): TFile | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (this.isCommentableFile(activeFile)) {
            return activeFile;
        }

        if (this.isCommentableFile(this.activeSidebarFile)) {
            return this.activeSidebarFile;
        }

        return this.activeMarkdownFile;
    }

    public getSidebarTargetFile(): TFile | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (isSidebarSupportedFile(activeFile, this.getAllCommentsNotePath())) {
            return activeFile;
        }

        return this.activeSidebarFile;
    }

    private getFileForLeaf(leaf: WorkspaceLeaf | null): TFile | null {
        return leaf?.view instanceof FileView && leaf.view.file instanceof TFile
            ? leaf.view.file
            : null;
    }

    public getPreferredFileLeaf(filePath?: string): WorkspaceLeaf | null {
        let matchedLeaf: WorkspaceLeaf | null = null;

        if (filePath) {
            this.app.workspace.iterateAllLeaves((leaf) => {
                if (matchedLeaf) {
                    return;
                }

                if (leaf.view instanceof FileView && leaf.view.file?.path === filePath) {
                    matchedLeaf = leaf;
                }
            });
        }

        if (matchedLeaf) {
            return matchedLeaf;
        }

        const activeLeaf = this.app.workspace.activeLeaf;
        if (activeLeaf?.view instanceof FileView && !(activeLeaf.view instanceof SideNote2View)) {
            return activeLeaf;
        }

        const recentLeaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
        if (recentLeaf?.view instanceof FileView && !(recentLeaf.view instanceof SideNote2View)) {
            return recentLeaf;
        }

        this.app.workspace.iterateAllLeaves((leaf) => {
            if (!matchedLeaf && leaf.view instanceof FileView && !(leaf.view instanceof SideNote2View)) {
                matchedLeaf = leaf;
            }
        });

        return matchedLeaf;
    }

    private getMarkdownViewForFile(file: TFile): MarkdownView | null {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView?.file?.path === file.path) {
            return activeView;
        }

        let matchedView: MarkdownView | null = null;
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (matchedView) {
                return;
            }

            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
                matchedView = leaf.view;
            }
        });

        return matchedView;
    }

    private async setLeafMarkdownMode(leaf: WorkspaceLeaf, mode: MarkdownViewModeType): Promise<void> {
        const viewState = leaf.getViewState();
        if (viewState.type !== "markdown") {
            return;
        }

        await leaf.setViewState({
            ...viewState,
            state: {
                ...(viewState.state ?? {}),
                mode,
                source: mode === "source",
            },
        });
        this.syncIndexNoteViewClasses();
    }

    private async syncIndexNoteLeafMode(leaf: WorkspaceLeaf | null): Promise<void> {
        if (!(leaf?.view instanceof MarkdownView)) {
            return;
        }

        const isIndexLeaf = this.isAllCommentsNotePath(leaf.view.file?.path ?? "");
        if (isIndexLeaf) {
            if (leaf.view.getMode() !== "preview") {
                await this.setLeafMarkdownMode(leaf, "preview");
            }
            return;
        }

        const viewState = leaf.getViewState();
        if (viewState.type !== "markdown") {
            return;
        }

        const isDefaultEditingMode = leaf.view.getMode() === "source" && viewState.state?.source !== true;
        if (isDefaultEditingMode) {
            return;
        }

        await leaf.setViewState({
            ...viewState,
            state: {
                ...(viewState.state ?? {}),
                mode: "source",
                source: false,
            },
        });
        this.syncIndexNoteViewClasses();
    }

    private syncIndexNoteViewClasses(): void {
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (!(leaf.view instanceof MarkdownView)) {
                return;
            }

            leaf.view.containerEl.classList.toggle(
                SideNote2.INDEX_NOTE_VIEW_CLASS,
                this.isAllCommentsNotePath(leaf.view.file?.path ?? ""),
            );
        });
    }

    private getMarkdownViewForEditorView(editorView: EditorView): MarkdownView | null {
        let matchedView: MarkdownView | null = null;
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (matchedView) {
                return;
            }

            if (leaf.view instanceof MarkdownView) {
                const cm = (leaf.view.editor as { cm?: EditorView } | null)?.cm;
                if (cm === editorView || leaf.view.contentEl.contains(editorView.dom)) {
                    matchedView = leaf.view;
                }
            }
        });

        return matchedView;
    }

    private clearPendingCommentPersistTimer(filePath: string) {
        const timer = this.pendingCommentPersistTimers[filePath];
        if (timer === undefined) {
            return;
        }

        window.clearTimeout(timer);
        delete this.pendingCommentPersistTimers[filePath];
    }

    private isMarkdownEditorFocused(file: TFile): boolean {
        const openView = this.getMarkdownViewForFile(file);
        if (!openView) {
            return false;
        }

        const cm = (openView.editor as { cm?: EditorView } | null)?.cm;
        if (cm?.hasFocus === true) {
            return true;
        }

        return !!document.activeElement && openView.contentEl.contains(document.activeElement);
    }

    private scheduleDeferredCommentPersist(file: TFile) {
        this.clearPendingCommentPersistTimer(file.path);
        this.pendingCommentPersistTimers[file.path] = window.setTimeout(() => {
            delete this.pendingCommentPersistTimers[file.path];
            void this.flushDeferredCommentPersist(file.path);
        }, 750);
    }

    private async flushDeferredCommentPersist(filePath: string): Promise<void> {
        const file = this.getMarkdownFileByPath(filePath);
        if (!file) {
            return;
        }

        if (this.isMarkdownEditorFocused(file)) {
            this.scheduleDeferredCommentPersist(file);
            return;
        }

        await this.writeCommentsForFile(file);
    }

    private isCommentableFile(file: TFile | null): file is TFile {
        return isMarkdownCommentableFile(file, this.getAllCommentsNotePath()) || isAttachmentCommentableFile(file);
    }

    private async getCurrentNoteContent(file: TFile): Promise<string> {
        const openView = this.getMarkdownViewForFile(file);
        if (openView) {
            return openView.editor.getValue();
        }

        return this.app.vault.cachedRead(file);
    }

    private async loadVisibleFiles() {
        const visibleFiles = this.getOpenSidebarFiles();
        for (const file of visibleFiles) {
            await this.syncSidebarFile(file);
        }

        const activeFile = this.app.workspace.getActiveFile();
        if (isSidebarSupportedFile(activeFile, this.getAllCommentsNotePath())) {
            await this.syncSidebarFile(activeFile);
        }
    }

    private async syncSidebarFile(file: TFile | null): Promise<void> {
        if (!file) {
            return;
        }

        if (this.isAllCommentsNotePath(file.path)) {
            await this.ensureIndexedCommentsLoaded();
            await this.refreshAggregateNoteNow();
            return;
        }

        await this.loadCommentsForFile(file);
    }

    private getParsedNoteComments(filePath: string, noteContent: string): ParsedNoteComments {
        return this.parsedNoteCache.getOrParse(filePath, noteContent, parseNoteComments);
    }

    private clearParsedNoteCache(filePath: string) {
        this.parsedNoteCache.clear(filePath);
    }

    private installMetadataCacheAugmentation() {
        if (this.originalMetadataGetCache && this.originalMetadataGetFileCache) {
            return;
        }

        const metadataCache = this.app.metadataCache as unknown as MutableMetadataCache;
        this.originalMetadataGetCache = metadataCache.getCache.bind(this.app.metadataCache);
        this.originalMetadataGetFileCache = metadataCache.getFileCache.bind(this.app.metadataCache);

        metadataCache.getCache = ((path: string) =>
            this.mergeDerivedLinksIntoCache(path, this.originalMetadataGetCache?.(path) ?? null)
        ) as MutableMetadataCache["getCache"];

        metadataCache.getFileCache = ((file: TFile) =>
            this.mergeDerivedLinksIntoCache(file.path, this.originalMetadataGetFileCache?.(file) ?? null)
        ) as MutableMetadataCache["getFileCache"];
    }

    private restoreMetadataCacheAugmentation() {
        const metadataCache = this.app.metadataCache as unknown as MutableMetadataCache;
        if (this.originalMetadataGetCache) {
            metadataCache.getCache = this.originalMetadataGetCache as MutableMetadataCache["getCache"];
            this.originalMetadataGetCache = null;
        }

        if (this.originalMetadataGetFileCache) {
            metadataCache.getFileCache = this.originalMetadataGetFileCache as MutableMetadataCache["getFileCache"];
            this.originalMetadataGetFileCache = null;
        }
    }

    private mergeDerivedLinksIntoCache(filePath: string, baseCache: CachedMetadata | null): CachedMetadata | null {
        const derivedLinks = this.derivedCommentLinksByFilePath.get(filePath);
        const derivedCache = baseCache as DerivedMetadataCache | null;
        if (!derivedLinks || derivedLinks.links.length === 0 || derivedCache?.[derivedMetadataCacheMarker]) {
            return baseCache;
        }

        const mergedCache: DerivedMetadataCache = {
            ...(baseCache ?? {}),
            links: [...(baseCache?.links ?? []), ...derivedLinks.links],
        };
        Object.defineProperty(mergedCache, derivedMetadataCacheMarker, {
            configurable: false,
            enumerable: false,
            value: true,
        });
        return mergedCache;
    }

    private clearAllDerivedCommentLinks() {
        const filePaths = Array.from(this.derivedCommentLinksByFilePath.keys());
        for (const filePath of filePaths) {
            this.clearDerivedCommentLinksForFile(filePath, false);
        }
    }

    private clearDerivedCommentLinksForFile(filePath: string, notify = true) {
        const previous = this.derivedCommentLinksByFilePath.get(filePath);
        if (!previous) {
            return;
        }

        this.mergeDerivedLinkCounts(
            (this.app.metadataCache as unknown as MutableMetadataCache).resolvedLinks,
            filePath,
            previous.resolved,
            {},
        );
        this.mergeDerivedLinkCounts(
            (this.app.metadataCache as unknown as MutableMetadataCache).unresolvedLinks,
            filePath,
            previous.unresolved,
            {},
        );
        this.derivedCommentLinksByFilePath.delete(filePath);
        this.derivedCommentLinkSignaturesByFilePath.delete(filePath);

        if (notify) {
            this.notifyDerivedLinksChanged(filePath);
        }
    }

    private syncDerivedCommentLinksForFile(file: TFile, noteContent: string, comments: Comment[]) {
        const nextDerivedLinks = buildDerivedCommentLinks(
            comments,
            noteContent,
            (linkPath, sourcePath) => {
                const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
                return linkedFile instanceof TFile ? linkedFile.path : null;
            },
        );
        const nextSignature = this.getDerivedCommentLinksSignature(nextDerivedLinks);
        const previousSignature = this.derivedCommentLinkSignaturesByFilePath.get(file.path) ?? "";
        if (nextSignature === previousSignature) {
            return;
        }

        const previousDerivedLinks = this.derivedCommentLinksByFilePath.get(file.path) ?? {
            links: [],
            resolved: {},
            unresolved: {},
        };

        this.mergeDerivedLinkCounts(
            (this.app.metadataCache as unknown as MutableMetadataCache).resolvedLinks,
            file.path,
            previousDerivedLinks.resolved,
            nextDerivedLinks.resolved,
        );
        this.mergeDerivedLinkCounts(
            (this.app.metadataCache as unknown as MutableMetadataCache).unresolvedLinks,
            file.path,
            previousDerivedLinks.unresolved,
            nextDerivedLinks.unresolved,
        );

        if (
            nextDerivedLinks.links.length === 0 &&
            Object.keys(nextDerivedLinks.resolved).length === 0 &&
            Object.keys(nextDerivedLinks.unresolved).length === 0
        ) {
            this.derivedCommentLinksByFilePath.delete(file.path);
            this.derivedCommentLinkSignaturesByFilePath.delete(file.path);
        } else {
            this.derivedCommentLinksByFilePath.set(file.path, nextDerivedLinks);
            this.derivedCommentLinkSignaturesByFilePath.set(file.path, nextSignature);
        }

        this.notifyDerivedLinksChanged(file.path);
    }

    private getDerivedCommentLinksSignature(derivedLinks: ReturnType<typeof buildDerivedCommentLinks>): string {
        const sortedResolved = Object.entries(derivedLinks.resolved).sort(([left], [right]) => left.localeCompare(right));
        const sortedUnresolved = Object.entries(derivedLinks.unresolved).sort(([left], [right]) => left.localeCompare(right));
        const linkEntries = derivedLinks.links.map((link) => ({
            link: link.link,
            original: link.original,
            displayText: link.displayText ?? "",
            line: link.position.start.line,
            col: link.position.start.col,
        }));

        return JSON.stringify({
            links: linkEntries,
            resolved: sortedResolved,
            unresolved: sortedUnresolved,
        });
    }

    private mergeDerivedLinkCounts(
        countsByFile: Record<string, Record<string, number>>,
        filePath: string,
        previousCounts: Record<string, number>,
        nextCounts: Record<string, number>,
    ) {
        const mergedCounts = { ...(countsByFile[filePath] ?? {}) };

        for (const [targetPath, count] of Object.entries(previousCounts)) {
            if (!(targetPath in mergedCounts)) {
                continue;
            }

            const nextCount = (mergedCounts[targetPath] ?? 0) - count;
            if (nextCount > 0) {
                mergedCounts[targetPath] = nextCount;
            } else {
                delete mergedCounts[targetPath];
            }
        }

        for (const [targetPath, count] of Object.entries(nextCounts)) {
            mergedCounts[targetPath] = (mergedCounts[targetPath] ?? 0) + count;
        }

        if (Object.keys(mergedCounts).length === 0) {
            delete countsByFile[filePath];
            return;
        }

        countsByFile[filePath] = mergedCounts;
    }

    private notifyDerivedLinksChanged(filePath: string) {
        const file = this.getMarkdownFileByPath(filePath);
        if (file) {
            this.app.metadataCache.trigger("resolve", file);
        }
        this.app.metadataCache.trigger("resolved");
    }

    private async ensureAggregateCommentIndexInitialized(): Promise<boolean> {
        if (this.aggregateIndexInitialized) {
            return false;
        }

        let initializedNow = false;
        if (!this.aggregateIndexInitializationPromise) {
            this.aggregateIndexInitializationPromise = (async () => {
                const markdownFiles = this.app.vault
                    .getMarkdownFiles()
                    .filter((file) => !this.isAllCommentsNotePath(file.path))
                    .sort((left, right) => left.path.localeCompare(right.path));

                for (const file of markdownFiles) {
                    const noteContent = await this.getCurrentNoteContent(file);
                    const parsed = await this.parseAndNormalizeFileComments(file.path, noteContent);
                    this.aggregateCommentIndex.updateFile(file.path, parsed.comments);
                }

                const attachmentCommentsByFile = new Map<string, Comment[]>();
                for (const comment of this.commentManager.getAllComments()) {
                    if (!isAttachmentCommentablePath(comment.filePath)) {
                        continue;
                    }

                    const existingComments = attachmentCommentsByFile.get(comment.filePath) ?? [];
                    existingComments.push(comment);
                    attachmentCommentsByFile.set(comment.filePath, existingComments);
                }

                for (const [filePath, comments] of Array.from(attachmentCommentsByFile.entries()).sort(([left], [right]) =>
                    left.localeCompare(right),
                )) {
                    this.aggregateCommentIndex.updateFile(filePath, comments);
                }

                this.aggregateIndexInitialized = true;
                initializedNow = true;
            })().finally(() => {
                this.aggregateIndexInitializationPromise = null;
            });
        }

        await this.aggregateIndexInitializationPromise;
        return initializedNow;
    }

    private async parseAndNormalizeFileComments(filePath: string, noteContent: string): Promise<ParsedNoteComments> {
        if (this.isAllCommentsNotePath(filePath)) {
            const parsed = this.getParsedNoteComments(filePath, noteContent);
            return {
                mainContent: parsed.mainContent,
                comments: [],
            };
        }

        const parsed = this.getParsedNoteComments(filePath, noteContent);
        const normalizedComments: Comment[] = [];

        for (const parsedComment of parsed.comments) {
            const comment = { ...parsedComment };
            if (!comment.id) {
                comment.id = generateCommentId();
            }
            comment.anchorKind = comment.anchorKind === "page" ? "page" : "selection";
            if (comment.anchorKind === "page") {
                comment.orphaned = false;
                if (!comment.selectedText) {
                    comment.selectedText = getPageCommentLabel(filePath);
                }
            } else {
                comment.orphaned = comment.orphaned === true;
            }
            if (!comment.selectedTextHash && comment.selectedText) {
                comment.selectedTextHash = await generateHash(comment.selectedText);
            }
            normalizedComments.push(comment);
        }

        return {
            mainContent: parsed.mainContent,
            comments: normalizedComments,
        };
    }

    private async syncFileCommentsFromContent(file: TFile, noteContent: string): Promise<{ mainContent: string; comments: Comment[] }> {
        const parsed = await this.parseAndNormalizeFileComments(file.path, noteContent);
        const syncedComments = await syncLoadedCommentsForCurrentNote(
            file.path,
            parsed.mainContent,
            parsed.comments,
            this.commentManager,
            this.aggregateCommentIndex,
        );
        this.syncDerivedCommentLinksForFile(file, parsed.mainContent, syncedComments);
        return {
            mainContent: parsed.mainContent,
            comments: syncedComments,
        };
    }

    async loadCommentsForFile(file: TFile | null): Promise<Comment[]> {
        if (!file || this.isAllCommentsNotePath(file.path) || !this.isCommentableFile(file)) {
            return [];
        }

        if (isAttachmentCommentableFile(file)) {
            const comments = this.commentManager.getCommentsForFile(file.path);
            this.aggregateCommentIndex.updateFile(file.path, comments);
            return comments;
        }

        const noteContent = await this.getCurrentNoteContent(file);
        const parsed = await this.syncFileCommentsFromContent(file, noteContent);
        return parsed.comments;
    }

    public async ensureIndexedCommentsLoaded(): Promise<void> {
        const initializedNow = await this.ensureAggregateCommentIndexInitialized();
        if (initializedNow) {
            await this.refreshAggregateNoteNow();
        }
    }

    private async updateSidebarViews(file: TFile | null): Promise<void> {
        const leaves = this.app.workspace.getLeavesOfType("sidenote2-view");
        for (const leaf of leaves) {
            if (leaf.view instanceof SideNote2View) {
                await leaf.view.updateActiveFile(file);
            }
        }
    }

    private async refreshCommentViews() {
        const leaves = this.app.workspace.getLeavesOfType("sidenote2-view");
        for (const leaf of leaves) {
            if (leaf.view instanceof SideNote2View) {
                await leaf.view.renderComments();
            }
        }
    }

    private refreshMarkdownPreviews() {
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (!(leaf.view instanceof MarkdownView) || leaf.view.getMode() !== "preview") {
                return;
            }

            leaf.view.previewMode.rerender(true);
        });
    }

    public shouldShowResolvedComments(): boolean {
        return this.showResolvedComments;
    }

    public async setShowResolvedComments(showResolved: boolean) {
        if (this.showResolvedComments === showResolved) {
            return;
        }

        this.showResolvedComments = showResolved;
        await this.refreshCommentViews();
        this.refreshEditorDecorations();
        this.refreshMarkdownPreviews();
    }

    private async writeCommentsForFile(
        file: TFile,
        options: { immediateAggregateRefresh?: boolean } = {},
    ): Promise<string> {
        this.clearPendingCommentPersistTimer(file.path);
        const comments = this.commentManager.getCommentsForFile(file.path);
        const openView = this.getMarkdownViewForFile(file);

        if (openView) {
            const currentContent = openView.editor.getValue();
            const nextContent = serializeNoteComments(currentContent, comments);
            if (currentContent !== nextContent) {
                const edit = getManagedSectionEdit(currentContent, comments);
                openView.editor.replaceRange(
                    edit.replacement,
                    openView.editor.offsetToPos(edit.fromOffset),
                    openView.editor.offsetToPos(edit.toOffset),
                );
            }
            await this.syncFileCommentsFromContent(file, nextContent);
            await this.refreshCommentViews();
            this.refreshEditorDecorations();
            if (options.immediateAggregateRefresh) {
                await this.refreshAggregateNoteNow();
            } else {
                this.scheduleAggregateNoteRefresh();
            }
            return nextContent;
        }

        const nextContent = await this.app.vault.process(file, (currentContent) =>
            serializeNoteComments(currentContent, comments)
        );
        await this.syncFileCommentsFromContent(file, nextContent);
        await this.refreshCommentViews();
        this.refreshEditorDecorations();
        if (options.immediateAggregateRefresh) {
            await this.refreshAggregateNoteNow();
        } else {
            this.scheduleAggregateNoteRefresh();
        }
        return nextContent;
    }

    private async persistCommentsForFile(
        file: TFile,
        options: { immediateAggregateRefresh?: boolean } = {},
    ): Promise<void> {
        if (isAttachmentCommentableFile(file)) {
            this.aggregateCommentIndex.updateFile(file.path, this.commentManager.getCommentsForFile(file.path));
            await this.saveSettings();
            await this.refreshCommentViews();
            this.refreshEditorDecorations();
            if (options.immediateAggregateRefresh) {
                await this.refreshAggregateNoteNow();
            } else {
                this.scheduleAggregateNoteRefresh();
            }
            return;
        }

        await this.writeCommentsForFile(file, options);
    }

    private getFileByPath(filePath: string): TFile | null {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        return file instanceof TFile ? file : null;
    }

    private getMarkdownFileByPath(filePath: string): TFile | null {
        const file = this.getFileByPath(filePath);
        return file?.extension === "md" ? file : null;
    }

    private scheduleAggregateNoteRefresh() {
        if (this.aggregateRefreshTimer !== null) {
            window.clearTimeout(this.aggregateRefreshTimer);
        }

        this.aggregateRefreshTimer = window.setTimeout(() => {
            this.aggregateRefreshTimer = null;
            void this.enqueueAggregateNoteRefresh();
        }, 150);
    }

    private async refreshAggregateNoteNow(): Promise<void> {
        if (this.aggregateRefreshTimer !== null) {
            window.clearTimeout(this.aggregateRefreshTimer);
            this.aggregateRefreshTimer = null;
        }

        await this.enqueueAggregateNoteRefresh();
    }

    private async enqueueAggregateNoteRefresh(): Promise<void> {
        if (this.aggregateRefreshPromise) {
            this.aggregateRefreshQueued = true;
            await this.aggregateRefreshPromise;
            return;
        }

        do {
            this.aggregateRefreshQueued = false;
            this.aggregateRefreshPromise = this.refreshAggregateNote();
            try {
                await this.aggregateRefreshPromise;
            } finally {
                this.aggregateRefreshPromise = null;
            }
        } while (this.aggregateRefreshQueued);
    }

    private async refreshAggregateNote() {
        await this.ensureAggregateCommentIndexInitialized();
        const comments = this.aggregateCommentIndex.getAllComments();
        const nextContent = buildAllCommentsNoteContent(this.app.vault.getName(), comments, {
            allCommentsNotePath: this.getAllCommentsNotePath(),
            headerImageUrl: this.getIndexHeaderImageUrl(),
            headerImageCaption: this.getIndexHeaderImageCaption(),
            getMentionedPageLabels: (comment) => this.getCommentMentionedPageLabels(comment),
        });
        const allCommentsNotePath = this.getAllCommentsNotePath();
        let existingFile = this.getMarkdownFileByPath(allCommentsNotePath);

        if (!existingFile) {
            const legacyFile = this.getMarkdownFileByPath(LEGACY_ALL_COMMENTS_NOTE_PATH);
            if (legacyFile) {
                await this.app.fileManager.renameFile(legacyFile, allCommentsNotePath);
                existingFile = this.getMarkdownFileByPath(allCommentsNotePath);
            }
        }

        if (!existingFile) {
            await this.app.vault.create(allCommentsNotePath, nextContent);
            return;
        }

        const currentContent = await this.getCurrentNoteContent(existingFile);
        const contentChanged = currentContent !== nextContent;

        const openView = this.getMarkdownViewForFile(existingFile);
        if (openView) {
            await this.syncIndexNoteLeafMode(openView.leaf);
            if (openView.getViewData() !== nextContent) {
                openView.setViewData(nextContent, false);
            }
            if (contentChanged) {
                await openView.save();
            }
            if (openView.getMode() === "preview") {
                openView.previewMode.rerender(true);
            }
        }

        if (!contentChanged) {
            return;
        }

        if (openView) {
            return;
        }

        await this.app.vault.modify(existingFile, nextContent);
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
        const file = this.getFileByPath(comment.filePath);
        if (!file) {
            new Notice("Unable to find that file.");
            return;
        }

        let targetLeaf = this.getPreferredFileLeaf(comment.filePath);
        if (!targetLeaf) {
            targetLeaf = this.app.workspace.getLeaf(false);
        }

        if (!targetLeaf) {
            new Notice("Failed to open that file.");
            return;
        }

        if (!(targetLeaf.view instanceof FileView) || targetLeaf.view.file?.path !== file.path) {
            await targetLeaf.openFile(file);
        }

        this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });

        if (isAttachmentCommentableFile(file)) {
            await this.activateViewAndHighlightComment(comment.id);
            return;
        }

        if (!(targetLeaf.view instanceof MarkdownView)) {
            await targetLeaf.openFile(file);
        }

        if (!(targetLeaf.view instanceof MarkdownView)) {
            new Notice("Failed to jump to Markdown view.");
            return;
        }

        const editor = targetLeaf.view.editor;
        if (isPageComment(comment)) {
            editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 0 });
            editor.scrollIntoView(
                {
                    from: { line: 0, ch: 0 },
                    to: { line: 0, ch: 0 },
                },
                true
            );
            editor.focus();
            await this.activateViewAndHighlightComment(comment.id);
            return;
        }

        const currentContent = editor.getValue();
        const parsed = parseNoteComments(currentContent, comment.filePath);
        const resolvedAnchor = resolveAnchorRange(parsed.mainContent, comment);

        if (resolvedAnchor) {
            editor.setSelection(
                { line: resolvedAnchor.startLine, ch: resolvedAnchor.startChar },
                { line: resolvedAnchor.startLine, ch: resolvedAnchor.startChar }
            );
            editor.scrollIntoView(
                {
                    from: { line: resolvedAnchor.startLine, ch: 0 },
                    to: { line: resolvedAnchor.endLine, ch: 0 },
                },
                true
            );
        } else {
            new Notice("Side note anchor text is missing; showing the stored location.");
            editor.scrollIntoView(
                {
                    from: { line: comment.startLine, ch: 0 },
                    to: { line: comment.startLine, ch: 0 },
                },
                true
            );
        }
        editor.focus();
        await this.activateViewAndHighlightComment(comment.id);
    }

    public clearRevealedCommentSelection(): void {
        const revealedCommentState = this.revealedCommentState;
        this.revealedCommentState = null;
        this.refreshEditorDecorations();
        this.refreshMarkdownPreviews();

        if (!revealedCommentState) {
            return;
        }

        const file = this.getMarkdownFileByPath(revealedCommentState.filePath);
        if (!(file instanceof TFile)) {
            return;
        }

        const markdownView = this.getMarkdownViewForFile(file);
        if (!markdownView) {
            return;
        }

        const editor = markdownView.editor;
        const cursor = editor.getCursor("to");
        editor.setSelection(cursor, cursor);
    }

    private async openCommentById(filePath: string, commentId: string) {
        const file = this.getFileByPath(filePath);
        if (!file) {
            new Notice("Unable to find that file.");
            return;
        }

        await this.loadCommentsForFile(file);
        const comment = this.commentManager.getCommentById(commentId);
        if (!comment || comment.filePath !== file.path) {
            new Notice("Unable to find that side comment.");
            return;
        }

        await this.revealComment(comment);
    }

    public getDraftForFile(filePath: string): DraftComment | null {
        return this.draftComment?.filePath === filePath ? this.draftComment : null;
    }

    public getDraftForView(filePath: string): DraftComment | null {
        return this.draftComment && this.draftHostFilePath === filePath
            ? this.draftComment
            : null;
    }

    public getAllIndexedComments(): Comment[] {
        return this.aggregateCommentIndex.getAllComments();
    }

    public isSavingDraft(commentId: string): boolean {
        return this.savingDraftCommentId === commentId;
    }

    public updateDraftCommentText(commentId: string, commentText: string) {
        if (this.draftComment?.id !== commentId) {
            return;
        }

        this.draftComment.comment = commentText;
    }

    public async cancelDraft(commentId?: string) {
        if (!this.draftComment) {
            return;
        }

        if (commentId && this.draftComment.id !== commentId) {
            return;
        }

        await this.setDraftComment(null);
    }

    public async startEditDraft(
        commentId: string,
        hostFilePath: string | null = this.getSidebarTargetFile()?.path ?? null,
    ) {
        const existingComment = this.getKnownCommentById(commentId);
        const file = existingComment ? this.getFileByPath(existingComment.filePath) : null;
        if (!existingComment || !file) {
            new Notice("Unable to find that side note.");
            return;
        }

        await this.loadCommentsForFile(file);
        const latestComment = this.commentManager.getCommentById(commentId);
        if (!latestComment) {
            new Notice("Unable to find that side note.");
            return;
        }

        await this.setDraftComment(
            {
                ...latestComment,
                mode: "edit",
            },
            hostFilePath ?? latestComment.filePath,
        );
        await this.activateViewAndHighlightComment(latestComment.id);
    }

    public async saveDraft(commentId: string) {
        const draft = this.draftComment;
        if (!draft || draft.id !== commentId || this.savingDraftCommentId === commentId) {
            return;
        }

        const commentBody = draft.comment.trim();
        if (!commentBody) {
            new Notice("Please enter a comment before saving.");
            return;
        }

        this.draftComment = {
            ...draft,
            comment: commentBody,
        };
        this.savingDraftCommentId = commentId;
        await this.refreshCommentViews();

        let saved = false;
        try {
            if (draft.mode === "new") {
                saved = await this.addComment(this.toPersistedComment(this.draftComment));
            } else {
                saved = await this.editComment(commentId, commentBody);
            }
        } finally {
            if (saved && this.draftComment?.id === commentId) {
                this.draftComment = null;
                this.draftHostFilePath = null;
            }
            this.savingDraftCommentId = null;
            await this.refreshCommentViews();
            this.refreshEditorDecorations();
        }
    }

    public async startPageCommentDraft(file: TFile | null = this.getPinnedCommentableFile()) {
        if (!this.isCommentableFile(file)) {
            new Notice(`Cannot add comments to ${this.getAllCommentsNotePath()}.`);
            return;
        }

        await this.startNewCommentDraft({
            file,
            selectedText: getPageCommentLabel(file.path),
            startLine: 0,
            startChar: 0,
            endLine: 0,
            endChar: 0,
            anchorKind: "page",
        });
    }

    private async startNewCommentDraft(selection: DraftSelection) {
        if (!this.isCommentableFile(selection.file)) {
            new Notice(`Cannot add comments to ${this.getAllCommentsNotePath()}.`);
            return;
        }
        if (selection.anchorKind !== "page" && !isMarkdownCommentableFile(selection.file, this.getAllCommentsNotePath())) {
            new Notice("Text-anchored side notes are only supported in markdown files.");
            return;
        }

        await this.loadCommentsForFile(selection.file);
        const draft: DraftComment = {
            id: generateCommentId(),
            filePath: selection.file.path,
            startLine: selection.startLine,
            startChar: selection.startChar,
            endLine: selection.endLine,
            endChar: selection.endChar,
            selectedText: selection.selectedText,
            selectedTextHash: await generateHash(selection.selectedText),
            comment: "",
            timestamp: Date.now(),
            anchorKind: selection.anchorKind === "page" ? "page" : "selection",
            orphaned: false,
            mode: "new",
        };

        if (isMarkdownCommentableFile(selection.file, this.getAllCommentsNotePath())) {
            this.activeMarkdownFile = selection.file;
        }
        this.activeSidebarFile = selection.file;
        await this.setDraftComment(draft, selection.file.path);
        await this.activateViewAndHighlightComment(draft.id);
    }

    private async setDraftComment(
        draftComment: DraftComment | null,
        hostFilePath: string | null = draftComment?.filePath ?? null,
    ) {
        this.draftComment = draftComment;
        this.draftHostFilePath = draftComment ? hostFilePath : null;
        await this.refreshCommentViews();
        this.refreshEditorDecorations();
    }

    private toPersistedComment(draftComment: DraftComment): Comment {
        const { mode: _mode, ...comment } = draftComment;
        return comment;
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
        const { workspace } = this.app;
        const sidebarFile = this.getSidebarTargetFile();

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType("sidenote2-view");

        if (leaves.length > 0) {
            // A leaf with our view already exists, use that
            leaf = leaves[0];
        } else {
            // Our view could not be found in the workspace, create a new leaf in the right sidebar
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                leaf = rightLeaf;
                await leaf.setViewState({
                    type: "sidenote2-view",
                    state: { filePath: sidebarFile?.path ?? null },
                    active: true,
                });
            }
        }

        // Reveal the leaf in case it's in a collapsed sidebar
        if (leaf) {
            workspace.revealLeaf(leaf);
            // Update to show comments for the current active file
            // Skip if the view was just refreshed (e.g., when adding a new comment)
            if (!skipViewUpdate && leaf.view instanceof SideNote2View) {
                await leaf.view.updateActiveFile(sidebarFile);
            }
        }
    }

    private createAddFingerprint(comment: Comment): string {
        return [
            comment.filePath,
            comment.anchorKind ?? "selection",
            comment.startLine,
            comment.startChar,
            comment.endLine,
            comment.endChar,
            comment.selectedText,
            comment.comment,
        ].join("|");
    }

    async addComment(newComment: Comment): Promise<boolean> {
        debugCount("addComment");
        debugLog("addComment", { filePath: newComment.filePath, id: newComment.id });
        if (this.isAllCommentsNotePath(newComment.filePath)) {
            new Notice(`Cannot add comments to ${this.getAllCommentsNotePath()}.`);
            return false;
        }

        const file = this.getFileByPath(newComment.filePath);
        if (!this.isCommentableFile(file)) {
            new Notice("Unable to find the note for this side note.");
            return false;
        }

        await this.loadCommentsForFile(file);
        const now = Date.now();
        const fingerprint = this.createAddFingerprint(newComment);
        if (
            this.lastAddFingerprint &&
            this.lastAddFingerprint.key === fingerprint &&
            now - this.lastAddFingerprint.at < this.duplicateAddWindowMs
        ) {
            return false;
        }
        this.lastAddFingerprint = { key: fingerprint, at: now };
        this.commentManager.addComment(newComment);
        await this.persistCommentsForFile(file, { immediateAggregateRefresh: true });
        return true;
    }

    async editComment(commentId: string, newCommentText: string): Promise<boolean> {
        debugCount("editComment");
        debugLog("editComment", { id: commentId, length: newCommentText.length });
        const existingComment = this.getKnownCommentById(commentId);
        const file = existingComment ? this.getFileByPath(existingComment.filePath) : null;
        if (!existingComment || !this.isCommentableFile(file)) {
            new Notice("Unable to find that side note.");
            return false;
        }

        await this.loadCommentsForFile(file);
        const latestComment = this.commentManager.getCommentById(commentId);
        if (!latestComment) {
            new Notice("Unable to find that side note.");
            return false;
        }
        this.commentManager.editComment(commentId, newCommentText);
        await this.persistCommentsForFile(file, { immediateAggregateRefresh: true });
        return true;
    }

    async deleteComment(commentId: string) {
        debugCount("deleteComment");
        debugLog("deleteComment", { id: commentId });
        const existingComment = this.getKnownCommentById(commentId);
        const file = existingComment ? this.getFileByPath(existingComment.filePath) : null;
        if (!existingComment || !this.isCommentableFile(file)) {
            new Notice("Unable to find that side note.");
            return;
        }

        await this.loadCommentsForFile(file);
        const latestComment = this.commentManager.getCommentById(commentId);
        if (!latestComment) {
            new Notice("Unable to find that side note.");
            return;
        }
        this.commentManager.deleteComment(commentId);
        await this.persistCommentsForFile(file, { immediateAggregateRefresh: true });
    }

    async resolveComment(commentId: string) {
        debugCount("resolveComment");
        debugLog("resolveComment", { id: commentId });
        const existingComment = this.getKnownCommentById(commentId);
        const file = existingComment ? this.getFileByPath(existingComment.filePath) : null;
        if (!existingComment || !this.isCommentableFile(file)) {
            new Notice("Unable to find that side note.");
            return;
        }

        await this.loadCommentsForFile(file);
        const latestComment = this.commentManager.getCommentById(commentId);
        if (!latestComment) {
            new Notice("Unable to find that side note.");
            return;
        }
        this.commentManager.resolveComment(commentId);
        await this.persistCommentsForFile(file, { immediateAggregateRefresh: true });
    }

    async unresolveComment(commentId: string) {
        debugCount("unresolveComment");
        debugLog("unresolveComment", { id: commentId });
        const existingComment = this.getKnownCommentById(commentId);
        const file = existingComment ? this.getFileByPath(existingComment.filePath) : null;
        if (!existingComment || !this.isCommentableFile(file)) {
            new Notice("Unable to find that side note.");
            return;
        }

        await this.loadCommentsForFile(file);
        const latestComment = this.commentManager.getCommentById(commentId);
        if (!latestComment) {
            new Notice("Unable to find that side note.");
            return;
        }
        this.commentManager.unresolveComment(commentId);
        await this.persistCommentsForFile(file, { immediateAggregateRefresh: true });
    }

    /**
     * Inject highlights into rendered Markdown (reading view only)
     * Skips Live Preview/editing modes to preserve context menu functionality.
     */
    private registerMarkdownPreviewHighlights() {
        this.registerMarkdownPostProcessor(async (element, context) => {
            // Only apply to Reading view (non-editing preview)
            // Live Preview editing mode preserves context menu through editor decorations
            const previewContainer = element.closest('.markdown-preview-view');
            if (!previewContainer) {
                return; // Not in Reading view, skip
            }

            const sectionInfo = context.getSectionInfo(element);
            if (!sectionInfo) {
                return;
            }

            const file = this.getMarkdownFileByPath(context.sourcePath);
            if (file) {
                const noteContent = await this.getCurrentNoteContent(file);
                const managedSectionStartLine = getManagedSectionStartLine(noteContent);
                if (managedSectionStartLine !== null && sectionInfo.lineStart >= managedSectionStartLine) {
                    element.remove();
                    return;
                }
            }

            const activeCommentId = this.getRevealedCommentId(context.sourcePath);
            const comments = this.commentManager
                .getCommentsForFile(context.sourcePath)
                .filter((comment) =>
                    isAnchoredComment(comment) &&
                    !!comment.selectedText &&
                    comment.startLine >= sectionInfo.lineStart &&
                    comment.endLine <= sectionInfo.lineEnd &&
                    (this.shouldShowResolvedComments() || !comment.resolved)
                );

            if (!comments.length) return;

            // Collect all text nodes with absolute offsets
            const textNodes: Array<{ node: Text; start: number; end: number }> = [];
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            let offset = 0;

            while (walker.nextNode()) {
                const node = walker.currentNode as Text;
                const value = node.nodeValue || "";
                if (!value.length) continue;
                const start = offset;
                const end = start + value.length;
                textNodes.push({ node, start, end });
                offset = end;
            }

            const fullText = textNodes.map(t => t.node.nodeValue || "").join("");
            if (!fullText.length) return;

            const wraps: Array<{ start: number; end: number; comment: Comment }> = [];

            for (const comment of comments) {
                const target = comment.selectedText;
                if (!target) continue;

                const sourceMatch = resolveAnchorRange(sectionInfo.text, {
                    startLine: comment.startLine - sectionInfo.lineStart,
                    startChar: comment.startChar,
                    endLine: comment.endLine - sectionInfo.lineStart,
                    endChar: comment.endChar,
                    selectedText: target,
                });
                const renderedMatch = pickExactTextMatch(fullText, target, {
                    occurrenceIndex: sourceMatch && sourceMatch.occurrenceIndex >= 0
                        ? sourceMatch.occurrenceIndex
                        : undefined,
                    hintOffset: sourceMatch?.startOffset,
                });
                if (!renderedMatch) continue;

                wraps.push({
                    start: renderedMatch.startOffset,
                    end: renderedMatch.endOffset,
                    comment,
                });
            }

            if (!wraps.length) return;

            // Helper to map absolute offset to text node and relative position
            const findPos = (absolute: number): { node: Text; offsetInNode: number } | null => {
                for (const entry of textNodes) {
                    if (absolute >= entry.start && absolute <= entry.end) {
                        return { node: entry.node, offsetInNode: absolute - entry.start };
                    }
                }
                return null;
            };

            // Apply from the end to avoid offset shifts as we wrap
            wraps.sort((a, b) => b.start - a.start);

            for (const wrap of wraps) {
                const startPos = findPos(wrap.start);
                const endPos = findPos(wrap.end);
                if (!startPos || !endPos) continue;

                try {
                    const range = document.createRange();
                    range.setStart(startPos.node, startPos.offsetInNode);
                    range.setEnd(endPos.node, endPos.offsetInNode);

                    const span = document.createElement('span');
                    span.classList.add('sidenote2-highlight', 'sidenote2-highlight-preview');
                    if (wrap.comment.resolved) {
                        span.classList.add('sidenote2-highlight-resolved');
                    }
                    if (wrap.comment.id === activeCommentId) {
                        span.classList.add('sidenote2-highlight-active');
                    }
                    span.dataset.commentId = wrap.comment.id;
                    span.addEventListener('click', (event: MouseEvent) => {
                        // Only handle primary button clicks; let other interactions (context menu, selections) flow
                        if (event.button !== 0) return;
                        void this.activateViewAndHighlightComment(wrap.comment.id);
                    });

                    // Ensure browser/Obsidian context menus still work on right-click
                    span.addEventListener('contextmenu', () => {
                        /* intentionally empty to keep default behavior */
                    });

                    range.surroundContents(span);
                } catch (e) {
                    // If the range crosses invalid boundaries, skip this wrap
                    console.warn('Failed to wrap preview highlight', e);
                    continue;
                }
            }
        });
    }

    private createLivePreviewManagedBlockPlugin() {
        const plugin = this;

        return ViewPlugin.fromClass(class {
            private readonly view: EditorView;
            private readonly observer: MutationObserver;

            constructor(view: EditorView) {
                this.view = view;
                this.observer = new MutationObserver(() => {
                    this.updateManagedBlockVisibility();
                });
                this.observer.observe(this.view.dom, {
                    childList: true,
                    subtree: true,
                });
                this.updateManagedBlockVisibility();
            }

            destroy() {
                this.clearManagedBlockClasses();
                this.observer.disconnect();
            }

            update(_update: ViewUpdate) {
                this.updateManagedBlockVisibility();
            }

            private clearManagedBlockClasses() {
                this.view.dom
                    .querySelectorAll(".sidenote2-managed-live-preview-line")
                    .forEach((line) => line.classList.remove("sidenote2-managed-live-preview-line"));
            }

            private updateManagedBlockVisibility() {
                this.clearManagedBlockClasses();

                const markdownView = plugin.getMarkdownViewForEditorView(this.view);
                if (!markdownView) {
                    return;
                }

                const isLivePreview = markdownView.getMode() === "source" && markdownView.getState().source !== true;
                if (!isLivePreview) {
                    return;
                }

                const lineRange = getManagedSectionLineRange(this.view.state.doc.toString());
                if (!lineRange) {
                    return;
                }

                this.view.dom.querySelectorAll(".cm-line").forEach((lineEl) => {
                    if (!(lineEl instanceof HTMLElement)) {
                        return;
                    }

                    let pos: number;
                    try {
                        pos = this.view.posAtDOM(lineEl, 0);
                    } catch {
                        return;
                    }

                    const safePos = Math.max(0, Math.min(pos, this.view.state.doc.length));
                    const lineNumber = this.view.state.doc.lineAt(safePos).number - 1;
                    if (lineNumber >= lineRange.startLine && lineNumber <= lineRange.endLine) {
                        lineEl.classList.add("sidenote2-managed-live-preview-line");
                    }
                });
            }
        });
    }

    private createEditorHighlightPlugin() {
        const plugin = this;

        return ViewPlugin.fromClass(class {
            decorations: DecorationSet;

            constructor(readonly view: EditorView) {
                this.decorations = this.buildDecorations();
            }

            update(update: ViewUpdate) {
                if (
                    update.docChanged ||
                    update.viewportChanged ||
                    update.transactions.some((tr) =>
                        tr.effects.some((effect) => effect.is(forceHighlightRefreshEffect))
                    )
                ) {
                    this.decorations = this.buildDecorations();
                }
            }

            private buildDecorations(): DecorationSet {
                const markdownView = plugin.getMarkdownViewForEditorView(this.view);
                const filePath = markdownView?.file?.path ?? null;
                if (!filePath || plugin.isAllCommentsNotePath(filePath)) {
                    return Decoration.none;
                }

                const doc = this.view.state.doc;
                const currentNoteText = doc.toString();
                const parsed = plugin.getParsedNoteComments(filePath, currentNoteText);
                const searchableText = parsed.mainContent;
                const decorations: Range<Decoration>[] = [];
                const storedComments = chooseCommentStateForOpenEditor(
                    plugin.commentManager.getCommentsForFile(filePath),
                    parsed.comments,
                );
                const draftComment = plugin.getDraftForFile(filePath);
                const showResolved = plugin.shouldShowResolvedComments();
                const ranges = buildEditorHighlightRanges(
                    currentNoteText,
                    searchableText,
                    storedComments,
                    draftComment,
                    showResolved,
                    plugin.getRevealedCommentId(filePath),
                );

                ranges.forEach((range) => {
                    const classes = ["sidenote2-highlight"];
                    if (range.resolved) {
                        classes.push("sidenote2-highlight-resolved");
                    }
                    if (range.active) {
                        classes.push("sidenote2-highlight-active");
                    }

                    decorations.push(
                        Decoration.mark({
                            class: classes.join(" "),
                            attributes: {
                                "data-comment-id": range.commentId,
                            },
                        }).range(range.from, range.to)
                    );
                });

                return Decoration.set(decorations, true);
            }
        }, {
            decorations: (value) => value.decorations,
        });
    }

    private createAllCommentsLivePreviewLinkPlugin() {
        const plugin = this;

        return EditorView.domEventHandlers({
            click(event, view) {
                if (
                    event.button !== 0
                    || event.metaKey
                    || event.ctrlKey
                    || event.shiftKey
                    || event.altKey
                ) {
                    return false;
                }

                const target = event.target;
                if (!(target instanceof HTMLElement)) {
                    return false;
                }

                const linkEl = target.closest(".cm-link");
                if (!(linkEl instanceof HTMLElement)) {
                    return false;
                }

                const markdownView = plugin.getMarkdownViewForEditorView(view);
                const filePath = markdownView?.file?.path ?? null;
                if (!filePath || !plugin.isAllCommentsNotePath(filePath)) {
                    return false;
                }

                const lineEl = linkEl.closest(".cm-line");
                if (!(lineEl instanceof HTMLElement)) {
                    return false;
                }

                let pos: number;
                try {
                    pos = view.posAtDOM(lineEl, 0);
                } catch {
                    return false;
                }

                const safePos = Math.max(0, Math.min(pos, view.state.doc.length));
                const lineText = view.state.doc.lineAt(safePos).text;
                const commentTarget = findCommentLocationTargetInMarkdownLine(lineText);
                if (!commentTarget) {
                    return false;
                }

                event.preventDefault();
                event.stopPropagation();
                void plugin.openCommentById(commentTarget.filePath, commentTarget.commentId);
                return true;
            },
        });
    }

    /**
     * Refresh editor-side highlight decorations after comment or draft changes.
     */
    refreshEditorDecorations() {
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (!(leaf.view instanceof MarkdownView)) {
                return;
            }

            const cm = (leaf.view.editor as { cm?: EditorView } | null)?.cm;
            if (!cm?.dispatch) {
                return;
            }

            cm.dispatch({
                effects: [forceHighlightRefreshEffect.of(null)],
            });
        });
    }
}
