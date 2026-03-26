import { addIcon, WorkspaceLeaf, TFile, MarkdownView, Notice, Plugin, normalizePath } from "obsidian";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Range, StateEffect } from "@codemirror/state";
import { Comment, CommentManager } from "./commentManager";
import { DraftComment, DraftSelection } from "./domain/drafts";
import { parsePromptDeleteSetting } from "./core/appConfig";
import { ALL_COMMENTS_NOTE_PATH, buildAllCommentsNoteContent, isAllCommentsNotePath, LEGACY_ALL_COMMENTS_NOTE_PATH } from "./core/allCommentsNote";
import { pickExactTextMatch, resolveAnchorRange } from "./core/anchorResolver";
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

// Main plugin class
export default class SideNote2 extends Plugin {
    commentManager: CommentManager;
    settings: SideNote2Settings = DEFAULT_SETTINGS;
    private editorUpdateTimers: Record<string, number> = {};
    private readonly duplicateAddWindowMs = 800;
    private lastAddFingerprint: { key: string; at: number } | null = null;
    private activeMarkdownFile: TFile | null = null;
    private draftComment: DraftComment | null = null;
    private savingDraftCommentId: string | null = null;
    private aggregateRefreshTimer: number | null = null;
    private aggregateIndexInitialized = false;
    private aggregateIndexInitializationPromise: Promise<void> | null = null;
    private aggregateCommentIndex = new AggregateCommentIndex();
    private parsedNoteCache = new ParsedNoteCache(20);
    private readonly pendingCommentPersistTimers: Record<string, number> = {};
    private showResolvedComments = false;

