import type { MarkdownView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import type { Comment, CommentManager, CommentThread, CommentThreadEntry } from "../commentManager";
import { threadToComment } from "../commentManager";
import { getPageCommentLabel } from "../core/anchors/commentAnchors";
import {
    type AllCommentsNoteBuildOptions,
    buildAllCommentsNoteContent,
    LEGACY_ALL_COMMENTS_NOTE_PATH,
    LEGACY_ALL_COMMENTS_NOTE_PATHS,
} from "../core/derived/allCommentsNote";
import {
    syncLoadedCommentsForCurrentNote,
} from "../core/rules/commentSyncPolicy";
import {
    getManagedSectionEditForThreads,
    getManagedSectionKind,
    getVisibleNoteContent,
    serializeNoteCommentThreads,
    type ParsedNoteComments,
} from "../core/storage/noteCommentStorage";
import {
    planCanonicalCommentStorage,
    type CanonicalCommentStorageSource,
} from "../core/storage/canonicalCommentStorage";
import { normalizeDeletedAt, purgeExpiredDeletedThreads } from "../core/rules/deletedCommentVisibility";
import { SidecarCommentStorage, type RemovedSidecarComments } from "../core/storage/sidecarCommentStorage";
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
} from "../sync/sideNoteSyncEventStore";
import type { PersistedPluginData } from "../settings/indexNoteSettingsPlanner";
import {
    SourceIdentityStore,
    type SourceIdentityRecord,
} from "../sync/sourceIdentityStore";

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
    source: CanonicalCommentStorageSource;
};

type VisibleSyncedFileComments = Omit<SyncedFileComments, "source">;

type LegacySourceCandidate = {
    notePath: string;
    threads: CommentThread[];
    updatedAt: number;
    origin: "snapshot" | "cache";
    coveredWatermarks?: Record<string, number>;
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
    getStoredNoteContent(file: TFile): Promise<string>;
    getParsedNoteComments(filePath: string, noteContent: string): ParsedNoteComments;
    getPluginDataDirPath(): string;
    getLegacyPluginDataDirPaths?(): string[];
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
        if (event.op !== "renameNote" && event.op !== "renameSource") {
            continue;
        }

        const payload = getPayloadRecord(event);
        if (typeof payload?.nextNotePath === "string" && payload.nextNotePath.trim()) {
            targetNotePath = payload.nextNotePath;
        } else if (typeof payload?.nextPath === "string" && payload.nextPath.trim()) {
            targetNotePath = payload.nextPath;
        }
    }
    return targetNotePath;
}

function getSyncedEventSourceId(events: SideNoteSyncEvent[]): string | null {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const payload = getPayloadRecord(events[index]);
        if (typeof payload?.sourceId === "string" && payload.sourceId.trim()) {
            return payload.sourceId.trim();
        }
    }
    return null;
}

function extractFirstMarkdownHeading(noteContent: string): string | null {
    for (const line of noteContent.replace(/\r\n/g, "\n").split("\n")) {
        const match = /^#\s+(.+?)\s*#*\s*$/.exec(line);
        if (match?.[1]?.trim()) {
            return match[1].trim();
        }
    }
    return null;
}

function normalizeSourceIdentityLabel(value: string): string {
    return value
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function sourceIdentityLabelsForFile(filePath: string, noteContent: string): string[] {
    const labels = [
        getPageCommentLabel(filePath),
        extractFirstMarkdownHeading(noteContent) ?? "",
    ]
        .map((label) => normalizeSourceIdentityLabel(label))
        .filter((label) => label.length >= 4);
    return Array.from(new Set(labels));
}

function sourceIdentityLabelsForSnapshot(snapshot: SideNoteSyncNoteSnapshot): string[] {
    const labels = [
        getPageCommentLabel(snapshot.notePath),
        ...snapshot.threads.map((thread) => thread.selectedText),
    ]
        .map((label) => normalizeSourceIdentityLabel(label))
        .filter((label) => label.length >= 4);
    return Array.from(new Set(labels));
}

function sourceIdentityLabelsMatch(left: string, right: string): boolean {
    return left === right
        || left.startsWith(`${right} `)
        || right.startsWith(`${left} `);
}

function normalizeContentMatchText(value: string): string {
    return value
        .normalize("NFKC")
        .replace(/\r\n/g, "\n")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
}

function isGenericRecoveryHeading(value: string): boolean {
    const headingMatch = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(value.trim());
    if (!headingMatch?.[1]) {
        return false;
    }

    const headingLabel = normalizeSourceIdentityLabel(headingMatch[1]);
    return /^(chapter|part|section|book|volume|appendix)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)$/.test(headingLabel)
        || /^(introduction|conclusion|preface|foreword|afterword|prologue|epilogue|contents|table of contents|acknowledgments|acknowledgements|notes|bibliography|references|index)$/.test(headingLabel);
}

function getDistinctiveSelectedTextAnchors(
    threads: CommentThread[],
    options: { selectionOnly?: boolean } = {},
): string[] {
    const anchors = threads
        .filter((thread) => !options.selectionOnly || thread.anchorKind !== "page")
        .map((thread) => thread.selectedText)
        .filter((selectedText) => !isGenericRecoveryHeading(selectedText))
        .map((selectedText) => normalizeContentMatchText(selectedText))
        .filter((selectedText) => selectedText.length >= 8);
    return Array.from(new Set(anchors));
}

function getAnchorContentMatch(
    threads: CommentThread[],
    targetNoteContent: string,
    options: { selectionOnly?: boolean } = {},
): {
    matchedAnchorCount: number;
    anchorCount: number;
} {
    const targetContent = normalizeContentMatchText(getVisibleNoteContent(targetNoteContent));
    if (!targetContent) {
        return { matchedAnchorCount: 0, anchorCount: 0 };
    }

    const anchors = getDistinctiveSelectedTextAnchors(threads, options);
    let matchedAnchorCount = 0;
    for (const anchor of anchors) {
        if (targetContent.includes(anchor)) {
            matchedAnchorCount += 1;
        }
    }
    return {
        matchedAnchorCount,
        anchorCount: anchors.length,
    };
}

function areSnapshotThreadsCompatibleWithFile(
    threads: CommentThread[],
    targetNoteContent: string,
): boolean {
    const match = getAnchorContentMatch(threads, targetNoteContent, { selectionOnly: true });
    if (match.anchorCount === 0) {
        return true;
    }

    return match.matchedAnchorCount >= Math.min(2, match.anchorCount);
}

function normalizeSourceContentForFingerprint(noteContent: string): string {
    return getVisibleNoteContent(noteContent)
        .normalize("NFKC")
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, 32768);
}

function getCandidateContentMatch(candidate: LegacySourceCandidate, targetFilePath: string, targetNoteContent: string): {
    score: number;
    matchedAnchorCount: number;
} {
    const targetContent = normalizeContentMatchText(getVisibleNoteContent(targetNoteContent));
    if (!targetContent) {
        return { score: 0, matchedAnchorCount: 0 };
    }

    const candidateAnchors = getDistinctiveSelectedTextAnchors(candidate.threads);
    let score = 0;
    let matchedAnchorCount = 0;
    for (const anchor of candidateAnchors) {
        if (!targetContent.includes(anchor)) {
            continue;
        }

        matchedAnchorCount += 1;
        score += Math.min(40, Math.max(8, Math.floor(anchor.length / 8)));
    }

    const targetLabels = sourceIdentityLabelsForFile(targetFilePath, targetNoteContent);
    for (const snapshotLabel of sourceIdentityLabelsForSnapshot({
        notePath: candidate.notePath,
        noteHash: "",
        updatedAt: candidate.updatedAt,
        coveredWatermarks: candidate.coveredWatermarks ?? {},
        threads: candidate.threads,
    })) {
        for (const targetLabel of targetLabels) {
            if (sourceIdentityLabelsMatch(snapshotLabel, targetLabel)) {
                score += snapshotLabel === targetLabel ? 4 : 2;
            }
        }
    }

    return { score, matchedAnchorCount };
}

