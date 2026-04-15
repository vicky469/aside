import { MarkdownView, TFile, type WorkspaceLeaf } from "obsidian";
import type { Plugin } from "obsidian";
import type { Comment, CommentManager, CommentThread } from "../commentManager";
import { threadToComment } from "../commentManager";
import { getPageCommentLabel } from "../core/anchors/commentAnchors";
import {
    type AllCommentsNoteBuildOptions,
    buildAllCommentsNoteContent,
    LEGACY_ALL_COMMENTS_NOTE_PATH,
} from "../core/derived/allCommentsNote";
import {
    isAttachmentCommentableFile,
    isAttachmentCommentablePath,
} from "../core/rules/commentableFiles";
import {
    shouldDeferManagedCommentPersist,
    syncLoadedCommentsForCurrentNote,
} from "../core/rules/commentSyncPolicy";
import {
    getManagedSectionEditForThreads,
    getManagedSectionKind,
    serializeNoteCommentThreads,
    type ParsedNoteComments,
} from "../core/storage/noteCommentStorage";
import { remapSelectionOffsetAfterManagedSectionEdit } from "../core/text/editOffsets";
import type { AggregateCommentIndex } from "../index/AggregateCommentIndex";
import { shouldSkipAggregateViewRefresh } from "./commentPersistencePlanner";

type PersistOptions = {
    immediateAggregateRefresh?: boolean;
};

type SyncedFileComments = {
    mainContent: string;
    threads: CommentThread[];
    comments: Comment[];
};

export interface CommentPersistenceHost {
    app: Plugin["app"];
    getAllCommentsNotePath(): string;
    getIndexHeaderImageUrl(): string;
    getIndexHeaderImageCaption(): string;
    shouldShowResolvedComments(): boolean;
    getMarkdownViewForFile(file: TFile): MarkdownView | null;
    getMarkdownFileByPath(filePath: string): TFile | null;
    getCurrentNoteContent(file: TFile): Promise<string>;
    getParsedNoteComments(filePath: string, noteContent: string): ParsedNoteComments;
    isAllCommentsNotePath(filePath: string): boolean;
    isCommentableFile(file: TFile | null): file is TFile;
    isMarkdownEditorFocused(file: TFile): boolean;
    getCommentManager(): CommentManager;
    getAggregateCommentIndex(): AggregateCommentIndex;
    createCommentId(): string;
    hashText(text: string): Promise<string>;
    syncDerivedCommentLinksForFile(file: TFile, noteContent: string, comments: Comment[]): void;
    refreshCommentViews(): Promise<void>;
    refreshEditorDecorations(): void;
    getCommentMentionedPageLabels(comment: Comment): string[];
    syncIndexNoteLeafMode(leaf: WorkspaceLeaf | null): Promise<void>;
    saveSettings(): Promise<void>;
    log?(level: "info" | "warn" | "error", area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
}

export class CommentPersistenceController {
    private readonly pendingCommentPersistTimers: Record<string, number> = {};
    private aggregateRefreshTimer: number | null = null;
    private aggregateRefreshPromise: Promise<void> | null = null;
    private aggregateRefreshQueued = false;
    private aggregateIndexInitialized = false;
    private aggregateIndexInitializationPromise: Promise<void> | null = null;

    constructor(private readonly host: CommentPersistenceHost) {}

    public async handleMarkdownFileModified(file: TFile): Promise<void> {
        if (file.extension !== "md") {
            return;
        }

        try {
            const fileContent = await this.host.getCurrentNoteContent(file);
            const parsed = await this.syncFileCommentsFromContent(file, fileContent);
            const rewrittenContent = serializeNoteCommentThreads(parsed.mainContent, parsed.threads);

            if (shouldDeferManagedCommentPersist({
                isEditorFocused: this.host.isMarkdownEditorFocused(file),
                fileContent,
                rewrittenContent,
            })) {
                void this.host.log?.("warn", "persistence", "storage.note.write.conflict", {
                    filePath: file.path,
                });
                this.scheduleDeferredCommentPersist(file);
                await this.afterCommentsChanged();
                return;
            }

            if (rewrittenContent !== fileContent) {
                await this.writeCommentsForFile(file);
                return;
            }

            this.clearPendingCommentPersistTimer(file.path);
            await this.afterCommentsChanged();
        } catch (error) {
            console.error("Error syncing note-backed comments:", error);
            void this.host.log?.("error", "persistence", "storage.note.write.error", {
                filePath: file.path,
                error,
            });
        }
    }