    async onload() {
        initializeDebug();
        debugLog("plugin.onload", { version: this.manifest.version });
        addIcon(SIDE_NOTE2_ICON_ID, SIDE_NOTE2_ICON_SVG);

        this.commentManager = new CommentManager([]);
        this.activeMarkdownFile = this.app.workspace.getActiveFile();
        await this.loadVisibleFiles();

        this.registerEditorExtension([
            this.createLivePreviewManagedBlockPlugin(),
            this.createEditorHighlightPlugin(),
        ]);

        // Also highlight commented text inside rendered Markdown (Live Preview/Reading view)
        this.registerMarkdownPreviewHighlights();
        this.app.workspace.onLayoutReady(async () => {
            await this.refreshCommentViews();
            this.refreshEditorDecorations();
            this.scheduleAggregateNoteRefresh();
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
                if (!(file instanceof TFile) || file.extension !== "md" || isAllCommentsNotePath(file.path)) {
                    return;
                }

                this.activeMarkdownFile = file;
                void this.loadCommentsForFile(file).finally(async () => {
                    await this.refreshCommentViews();
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

                const file = leaf && leaf.view instanceof MarkdownView && leaf.view.file && !isAllCommentsNotePath(leaf.view.file.path)
                    ? leaf.view.file
                    : null;
                if (!file) {
                    return;
                }

                this.activeMarkdownFile = file;
                void this.loadCommentsForFile(file).finally(async () => {
                    const leaves = this.app.workspace.getLeavesOfType("sidenote2-view");
                    for (const sideNoteLeaf of leaves) {
                        if (sideNoteLeaf.view instanceof SideNote2View) {
                            await sideNoteLeaf.view.updateActiveFile(file);
                        }
                    }
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
                if (!(file instanceof TFile) || file.extension !== "md") {
                    return;
                }

                this.commentManager.replaceCommentsForFile(file.path, []);
                this.clearParsedNoteCache(file.path);
                this.aggregateCommentIndex.deleteFile(file.path);
                this.scheduleAggregateNoteRefresh();
            })
        );

        // Keep in-memory comments in sync with their managed appendix section.
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (!(file instanceof TFile) || file.extension !== 'md' || isAllCommentsNotePath(file.path)) {
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

        // Load settings
        await this.loadSettings();
        setDebugEnabled(this.settings.enableDebugMode);
        this.addSettingTab(new SideNote2SettingTab(this.app, this));
    }

    async loadSettings() {
        const loaded = await this.loadData() as Partial<SideNote2Settings> | null;
        this.settings = {
            enableDebugMode: typeof loaded?.enableDebugMode === "boolean"
                ? loaded.enableDebugMode
                : DEFAULT_SETTINGS.enableDebugMode,
        };

        if (loaded && Object.prototype.hasOwnProperty.call(loaded, "confirmDelete")) {
            await this.saveSettings();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
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

    /**
     * Activate the SideNote2 view, highlight a specific comment, and focus the draft
     */
    async activateViewAndHighlightComment(commentId: string) {
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

    private getOpenMarkdownFiles(): TFile[] {
        const files = new Map<string, TFile>();
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView && leaf.view.file) {
                files.set(leaf.view.file.path, leaf.view.file);
            }
        });
        return Array.from(files.values());
    }

    public getPinnedMarkdownFile(): TFile | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile instanceof TFile && activeFile.extension === "md" && !isAllCommentsNotePath(activeFile.path)) {
            return activeFile;
        }

        return this.activeMarkdownFile;
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
        return !!file && file.extension === "md" && !isAllCommentsNotePath(file.path);
    }

    private async getCurrentNoteContent(file: TFile): Promise<string> {
        const openView = this.getMarkdownViewForFile(file);
        if (openView) {
            return openView.editor.getValue();
        }

        return this.app.vault.cachedRead(file);
    }

    private async loadVisibleFiles() {
        const visibleFiles = this.getOpenMarkdownFiles();
        for (const file of visibleFiles) {
            await this.loadCommentsForFile(file);
        }

        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            await this.loadCommentsForFile(activeFile);
        }
    }

    private getParsedNoteComments(filePath: string, noteContent: string): ParsedNoteComments {
        return this.parsedNoteCache.getOrParse(filePath, noteContent, parseNoteComments);
    }

    private clearParsedNoteCache(filePath: string) {
        this.parsedNoteCache.clear(filePath);
    }

    private async ensureAggregateCommentIndexInitialized() {
        if (this.aggregateIndexInitialized) {
            return;
        }

        if (!this.aggregateIndexInitializationPromise) {
            this.aggregateIndexInitializationPromise = (async () => {
                const markdownFiles = this.app.vault
                    .getMarkdownFiles()
                    .filter((file) => !isAllCommentsNotePath(file.path))
                    .sort((left, right) => left.path.localeCompare(right.path));

                for (const file of markdownFiles) {
                    const noteContent = await this.getCurrentNoteContent(file);
                    const parsed = await this.parseAndNormalizeFileComments(file.path, noteContent);
                    this.aggregateCommentIndex.updateFile(file.path, parsed.comments);
                }

                this.aggregateIndexInitialized = true;
            })().finally(() => {
                this.aggregateIndexInitializationPromise = null;
            });
        }

        await this.aggregateIndexInitializationPromise;
    }

    private async parseAndNormalizeFileComments(filePath: string, noteContent: string): Promise<ParsedNoteComments> {
        if (isAllCommentsNotePath(filePath)) {
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
        return {
            mainContent: parsed.mainContent,
            comments: syncedComments,
        };
    }

    async loadCommentsForFile(file: TFile | null): Promise<Comment[]> {
        if (!file || file.extension !== "md") {
            return [];
        }

        const noteContent = await this.getCurrentNoteContent(file);
        const parsed = await this.syncFileCommentsFromContent(file, noteContent);
        return parsed.comments;
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

    private async writeCommentsForFile(file: TFile): Promise<string> {
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
            this.scheduleAggregateNoteRefresh();
            return nextContent;
        }

        const nextContent = await this.app.vault.process(file, (currentContent) =>
            serializeNoteComments(currentContent, comments)
        );
        await this.syncFileCommentsFromContent(file, nextContent);
        await this.refreshCommentViews();
        this.refreshEditorDecorations();
        this.scheduleAggregateNoteRefresh();
        return nextContent;
    }

    private async persistCommentsForFile(file: TFile): Promise<void> {
        await this.writeCommentsForFile(file);
    }

    private getMarkdownFileByPath(filePath: string): TFile | null {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        return file instanceof TFile ? file : null;
    }

    private scheduleAggregateNoteRefresh() {
        if (this.aggregateRefreshTimer !== null) {
            window.clearTimeout(this.aggregateRefreshTimer);
        }

        this.aggregateRefreshTimer = window.setTimeout(() => {
            this.aggregateRefreshTimer = null;
            void this.refreshAggregateNote();
        }, 150);
    }

    private async refreshAggregateNote() {
        await this.ensureAggregateCommentIndexInitialized();
        const comments = this.aggregateCommentIndex.getAllComments();
        const nextContent = buildAllCommentsNoteContent(this.app.vault.getName(), comments);
        let existingFile = this.getMarkdownFileByPath(ALL_COMMENTS_NOTE_PATH);

        if (!existingFile) {
            const legacyFile = this.getMarkdownFileByPath(LEGACY_ALL_COMMENTS_NOTE_PATH);
            if (legacyFile) {
                await this.app.fileManager.renameFile(legacyFile, ALL_COMMENTS_NOTE_PATH);
                existingFile = this.getMarkdownFileByPath(ALL_COMMENTS_NOTE_PATH);
            }
        }

        if (!existingFile) {
            await this.app.vault.create(ALL_COMMENTS_NOTE_PATH, nextContent);
            return;
        }

        const currentContent = await this.getCurrentNoteContent(existingFile);
        if (currentContent === nextContent) {
            return;
        }

        const openView = this.getMarkdownViewForFile(existingFile);
        if (openView) {
            openView.editor.setValue(nextContent);
        }

        await this.app.vault.modify(existingFile, nextContent);
    }

    public async revealComment(comment: Comment) {
        let targetLeaf: WorkspaceLeaf | null = null;
        this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === comment.filePath) {
                targetLeaf = leaf;
                return false;
            }
        });