function isStrongLegacySourceMatch(candidate: LegacySourceCandidate, targetFilePath: string, targetNoteContent: string): boolean {
    const match = getCandidateContentMatch(candidate, targetFilePath, targetNoteContent);
    if (match.matchedAnchorCount >= 2) {
        return true;
    }

    if (candidate.threads.length === 1 && match.matchedAnchorCount === 1 && match.score >= 16) {
        return true;
    }

    return false;
}

function mergeSyncWatermarks(
    left: Record<string, number>,
    right: Record<string, number>,
): Record<string, number> {
    const merged = { ...left };
    for (const [deviceId, logicalClock] of Object.entries(right)) {
        merged[deviceId] = Math.max(merged[deviceId] ?? 0, logicalClock);
    }
    return merged;
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

function getThreadEntryVersion(entry: CommentThreadEntry): number {
    return Math.max(entry.timestamp, normalizeDeletedAt(entry.deletedAt) ?? 0);
}

function getThreadStateVersion(thread: CommentThread): number {
    return Math.max(
        thread.createdAt,
        thread.updatedAt,
        normalizeDeletedAt(thread.deletedAt) ?? 0,
        ...thread.entries.map((entry) => getThreadEntryVersion(entry)),
    );
}

function chooseSnapshotThreadEntry(
    localEntry: CommentThreadEntry,
    snapshotEntry: CommentThreadEntry,
): CommentThreadEntry {
    return getThreadEntryVersion(snapshotEntry) >= getThreadEntryVersion(localEntry)
        ? cloneThreadEntry(snapshotEntry)
        : cloneThreadEntry(localEntry);
}

function mergeThreadEntriesFromSnapshot(
    localEntries: CommentThreadEntry[],
    snapshotEntries: CommentThreadEntry[],
): CommentThreadEntry[] {
    const mergedEntries = localEntries.map((entry) => cloneThreadEntry(entry));

    for (let snapshotIndex = 0; snapshotIndex < snapshotEntries.length; snapshotIndex += 1) {
        const snapshotEntry = snapshotEntries[snapshotIndex];
        const existingIndex = mergedEntries.findIndex((entry) => entry.id === snapshotEntry.id);
        if (existingIndex !== -1) {
            mergedEntries[existingIndex] = chooseSnapshotThreadEntry(mergedEntries[existingIndex], snapshotEntry);
            continue;
        }

        let insertIndex = -1;
        for (let previousIndex = snapshotIndex - 1; previousIndex >= 0; previousIndex -= 1) {
            const previousSnapshotEntryId = snapshotEntries[previousIndex].id;
            const previousMergedIndex = mergedEntries.findIndex((entry) => entry.id === previousSnapshotEntryId);
            if (previousMergedIndex !== -1) {
                insertIndex = previousMergedIndex + 1;
                break;
            }
        }

        mergedEntries.splice(insertIndex === -1 ? 0 : insertIndex, 0, cloneThreadEntry(snapshotEntry));
    }

    return mergedEntries;
}

function mergeThreadFromSnapshot(localThread: CommentThread, snapshotThread: CommentThread): CommentThread {
    const snapshotIsNewer = getThreadStateVersion(snapshotThread) >= getThreadStateVersion(localThread);
    const baseThread = cloneThread(snapshotIsNewer ? snapshotThread : localThread);
    const entries = mergeThreadEntriesFromSnapshot(localThread.entries, snapshotThread.entries);
    return {
        ...baseThread,
        createdAt: Math.min(localThread.createdAt, snapshotThread.createdAt),
        updatedAt: Math.max(
            baseThread.updatedAt,
            ...entries.map((entry) => getThreadEntryVersion(entry)),
        ),
        entries,
    };
}

function mergeSnapshotThreadsWithSidecar(
    sidecarThreads: CommentThread[],
    snapshotThreads: CommentThread[],
): CommentThread[] {
    const mergedThreads = sidecarThreads.map((thread) => cloneThread(thread));

    for (let snapshotIndex = 0; snapshotIndex < snapshotThreads.length; snapshotIndex += 1) {
        const snapshotThread = snapshotThreads[snapshotIndex];
        const existingIndex = mergedThreads.findIndex((thread) => thread.id === snapshotThread.id);
        if (existingIndex !== -1) {
            mergedThreads[existingIndex] = mergeThreadFromSnapshot(mergedThreads[existingIndex], snapshotThread);
            continue;
        }

        let insertIndex = -1;
        for (let previousIndex = snapshotIndex - 1; previousIndex >= 0; previousIndex -= 1) {
            const previousSnapshotThreadId = snapshotThreads[previousIndex].id;
            const previousMergedIndex = mergedThreads.findIndex((thread) => thread.id === previousSnapshotThreadId);
            if (previousMergedIndex !== -1) {
                insertIndex = previousMergedIndex + 1;
                break;
            }
        }

        mergedThreads.splice(insertIndex === -1 ? mergedThreads.length : insertIndex, 0, cloneThread(snapshotThread));
    }

    return mergedThreads;
}

function areCommentThreadsEqual(left: CommentThread, right: CommentThread): boolean {
    return left.id === right.id
        && left.filePath === right.filePath
        && left.startLine === right.startLine
        && left.startChar === right.startChar
        && left.endLine === right.endLine
        && left.endChar === right.endChar
        && left.selectedText === right.selectedText
        && left.selectedTextHash === right.selectedTextHash
        && (left.anchorKind ?? "selection") === (right.anchorKind ?? "selection")
        && (left.orphaned === true) === (right.orphaned === true)
        && (left.isPinned === true) === (right.isPinned === true)
        && (left.resolved === true) === (right.resolved === true)
        && normalizeDeletedAt(left.deletedAt) === normalizeDeletedAt(right.deletedAt)
        && left.createdAt === right.createdAt
        && left.updatedAt === right.updatedAt
        && left.entries.length === right.entries.length
        && left.entries.every((entry, index) => areThreadEntriesEqual(entry, right.entries[index]));
}

function areCommentThreadListsEqual(left: CommentThread[], right: CommentThread[]): boolean {
    return left.length === right.length
        && left.every((thread, index) => areCommentThreadsEqual(thread, right[index]));
}

function getLegacyInlineConflictEntryId(entryId: string): string {
    return `legacy-inline-conflict-${entryId}`;
}

function createLegacyInlineConflictEntry(entry: CommentThreadEntry): CommentThreadEntry {
    return {
        id: getLegacyInlineConflictEntryId(entry.id),
        body: [
            "Legacy inline Aside block recovery.",
            "",
            "This version was preserved while cleaning up an old source-markdown Aside block:",
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
    private readonly sourceIdentityStore: SourceIdentityStore;
    private aggregateRefreshTimer: number | null = null;
    private aggregateRefreshPromise: Promise<void> | null = null;
    private aggregateRefreshQueued = false;
    private aggregateIndexInitialized = false;
    private aggregateIndexInitializationPromise: Promise<void> | null = null;
    private fullSyncedEventReplayPromise: Promise<number> | null = null;
    private readonly targetedSyncedEventReplayPromises = new Map<string, Promise<number>>();
    private disposed = false;

    constructor(private readonly host: CommentPersistenceHost) {
        this.sidecarStorage = new SidecarCommentStorage({
            adapter: host.app.vault.adapter,
            pluginDirPath: host.getPluginDataDirPath(),
            legacyPluginDirPaths: host.getLegacyPluginDataDirPaths?.() ?? [],
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
        this.sourceIdentityStore = new SourceIdentityStore({
            readPersistedPluginData: () => host.readPersistedPluginData(),
            readLatestPersistedPluginData: () => host.loadPersistedPluginData?.() ?? Promise.resolve(host.readPersistedPluginData()),
            writePersistedPluginData: (data) => host.writePersistedPluginData(data),
            createSourceId: () => `src-${host.createCommentId()}`,
            now: () => Date.now(),
        });
    }

    public dispose(): void {
        this.disposed = true;
        if (typeof window !== "undefined") {
            if (this.aggregateRefreshTimer !== null) {
                window.clearTimeout(this.aggregateRefreshTimer);
                this.aggregateRefreshTimer = null;
            }
            for (const timer of Object.values(this.pendingCommentPersistTimers)) {
                window.clearTimeout(timer);
            }
        }
        for (const filePath of Object.keys(this.pendingCommentPersistTimers)) {
            delete this.pendingCommentPersistTimers[filePath];
        }
        this.aggregateRefreshQueued = false;
        this.commentViewRefreshSuppressions.clear();
    }

    public reviveForLoad(): CommentPersistenceController {
        return this.disposed
            ? new CommentPersistenceController(this.host)
            : this;
    }

    private async getSourceContentFingerprint(noteContent: string): Promise<string | null> {
        const normalizedContent = normalizeSourceContentForFingerprint(noteContent);
        return normalizedContent.length > 0
            ? this.host.hashText(normalizedContent)
            : null;
    }

    private async ensureSourceIdentityForFilePath(
        filePath: string,
        noteContent?: string,
    ): Promise<SourceIdentityRecord> {
        await this.sourceIdentityStore.refreshFromLatestPersistedData();
        const fingerprint = noteContent === undefined
            ? null
            : await this.getSourceContentFingerprint(noteContent);
        const existingRecord = this.sourceIdentityStore.getRecordByPath(filePath);
        if (
            existingRecord
            && existingRecord.currentPath !== filePath
            && !!this.host.getMarkdownFileByPath(existingRecord.currentPath)
        ) {
            return this.sourceIdentityStore.createSourceForPath(filePath, fingerprint);
        }
        return this.sourceIdentityStore.ensureSourceForPath(filePath, fingerprint);
    }

    private async writeSourceAndPathSidecars(
        sourceId: string,
        filePath: string,
        threads: CommentThread[],
    ): Promise<void> {
        await this.sidecarStorage.writeForSource(sourceId, filePath, threads);
        await this.sidecarStorage.write(filePath, threads);
    }

    private async readSourceOrPathSidecar(
        sourceRecord: SourceIdentityRecord,
        filePath: string,
    ): Promise<{
        threads: CommentThread[];
        source: "source" | "path";
    } | null> {
        const sourceThreads = await this.sidecarStorage.readForSource(sourceRecord.sourceId, filePath);
        if (sourceThreads) {
            return {
                threads: sourceThreads,
                source: "source",
            };
        }

        const pathThreads = await this.sidecarStorage.read(filePath);
        if (!pathThreads) {
            return null;
        }

        await this.sidecarStorage.writeForSource(sourceRecord.sourceId, filePath, pathThreads);
        return {
            threads: pathThreads,
            source: "path",
        };
    }

    public async renameStoredComments(previousFilePath: string, nextFilePath: string): Promise<void> {
        await this.sourceIdentityStore.refreshFromLatestPersistedData();
        const existingSourceRecord = this.sourceIdentityStore.getRecordByPath(previousFilePath)
            ?? this.sourceIdentityStore.getRecordByPath(nextFilePath);
        const previousSourceThreads = existingSourceRecord
            ? await this.sidecarStorage.readForSource(existingSourceRecord.sourceId, previousFilePath)
            : null;
        const previousThreads = previousSourceThreads ?? await this.sidecarStorage.read(previousFilePath);
        const sourceRecord = await this.sourceIdentityStore.recordRename(previousFilePath, nextFilePath);
        await this.sidecarStorage.rename(previousFilePath, nextFilePath);
        if (previousThreads && previousThreads.length > 0) {
            const retargetedThreads = retargetThreads(previousThreads, nextFilePath);
            await this.writeSourceAndPathSidecars(sourceRecord.sourceId, nextFilePath, retargetedThreads);
            await this.syncEventStore.appendLocalEvents(previousFilePath, [{
                op: "renameSource",
                payload: {
                    sourceId: sourceRecord.sourceId,
                    previousPath: previousFilePath,
                    nextPath: nextFilePath,
                    previousNotePath: previousFilePath,
                    nextNotePath: nextFilePath,
                },
            }]);
            await this.compactSyncedSideNoteEventsForSnapshots([{
                notePath: nextFilePath,
                coveredNotePath: previousFilePath,
                threads: retargetedThreads,
            }, {
                notePath: nextFilePath,
                threads: retargetedThreads,
            }]);
        }
    }

    private hasKnownCommentsForDeletedFile(filePath: string, previousThreads: CommentThread[] | null): boolean {
        if ((previousThreads?.length ?? 0) > 0) {
            return true;
        }

        if (this.host.getCommentManager().getThreadsForFile(filePath, { includeDeleted: true }).length > 0) {
            return true;
        }

        if (this.host.getAggregateCommentIndex().getThreadsForFile(filePath).length > 0) {
            return true;
        }

        if (this.syncEventStore.getSnapshots().some((snapshot) =>
            snapshot.notePath === filePath && snapshot.threads.length > 0)) {
            return true;
        }

        return this.syncEventStore.getUnprocessedEvents().some((event) =>
            this.eventTouchesNotePath(event, filePath));
    }

    public async deleteStoredComments(filePath: string): Promise<void> {
        await this.sourceIdentityStore.refreshFromLatestPersistedData();
        await this.syncEventStore.refreshFromLatestPersistedData();
        const sourceRecord = this.sourceIdentityStore.getRecordByPath(filePath);
        const removedSidecar = await this.sidecarStorage.removeNote(filePath);
        const previousThreads = removedSidecar?.threads ?? (sourceRecord
            ? await this.sidecarStorage.readForSource(sourceRecord.sourceId, filePath)
            : null) ?? await this.sidecarStorage.read(filePath);
        if (this.hasKnownCommentsForDeletedFile(filePath, previousThreads)) {
            await this.syncEventStore.appendLocalEvents(filePath, [{
                op: "deleteNote",
                payload: {
                    notePath: filePath,
                    ...(sourceRecord ? { sourceId: sourceRecord.sourceId } : {}),
                },
            }]);
        }
        if (!removedSidecar) {
            await this.sidecarStorage.remove(filePath);
        }
        if (sourceRecord && !removedSidecar?.sourceId) {
            await this.sidecarStorage.removeForSource(sourceRecord.sourceId);
        }
        await this.sourceIdentityStore.removeSourceForPath(filePath);
        await this.compactSyncedSideNoteEventsForSnapshots([{
            notePath: filePath,
            threads: [],
        }]);
    }

    public async deleteStoredCommentsInFolder(folderPath: string): Promise<void> {
        await this.sourceIdentityStore.refreshFromLatestPersistedData();
        await this.syncEventStore.refreshFromLatestPersistedData();

        const removedByNotePath = new Map<string, {
            notePath: string;
            sourceId?: string;
            threads: CommentThread[];
        }>();
        for (const removed of await this.sidecarStorage.removeFolder(folderPath)) {
            removedByNotePath.set(removed.notePath, {
                notePath: removed.notePath,
                sourceId: removed.sourceId,
                threads: removed.threads,
            });
        }

        for (const sourceRecord of await this.sourceIdentityStore.removeSourcesInFolder(folderPath)) {
            await this.sidecarStorage.remove(sourceRecord.currentPath);
            await this.sidecarStorage.removeForSource(sourceRecord.sourceId);
            const existing = removedByNotePath.get(sourceRecord.currentPath);
            removedByNotePath.set(sourceRecord.currentPath, {
                notePath: sourceRecord.currentPath,
                sourceId: existing?.sourceId ?? sourceRecord.sourceId,
                threads: existing?.threads ?? [],
            });
        }

        const removedRecords = Array.from(removedByNotePath.values())
            .sort((left, right) => left.notePath.localeCompare(right.notePath));
        for (const record of removedRecords) {
            if (!this.hasKnownCommentsForDeletedFile(record.notePath, record.threads)) {
                continue;
            }

            await this.syncEventStore.appendLocalEvents(record.notePath, [{
                op: "deleteNote",
                payload: {
                    notePath: record.notePath,
                    ...(record.sourceId ? { sourceId: record.sourceId } : {}),
                },
            }]);
        }

        await this.compactSyncedSideNoteEventsForSnapshots(
            removedRecords.map((record) => ({
                notePath: record.notePath,
                threads: [],
            })),
        );
    }

    public async migrateLegacyInlineCommentsOnStartup(): Promise<void> {
        const markdownFiles = this.host.app.vault
            .getMarkdownFiles()
            .filter((file) => this.host.isCommentableFile(file))
            .sort((left, right) => left.path.localeCompare(right.path));

        let migratedCount = 0;
        for (const file of markdownFiles) {
            if (this.disposed) {
                break;
            }
            const noteContent = await this.host.getCurrentNoteContent(file);
            if (this.disposed) {
                break;
            }
            if (await this.ensureLegacyInlineCommentsMigrated(file, noteContent)) {
                migratedCount += 1;
            }
        }

        void this.host.log?.("info", "persistence", "storage.note.migrate.startup.complete", {
            migratedCount,
        });
    }

    public async replaySyncedSideNoteEvents(targetNotePath?: string): Promise<number> {
        if (this.disposed) {
            return 0;
        }

        const normalizedTargetNotePath = targetNotePath?.trim();
        if (normalizedTargetNotePath) {
            const existingTargetedReplay = this.targetedSyncedEventReplayPromises.get(normalizedTargetNotePath);
            if (existingTargetedReplay) {
                return existingTargetedReplay;
            }

            const targetedReplay = this.replaySyncedSideNoteEventsNow(normalizedTargetNotePath).finally(() => {
                this.targetedSyncedEventReplayPromises.delete(normalizedTargetNotePath);
            });
            this.targetedSyncedEventReplayPromises.set(normalizedTargetNotePath, targetedReplay);
            return targetedReplay;
        }

        if (this.fullSyncedEventReplayPromise) {
            return this.fullSyncedEventReplayPromise;
        }

        this.fullSyncedEventReplayPromise = this.replaySyncedSideNoteEventsNow().finally(() => {
            this.fullSyncedEventReplayPromise = null;
        });
        return this.fullSyncedEventReplayPromise;
    }

    private eventTouchesNotePath(event: SideNoteSyncEvent, notePath: string): boolean {
        if (event.notePath === notePath) {
            return true;
        }

        const payload = getPayloadRecord(event);
        return payload?.notePath === notePath
            || payload?.previousNotePath === notePath
            || payload?.nextNotePath === notePath
            || payload?.previousPath === notePath
            || payload?.nextPath === notePath;
    }

    private async replaySyncedSideNoteEventsNow(targetNotePath?: string): Promise<number> {
        if (this.disposed) {
            return 0;
        }
        await this.sourceIdentityStore.refreshFromLatestPersistedData();
        if (this.disposed) {
            return 0;
        }
        await this.syncEventStore.refreshFromLatestPersistedData();
        if (this.disposed) {
            return 0;
        }
        await this.hydrateSyncedSideNoteSnapshots(targetNotePath);
        if (this.disposed) {
            return 0;
        }
        const events = this.syncEventStore
            .getUnprocessedEvents()
            .filter((event) => !targetNotePath || this.eventTouchesNotePath(event, targetNotePath));
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
            if (this.disposed) {
                return appliedEventCount;
            }
            const targetNotePath = getSyncedEventTargetNotePath(notePath, noteEvents);
            const sourceId = getSyncedEventSourceId(noteEvents);
            const existingSourceRecord = sourceId
                ? this.sourceIdentityStore.getRecordBySourceId(sourceId)
                : this.sourceIdentityStore.getRecordByPathIncludingAliases(notePath)
                    ?? this.sourceIdentityStore.getRecordByPathIncludingAliases(targetNotePath);
            const baseSourceThreads = existingSourceRecord || sourceId
                ? await this.sidecarStorage.readForSource(existingSourceRecord?.sourceId ?? sourceId ?? "", notePath)
                : null;
            const baseThreads = baseSourceThreads
                ?? await this.sidecarStorage.read(notePath)
                ?? [];
            const reduced = reduceSideNoteSyncEvents(
                await this.normalizeThreadsForFile(notePath, baseThreads),
                noteEvents,
            );
            const targetThreads = retargetThreads(reduced.threads, targetNotePath);
            const noteWasDeleted = hasDeleteNoteEvent(noteEvents);
            const targetFile = this.host.getMarkdownFileByPath(targetNotePath);
            const targetNoteContent = targetFile && this.host.isCommentableFile(targetFile)
                ? await this.host.getCurrentNoteContent(targetFile)
                : null;
            if (this.disposed) {
                return appliedEventCount;
            }

            if (
                !noteWasDeleted
                && targetNotePath !== notePath
                && targetNoteContent !== null
                && targetThreads.length > 0
                && !areSnapshotThreadsCompatibleWithFile(targetThreads, targetNoteContent)
            ) {
                void this.host.log?.("warn", "persistence", "sync.plugin-data.rename.skip-incompatible", {
                    sourceNotePath: notePath,
                    targetNotePath,
                    threadCount: targetThreads.length,
                });
                processedEvents.push(...noteEvents);
                continue;
            }

            const sourceRecord = sourceId
                ? await this.sourceIdentityStore.attachPathToSource(sourceId, targetNotePath, {
                    aliases: [notePath],
                })
                : await this.sourceIdentityStore.recordRename(notePath, targetNotePath);

            if (noteWasDeleted) {
                await this.sidecarStorage.remove(notePath);
                await this.sidecarStorage.removeForSource(sourceRecord.sourceId);
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
                await this.writeSourceAndPathSidecars(sourceRecord.sourceId, targetNotePath, targetThreads);
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

            if (targetFile && this.host.isCommentableFile(targetFile) && targetNoteContent !== null) {
                const parsed = await this.parseAndNormalizeFileComments(targetNotePath, targetNoteContent);
                await this.syncThreadsIntoVisibleNoteContent(targetFile, parsed.mainContent, noteWasDeleted ? [] : targetThreads);
                this.clearPendingCommentPersistTimer(targetNotePath);
                await this.afterCommentsChanged(targetNotePath);
            } else {
                this.host.getAggregateCommentIndex().updateFile(targetNotePath, noteWasDeleted ? [] : targetThreads);
            }

            processedEvents.push(...noteEvents);
            appliedEventCount += reduced.appliedEvents.length;
        }

        if (this.disposed) {
            return appliedEventCount;
        }
        await this.syncEventStore.markEventsProcessed(processedEvents);
        if (this.disposed) {
            return appliedEventCount;
        }
        await this.compactSyncedSideNoteEventsForSnapshots(compactionSnapshots);
        void this.host.log?.("info", "persistence", "sync.plugin-data.replay.complete", {
            appliedEventCount,
            ...(targetNotePath ? { targetNotePath } : {}),
        });
        return appliedEventCount;
    }

    public async migrateSidecarsToSyncedPluginDataOnStartup(): Promise<void> {
        const storedRecords = (await this.sidecarStorage.listStoredComments())
            .filter((record) => record.threads.length > 0);

        let migratedCount = 0;
        for (const record of storedRecords) {
            if (this.disposed) {
                break;
            }
            const file = this.host.getMarkdownFileByPath(record.notePath);
            if (!this.host.isCommentableFile(file)) {
                continue;
            }

            const normalizedThreads = await this.normalizeThreadsForFile(file.path, record.threads);
            const noteContent = await this.host.getCurrentNoteContent(file);
            if (this.disposed) {
                break;
            }
            const sourceRecord = await this.ensureSourceIdentityForFilePath(file.path, noteContent);
            await this.writeSourceAndPathSidecars(sourceRecord.sourceId, file.path, normalizedThreads);
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

    public async migrateSourceIdentitiesOnStartup(): Promise<void> {
        await this.sourceIdentityStore.refreshFromLatestPersistedData();
        const filePaths = await this.getPersistedCommentSourcePaths();
        const snapshotsByPath = new Map(
            this.getLatestSnapshotsByNotePath(this.syncEventStore.getSnapshots())
                .map((snapshot) => [snapshot.notePath, snapshot]),
        );

        let sourceCount = 0;
        let sourceSidecarCount = 0;
        for (const filePath of filePaths) {
            if (this.disposed) {
                break;
            }
            const file = this.host.getMarkdownFileByPath(filePath);
            if (!this.host.isCommentableFile(file)) {
                continue;
            }
            const noteContent = await this.host.getCurrentNoteContent(file);
            if (this.disposed) {
                break;
            }
            const sourceRecord = await this.ensureSourceIdentityForFilePath(file.path, noteContent);
            sourceCount += 1;

            const sourceThreads = await this.sidecarStorage.readForSource(sourceRecord.sourceId, file.path);
            if (sourceThreads) {
                continue;
            }

            const pathThreads = await this.sidecarStorage.read(file.path);
            if (pathThreads) {
                const normalizedThreads = await this.normalizeThreadsForFile(file.path, pathThreads);
                await this.writeSourceAndPathSidecars(sourceRecord.sourceId, file.path, normalizedThreads);
                sourceSidecarCount += 1;
                continue;
            }

            const snapshot = snapshotsByPath.get(file.path);
            if (snapshot && snapshot.threads.length > 0) {
                const normalizedThreads = await this.normalizeThreadsForFile(file.path, snapshot.threads);
                if (!areSnapshotThreadsCompatibleWithFile(normalizedThreads, noteContent)) {
                    void this.host.log?.("warn", "persistence", "source-identity.snapshot.skip-incompatible", {
                        targetNotePath: file.path,
                        threadCount: normalizedThreads.length,
                    });
                    continue;
                }
                await this.writeSourceAndPathSidecars(sourceRecord.sourceId, file.path, normalizedThreads);
                sourceSidecarCount += 1;
            }
        }

        void this.host.log?.("info", "persistence", "source-identity.migrate.complete", {
            sourceCount,
            sourceSidecarCount,
        });
    }

    public async handleMarkdownFileModified(file: TFile): Promise<void> {
        if (this.disposed || file.extension !== "md") {
            return;
        }

        try {
            const fileContent = await this.host.getCurrentNoteContent(file);
            if (this.disposed) {
                return;
            }
            const sourceRecord = await this.ensureSourceIdentityForFilePath(file.path, fileContent);
            const storedContent = await this.host.getStoredNoteContent(file);
            if (this.disposed) {
                return;
            }
            const hasSidecar = await this.sidecarStorage.exists(file.path);
            if (!hasSidecar && fileContent !== storedContent && this.host.getMarkdownViewForFile(file)) {
                const currentParsed = await this.parseAndNormalizeFileComments(file.path, fileContent);
                const storedParsed = await this.parseAndNormalizeFileComments(file.path, storedContent);
                if (currentParsed.mainContent === storedParsed.mainContent && storedParsed.threads.length > 0) {
                    const synced = await this.syncThreadsIntoVisibleNoteContent(file, currentParsed.mainContent, storedParsed.threads);
                    await this.writeSourceAndPathSidecars(sourceRecord.sourceId, file.path, synced.threads);
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
                await this.writeSourceAndPathSidecars(sourceRecord.sourceId, file.path, parsed.threads);
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
        if (this.disposed || !file || this.host.isAllCommentsNotePath(file.path) || !this.host.isCommentableFile(file)) {
            return [];
        }

        await this.replaySyncedSideNoteEvents(file.path);
        if (this.disposed) {
            return [];
        }
        const noteContent = await this.host.getCurrentNoteContent(file);
        if (this.disposed) {
            return [];
        }
        const parsed = await this.syncFileCommentsFromContent(file, noteContent);
        return parsed.comments;
    }

    public async ensureIndexedCommentsLoaded(): Promise<void> {
        if (this.disposed) {
            return;
        }
        await this.replaySyncedSideNoteEvents();
        if (this.disposed) {
            return;
        }
        const initializedNow = await this.ensureAggregateCommentIndexInitialized();
        if (initializedNow) {
            await this.refreshAggregateNoteNow();
        }
    }

    public async persistCommentsForFile(file: TFile, options: PersistOptions = {}): Promise<void> {
        if (this.disposed) {
            return;
        }
        if (options.skipCommentViewRefresh) {
            this.scheduleCommentViewRefreshSuppression(file.path, 1);
        }

        await this.writeCommentsForFile(file, options);
    }

    public scheduleAggregateNoteRefresh(): void {
        if (this.disposed) {
            return;
        }
        if (this.aggregateRefreshTimer !== null) {
            window.clearTimeout(this.aggregateRefreshTimer);
        }

        this.aggregateRefreshTimer = window.setTimeout(() => {
            this.aggregateRefreshTimer = null;
            void this.enqueueAggregateNoteRefresh();
        }, 150);
    }

    public async refreshAggregateNoteNow(): Promise<void> {
        if (this.disposed) {
            return;
        }
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
        if (this.disposed) {
            return;
        }
        this.clearPendingCommentPersistTimer(file.path);
        this.pendingCommentPersistTimers[file.path] = window.setTimeout(() => {
            delete this.pendingCommentPersistTimers[file.path];
            void this.flushDeferredCommentPersist(file.path);
        }, 750);
    }

    private async flushDeferredCommentPersist(filePath: string): Promise<void> {
        if (this.disposed) {
            return;
        }
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
        if (this.disposed) {
            return false;
        }

        let initializedNow = false;
        if (!this.aggregateIndexInitializationPromise) {
            this.aggregateIndexInitializationPromise = (async () => {
                const persistedSourceRecords = await this.getPersistedCommentSourceRecords();

                for (const record of persistedSourceRecords) {
                    if (this.disposed) {
                        break;
                    }
                    const file = this.host.getMarkdownFileByPath(record.notePath);
                    if (!this.host.isCommentableFile(file)) {
                        this.host.getAggregateCommentIndex().deleteFile(record.notePath);
                        continue;
                    }
                    const threads = await this.normalizeThreadsForFile(file.path, record.threads);
                    this.host.getAggregateCommentIndex().updateFile(file.path, threads);
                }

                if (!this.disposed) {
                    this.aggregateIndexInitialized = true;
                    initializedNow = true;
                }
            })().finally(() => {
                this.aggregateIndexInitializationPromise = null;
            });
        }

        await this.aggregateIndexInitializationPromise;
        return initializedNow;
    }

    private async getPersistedCommentSourceRecords(): Promise<RemovedSidecarComments[]> {
        if (this.disposed) {
            return [];
        }
        await this.syncEventStore.refreshFromLatestPersistedData();
        if (this.disposed) {
            return [];
        }

        const recordsByNotePath = new Map<string, RemovedSidecarComments>();
        for (const record of await this.sidecarStorage.listStoredComments()) {
            if (record.threads.length > 0) {
                recordsByNotePath.set(record.notePath, record);
            }
        }

        for (const snapshot of this.getLatestSnapshotsByNotePath(this.syncEventStore.getSnapshots())) {
            if (!recordsByNotePath.has(snapshot.notePath) && snapshot.threads.length > 0) {
                recordsByNotePath.set(snapshot.notePath, {
                    notePath: snapshot.notePath,
                    threads: snapshot.threads,
                });
            }
        }

        return Array.from(recordsByNotePath.values())
            .sort((left, right) => left.notePath.localeCompare(right.notePath));
    }

    private isMissingStoredCommentSource(filePath: string): boolean {
        if (this.host.isAllCommentsNotePath(filePath)) {
            return false;
        }

        return !this.host.isCommentableFile(this.host.getMarkdownFileByPath(filePath));
    }

    private async getPersistedCommentSourcePaths(): Promise<string[]> {
        if (this.disposed) {
            return [];
        }
        await this.sourceIdentityStore.refreshFromLatestPersistedData();
        if (this.disposed) {
            return [];
        }
        await this.syncEventStore.refreshFromLatestPersistedData();
        if (this.disposed) {
            return [];
        }

        const filePaths = new Set<string>();
        for (const snapshot of this.syncEventStore.getSnapshots()) {
            if (snapshot.threads.length > 0) {
                filePaths.add(snapshot.notePath);
            }
        }
        for (const sidecarRecord of await this.sidecarStorage.listStoredComments()) {
            if (sidecarRecord.threads.length > 0) {
                filePaths.add(sidecarRecord.notePath);
            }
        }
        for (const thread of this.host.getAggregateCommentIndex().getAllThreads()) {
            filePaths.add(thread.filePath);
        }

        return Array.from(filePaths)
            .sort((left, right) => left.localeCompare(right));
    }

    private async pruneMissingStoredCommentSources(): Promise<number> {
        let prunedCount = 0;
        for (const filePath of await this.getPersistedCommentSourcePaths()) {
            if (this.disposed) {
                return prunedCount;
            }
            if (!this.isMissingStoredCommentSource(filePath)) {
                continue;
            }

            await this.deleteStoredComments(filePath);
            this.host.getCommentManager().replaceCommentsForFile(filePath, []);
            this.host.getAggregateCommentIndex().deleteFile(filePath);
            prunedCount += 1;
        }

        if (prunedCount > 0) {
            void this.host.log?.("info", "persistence", "storage.missing-sources.pruned", {
                prunedCount,
            });
        }
        return prunedCount;
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

    private async hasKnownCommentsForSnapshot(notePath: string): Promise<boolean> {
        if (this.host.getCommentManager().getThreadsForFile(notePath).length > 0) {
            return true;
        }
        if (this.host.getAggregateCommentIndex().getThreadsForFile(notePath).length > 0) {
            return true;
        }

        const sourceRecord = this.sourceIdentityStore.getRecordByPath(notePath);
        if (sourceRecord) {
            const sourceOrPathSidecar = await this.readSourceOrPathSidecar(sourceRecord, notePath);
            return (sourceOrPathSidecar?.threads.length ?? 0) > 0;
        }

        return (await this.sidecarStorage.read(notePath) ?? []).length > 0;
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

    private async hydrateSyncedSideNoteSnapshots(targetNotePath?: string): Promise<number> {
        if (this.disposed) {
            return 0;
        }
        const snapshots = this.getLatestSnapshotsByNotePath(this.syncEventStore.getSnapshots())
            .filter((snapshot) => !targetNotePath || snapshot.notePath === targetNotePath);
        if (snapshots.length === 0) {
            return 0;
        }

        let hydratedCount = 0;
        let coveredWatermarks: Record<string, number> = {};
        for (const snapshot of snapshots) {
            if (this.disposed) {
                return hydratedCount;
            }
            coveredWatermarks = mergeSyncWatermarks(coveredWatermarks, snapshot.coveredWatermarks);
            if (snapshot.threads.length === 0 && !(await this.hasKnownCommentsForSnapshot(snapshot.notePath))) {
                continue;
            }
            const file = this.host.getMarkdownFileByPath(snapshot.notePath);
            if (!this.host.isCommentableFile(file)) {
                await this.deleteStoredComments(snapshot.notePath);
                this.host.getCommentManager().replaceCommentsForFile(snapshot.notePath, []);
                this.host.getAggregateCommentIndex().deleteFile(snapshot.notePath);
                continue;
            }

            const noteContent = await this.host.getCurrentNoteContent(file);
            if (this.disposed) {
                return hydratedCount;
            }
            const sourceRecord = await this.ensureSourceIdentityForFilePath(
                snapshot.notePath,
                noteContent,
            );
            if (this.disposed) {
                return hydratedCount;
            }
            const existingSidecarThreads = (await this.sidecarStorage.readForSource(sourceRecord.sourceId, snapshot.notePath))
                ?? await this.sidecarStorage.read(snapshot.notePath);
            const normalizedSnapshotThreads = await this.normalizeThreadsForFile(snapshot.notePath, snapshot.threads);
            const normalizedExistingThreads = existingSidecarThreads
                ? await this.normalizeThreadsForFile(snapshot.notePath, existingSidecarThreads)
                : null;
            if (
                normalizedSnapshotThreads.length > 0
                && !areSnapshotThreadsCompatibleWithFile(normalizedSnapshotThreads, noteContent)
            ) {
                void this.host.log?.("warn", "persistence", "sync.plugin-data.snapshot.skip-incompatible", {
                    targetNotePath: snapshot.notePath,
                    threadCount: normalizedSnapshotThreads.length,
                });
                continue;
            }
            const normalizedThreads = normalizedExistingThreads && normalizedSnapshotThreads.length > 0
                ? mergeSnapshotThreadsWithSidecar(normalizedExistingThreads, normalizedSnapshotThreads)
                : normalizedSnapshotThreads;
            if (
                normalizedExistingThreads
                && areCommentThreadListsEqual(normalizedExistingThreads, normalizedThreads)
            ) {
                continue;
            }

            await this.writeSourceAndPathSidecars(sourceRecord.sourceId, snapshot.notePath, normalizedThreads);
            const parsed = await this.parseAndNormalizeFileComments(snapshot.notePath, noteContent);
            await this.syncThreadsIntoVisibleNoteContent(file, parsed.mainContent, normalizedThreads);
            this.clearPendingCommentPersistTimer(snapshot.notePath);
            await this.afterCommentsChanged(snapshot.notePath);
            hydratedCount += 1;
        }

        if (this.disposed) {
            return hydratedCount;
        }
        if (!targetNotePath) {
            await this.syncEventStore.markWatermarksProcessed(this.syncEventStore.getCompactedWatermarks());
        } else {
            await this.syncEventStore.markWatermarksProcessed(coveredWatermarks);
        }
        if (hydratedCount > 0) {
            void this.host.log?.("info", "persistence", "sync.plugin-data.snapshot.hydrate", {
                hydratedCount,
                ...(targetNotePath ? { targetNotePath } : {}),
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

    private async readLegacyCacheCandidate(storagePath: string): Promise<LegacySourceCandidate | null> {
        try {
            const rawContent = await this.host.app.vault.adapter.read(storagePath);
            const parsed = JSON.parse(rawContent) as unknown;
            if (
                !parsed
                || typeof parsed !== "object"
                || Array.isArray(parsed)
                || typeof (parsed as { notePath?: unknown }).notePath !== "string"
                || !Array.isArray((parsed as { threads?: unknown }).threads)
            ) {
                return null;
            }

            const notePath = (parsed as { notePath: string }).notePath;
            const threads = await this.normalizeThreadsForFile(
                notePath,
                (parsed as { threads: CommentThread[] }).threads,
            );
            if (threads.length === 0) {
                return null;
            }

            return {
                notePath,
                threads,
                updatedAt: 0,
                origin: "cache",
            };
        } catch {
            return null;
        }
    }

    private async readLegacyCacheCandidates(): Promise<LegacySourceCandidate[]> {
        const cacheDirPath = `${this.host.getPluginDataDirPath()}/cache`;
        try {
            if (!(await this.host.app.vault.adapter.exists(cacheDirPath))) {
                return [];
            }

            const listed = await this.host.app.vault.adapter.list(cacheDirPath);
            const candidates: LegacySourceCandidate[] = [];
            for (const filePath of listed.files.filter((path) => path.endsWith(".json"))) {
                const candidate = await this.readLegacyCacheCandidate(filePath);
                if (candidate) {
                    candidates.push(candidate);
                }
            }
            return candidates;
        } catch {
            return [];
        }
    }

    private async findRenamedSourceCandidate(filePath: string, noteContent: string): Promise<LegacySourceCandidate | null> {
        const snapshotCandidates: LegacySourceCandidate[] = this.getLatestSnapshotsByNotePath(this.syncEventStore.getSnapshots())
            .filter((snapshot) =>
                snapshot.notePath !== filePath
                && snapshot.threads.length > 0)
            .map((snapshot) => ({
                notePath: snapshot.notePath,
                threads: snapshot.threads,
                updatedAt: snapshot.updatedAt,
                origin: "snapshot" as const,
                coveredWatermarks: snapshot.coveredWatermarks,
            }));
        const cacheCandidates = await this.readLegacyCacheCandidates();
        const candidates = [...snapshotCandidates, ...cacheCandidates]
            .filter((candidate) =>
                candidate.notePath !== filePath
                && candidate.threads.length > 0
                && !this.host.getMarkdownFileByPath(candidate.notePath)
                && this.canRecoverLegacyCandidateForFile(candidate.notePath, filePath)
                && isStrongLegacySourceMatch(candidate, filePath, noteContent))
            .map((candidate) => ({
                candidate,
                match: getCandidateContentMatch(candidate, filePath, noteContent),
            }))
            .sort((left, right) =>
                right.match.score - left.match.score
                || right.match.matchedAnchorCount - left.match.matchedAnchorCount
                || right.candidate.updatedAt - left.candidate.updatedAt
                || right.candidate.threads.length - left.candidate.threads.length
                || right.candidate.notePath.localeCompare(left.candidate.notePath));

        if (candidates.length === 0) {
            return null;
        }

        const [best, second] = candidates;
        if (
            second
            && second.match.score === best.match.score
            && second.match.matchedAnchorCount === best.match.matchedAnchorCount
            && second.candidate.updatedAt === best.candidate.updatedAt
        ) {
            void this.host.log?.("warn", "persistence", "source-identity.recover.ambiguous", {
                targetNotePath: filePath,
                candidateCount: candidates.length,
                bestNotePath: best.candidate.notePath,
                secondNotePath: second.candidate.notePath,
            });
            return null;
        }

        return best.candidate;
    }

    private canRecoverLegacyCandidateForFile(candidateNotePath: string, targetFilePath: string): boolean {
        const claimedSourceRecord = this.sourceIdentityStore.getRecordByPathIncludingAliases(candidateNotePath);
        if (!claimedSourceRecord || claimedSourceRecord.currentPath === targetFilePath) {
            return true;
        }

        return !this.host.getMarkdownFileByPath(claimedSourceRecord.currentPath);
    }

    private async recoverRenamedSourceThreadsForFile(
        file: TFile,
        noteContent: string,
    ): Promise<CommentThread[] | null> {
        const candidate = await this.findRenamedSourceCandidate(file.path, noteContent);
        if (!candidate) {
            return null;
        }

        const normalizedThreads = await this.normalizeThreadsForFile(file.path, candidate.threads);
        if (normalizedThreads.length === 0) {
            return null;
        }

        const fingerprint = await this.getSourceContentFingerprint(noteContent);
        const sourceRecord = await this.sourceIdentityStore.recordRename(candidate.notePath, file.path, fingerprint);
        await this.writeSourceAndPathSidecars(sourceRecord.sourceId, file.path, normalizedThreads);
        await this.sidecarStorage.remove(candidate.notePath);
        await this.syncEventStore.appendLocalEvents(candidate.notePath, [{
            op: "renameSource",
            payload: {
                sourceId: sourceRecord.sourceId,
                previousPath: candidate.notePath,
                nextPath: file.path,
                previousNotePath: candidate.notePath,
                nextNotePath: file.path,
            },
        }]);
        await this.compactSyncedSideNoteEventsForSnapshots([{
            notePath: file.path,
            coveredNotePath: candidate.notePath,
            threads: normalizedThreads,
        }, {
            notePath: file.path,
            threads: normalizedThreads,
        }]);
        void this.host.log?.("info", "persistence", "sync.plugin-data.rename.recover", {
            previousNotePath: candidate.notePath,
            nextNotePath: file.path,
            threadCount: normalizedThreads.length,
            origin: candidate.origin,
        });
        return normalizedThreads;
    }

    private async writeCommentsForFile(file: TFile, options: PersistOptions = {}): Promise<string> {
        this.clearPendingCommentPersistTimer(file.path);
        this.host.getCommentManager().purgeExpiredDeletedComments();
        const threads = this.host.getCommentManager().getThreadsForFile(file.path, { includeDeleted: true });
        void this.host.log?.("info", "persistence", "storage.note.write.begin", {
            filePath: file.path,
            threadCount: threads.length,
        });
        const currentContent = await this.host.getCurrentNoteContent(file);
        const sourceRecord = await this.ensureSourceIdentityForFilePath(file.path, currentContent);
        const previousThreads = (await this.sidecarStorage.readForSource(sourceRecord.sourceId, file.path))
            ?? await this.sidecarStorage.read(file.path)
            ?? [];
        const parsedCurrentContent = await this.parseAndNormalizeFileComments(file.path, currentContent);
        const synced = await this.syncThreadsIntoVisibleNoteContent(file, parsedCurrentContent.mainContent, threads);
        const eventInputs = buildSideNoteSyncEventInputsForThreadDiff(
            await this.normalizeThreadsForFile(file.path, previousThreads),
            synced.threads,
        );
        await this.syncEventStore.appendLocalEvents(file.path, eventInputs);
        await this.writeSourceAndPathSidecars(sourceRecord.sourceId, file.path, synced.threads);
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
        source: CanonicalCommentStorageSource;
    }> {
        const inlineParsed = await this.parseAndNormalizeFileComments(file.path, noteContent);
        const sourceRecord = await this.ensureSourceIdentityForFilePath(file.path, noteContent);
        const sidecarResult = await this.readSourceOrPathSidecar(sourceRecord, file.path);
        const sidecarThreads = sidecarResult?.threads ?? null;
        const storagePlan = planCanonicalCommentStorage({
            sidecarRecordFound: sidecarResult !== null,
            inlineThreadCount: inlineParsed.threads.length,
            hasThreadedInlineBlock: getManagedSectionKind(noteContent) === "threaded",
        });

        if (storagePlan.action === "use-sidecar" && sidecarThreads) {
            const canonicalThreads = await this.reconcileLegacyInlineThreadsWithSidecar(
                file.path,
                sidecarThreads,
                inlineParsed.threads,
            );
            if (storagePlan.shouldStripInlineBlock) {
                await this.stripInlineManagedSectionIfPresent(file, noteContent);
            }

            return {
                mainContent: inlineParsed.mainContent,
                threads: canonicalThreads,
                source: storagePlan.source,
            };
        }

        if (storagePlan.shouldRecoverRenamedSource) {
            if (storagePlan.shouldStripInlineBlock) {
                await this.stripInlineManagedSectionIfPresent(file, noteContent);
            }
            const recoveredThreads = await this.recoverRenamedSourceThreadsForFile(file, noteContent);
            if (recoveredThreads) {
                return {
                    mainContent: inlineParsed.mainContent,
                    threads: recoveredThreads,
                    source: "sidecar",
                };
            }
            return {
                mainContent: inlineParsed.mainContent,
                threads: [],
                source: storagePlan.source,
            };
        }

        await this.writeSourceAndPathSidecars(sourceRecord.sourceId, file.path, inlineParsed.threads);
        await this.syncEventStore.appendLocalEvents(
            file.path,
            buildSideNoteSyncEventInputsForThreadDiff([], inlineParsed.threads),
        );
        await this.compactSyncedSideNoteEventsForSnapshots([{
            notePath: file.path,
            threads: inlineParsed.threads,
        }]);
        if (storagePlan.shouldStripInlineBlock) {
            await this.stripInlineManagedSectionIfPresent(file, noteContent);
        }
        void this.host.log?.("info", "persistence", "storage.note.migrate.success", {
            filePath: file.path,
            threadCount: inlineParsed.threads.length,
        });
        return {
            mainContent: inlineParsed.mainContent,
            threads: inlineParsed.threads,
            source: storagePlan.source,
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
        const sourceRecord = await this.ensureSourceIdentityForFilePath(file.path, noteContent);
        await this.syncEventStore.appendLocalEvents(
            file.path,
            buildSideNoteSyncEventInputsForThreadDiff([], normalizedThreads),
        );
        await this.writeSourceAndPathSidecars(sourceRecord.sourceId, file.path, normalizedThreads);
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
        const sourceRecord = await this.ensureSourceIdentityForFilePath(filePath);
        await this.writeSourceAndPathSidecars(sourceRecord.sourceId, filePath, normalizedMergedThreads);
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
        if (this.disposed) {
            return;
        }
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
        if (this.disposed) {
            return;
        }
        const existingCount = this.commentViewRefreshSuppressions.get(filePath) ?? 0;
        this.commentViewRefreshSuppressions.set(filePath, Math.max(existingCount, count));
    }

    private consumeCommentViewRefreshSuppression(filePath: string): boolean {
        if (this.disposed) {
            return false;
        }
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
        if (this.disposed) {
            return;
        }
        if (this.aggregateRefreshPromise) {
            this.aggregateRefreshQueued = true;
            await this.aggregateRefreshPromise;
            return;
        }

        do {
            if (this.disposed) {
                return;
            }
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
        if (this.disposed) {
            return;
        }
        void this.host.log?.("info", "index", "index.refresh.begin", {
            showResolved: this.host.shouldShowResolvedComments(),
        });
        try {
            const prunedMissingSourceCount = await this.pruneMissingStoredCommentSources();
            if (this.disposed) {
                return;
            }
            await this.ensureAggregateCommentIndexInitialized();
            if (this.disposed) {
                return;
            }
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
                const legacyFile = LEGACY_ALL_COMMENTS_NOTE_PATHS
                    .map((path) => this.host.getMarkdownFileByPath(path))
                    .find((file): file is TFile => !!file)
                    ?? this.host.getMarkdownFileByPath(LEGACY_ALL_COMMENTS_NOTE_PATH);
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
                    prunedMissingSourceCount,
                });
                return;
            }

            const currentContent = await this.host.getCurrentNoteContent(existingFile);
            if (this.disposed) {
                return;
            }
            const openView = this.host.getMarkdownViewForFile(existingFile);
            const contentChanged = currentContent !== nextContent;
            if (openView) {
                await this.host.syncIndexNoteLeafMode(openView.leaf);
                const viewContentChanged = openView.getViewData() !== nextContent;
                if (viewContentChanged) {
                    openView.setViewData(nextContent, false);
                }
                if (contentChanged) {
                    await openView.save();
                }
                if ((contentChanged || viewContentChanged) && openView.getMode() === "preview") {
                    openView.previewMode.rerender(true);
                }
            }

            if (shouldSkipAggregateViewRefresh(currentContent, nextContent, !!openView)) {
                void this.host.log?.("info", "index", "index.refresh.success", {
                    commentCount: comments.length,
                    skippedViewRefresh: true,
                    prunedMissingSourceCount,
                });
                return;
            }

            if (!openView) {
                await this.host.app.vault.modify(existingFile, nextContent);
            }

            void this.host.log?.("info", "index", "index.refresh.success", {
                commentCount: comments.length,
                skippedViewRefresh: false,
                prunedMissingSourceCount,
            });
        } catch (error) {
            void this.host.log?.("error", "index", "index.refresh.error", {
                error,
            });
            throw error;
        }
    }
}
