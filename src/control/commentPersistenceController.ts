import type { MarkdownView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import type { Comment, CommentManager, CommentThread, CommentThreadEntry } from "../commentManager";
import { threadToComment } from "../commentManager";
import { getPageCommentLabel } from "../core/anchors/commentAnchors";
import {
    type AllCommentsNoteBuildOptions,
    buildAllCommentsNoteContent,
    LEGACY_ALL_COMMENTS_NOTE_PATH,
} from "../core/derived/allCommentsNote";
import {
    syncLoadedCommentsForCurrentNote,
} from "../core/rules/commentSyncPolicy";
import {
    getManagedSectionEditForThreads,
    getManagedSectionKind,
    serializeNoteCommentThreads,
    type ParsedNoteComments,
} from "../core/storage/noteCommentStorage";
import { normalizeDeletedAt, purgeExpiredDeletedThreads } from "../core/rules/deletedCommentVisibility";
import { SidecarCommentStorage } from "../core/storage/sidecarCommentStorage";
import {
    buildSideNoteSyncEventInputsForThreadDiff,
    reduceSideNoteSyncEvents,
    type SideNoteSyncEvent,
} from "../core/storage/sideNoteSyncEvents";
import { remapSelectionOffsetAfterManagedSectionEdit } from "../core/text/editOffsets";
import type { AggregateCommentIndex } from "../index/AggregateCommentIndex";
import { shouldSkipAggregateViewRefresh } from "./commentPersistencePlanner";
import {
    SideNoteSyncEventStore,
    type SideNoteSyncNoteSnapshot,
    type SideNoteSyncSnapshotInput,
} from "./sideNoteSyncEventStore";
import type { PersistedPluginData } from "./indexNoteSettingsPlanner";

type PersistOptions = {
    immediateAggregateRefresh?: boolean;
    skipCommentViewRefresh?: boolean;
    refreshEditorDecorations?: boolean;
    refreshMarkdownPreviews?: boolean;
};

type SyncedFileComments = {
    mainContent: string;
    threads: CommentThread[];
    comments: Comment[];
    source: "none" | "inline" | "sidecar";
};

type VisibleSyncedFileComments = Omit<SyncedFileComments, "source">;

export interface CommentPersistenceHost {
    app: Plugin["app"];
    getAllCommentsNotePath(): string;
    getIndexHeaderImageUrl(): string;
    getIndexHeaderImageCaption(): string;
    shouldShowResolvedComments(): boolean;
    getMarkdownViewForFile(file: TFile): MarkdownView | null;
    getMarkdownFileByPath(filePath: string): TFile | null;
    getCurrentNoteContent(file: TFile): Promise<string>;
    getStoredNoteContent(file: TFile): Promise<string>;
    getParsedNoteComments(filePath: string, noteContent: string): ParsedNoteComments;
    getPluginDataDirPath(): string;
    getSideNoteSyncDeviceId(): string;
    readPersistedPluginData(): PersistedPluginData;
    loadPersistedPluginData?(): Promise<PersistedPluginData | null>;
    writePersistedPluginData(data: PersistedPluginData): Promise<void>;
    isAllCommentsNotePath(filePath: string): boolean;
    isCommentableFile(file: TFile | null): file is TFile;
    isMarkdownEditorFocused(file: TFile): boolean;
    getCommentManager(): CommentManager;
    getAggregateCommentIndex(): AggregateCommentIndex;
    createCommentId(): string;
    hashText(text: string): Promise<string>;
    syncDerivedCommentLinksForFile(file: TFile, noteContent: string, comments: Array<Comment | CommentThread>): void;
    refreshCommentViews(options?: { skipDataRefresh?: boolean }): Promise<void>;
    refreshAllCommentsSidebarViews(options?: { skipDataRefresh?: boolean }): Promise<void>;
    refreshEditorDecorations(): void;
    refreshMarkdownPreviews(): void;
    getCommentMentionedPageLabels(comment: Comment): string[];
    syncIndexNoteLeafMode(leaf: WorkspaceLeaf | null): Promise<void>;
    log?(level: "info" | "warn" | "error", area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
}

function isTFileLike(value: unknown): value is TFile {
    if (!value || typeof value !== "object") {
        return false;
    }

    const candidate = value as Partial<TFile>;
    return typeof candidate.path === "string"
        && typeof candidate.basename === "string"
        && typeof candidate.extension === "string";
}

function getPayloadRecord(event: SideNoteSyncEvent): Record<string, unknown> | null {
    return !!event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        ? event.payload as Record<string, unknown>
        : null;
}

function getSyncedEventTargetNotePath(notePath: string, events: SideNoteSyncEvent[]): string {
    let targetNotePath = notePath;
    for (const event of events) {
        if (event.op !== "renameNote") {
            continue;
        }

        const payload = getPayloadRecord(event);
        if (typeof payload?.nextNotePath === "string" && payload.nextNotePath.trim()) {
            targetNotePath = payload.nextNotePath;
        }
    }
    return targetNotePath;
}

function hasDeleteNoteEvent(events: SideNoteSyncEvent[]): boolean {
    return events.some((event) => event.op === "deleteNote");
}

function retargetThreads(threads: CommentThread[], filePath: string): CommentThread[] {
    return threads.map((thread) => ({
        ...thread,
        filePath,
        entries: thread.entries.map((entry) => ({ ...entry })),
    }));
}

function cloneThreadEntry(entry: CommentThreadEntry): CommentThreadEntry {
    const deletedAt = normalizeDeletedAt(entry.deletedAt);
    return {
        id: entry.id,
        body: entry.body,
        timestamp: entry.timestamp,
        ...(deletedAt !== undefined ? { deletedAt } : {}),
    };
}

function cloneThread(thread: CommentThread): CommentThread {
    const deletedAt = normalizeDeletedAt(thread.deletedAt);
    return {
        ...thread,
        deletedAt,
        entries: thread.entries.map((entry) => cloneThreadEntry(entry)),
    };
}

function areThreadEntriesEqual(left: CommentThreadEntry, right: CommentThreadEntry): boolean {
    return left.id === right.id
        && left.body === right.body
        && left.timestamp === right.timestamp
        && normalizeDeletedAt(left.deletedAt) === normalizeDeletedAt(right.deletedAt);
}

function getLegacyInlineConflictEntryId(entryId: string): string {
    return `legacy-inline-conflict-${entryId}`;
}

function createLegacyInlineConflictEntry(entry: CommentThreadEntry): CommentThreadEntry {
    return {
        id: getLegacyInlineConflictEntryId(entry.id),
        body: [
            "Legacy inline SideNote2 block recovery.",
            "",
            "This version was preserved while cleaning up an old source-markdown SideNote2 block:",
            "",
            entry.body,
        ].join("\n"),
        timestamp: entry.timestamp,
    };
}

function mergeLegacyInlineThreads(
    canonicalThreads: CommentThread[],
    inlineThreads: CommentThread[],
): { threads: CommentThread[]; changed: boolean } {
    const mergedThreads = canonicalThreads.map((thread) => cloneThread(thread));
    const threadIndexesById = new Map(mergedThreads.map((thread, index) => [thread.id, index]));
    let changed = false;

    for (const inlineThread of inlineThreads) {
        const existingIndex = threadIndexesById.get(inlineThread.id);
        if (existingIndex === undefined) {
            threadIndexesById.set(inlineThread.id, mergedThreads.length);
            mergedThreads.push(cloneThread(inlineThread));
            changed = true;
            continue;
        }

        const existingThread = mergedThreads[existingIndex];
        const nextEntries = existingThread.entries.map((entry) => cloneThreadEntry(entry));
        const entriesById = new Map(nextEntries.map((entry) => [entry.id, entry]));
        let threadChanged = false;
        for (const inlineEntry of inlineThread.entries) {
            const existingEntry = entriesById.get(inlineEntry.id);
            if (!existingEntry) {
                nextEntries.push(cloneThreadEntry(inlineEntry));
                threadChanged = true;
                continue;
            }

            if (
                !areThreadEntriesEqual(existingEntry, inlineEntry)
                && !nextEntries.some((entry) => entry.id === getLegacyInlineConflictEntryId(inlineEntry.id))
            ) {
                nextEntries.push(createLegacyInlineConflictEntry(inlineEntry));
                threadChanged = true;
            }
        }

        if (!threadChanged) {
            continue;
        }

        mergedThreads[existingIndex] = {
            ...existingThread,
            entries: nextEntries,
            updatedAt: Math.max(
                existingThread.updatedAt,
                inlineThread.updatedAt,
                ...nextEntries.map((entry) => entry.timestamp),
            ),
        };
        changed = true;
    }

    return {
        threads: mergedThreads,
        changed,
    };
}

export class CommentPersistenceController {
    private readonly pendingCommentPersistTimers: Record<string, number> = {};
    private readonly commentViewRefreshSuppressions = new Map<string, number>();
    private readonly sidecarStorage: SidecarCommentStorage;
    private readonly syncEventStore: SideNoteSyncEventStore;
    private aggregateRefreshTimer: number | null = null;
    private aggregateRefreshPromise: Promise<void> | null = null;
    private aggregateRefreshQueued = false;
    private aggregateIndexInitialized = false;
    private aggregateIndexInitializationPromise: Promise<void> | null = null;

    constructor(private readonly host: CommentPersistenceHost) {
        this.sidecarStorage = new SidecarCommentStorage({
            adapter: host.app.vault.adapter,
            pluginDirPath: host.getPluginDataDirPath(),
            hashText: (text) => host.hashText(text),
        });
        this.syncEventStore = new SideNoteSyncEventStore({
            readPersistedPluginData: () => host.readPersistedPluginData(),
            readLatestPersistedPluginData: () => host.loadPersistedPluginData?.() ?? Promise.resolve(host.readPersistedPluginData()),
            writePersistedPluginData: (data) => host.writePersistedPluginData(data),
            getDeviceId: () => host.getSideNoteSyncDeviceId(),
            createEventId: () => host.createCommentId(),
            hashText: (text) => host.hashText(text),
            now: () => Date.now(),
        });
    }

    public async renameStoredComments(previousFilePath: string, nextFilePath: string): Promise<void> {
        const previousThreads = await this.sidecarStorage.read(previousFilePath);
        await this.sidecarStorage.rename(previousFilePath, nextFilePath);
        if (previousThreads && previousThreads.length > 0) {
            await this.syncEventStore.appendLocalEvents(previousFilePath, [{
                op: "renameNote",
                payload: {
                    previousNotePath: previousFilePath,
                    nextNotePath: nextFilePath,
                },
            }]);
            await this.compactSyncedSideNoteEventsForSnapshots([{
                notePath: nextFilePath,
                coveredNotePath: previousFilePath,
                threads: retargetThreads(previousThreads, nextFilePath),
            }, {
                notePath: nextFilePath,
                threads: retargetThreads(previousThreads, nextFilePath),
            }]);
        }
    }

    public async deleteStoredComments(filePath: string): Promise<void> {
        const previousThreads = await this.sidecarStorage.read(filePath);
        if (previousThreads && previousThreads.length > 0) {
            await this.syncEventStore.appendLocalEvents(filePath, [{
                op: "deleteNote",
                payload: {
                    notePath: filePath,
                },
            }]);
        }
        await this.sidecarStorage.remove(filePath);
        await this.compactSyncedSideNoteEventsForSnapshots([{
            notePath: filePath,
            threads: [],
        }]);
    }

    public async migrateLegacyInlineCommentsOnStartup(): Promise<void> {
        const markdownFiles = this.host.app.vault
            .getMarkdownFiles()
            .filter((file) => !this.host.isAllCommentsNotePath(file.path))
            .sort((left, right) => left.path.localeCompare(right.path));

        let migratedCount = 0;
        for (const file of markdownFiles) {
            const noteContent = await this.host.getCurrentNoteContent(file);
            if (await this.ensureLegacyInlineCommentsMigrated(file, noteContent)) {
                migratedCount += 1;
            }
        }

        void this.host.log?.("info", "persistence", "storage.note.migrate.startup.complete", {
            migratedCount,
        });
    }

    public async replaySyncedSideNoteEvents(): Promise<number> {
        await this.hydrateSyncedSideNoteSnapshots();
        const events = this.syncEventStore.getUnprocessedEvents();
        if (events.length === 0) {
            return 0;
        }

        const eventsByNotePath = new Map<string, SideNoteSyncEvent[]>();
        for (const event of events) {
            const noteEvents = eventsByNotePath.get(event.notePath) ?? [];
            noteEvents.push(event);
            eventsByNotePath.set(event.notePath, noteEvents);
        }

        let appliedEventCount = 0;
        const processedEvents: SideNoteSyncEvent[] = [];
        const compactionSnapshots: SideNoteSyncSnapshotInput[] = [];
        for (const [notePath, noteEvents] of eventsByNotePath.entries()) {
            const baseThreads = await this.sidecarStorage.read(notePath) ?? [];
            const reduced = reduceSideNoteSyncEvents(
                await this.normalizeThreadsForFile(notePath, baseThreads),
                noteEvents,
            );
            const targetNotePath = getSyncedEventTargetNotePath(notePath, noteEvents);
            const targetThreads = retargetThreads(reduced.threads, targetNotePath);
            const noteWasDeleted = hasDeleteNoteEvent(noteEvents);

            if (noteWasDeleted) {
                await this.sidecarStorage.remove(notePath);
                if (targetNotePath !== notePath) {
                    await this.sidecarStorage.remove(targetNotePath);
                }
                this.host.getCommentManager().replaceThreadsForFile(notePath, []);
                if (targetNotePath !== notePath) {
                    this.host.getCommentManager().replaceThreadsForFile(targetNotePath, []);
                }
                this.host.getAggregateCommentIndex().deleteFile(notePath);
                this.host.getAggregateCommentIndex().deleteFile(targetNotePath);
            } else {
                await this.sidecarStorage.write(targetNotePath, targetThreads);
                if (targetNotePath !== notePath) {
                    await this.sidecarStorage.remove(notePath);
                    this.host.getCommentManager().replaceThreadsForFile(notePath, []);
                    this.host.getAggregateCommentIndex().deleteFile(notePath);
                }
            }

            if (noteWasDeleted) {
                compactionSnapshots.push({
                    notePath,
                    threads: [],
                });
                if (targetNotePath !== notePath) {
                    compactionSnapshots.push({
                        notePath: targetNotePath,
                        threads: [],
                    });
                }
            } else if (targetNotePath !== notePath) {
                compactionSnapshots.push({
                    notePath: targetNotePath,
                    coveredNotePath: notePath,
                    threads: targetThreads,
                }, {
                    notePath: targetNotePath,
                    threads: targetThreads,
                });
            } else {
                compactionSnapshots.push({
                    notePath: targetNotePath,
                    threads: targetThreads,
                });
            }

            const file = this.host.getMarkdownFileByPath(targetNotePath);
            if (file && this.host.isCommentableFile(file)) {
                const noteContent = await this.host.getCurrentNoteContent(file);
                const parsed = await this.parseAndNormalizeFileComments(targetNotePath, noteContent);
                await this.syncThreadsIntoVisibleNoteContent(file, parsed.mainContent, noteWasDeleted ? [] : targetThreads);
                this.clearPendingCommentPersistTimer(targetNotePath);
                await this.afterCommentsChanged(targetNotePath);
            } else {
                this.host.getAggregateCommentIndex().updateFile(targetNotePath, noteWasDeleted ? [] : targetThreads);
            }

            processedEvents.push(...noteEvents);
            appliedEventCount += reduced.appliedEvents.length;
        }

        await this.syncEventStore.markEventsProcessed(processedEvents);
        await this.compactSyncedSideNoteEventsForSnapshots(compactionSnapshots);
        void this.host.log?.("info", "persistence", "sync.plugin-data.replay.complete", {
            appliedEventCount,
        });
        return appliedEventCount;
    }

    public async migrateSidecarsToSyncedPluginDataOnStartup(): Promise<void> {
        const markdownFiles = this.host.app.vault
            .getMarkdownFiles()
            .filter((file) => !this.host.isAllCommentsNotePath(file.path))
            .sort((left, right) => left.path.localeCompare(right.path));

        let migratedCount = 0;
        for (const file of markdownFiles) {
            const threads = await this.sidecarStorage.read(file.path);
            if (!threads || threads.length === 0) {
                continue;
            }

            const normalizedThreads = await this.normalizeThreadsForFile(file.path, threads);
            const eventInputs = buildSideNoteSyncEventInputsForThreadDiff([], normalizedThreads);
            if (eventInputs.length === 0) {
                continue;
            }

            await this.syncEventStore.appendLocalEvents(file.path, eventInputs);
            await this.compactSyncedSideNoteEventsForSnapshots([{
                notePath: file.path,
                threads: normalizedThreads,
            }]);
            migratedCount += 1;
        }

        void this.host.log?.("info", "persistence", "sync.plugin-data.migrate.complete", {
            migratedCount,
        });
    }

    public async handleMarkdownFileModified(file: TFile): Promise<void> {
        if (file.extension !== "md") {
            return;
        }

        try {
            const fileContent = await this.host.getCurrentNoteContent(file);
            const storedContent = await this.host.getStoredNoteContent(file);
            const hasSidecar = await this.sidecarStorage.exists(file.path);
            if (!hasSidecar && fileContent !== storedContent && this.host.getMarkdownViewForFile(file)) {
                const currentParsed = await this.parseAndNormalizeFileComments(file.path, fileContent);
                const storedParsed = await this.parseAndNormalizeFileComments(file.path, storedContent);
                if (currentParsed.mainContent === storedParsed.mainContent && storedParsed.threads.length > 0) {
                    const synced = await this.syncThreadsIntoVisibleNoteContent(file, currentParsed.mainContent, storedParsed.threads);
                    await this.sidecarStorage.write(file.path, synced.threads);
                    await this.syncEventStore.appendLocalEvents(
                        file.path,
                        buildSideNoteSyncEventInputsForThreadDiff([], synced.threads),
                    );
                    await this.compactSyncedSideNoteEventsForSnapshots([{
                        notePath: file.path,
                        threads: synced.threads,
                    }]);
                    this.clearPendingCommentPersistTimer(file.path);
                    await this.afterCommentsChanged(file.path);
                    void this.host.log?.("info", "persistence", "storage.note.external-managed-sync", {
                        filePath: file.path,
                        threadCount: synced.threads.length,
                    });
                    return;
                }
            }
            const parsed = await this.syncFileCommentsFromContent(file, fileContent);
            if (parsed.source !== "none" || parsed.threads.length > 0) {
                await this.sidecarStorage.write(file.path, parsed.threads);
            }

            this.clearPendingCommentPersistTimer(file.path);
            await this.afterCommentsChanged(file.path);
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
        if (options.skipCommentViewRefresh) {
            this.scheduleCommentViewRefreshSuppression(file.path, 1);
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
                    const parsed = await this.getCanonicalThreadState(file, noteContent);
                    this.host.getAggregateCommentIndex().updateFile(file.path, parsed.threads);
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

    private async normalizeThreadsForFile(filePath: string, threads: CommentThread[]): Promise<CommentThread[]> {
        const normalizedThreads: CommentThread[] = [];

        for (const parsedThread of threads) {
            const thread: CommentThread = {
                ...parsedThread,
                filePath,
                entries: Array.isArray(parsedThread.entries)
                    ? parsedThread.entries.map((entry) => ({ ...entry }))
                    : [],
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

        return purgeExpiredDeletedThreads(normalizedThreads);
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
        const retainedThreads = await this.normalizeThreadsForFile(filePath, parsed.threads);

        return {
            mainContent: parsed.mainContent,
            threads: retainedThreads,
            comments: retainedThreads.map((thread) => threadToComment(thread)),
        };
    }

    private async syncFileCommentsFromContent(file: TFile, noteContent: string): Promise<SyncedFileComments> {
        const parsed = await this.getCanonicalThreadState(file, noteContent);
        const synced = await this.syncThreadsIntoVisibleNoteContent(file, parsed.mainContent, parsed.threads);
        return {
            ...synced,
            source: parsed.source,
        };
    }

    private async syncThreadsIntoVisibleNoteContent(
        file: TFile,
        mainContent: string,
        threads: CommentThread[],
    ): Promise<VisibleSyncedFileComments> {
        const syncedComments = await syncLoadedCommentsForCurrentNote(
            file.path,
            mainContent,
            threads,
            this.host.getCommentManager(),
            this.host.getAggregateCommentIndex(),
        );
        this.host.syncDerivedCommentLinksForFile(file, mainContent, syncedComments.threads);
        return {
            mainContent,
            threads: syncedComments.threads,
            comments: syncedComments.comments,
        };
    }

    private getLatestSnapshotsByNotePath(snapshots: SideNoteSyncNoteSnapshot[]): SideNoteSyncNoteSnapshot[] {
        const latestByNotePath = new Map<string, SideNoteSyncNoteSnapshot>();
        for (const snapshot of snapshots) {
            const existing = latestByNotePath.get(snapshot.notePath);
            if (!existing || snapshot.updatedAt >= existing.updatedAt) {
                latestByNotePath.set(snapshot.notePath, snapshot);
            }
        }

        return Array.from(latestByNotePath.values())
            .sort((left, right) => left.notePath.localeCompare(right.notePath));
    }

    private async hydrateSyncedSideNoteSnapshots(): Promise<number> {
        const snapshots = this.getLatestSnapshotsByNotePath(this.syncEventStore.getSnapshots());
        if (snapshots.length === 0) {
            return 0;
        }

        let hydratedCount = 0;
        for (const snapshot of snapshots) {
            const hasSidecar = await this.sidecarStorage.exists(snapshot.notePath);
            if (hasSidecar && snapshot.threads.length > 0) {
                continue;
            }

            const normalizedThreads = await this.normalizeThreadsForFile(snapshot.notePath, snapshot.threads);
            await this.sidecarStorage.write(snapshot.notePath, normalizedThreads);
            const file = this.host.getMarkdownFileByPath(snapshot.notePath);
            if (file && this.host.isCommentableFile(file)) {
                const noteContent = await this.host.getCurrentNoteContent(file);
                const parsed = await this.parseAndNormalizeFileComments(snapshot.notePath, noteContent);
                await this.syncThreadsIntoVisibleNoteContent(file, parsed.mainContent, normalizedThreads);
                this.clearPendingCommentPersistTimer(snapshot.notePath);
                await this.afterCommentsChanged(snapshot.notePath);
            } else {
                this.host.getAggregateCommentIndex().updateFile(snapshot.notePath, normalizedThreads);
            }
            hydratedCount += 1;
        }

        await this.syncEventStore.markWatermarksProcessed(this.syncEventStore.getCompactedWatermarks());
        if (hydratedCount > 0) {
            void this.host.log?.("info", "persistence", "sync.plugin-data.snapshot.hydrate", {
                hydratedCount,
            });
        }
        return hydratedCount;
    }

    private async compactSyncedSideNoteEventsForSnapshots(snapshots: SideNoteSyncSnapshotInput[]): Promise<void> {
        const compacted = await this.syncEventStore.compactProcessedEventsForSnapshots(snapshots);
        if (compacted.removedEventCount === 0 && compacted.snapshotCount === 0) {
            return;
        }

        void this.host.log?.("info", "persistence", "sync.plugin-data.compact", {
            removedEventCount: compacted.removedEventCount,
            snapshotCount: compacted.snapshotCount,
        });
    }

    private async writeCommentsForFile(file: TFile, options: PersistOptions = {}): Promise<string> {
        this.clearPendingCommentPersistTimer(file.path);
        this.host.getCommentManager().purgeExpiredDeletedComments();
        const threads = this.host.getCommentManager().getThreadsForFile(file.path, { includeDeleted: true });
        void this.host.log?.("info", "persistence", "storage.note.write.begin", {
            filePath: file.path,
            threadCount: threads.length,
        });
        const previousThreads = await this.sidecarStorage.read(file.path) ?? [];
        const currentContent = await this.host.getCurrentNoteContent(file);
        const parsedCurrentContent = await this.parseAndNormalizeFileComments(file.path, currentContent);
        const synced = await this.syncThreadsIntoVisibleNoteContent(file, parsedCurrentContent.mainContent, threads);
        const eventInputs = buildSideNoteSyncEventInputsForThreadDiff(
            await this.normalizeThreadsForFile(file.path, previousThreads),
            synced.threads,
        );
        await this.syncEventStore.appendLocalEvents(file.path, eventInputs);
        await this.sidecarStorage.write(file.path, synced.threads);
        await this.compactSyncedSideNoteEventsForSnapshots([{
            notePath: file.path,
            threads: synced.threads,
        }]);
        const nextContent = await this.stripInlineManagedSectionIfPresent(file, currentContent);
        await this.afterCommentsChanged(file.path, options);
        void this.host.log?.("info", "persistence", "storage.note.write.success", {
            filePath: file.path,
            threadCount: synced.threads.length,
        });
        return nextContent;
    }

    private async getCanonicalThreadState(file: TFile, noteContent: string): Promise<{
        mainContent: string;
        threads: CommentThread[];
        source: "none" | "inline" | "sidecar";
    }> {
        const inlineParsed = await this.parseAndNormalizeFileComments(file.path, noteContent);
        const hasSidecar = await this.sidecarStorage.exists(file.path);
        const sidecarThreads = hasSidecar ? await this.sidecarStorage.read(file.path) : null;

        if (sidecarThreads) {
            const canonicalThreads = await this.reconcileLegacyInlineThreadsWithSidecar(
                file.path,
                sidecarThreads,
                inlineParsed.threads,
            );
            if (getManagedSectionKind(noteContent) === "threaded") {
                await this.stripInlineManagedSectionIfPresent(file, noteContent);
            }

            return {
                mainContent: inlineParsed.mainContent,
                threads: canonicalThreads,
                source: "sidecar",
            };
        }

        if (inlineParsed.threads.length === 0) {
            if (getManagedSectionKind(noteContent) === "threaded") {
                await this.stripInlineManagedSectionIfPresent(file, noteContent);
            }
            return {
                mainContent: inlineParsed.mainContent,
                threads: [],
                source: "none",
            };
        }

        await this.sidecarStorage.write(file.path, inlineParsed.threads);
        await this.syncEventStore.appendLocalEvents(
            file.path,
            buildSideNoteSyncEventInputsForThreadDiff([], inlineParsed.threads),
        );
        await this.compactSyncedSideNoteEventsForSnapshots([{
            notePath: file.path,
            threads: inlineParsed.threads,
        }]);
        await this.stripInlineManagedSectionIfPresent(file, noteContent);
        void this.host.log?.("info", "persistence", "storage.note.migrate.success", {
            filePath: file.path,
            threadCount: inlineParsed.threads.length,
        });
        return {
            mainContent: inlineParsed.mainContent,
            threads: inlineParsed.threads,
            source: "inline",
        };
    }

    private async ensureLegacyInlineCommentsMigrated(file: TFile, noteContent: string): Promise<boolean> {
        const managedSectionKind = getManagedSectionKind(noteContent);
        if (managedSectionKind !== "threaded") {
            return false;
        }

        const parsed = await this.parseAndNormalizeFileComments(file.path, noteContent);
        const existingSidecarThreads = await this.sidecarStorage.read(file.path);
        if (existingSidecarThreads) {
            await this.reconcileLegacyInlineThreadsWithSidecar(file.path, existingSidecarThreads, parsed.threads);
            if (getManagedSectionKind(noteContent) === "threaded") {
                await this.stripInlineManagedSectionIfPresent(file, noteContent);
                return true;
            }
        }

        if (parsed.threads.length === 0) {
            await this.stripInlineManagedSectionIfPresent(file, noteContent);
            return true;
        }

        const normalizedThreads = await this.normalizeThreadsForFile(file.path, parsed.threads);
        await this.syncEventStore.appendLocalEvents(
            file.path,
            buildSideNoteSyncEventInputsForThreadDiff([], normalizedThreads),
        );
        await this.sidecarStorage.write(file.path, normalizedThreads);
        await this.compactSyncedSideNoteEventsForSnapshots([{
            notePath: file.path,
            threads: normalizedThreads,
        }]);
        await this.stripInlineManagedSectionIfPresent(file, noteContent);
        void this.host.log?.("info", "persistence", "storage.note.migrate.success", {
            filePath: file.path,
            threadCount: normalizedThreads.length,
        });
        return true;
    }

    private async reconcileLegacyInlineThreadsWithSidecar(
        filePath: string,
        sidecarThreads: CommentThread[],
        inlineThreads: CommentThread[],
    ): Promise<CommentThread[]> {
        const normalizedSidecarThreads = await this.normalizeThreadsForFile(filePath, sidecarThreads);
        if (inlineThreads.length === 0) {
            return normalizedSidecarThreads;
        }

        const merged = mergeLegacyInlineThreads(normalizedSidecarThreads, inlineThreads);
        if (!merged.changed) {
            return normalizedSidecarThreads;
        }

        const normalizedMergedThreads = await this.normalizeThreadsForFile(filePath, merged.threads);
        const eventInputs = buildSideNoteSyncEventInputsForThreadDiff(
            normalizedSidecarThreads,
            normalizedMergedThreads,
        );
        if (eventInputs.length === 0) {
            return normalizedSidecarThreads;
        }

        await this.syncEventStore.appendLocalEvents(filePath, eventInputs);
        await this.sidecarStorage.write(filePath, normalizedMergedThreads);
        await this.compactSyncedSideNoteEventsForSnapshots([{
            notePath: filePath,
            threads: normalizedMergedThreads,
        }]);
        void this.host.log?.("info", "persistence", "storage.note.legacy-inline.merge", {
            filePath,
            importedThreadCount: normalizedMergedThreads.length - normalizedSidecarThreads.length,
        });
        return normalizedMergedThreads;
    }

    private async stripInlineManagedSectionIfPresent(file: TFile, noteContent: string): Promise<string> {
        if (getManagedSectionKind(noteContent) !== "threaded") {
            return noteContent;
        }

        const nextContent = serializeNoteCommentThreads(noteContent, []);
        if (nextContent === noteContent) {
            return noteContent;
        }

        const openView = this.host.getMarkdownViewForFile(file);
        const canEditOpenView = !!openView && openView.getMode() !== "preview";
        if (openView && canEditOpenView) {
            const edit = getManagedSectionEditForThreads(noteContent, []);
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
            return nextContent;
        }

        return this.host.app.vault.process(file, (currentContent) =>
            getManagedSectionKind(currentContent) === "threaded"
                ? serializeNoteCommentThreads(currentContent, [])
                : currentContent,
        );
    }

    private async afterCommentsChanged(filePath: string | null = null, options: PersistOptions = {}): Promise<void> {
        const viewRefreshOptions = {
            skipDataRefresh: true,
        };
        if (filePath && this.host.isAllCommentsNotePath(filePath)) {
            await this.host.refreshAllCommentsSidebarViews(viewRefreshOptions);
        } else if (!filePath || !this.consumeCommentViewRefreshSuppression(filePath)) {
            await this.host.refreshCommentViews(viewRefreshOptions);
        }
        if (options.refreshEditorDecorations !== false) {
            this.host.refreshEditorDecorations();
        }
        if (options.refreshMarkdownPreviews !== false) {
            this.host.refreshMarkdownPreviews();
        }
        if (options.immediateAggregateRefresh) {
            await this.refreshAggregateNoteNow();
        } else {
            this.scheduleAggregateNoteRefresh();
        }
    }

    private scheduleCommentViewRefreshSuppression(filePath: string, count: number): void {
        const existingCount = this.commentViewRefreshSuppressions.get(filePath) ?? 0;
        this.commentViewRefreshSuppressions.set(filePath, Math.max(existingCount, count));
    }

    private consumeCommentViewRefreshSuppression(filePath: string): boolean {
        const count = this.commentViewRefreshSuppressions.get(filePath) ?? 0;
        if (count <= 0) {
            return false;
        }

        if (count === 1) {
            this.commentViewRefreshSuppressions.delete(filePath);
        } else {
            this.commentViewRefreshSuppressions.set(filePath, count - 1);
        }
        return true;
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
                hasSourceFile: (filePath: string) => isTFileLike(this.host.app.vault.getAbstractFileByPath(filePath)),
                getMentionedPageLabels: (comment: Comment) => this.host.getCommentMentionedPageLabels(comment),
                resolveWikiLinkPath: (linkPath: string, sourceFilePath: string) => {
                    const linkedFile = this.host.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFilePath);
                    return isTFileLike(linkedFile) ? linkedFile.path : null;
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