    public async loadCommentsForFile(file: TFile | null): Promise<Comment[]> {
        if (!file || this.host.isAllCommentsNotePath(file.path) || !this.host.isCommentableFile(file)) {
            return [];
        }

        if (isAttachmentCommentableFile(file)) {
            const comments = this.host.getCommentManager().getCommentsForFile(file.path);
            this.host.getAggregateCommentIndex().updateFile(file.path, this.host.getCommentManager().getThreadsForFile(file.path));
            return comments;
        }

        const noteContent = await this.host.getCurrentNoteContent(file);
        const parsed = await this.syncFileCommentsFromContent(file, noteContent);
        return parsed.comments;
    }

    public async ensureIndexedCommentsLoaded(): Promise<void> {
        const initializedNow = await this.ensureAggregateCommentIndexInitialized();
        if (initializedNow) {
            await this.refreshAggregateNoteNow();
        }
    }

    public async persistCommentsForFile(file: TFile, options: PersistOptions = {}): Promise<void> {
        if (isAttachmentCommentableFile(file)) {
            this.host.getAggregateCommentIndex().updateFile(
                file.path,
                this.host.getCommentManager().getThreadsForFile(file.path),
            );
            await this.host.saveSettings();
            await this.afterCommentsChanged(options);
            return;
        }

        await this.writeCommentsForFile(file, options);
    }

    public scheduleAggregateNoteRefresh(): void {
        if (this.aggregateRefreshTimer !== null) {
            window.clearTimeout(this.aggregateRefreshTimer);
        }

        this.aggregateRefreshTimer = window.setTimeout(() => {
            this.aggregateRefreshTimer = null;
            void this.enqueueAggregateNoteRefresh();
        }, 150);
    }

    public async refreshAggregateNoteNow(): Promise<void> {
        if (this.aggregateRefreshTimer !== null) {
            window.clearTimeout(this.aggregateRefreshTimer);
            this.aggregateRefreshTimer = null;
        }

        await this.enqueueAggregateNoteRefresh();
    }

    public hasPendingAggregateRefresh(): boolean {
        return this.aggregateRefreshTimer !== null
            || this.aggregateRefreshPromise !== null
            || this.aggregateRefreshQueued;
    }

    private clearPendingCommentPersistTimer(filePath: string): void {
        const timer = this.pendingCommentPersistTimers[filePath];
        if (timer === undefined) {
            return;
        }

        window.clearTimeout(timer);
        delete this.pendingCommentPersistTimers[filePath];
    }

    private scheduleDeferredCommentPersist(file: TFile): void {
        this.clearPendingCommentPersistTimer(file.path);
        this.pendingCommentPersistTimers[file.path] = window.setTimeout(() => {
            delete this.pendingCommentPersistTimers[file.path];
            void this.flushDeferredCommentPersist(file.path);
        }, 750);
    }

    private async flushDeferredCommentPersist(filePath: string): Promise<void> {
        const file = this.host.getMarkdownFileByPath(filePath);
        if (!file) {
            return;
        }

        if (this.host.isMarkdownEditorFocused(file)) {
            this.scheduleDeferredCommentPersist(file);
            return;
        }

        await this.writeCommentsForFile(file);
    }