        if (!targetLeaf) {
            const file = this.getMarkdownFileByPath(comment.filePath);
            if (file instanceof TFile) {
                const newLeaf = this.app.workspace.getLeaf(true);
                await newLeaf.openFile(file);
                targetLeaf = newLeaf;
            }
        }

        if (!(targetLeaf && targetLeaf.view instanceof MarkdownView)) {
            new Notice("Failed to jump to Markdown view.");
            return;
        }

        this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
        const editor = targetLeaf.view.editor;
        editor.setSelection(
            { line: comment.startLine, ch: comment.startChar },
            { line: comment.endLine, ch: comment.endChar }
        );
        editor.scrollIntoView(
            {
                from: { line: comment.startLine, ch: 0 },
                to: { line: comment.endLine, ch: 0 },
            },
            true
        );
        editor.focus();
        await this.activateViewAndHighlightComment(comment.id);
    }

    private async openCommentById(filePath: string, commentId: string) {
        const file = this.getMarkdownFileByPath(filePath);
        if (!file) {
            new Notice("Unable to find that note.");
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

    public async startEditDraft(commentId: string) {
        const existingComment = this.commentManager.getCommentById(commentId);
        const file = existingComment ? this.getMarkdownFileByPath(existingComment.filePath) : null;
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

        await this.setDraftComment({
            ...latestComment,
            mode: "edit",
        });
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
            }
            this.savingDraftCommentId = null;
            await this.refreshCommentViews();
            this.refreshEditorDecorations();
        }
    }

    private async startNewCommentDraft(selection: DraftSelection) {
        if (!this.isCommentableFile(selection.file)) {
            new Notice(`Cannot add comments to ${ALL_COMMENTS_NOTE_PATH}.`);
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
            mode: "new",
        };

        this.activeMarkdownFile = selection.file;
        await this.setDraftComment(draft);
        await this.activateViewAndHighlightComment(draft.id);
    }

    private async setDraftComment(draftComment: DraftComment | null) {
        this.draftComment = draftComment;
        await this.refreshCommentViews();
        this.refreshEditorDecorations();
    }

    private toPersistedComment(draftComment: DraftComment): Comment {
        const { mode: _mode, ...comment } = draftComment;
        return comment;
    }

    /**
     * Activate the SideNote2 view - open it in the right sidebar if not already open
     * @param skipViewUpdate If true, skips updating the view's active file (use when view was just refreshed)
     */
    async activateView(skipViewUpdate = false) {
        const { workspace } = this.app;
        const pinnedFile = this.getPinnedMarkdownFile();

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
                    state: { filePath: pinnedFile?.path ?? null },
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
                await leaf.view.updateActiveFile(pinnedFile);
            }
        }
    }

    private createAddFingerprint(comment: Comment): string {
        return [
            comment.filePath,
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
        if (isAllCommentsNotePath(newComment.filePath)) {
            new Notice(`Cannot add comments to ${ALL_COMMENTS_NOTE_PATH}.`);
            return false;
        }

        const file = this.getMarkdownFileByPath(newComment.filePath);
        if (!file) {
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
        await this.persistCommentsForFile(file);
        return true;
    }

    async editComment(commentId: string, newCommentText: string): Promise<boolean> {
        debugCount("editComment");
        debugLog("editComment", { id: commentId, length: newCommentText.length });
        const existingComment = this.commentManager.getCommentById(commentId);
        const file = existingComment ? this.getMarkdownFileByPath(existingComment.filePath) : null;
        if (!existingComment || !file) {
            new Notice("Unable to find that side note.");
            return false;
        }

        await this.loadCommentsForFile(file);
        this.commentManager.editComment(commentId, newCommentText);
        await this.persistCommentsForFile(file);
        return true;
    }

    async deleteComment(commentId: string) {
        debugCount("deleteComment");
        debugLog("deleteComment", { id: commentId });
        const existingComment = this.commentManager.getCommentById(commentId);
        const file = existingComment ? this.getMarkdownFileByPath(existingComment.filePath) : null;
        if (!existingComment || !file) {
            new Notice("Unable to find that side note.");
            return;
        }

        await this.loadCommentsForFile(file);
        this.commentManager.deleteComment(commentId);
        await this.persistCommentsForFile(file);
    }

    async resolveComment(commentId: string) {
        debugCount("resolveComment");
        debugLog("resolveComment", { id: commentId });
        const existingComment = this.commentManager.getCommentById(commentId);
        const file = existingComment ? this.getMarkdownFileByPath(existingComment.filePath) : null;
        if (!existingComment || !file) {
            new Notice("Unable to find that side note.");
            return;
        }

        await this.loadCommentsForFile(file);
        this.commentManager.resolveComment(commentId);
        await this.persistCommentsForFile(file);
    }

    async unresolveComment(commentId: string) {
        debugCount("unresolveComment");
        debugLog("unresolveComment", { id: commentId });
        const existingComment = this.commentManager.getCommentById(commentId);
        const file = existingComment ? this.getMarkdownFileByPath(existingComment.filePath) : null;
        if (!existingComment || !file) {
            new Notice("Unable to find that side note.");
            return;
        }

        await this.loadCommentsForFile(file);
        this.commentManager.unresolveComment(commentId);
        await this.persistCommentsForFile(file);
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

            const comments = this.commentManager
                .getCommentsForFile(context.sourcePath)
                .filter((comment) =>
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
                if (!filePath || isAllCommentsNotePath(filePath)) {
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
                );

                ranges.forEach((range) => {
                    const classes = ["sidenote2-highlight"];
                    if (range.resolved) {
                        classes.push("sidenote2-highlight-resolved");
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