    private async ensureAggregateCommentIndexInitialized(): Promise<boolean> {
        if (this.aggregateIndexInitialized) {
            return false;
        }

        let initializedNow = false;
        if (!this.aggregateIndexInitializationPromise) {
            this.aggregateIndexInitializationPromise = (async () => {
                const markdownFiles = this.host.app.vault
                    .getMarkdownFiles()
                    .filter((file) => !this.host.isAllCommentsNotePath(file.path))
                    .sort((left, right) => left.path.localeCompare(right.path));

                for (const file of markdownFiles) {
                    const noteContent = await this.host.getCurrentNoteContent(file);
                    const parsed = await this.parseAndNormalizeFileComments(file.path, noteContent);
                    this.host.getAggregateCommentIndex().updateFile(file.path, parsed.threads);
                }

                const attachmentThreadsByFile = new Map<string, CommentThread[]>();
                for (const thread of this.host.getCommentManager().getAllThreads()) {
                    if (!isAttachmentCommentablePath(thread.filePath)) {
                        continue;
                    }

                    const existingThreads = attachmentThreadsByFile.get(thread.filePath) ?? [];
                    existingThreads.push(thread);
                    attachmentThreadsByFile.set(thread.filePath, existingThreads);
                }

                for (const [filePath, threads] of Array.from(attachmentThreadsByFile.entries()).sort(([left], [right]) =>
                    left.localeCompare(right),
                )) {
                    this.host.getAggregateCommentIndex().updateFile(filePath, threads);
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
        void this.host.log?.("info", "persistence", "storage.note.parse.begin", {
            filePath,
        });
        if (this.host.isAllCommentsNotePath(filePath)) {
            const parsed = this.host.getParsedNoteComments(filePath, noteContent);
            return {
                mainContent: parsed.mainContent,
                threads: [],
                comments: [],
            };
        }

        if (getManagedSectionKind(noteContent) === "unsupported") {
            void this.host.log?.("warn", "persistence", "storage.note.parse.unsupported", {
                filePath,
            });
        }
        const parsed = this.host.getParsedNoteComments(filePath, noteContent);
        const normalizedThreads: CommentThread[] = [];

        for (const parsedThread of parsed.threads) {
            const thread: CommentThread = {
                ...parsedThread,
                entries: parsedThread.entries.map((entry) => ({ ...entry })),
            };
            if (!thread.id) {
                thread.id = this.host.createCommentId();
            }
            thread.anchorKind = thread.anchorKind === "page" ? "page" : "selection";
            if (thread.anchorKind === "page") {
                thread.orphaned = false;
                if (!thread.selectedText) {
                    thread.selectedText = getPageCommentLabel(filePath);
                }
            } else {
                thread.orphaned = thread.orphaned === true;
            }
            if (!thread.selectedTextHash && thread.selectedText) {
                thread.selectedTextHash = await this.host.hashText(thread.selectedText);
            }
            if (!thread.entries.length) {
                thread.entries = [{
                    id: this.host.createCommentId(),
                    body: "",
                    timestamp: thread.updatedAt || thread.createdAt || Date.now(),
                }];
            }
            if (!thread.createdAt) {
                thread.createdAt = thread.entries[0].timestamp;
            }
            if (!thread.updatedAt) {
                thread.updatedAt = thread.entries[thread.entries.length - 1].timestamp;
            }
            normalizedThreads.push(thread);
        }

        return {
            mainContent: parsed.mainContent,
            threads: normalizedThreads,
            comments: normalizedThreads.map((thread) => threadToComment(thread)),
        };
    }

    private async syncFileCommentsFromContent(file: TFile, noteContent: string): Promise<SyncedFileComments> {
        const parsed = await this.parseAndNormalizeFileComments(file.path, noteContent);
        const syncedComments = await syncLoadedCommentsForCurrentNote(
            file.path,
            parsed.mainContent,
            parsed.threads,
            this.host.getCommentManager(),
            this.host.getAggregateCommentIndex(),
        );
        this.host.syncDerivedCommentLinksForFile(file, parsed.mainContent, syncedComments.comments);
        return {
            mainContent: parsed.mainContent,
            threads: syncedComments.threads,
            comments: syncedComments.comments,
        };
    }

    private async writeCommentsForFile(file: TFile, options: PersistOptions = {}): Promise<string> {
        this.clearPendingCommentPersistTimer(file.path);
        const threads = this.host.getCommentManager().getThreadsForFile(file.path);
        void this.host.log?.("info", "persistence", "storage.note.write.begin", {
            filePath: file.path,
            threadCount: threads.length,
        });
        const openView = this.host.getMarkdownViewForFile(file);

        if (openView) {
            const currentContent = openView.editor.getValue();
            const nextContent = serializeNoteCommentThreads(currentContent, threads);
            if (currentContent !== nextContent) {
                const edit = getManagedSectionEditForThreads(currentContent, threads);
                const shouldClampSelectionToManagedSectionStart = openView.getMode() === "source"
                    && openView.getState().source !== true;
                const selectionFromOffset = openView.editor.posToOffset(openView.editor.getCursor("from"));
                const selectionToOffset = openView.editor.posToOffset(openView.editor.getCursor("to"));
                openView.editor.replaceRange(
                    edit.replacement,
                    openView.editor.offsetToPos(edit.fromOffset),
                    openView.editor.offsetToPos(edit.toOffset),
                );
                openView.editor.setSelection(
                    openView.editor.offsetToPos(remapSelectionOffsetAfterManagedSectionEdit(selectionFromOffset, edit, {
                        clampToManagedSectionStart: shouldClampSelectionToManagedSectionStart,
                    })),
                    openView.editor.offsetToPos(remapSelectionOffsetAfterManagedSectionEdit(selectionToOffset, edit, {
                        clampToManagedSectionStart: shouldClampSelectionToManagedSectionStart,
                    })),
                );
            }
            await this.syncFileCommentsFromContent(file, nextContent);
            await this.afterCommentsChanged(options);
            void this.host.log?.("info", "persistence", "storage.note.write.success", {
                filePath: file.path,
                threadCount: threads.length,
            });
            return nextContent;
        }

        const nextContent = await this.host.app.vault.process(file, (currentContent) =>
            serializeNoteCommentThreads(currentContent, threads),
        );
        await this.syncFileCommentsFromContent(file, nextContent);
        await this.afterCommentsChanged(options);
        void this.host.log?.("info", "persistence", "storage.note.write.success", {
            filePath: file.path,
            threadCount: threads.length,
        });
        return nextContent;
    }

    private async afterCommentsChanged(options: PersistOptions = {}): Promise<void> {
        await this.host.refreshCommentViews();
        this.host.refreshEditorDecorations();
        if (options.immediateAggregateRefresh) {
            await this.refreshAggregateNoteNow();
        } else {
            this.scheduleAggregateNoteRefresh();
        }
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

    private async refreshAggregateNote(): Promise<void> {
        void this.host.log?.("info", "index", "index.refresh.begin", {
            showResolved: this.host.shouldShowResolvedComments(),
        });
        try {
            await this.ensureAggregateCommentIndexInitialized();
            const comments = this.host.getAggregateCommentIndex().getAllComments();
            const noteOptions: AllCommentsNoteBuildOptions = {
                allCommentsNotePath: this.host.getAllCommentsNotePath(),
                headerImageUrl: this.host.getIndexHeaderImageUrl(),
                headerImageCaption: this.host.getIndexHeaderImageCaption(),
                showResolved: this.host.shouldShowResolvedComments(),
                hasSourceFile: (filePath: string) => this.host.app.vault.getAbstractFileByPath(filePath) instanceof TFile,
                getMentionedPageLabels: (comment: Comment) => this.host.getCommentMentionedPageLabels(comment),
                resolveWikiLinkPath: (linkPath: string, sourceFilePath: string) => {
                    const linkedFile = this.host.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFilePath);
                    return linkedFile instanceof TFile ? linkedFile.path : null;
                },
            };
            const nextContent = buildAllCommentsNoteContent(this.host.app.vault.getName(), comments, noteOptions);
            const allCommentsNotePath = this.host.getAllCommentsNotePath();
            let existingFile = this.host.getMarkdownFileByPath(allCommentsNotePath);

            if (!existingFile) {
                const legacyFile = this.host.getMarkdownFileByPath(LEGACY_ALL_COMMENTS_NOTE_PATH);
                if (legacyFile) {
                    await this.host.app.fileManager.renameFile(legacyFile, allCommentsNotePath);
                    existingFile = this.host.getMarkdownFileByPath(allCommentsNotePath);
                }
            }

            if (!existingFile) {
                await this.host.app.vault.create(allCommentsNotePath, nextContent);
                void this.host.log?.("info", "index", "index.refresh.success", {
                    commentCount: comments.length,
                    created: true,
                });
                return;
            }

            const currentContent = await this.host.getCurrentNoteContent(existingFile);
            const openView = this.host.getMarkdownViewForFile(existingFile);
            if (openView) {
                await this.host.syncIndexNoteLeafMode(openView.leaf);
                if (openView.getViewData() !== nextContent) {
                    openView.setViewData(nextContent, false);
                }
                if (currentContent !== nextContent) {
                    await openView.save();
                }
                if (openView.getMode() === "preview") {
                    openView.previewMode.rerender(true);
                }
            }

            if (shouldSkipAggregateViewRefresh(currentContent, nextContent, !!openView)) {
                void this.host.log?.("info", "index", "index.refresh.success", {
                    commentCount: comments.length,
                    skippedViewRefresh: true,
                });
                return;
            }

            if (!openView) {
                await this.host.app.vault.modify(existingFile, nextContent);
            }

            void this.host.log?.("info", "index", "index.refresh.success", {
                commentCount: comments.length,
                skippedViewRefresh: false,
            });
        } catch (error) {
            void this.host.log?.("error", "index", "index.refresh.error", {
                error,
            });
            throw error;
        }
    }
}
