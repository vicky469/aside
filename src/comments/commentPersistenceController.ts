import type { CachedMetadata, MarkdownView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import type { Comment, CommentManager, CommentThread, CommentThreadEntry } from "../commentManager";
import { normalizeCommentThread, threadToComment } from "../commentManager";
import { getPageCommentLabel } from "../core/anchors/commentAnchors";
import {
    type AllCommentsNoteBuildOptions,
    buildAllCommentsNoteContent,
} from "../core/derived/allCommentsNote";
import {
    syncLoadedCommentsForCurrentNote,
} from "../core/rules/commentSyncPolicy";
import {
    getVisibleNoteContent,
    type ParsedNoteComments,
} from "../core/storage/noteCommentStorage";
import {
    planCanonicalCommentStorage,
    type CanonicalCommentStorageSource,
} from "../core/storage/canonicalCommentStorage";
import { normalizeDeletedAt, purgeExpiredDeletedThreads } from "../core/rules/deletedCommentVisibility";
import { isMarkdownCommentablePath, isPageNoteCapablePath } from "../core/rules/commentableFiles";
import { SidecarCommentStorage, type RemovedSidecarComments } from "../core/storage/sidecarCommentStorage";
import {
    buildSideNoteSyncEventInputsForThreadDiff,
    reduceSideNoteSyncEvents,
    type SideNoteSyncEvent,
} from "../storage/comments/sideNoteSyncEvents";
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
import {
    retargetCommentThreads,
    type CommentThreadRetargetOptions,
} from "../domain/comments/commentThreadRetarget";
import type {
    CommentFileRetarget,
    CommentFileRetargetFailure,
    CommentFileRetargetResult,
} from "../domain/comments/folderCommentRetarget";
import {
    ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    isPluginEventExecutionActive,
    type PluginEventExecutionContext,
} from "../core/events/pluginEventExecutionContext";

type PersistOptions = {
    immediateAggregateRefresh?: boolean;
    skipCommentViewRefresh?: boolean;
    refreshEditorDecorations?: boolean;
    refreshMarkdownPreviews?: boolean;
};

type CommitThreadEntryOptions = PersistOptions & {
    insertAfterCommentId?: string;
    onlyIfEntryAbsentOrBlank?: boolean;
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

interface AggregateRefreshRequest {
    context: PluginEventExecutionContext;
    skipPersistenceMaintenance: boolean;
    resolve(): void;
    reject(error: unknown): void;
}

type AggregateRefreshRequestInput = Pick<
    AggregateRefreshRequest,
    "context" | "skipPersistenceMaintenance"
>;

export interface CommentPersistenceHost {
    app: Plugin["app"];
    getAllCommentsNotePath(): string;
    getIndexHeaderImageUrl(): string;
    getIndexHeaderImageCaption(): string;
    getMarkdownViewForFile(file: TFile): MarkdownView | null;
    getMarkdownFileByPath(filePath: string): TFile | null;
    getCurrentNoteContent(file: TFile): Promise<string>;
    getStoredNoteContent(file: TFile): Promise<string>;
    getParsedNoteComments(filePath: string, noteContent: string): ParsedNoteComments;
    getPluginDataDirPath(): string;
    getSideNoteSyncDeviceId(): string;
    readPersistedPluginData(): PersistedPluginData;
    loadPersistedPluginData?(): Promise<PersistedPluginData | null>;
    writePersistedPluginData(
        data: PersistedPluginData,
        context?: PluginEventExecutionContext,
    ): Promise<void>;
    isAllCommentsNotePath(filePath: string): boolean;
    isCommentableFile(file: TFile | null): file is TFile;
    isPageNoteCapableFile?(file: TFile | null): file is TFile;
    isMarkdownEditorFocused(file: TFile): boolean;
    getCommentManager(): CommentManager;
    getAggregateCommentIndex(): AggregateCommentIndex;
    createCommentId(): string;
    hashText(text: string): Promise<string>;
    syncDerivedCommentLinksForFile(file: TFile, noteContent: string, comments: Array<Comment | CommentThread>): void;
    refreshCommentViews(
        options: { skipDataRefresh?: boolean } | undefined,
        context: PluginEventExecutionContext,
    ): Promise<void>;
    refreshAllCommentsSidebarViews(
        options: { skipDataRefresh?: boolean } | undefined,
        context: PluginEventExecutionContext,
    ): Promise<void>;
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

function collectFrontmatterTagValues(value: unknown, tags: string[]): void {
    if (typeof value === "string") {
        tags.push(...value.split(/[,\s]+/u).filter(Boolean));
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            collectFrontmatterTagValues(item, tags);
        }
    }
}

function collectCachedMetadataTags(cache: CachedMetadata | null): string[] {
    if (!cache) {
        return [];
    }

    const tags = (cache.tags ?? [])
        .map((tag) => tag.tag)
        .filter(Boolean);
    collectFrontmatterTagValues(cache.frontmatter?.tags, tags);
    collectFrontmatterTagValues(cache.frontmatter?.tag, tags);
    return tags;
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

function cloneThreadEntry(entry: CommentThreadEntry): CommentThreadEntry {
    const deletedAt = normalizeDeletedAt(entry.deletedAt);
    return {
        id: entry.id,
        body: entry.body,
        timestamp: entry.timestamp,
        ...(deletedAt !== undefined ? { deletedAt } : {}),
        ...(entry.anchor ? { anchor: { ...entry.anchor } } : {}),
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

export class CommentPersistenceController {
    private readonly pendingCommentPersistTimers: Record<string, number> = {};
    private readonly commentViewRefreshSuppressions = new Map<string, number>();
    private readonly sidecarStorage: SidecarCommentStorage;
    private readonly syncEventStore: SideNoteSyncEventStore;
    private readonly sourceIdentityStore: SourceIdentityStore;
    private aggregateRefreshTimer: number | null = null;
    private readonly aggregateRefreshTimerRequests: AggregateRefreshRequestInput[] = [];
    private aggregateRefreshPromise: Promise<void> | null = null;
    private readonly aggregateRefreshRequests: AggregateRefreshRequest[] = [];
    private aggregateIndexInitialized = false;
    private aggregateIndexInitializationPromise: Promise<void> | null = null;
    private fullSyncedEventReplayPromise: Promise<number> | null = null;
    private readonly targetedSyncedEventReplayPromises = new Map<string, Promise<number>>();
    private readonly commentPersistTails = new Map<string, Promise<void>>();
    private readonly commentPersistPathByFile = new WeakMap<TFile, string>();
    private disposed = false;

    constructor(private readonly host: CommentPersistenceHost) {
        this.sidecarStorage = new SidecarCommentStorage({
            adapter: host.app.vault.adapter,
            pluginDirPath: host.getPluginDataDirPath(),
            hashText: (text) => host.hashText(text),
        });
        this.syncEventStore = new SideNoteSyncEventStore({
            readPersistedPluginData: () => host.readPersistedPluginData(),
            readLatestPersistedPluginData: () => host.loadPersistedPluginData?.() ?? Promise.resolve(host.readPersistedPluginData()),
            writePersistedPluginData: (data, context) => host.writePersistedPluginData(data, context),
            getDeviceId: () => host.getSideNoteSyncDeviceId(),
            createEventId: () => host.createCommentId(),
            hashText: (text) => host.hashText(text),
            now: () => Date.now(),
        });
        this.sourceIdentityStore = new SourceIdentityStore({
            readPersistedPluginData: () => host.readPersistedPluginData(),
            readLatestPersistedPluginData: () => host.loadPersistedPluginData?.() ?? Promise.resolve(host.readPersistedPluginData()),
            writePersistedPluginData: (data, context) => host.writePersistedPluginData(data, context),
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
        this.commentPersistTails.clear();
        for (const request of this.aggregateRefreshRequests.splice(0)) {
            request.resolve();
        }
        this.aggregateRefreshTimerRequests.length = 0;
        this.commentViewRefreshSuppressions.clear();
    }

    public reviveForLoad(): CommentPersistenceController {
        return this.disposed
            ? new CommentPersistenceController(this.host)
            : this;
    }

    private isPageNoteCapableFile(file: TFile | null): file is TFile {
        return this.host.isPageNoteCapableFile?.(file) ?? this.host.isCommentableFile(file);
    }

    private getPageNoteCapableFileByPath(filePath: string): TFile | null {
        const markdownFile = this.host.getMarkdownFileByPath(filePath);
        if (this.isPageNoteCapableFile(markdownFile)) {
            return markdownFile;
        }

        const vault = this.host.app.vault as Plugin["app"]["vault"] & {
            getAbstractFileByPath?: (path: string) => unknown;
        };
        const file = vault.getAbstractFileByPath?.(filePath);
        return isTFileLike(file) && this.isPageNoteCapableFile(file) ? file : null;
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
        await this.sourceIdentityStore.refreshFromLatestPersistedData(ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
        const fingerprint = noteContent === undefined
            ? null
            : await this.getSourceContentFingerprint(noteContent);
        const existingRecord = this.sourceIdentityStore.getRecordByPath(filePath);
        if (
            existingRecord
            && existingRecord.currentPath !== filePath
            && !!this.getPageNoteCapableFileByPath(existingRecord.currentPath)
        ) {
            return this.sourceIdentityStore.createSourceForPath(filePath, fingerprint);
        }
        return this.sourceIdentityStore.ensureSourceForPath(filePath, fingerprint);
    }

    private async ensureSourceIdentityForFilePathForEvent(
        filePath: string,
        noteContent: string | undefined,
        context: PluginEventExecutionContext,
    ): Promise<SourceIdentityRecord | null> {
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        await this.sourceIdentityStore.refreshFromLatestPersistedData(context);
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        const fingerprint = noteContent === undefined
            ? null
            : await this.getSourceContentFingerprint(noteContent);
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        const existingRecord = this.sourceIdentityStore.getRecordByPath(filePath);
        if (
            existingRecord
            && existingRecord.currentPath !== filePath
            && !!this.getPageNoteCapableFileByPath(existingRecord.currentPath)
        ) {
            return this.sourceIdentityStore.createSourceForPathForEvent(filePath, fingerprint, context);
        }
        return this.sourceIdentityStore.ensureSourceForPathForEvent(filePath, fingerprint, context);
    }

    private async writeSourceAndPathSidecars(
        sourceId: string,
        filePath: string,
        threads: CommentThread[],
        context: PluginEventExecutionContext,
    ): Promise<boolean> {
        if (!isPluginEventExecutionActive(context)) {
            return false;
        }
        await this.sidecarStorage.writeForSource(sourceId, filePath, threads, context);
        if (!isPluginEventExecutionActive(context)) {
            return false;
        }
        await this.sidecarStorage.write(filePath, threads, context);
        return isPluginEventExecutionActive(context);
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

        await this.sidecarStorage.writeForSource(
            sourceRecord.sourceId,
            filePath,
            pathThreads,
            ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
        );
        return {
            threads: pathThreads,
            source: "path",
        };
    }

    private async readSourceOrPathSidecarForEvent(
        sourceRecord: SourceIdentityRecord,
        filePath: string,
        context: PluginEventExecutionContext,
    ): Promise<{
        threads: CommentThread[];
        source: "source" | "path";
    } | null> {
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        const sourceThreads = await this.sidecarStorage.readForSource(sourceRecord.sourceId, filePath);
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        if (sourceThreads) {
            return { threads: sourceThreads, source: "source" };
        }

        const pathThreads = await this.sidecarStorage.read(filePath);
        if (!isPluginEventExecutionActive(context) || !pathThreads) {
            return null;
        }
        await this.sidecarStorage.writeForSource(sourceRecord.sourceId, filePath, pathThreads, context);
        return isPluginEventExecutionActive(context)
            ? { threads: pathThreads, source: "path" }
            : null;
    }

    private async retargetThreads(
        threads: CommentThread[],
        filePath: string,
        options?: CommentThreadRetargetOptions,
    ): Promise<CommentThread[]> {
        if (!threads.length) {
            return [];
        }

        const retargetOptions = options ?? {
            selectionCapable: isMarkdownCommentablePath(filePath, this.host.getAllCommentsNotePath()),
            pageLabelHash: await this.host.hashText(getPageCommentLabel(filePath)),
        };
        return retargetCommentThreads(threads, filePath, retargetOptions);
    }

    private async renameStoredCommentsNow(
        previousFilePath: string,
        nextFilePath: string,
        retargetOptions: CommentThreadRetargetOptions,
        context: PluginEventExecutionContext,
    ): Promise<void> {
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        await this.sourceIdentityStore.refreshFromLatestPersistedData(context);
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        const existingSourceRecord = this.sourceIdentityStore.getRecordByPath(previousFilePath)
            ?? this.sourceIdentityStore.getRecordByPath(nextFilePath);
        const previousSourceThreads = existingSourceRecord
            ? await this.sidecarStorage.readForSource(existingSourceRecord.sourceId, previousFilePath)
            : null;
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        const previousThreads = previousSourceThreads ?? await this.sidecarStorage.read(previousFilePath);
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        const sourceRecord = await this.sourceIdentityStore.recordRename(previousFilePath, nextFilePath, context);
        if (!sourceRecord || !isPluginEventExecutionActive(context)) {
            return;
        }
        await this.sidecarStorage.rename(previousFilePath, nextFilePath, context);
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        if (previousThreads && previousThreads.length > 0) {
            const retargetedThreads = await this.retargetThreads(previousThreads, nextFilePath, retargetOptions);
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            if (!await this.writeSourceAndPathSidecars(
                sourceRecord.sourceId,
                nextFilePath,
                retargetedThreads,
                context,
            )) {
                return;
            }
            await this.syncEventStore.appendLocalEvents(previousFilePath, context, [{
                op: "renameSource",
                payload: {
                    sourceId: sourceRecord.sourceId,
                    previousPath: previousFilePath,
                    nextPath: nextFilePath,
                    previousNotePath: previousFilePath,
                    nextNotePath: nextFilePath,
                },
            }]);
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            await this.compactSyncedSideNoteEventsForSnapshots([{
                notePath: nextFilePath,
                coveredNotePath: previousFilePath,
                threads: retargetedThreads,
            }, {
                notePath: nextFilePath,
                threads: retargetedThreads,
            }], context);
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
        }
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        this.host.getCommentManager().renameFile(previousFilePath, nextFilePath, retargetOptions);
    }

    public async renameStoredComments(
        previousFilePath: string,
        nextFilePath: string,
        retargetOptions: CommentThreadRetargetOptions,
        context: PluginEventExecutionContext,
    ): Promise<void> {
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        try {
            await this.enqueueCommentPersistence([previousFilePath, nextFilePath], async () => {
                if (!isPluginEventExecutionActive(context)) {
                    return;
                }
                await this.renameStoredCommentsNow(previousFilePath, nextFilePath, retargetOptions, context);
            });
        } catch (error) {
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            throw error;
        }
    }

    public async renameStoredCommentsInFolder(
        retargets: readonly CommentFileRetarget[],
        context: PluginEventExecutionContext,
    ): Promise<CommentFileRetargetResult> {
        let result: CommentFileRetargetResult = {
            successfulRetargets: [],
            failures: [],
        };
        if (!isPluginEventExecutionActive(context)) {
            return result;
        }
        try {
            await this.enqueueCommentPersistence(
                retargets.flatMap((retarget) => [retarget.previousFilePath, retarget.nextFilePath]),
                async () => {
                    if (!isPluginEventExecutionActive(context)) {
                        return;
                    }
                    result = await this.renameStoredCommentsInFolderNow(retargets, context);
                },
            );
        } catch (error) {
            if (!isPluginEventExecutionActive(context)) {
                return result;
            }
            throw error;
        }
        if (!isPluginEventExecutionActive(context)) {
            return {
                successfulRetargets: [],
                failures: [],
            };
        }
        return result;
    }

    private async renameStoredCommentsInFolderNow(
        retargets: readonly CommentFileRetarget[],
        context: PluginEventExecutionContext,
    ): Promise<CommentFileRetargetResult> {
        const abortedResult: CommentFileRetargetResult = {
            successfulRetargets: [],
            failures: [],
        };
        if (retargets.length === 0 || !isPluginEventExecutionActive(context)) {
            return {
                successfulRetargets: [],
                failures: [],
            };
        }

        // This is deliberately reconcilable rather than one filesystem transaction:
        // identities commit once, every sidecar gets an independent attempt, and only
        // successful sidecars enter the single sync-state commit and in-memory retarget.
        // A source/path/snapshot completion marker lets replay skip those successes and
        // finish only descendants that did not reach the prior sync commit.
        const snapshots = this.syncEventStore.getSnapshots();
        const preparedRetargets = await Promise.allSettled(retargets.map(async (retarget) => {
            const sourceRecord = this.sourceIdentityStore.getRecordByPathIncludingAliases(retarget.previousFilePath)
                ?? this.sourceIdentityStore.getRecordByPathIncludingAliases(retarget.nextFilePath);
            const sourceSidecarExists = sourceRecord
                ? await this.sidecarStorage.existsForSource(sourceRecord.sourceId)
                : false;
            const sourceThreads = sourceRecord
                ? await this.sidecarStorage.readForSource(sourceRecord.sourceId, retarget.previousFilePath)
                : null;
            if (sourceSidecarExists && sourceThreads === null) {
                throw new Error(`Unreadable source sidecar for ${retarget.previousFilePath}`);
            }

            const previousPathSidecarExists = await this.sidecarStorage.exists(retarget.previousFilePath);
            const previousPathThreads = await this.sidecarStorage.read(retarget.previousFilePath);
            if (previousPathSidecarExists && previousPathThreads === null) {
                throw new Error(`Unreadable path sidecar for ${retarget.previousFilePath}`);
            }

            const nextPathSidecarExists = await this.sidecarStorage.exists(retarget.nextFilePath);
            const nextPathThreads = await this.sidecarStorage.read(retarget.nextFilePath);
            if (nextPathSidecarExists && nextPathThreads === null) {
                throw new Error(`Unreadable path sidecar for ${retarget.nextFilePath}`);
            }
            const previousNoteHash = await this.host.hashText(retarget.previousFilePath);
            const completed = sourceRecord?.currentPath === retarget.nextFilePath
                && sourceThreads !== null
                && !previousPathSidecarExists
                && nextPathThreads !== null
                && snapshots.some((snapshot) =>
                    snapshot.noteHash === previousNoteHash
                    && snapshot.notePath === retarget.nextFilePath);
            return {
                threads: sourceThreads ?? previousPathThreads ?? nextPathThreads,
                completed,
            };
        }));
        if (!isPluginEventExecutionActive(context)) {
            return abortedResult;
        }
        const pendingIndexes = retargets.flatMap((_retarget, index) => {
            const prepared = preparedRetargets[index];
            return prepared?.status === "fulfilled" && !prepared.value.completed ? [index] : [];
        });
        const sourceRecords = await this.sourceIdentityStore.recordRenames(
            pendingIndexes.map((index) => retargets[index]).filter((retarget): retarget is CommentFileRetarget => !!retarget),
            context,
        );
        if (!isPluginEventExecutionActive(context)) {
            return abortedResult;
        }
        const sourceRecordByRetargetIndex = new Map(
            pendingIndexes.map((retargetIndex, recordIndex) => [retargetIndex, sourceRecords[recordIndex]]),
        );
        const failures: CommentFileRetargetFailure[] = [];
        const successfulItems: Array<{
            retarget: CommentFileRetarget;
            sourceId: string;
            threads: CommentThread[];
        }> = [];
        for (const [index, retarget] of retargets.entries()) {
            try {
                if (!isPluginEventExecutionActive(context)) {
                    return abortedResult;
                }
                const prepared = preparedRetargets[index];
                if (!prepared || prepared.status === "rejected") {
                    throw prepared?.reason ?? new Error(`Missing rename preparation for ${retarget.previousFilePath}`);
                }
                if (prepared.value.completed) {
                    continue;
                }
                const sourceRecord = sourceRecordByRetargetIndex.get(index);
                if (!sourceRecord) {
                    throw new Error(`Missing source identity for ${retarget.nextFilePath}`);
                }

                const previousThreads = prepared.value.threads;
                const retargetedThreads = previousThreads && previousThreads.length > 0
                    ? await this.retargetThreads(
                        previousThreads,
                        retarget.nextFilePath,
                        retarget.retargetOptions,
                    )
                    : [];
                if (!isPluginEventExecutionActive(context)) {
                    return abortedResult;
                }
                if (retargetedThreads.length > 0) {
                    await this.writeSourceAndPathSidecars(
                        sourceRecord.sourceId,
                        retarget.nextFilePath,
                        retargetedThreads,
                        context,
                    );
                    if (!isPluginEventExecutionActive(context)) {
                        return abortedResult;
                    }
                    await this.sidecarStorage.remove(retarget.previousFilePath, context);
                    if (!isPluginEventExecutionActive(context)) {
                        return abortedResult;
                    }
                } else if (previousThreads !== null) {
                    await this.sidecarStorage.remove(retarget.previousFilePath, context);
                    if (!isPluginEventExecutionActive(context)) {
                        return abortedResult;
                    }
                }
                successfulItems.push({
                    retarget,
                    sourceId: sourceRecord.sourceId,
                    threads: retargetedThreads,
                });
            } catch (error) {
                failures.push({ retarget, error });
            }
        }
        const syncedItems = successfulItems.filter((item) => item.threads.length > 0);
        if (syncedItems.length > 0) {
            try {
                const compacted = await this.syncEventStore.appendLocalEventBatchesAndCompactSnapshots(
                    syncedItems.map((item) => ({
                        notePath: item.retarget.previousFilePath,
                        inputs: [{
                            op: "renameSource",
                            payload: {
                                sourceId: item.sourceId,
                                previousPath: item.retarget.previousFilePath,
                                nextPath: item.retarget.nextFilePath,
                                previousNotePath: item.retarget.previousFilePath,
                                nextNotePath: item.retarget.nextFilePath,
                            },
                        }],
                    })),
                    syncedItems.flatMap((item) => [{
                        notePath: item.retarget.nextFilePath,
                        coveredNotePath: item.retarget.previousFilePath,
                        threads: item.threads,
                    }, {
                        notePath: item.retarget.nextFilePath,
                        threads: item.threads,
                    }]),
                    context,
                );
                if (!isPluginEventExecutionActive(context)) {
                    return abortedResult;
                }
                void this.host.log?.("info", "persistence", "sync.plugin-data.compact", {
                    removedEventCount: compacted.removedEventCount,
                    snapshotCount: compacted.snapshotCount,
                });
            } catch (error) {
                for (const item of successfulItems) {
                    failures.push({ retarget: item.retarget, error });
                }
                return {
                    successfulRetargets: [],
                    failures,
                };
            }
        }

        if (!isPluginEventExecutionActive(context)) {
            return abortedResult;
        }
        this.host.getCommentManager().renameFiles(
            successfulItems.map((item) => item.retarget),
        );
        return {
            successfulRetargets: successfulItems.map((item) => item.retarget),
            failures,
        };
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

    public async deleteStoredComments(
        filePath: string,
        context: PluginEventExecutionContext,
    ): Promise<void> {
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        try {
            await this.sourceIdentityStore.refreshFromLatestPersistedData(context);
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            await this.syncEventStore.refreshFromLatestPersistedData(context);
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            const sourceRecord = this.sourceIdentityStore.getRecordByPath(filePath);
            const removedSidecar = await this.sidecarStorage.removeNote(filePath, context);
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            let previousThreads = removedSidecar?.threads ?? null;
            if (!previousThreads && sourceRecord) {
                previousThreads = await this.sidecarStorage.readForSource(sourceRecord.sourceId, filePath);
                if (!isPluginEventExecutionActive(context)) {
                    return;
                }
            }
            if (!previousThreads) {
                previousThreads = await this.sidecarStorage.read(filePath);
            }
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            if (this.hasKnownCommentsForDeletedFile(filePath, previousThreads)) {
                await this.syncEventStore.appendLocalEvents(filePath, context, [{
                    op: "deleteNote",
                    payload: {
                        notePath: filePath,
                        ...(sourceRecord ? { sourceId: sourceRecord.sourceId } : {}),
                    },
                }]);
                if (!isPluginEventExecutionActive(context)) {
                    return;
                }
            }
            if (!removedSidecar) {
                await this.sidecarStorage.remove(filePath, context);
                if (!isPluginEventExecutionActive(context)) {
                    return;
                }
            }
            if (sourceRecord && !removedSidecar?.sourceId) {
                await this.sidecarStorage.removeForSource(sourceRecord.sourceId, context);
                if (!isPluginEventExecutionActive(context)) {
                    return;
                }
            }
            await this.sourceIdentityStore.removeSourceForPath(filePath, context);
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            await this.compactSyncedSideNoteEventsForSnapshots([{
                notePath: filePath,
                threads: [],
            }], context);
        } catch (error) {
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            throw error;
        }
    }

    public async deleteStoredCommentsInFolder(
        folderPath: string,
        context: PluginEventExecutionContext,
    ): Promise<void> {
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        try {
            await this.deleteStoredCommentsInFolderNow(folderPath, context);
        } catch (error) {
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            throw error;
        }
    }

    private async deleteStoredCommentsInFolderNow(
        folderPath: string,
        context: PluginEventExecutionContext,
    ): Promise<void> {
        await this.sourceIdentityStore.refreshFromLatestPersistedData(context);
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        await this.syncEventStore.refreshFromLatestPersistedData(context);
        if (!isPluginEventExecutionActive(context)) {
            return;
        }

        const removedByNotePath = new Map<string, {
            notePath: string;
            sourceId?: string;
            threads: CommentThread[];
        }>();
        for (const removed of await this.sidecarStorage.removeFolder(folderPath, context)) {
            removedByNotePath.set(removed.notePath, {
                notePath: removed.notePath,
                sourceId: removed.sourceId,
                threads: removed.threads,
            });
        }
        if (!isPluginEventExecutionActive(context)) {
            return;
        }

        for (const sourceRecord of await this.sourceIdentityStore.removeSourcesInFolder(folderPath, context)) {
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            await this.sidecarStorage.remove(sourceRecord.currentPath, context);
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            await this.sidecarStorage.removeForSource(sourceRecord.sourceId, context);
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
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
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            if (!this.hasKnownCommentsForDeletedFile(record.notePath, record.threads)) {
                continue;
            }

            await this.syncEventStore.appendLocalEvents(record.notePath, context, [{
                op: "deleteNote",
                payload: {
                    notePath: record.notePath,
                    ...(record.sourceId ? { sourceId: record.sourceId } : {}),
                },
            }]);
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
        }

        await this.compactSyncedSideNoteEventsForSnapshots(
            removedRecords.map((record) => ({
                notePath: record.notePath,
                threads: [],
            })),
            context,
        );
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
        await this.sourceIdentityStore.refreshFromLatestPersistedData(ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
        if (this.disposed) {
            return 0;
        }
        await this.syncEventStore.refreshFromLatestPersistedData(ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
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
            if (!isPageNoteCapablePath(targetNotePath, this.host.getAllCommentsNotePath())) {
                void this.host.log?.("warn", "persistence", "sync.plugin-data.rename.skip-ineligible-target", {
                    sourceNotePath: notePath,
                    targetNotePath,
                });
                processedEvents.push(...noteEvents);
                continue;
            }
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
            const targetThreads = await this.retargetThreads(reduced.threads, targetNotePath);
            const noteWasDeleted = hasDeleteNoteEvent(noteEvents);
            const targetFile = this.getPageNoteCapableFileByPath(targetNotePath);
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
                : await this.sourceIdentityStore.recordRename(
                    notePath,
                    targetNotePath,
                    ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
                );
            if (!sourceRecord) {
                throw new Error(`Source identity rename did not produce a record for ${targetNotePath}.`);
            }

            if (noteWasDeleted) {
                await this.sidecarStorage.remove(notePath, ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
                await this.sidecarStorage.removeForSource(sourceRecord.sourceId, ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
                if (targetNotePath !== notePath) {
                    await this.sidecarStorage.remove(targetNotePath, ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
                }
                this.host.getCommentManager().replaceThreadsForFile(notePath, []);
                if (targetNotePath !== notePath) {
                    this.host.getCommentManager().replaceThreadsForFile(targetNotePath, []);
                }
                this.host.getAggregateCommentIndex().deleteFile(notePath);
                this.host.getAggregateCommentIndex().deleteFile(targetNotePath);
            } else {
                await this.writeSourceAndPathSidecars(
                    sourceRecord.sourceId,
                    targetNotePath,
                    targetThreads,
                    ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
                );
                if (targetNotePath !== notePath) {
                    await this.sidecarStorage.remove(notePath, ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
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
        await this.compactSyncedSideNoteEventsForSnapshots(
            compactionSnapshots,
            ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
        );
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
            const file = this.getPageNoteCapableFileByPath(record.notePath);
            if (!this.isPageNoteCapableFile(file)) {
                continue;
            }

            const normalizedThreads = await this.normalizeThreadsForFile(file.path, record.threads);
            const noteContent = this.host.isCommentableFile(file)
                ? await this.host.getCurrentNoteContent(file)
                : undefined;
            if (this.disposed) {
                break;
            }
            const sourceRecord = await this.ensureSourceIdentityForFilePath(file.path, noteContent);
            await this.writeSourceAndPathSidecars(
                sourceRecord.sourceId,
                file.path,
                normalizedThreads,
                ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
            );
            const eventInputs = buildSideNoteSyncEventInputsForThreadDiff([], normalizedThreads);
            if (eventInputs.length === 0) {
                continue;
            }

            await this.syncEventStore.appendLocalEvents(
                file.path,
                ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
                eventInputs,
            );
            await this.compactSyncedSideNoteEventsForSnapshots([{
                notePath: file.path,
                threads: normalizedThreads,
            }], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
            migratedCount += 1;
        }

        void this.host.log?.("info", "persistence", "sync.plugin-data.migrate.complete", {
            migratedCount,
        });
    }

    public async migrateSourceIdentitiesOnStartup(): Promise<void> {
        await this.sourceIdentityStore.refreshFromLatestPersistedData(ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
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
            const file = this.getPageNoteCapableFileByPath(filePath);
            if (!this.isPageNoteCapableFile(file)) {
                continue;
            }
            const noteContent = this.host.isCommentableFile(file)
                ? await this.host.getCurrentNoteContent(file)
                : undefined;
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
                await this.writeSourceAndPathSidecars(
                    sourceRecord.sourceId,
                    file.path,
                    normalizedThreads,
                    ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
                );
                sourceSidecarCount += 1;
                continue;
            }

            const snapshot = snapshotsByPath.get(file.path);
            if (snapshot && snapshot.threads.length > 0) {
                const normalizedThreads = await this.normalizeThreadsForFile(file.path, snapshot.threads);
                if (
                    noteContent !== undefined
                    && !areSnapshotThreadsCompatibleWithFile(normalizedThreads, noteContent)
                ) {
                    void this.host.log?.("warn", "persistence", "source-identity.snapshot.skip-incompatible", {
                        targetNotePath: file.path,
                        threadCount: normalizedThreads.length,
                    });
                    continue;
                }
                await this.writeSourceAndPathSidecars(
                    sourceRecord.sourceId,
                    file.path,
                    normalizedThreads,
                    ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
                );
                sourceSidecarCount += 1;
            }
        }

        void this.host.log?.("info", "persistence", "source-identity.migrate.complete", {
            sourceCount,
            sourceSidecarCount,
        });
    }

    public async handleMarkdownFileModified(
        file: TFile,
        context: PluginEventExecutionContext,
    ): Promise<void> {
        if (this.disposed || file.extension !== "md" || !isPluginEventExecutionActive(context)) {
            return;
        }

        const filePath = file.path;
        try {
            const queueKeys = this.getCommentPersistenceQueueKeys(file, filePath);
            await this.enqueueCommentPersistence(queueKeys, async () => {
                if (!isPluginEventExecutionActive(context)) {
                    return;
                }
                await this.syncModifiedMarkdownFile(file, filePath, context);
            });
        } catch (error) {
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            console.error("Error syncing note-backed comments:", error);
            void this.host.log?.("error", "persistence", "storage.note.write.error", {
                filePath,
                error,
            });
        }
    }

    private async syncModifiedMarkdownFile(
        file: TFile,
        filePath: string,
        context: PluginEventExecutionContext,
    ): Promise<void> {
        const fileContent = await this.host.getCurrentNoteContent(file);
        if (this.disposed || !isPluginEventExecutionActive(context)) {
            return;
        }
        const sourceRecord = await this.ensureSourceIdentityForFilePathForEvent(filePath, fileContent, context);
        if (!sourceRecord || !isPluginEventExecutionActive(context)) {
            return;
        }
        const storedContent = await this.host.getStoredNoteContent(file);
        if (this.disposed || !isPluginEventExecutionActive(context)) {
            return;
        }
        const hasSidecar = await this.sidecarStorage.exists(filePath);
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        if (!hasSidecar && fileContent !== storedContent && this.host.getMarkdownViewForFile(file)) {
            const currentParsed = await this.parseAndNormalizeFileComments(filePath, fileContent);
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            const storedParsed = await this.parseAndNormalizeFileComments(filePath, storedContent);
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            if (currentParsed.mainContent === storedParsed.mainContent && storedParsed.threads.length > 0) {
                const synced = await this.syncThreadsIntoVisibleNoteContentForEvent(
                    file,
                    currentParsed.mainContent,
                    storedParsed.threads,
                    filePath,
                    context,
                );
                if (!synced || !isPluginEventExecutionActive(context)) {
                    return;
                }
                if (!(await this.writeSourceAndPathSidecars(
                    sourceRecord.sourceId,
                    filePath,
                    synced.threads,
                    context,
                ))) {
                    return;
                }
                await this.syncEventStore.appendLocalEvents(
                    filePath,
                    context,
                    buildSideNoteSyncEventInputsForThreadDiff([], synced.threads),
                );
                if (!isPluginEventExecutionActive(context)) {
                    return;
                }
                await this.compactSyncedSideNoteEventsForSnapshots([{
                    notePath: filePath,
                    threads: synced.threads,
                }], context);
                if (!isPluginEventExecutionActive(context)) {
                    return;
                }
                this.clearPendingCommentPersistTimer(filePath);
                await this.afterCommentsChangedForEvent(filePath, context);
                if (!isPluginEventExecutionActive(context)) {
                    return;
                }
                void this.host.log?.("info", "persistence", "storage.note.external-managed-sync", {
                    filePath,
                    threadCount: synced.threads.length,
                });
                return;
            }
        }
        const parsed = await this.syncFileCommentsFromContentForEvent(file, fileContent, filePath, context);
        if (!parsed || !isPluginEventExecutionActive(context)) {
            return;
        }
        if (parsed.source !== "none" || parsed.threads.length > 0) {
            if (!(await this.writeSourceAndPathSidecars(
                sourceRecord.sourceId,
                filePath,
                parsed.threads,
                context,
            ))) {
                return;
            }
        }

        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        this.clearPendingCommentPersistTimer(filePath);
        await this.afterCommentsChangedForEvent(filePath, context);
    }

    public async loadCommentsForFile(file: TFile | null): Promise<Comment[]> {
        if (this.disposed || !file || this.host.isAllCommentsNotePath(file.path) || !this.isPageNoteCapableFile(file)) {
            return [];
        }

        await this.replaySyncedSideNoteEvents(file.path);
        if (this.disposed) {
            return [];
        }
        if (!this.host.isCommentableFile(file)) {
            return this.loadStoredPageNoteCommentsForFile(file);
        }
        const noteContent = await this.host.getCurrentNoteContent(file);
        if (this.disposed) {
            return [];
        }
        const parsed = await this.syncFileCommentsFromContent(file, noteContent);
        return parsed.comments;
    }

    public async loadCommentsForFileForEvent(
        file: TFile | null,
        context: PluginEventExecutionContext,
    ): Promise<Comment[]> {
        if (
            this.disposed
            || !isPluginEventExecutionActive(context)
            || !file
            || this.host.isAllCommentsNotePath(file.path)
            || !this.isPageNoteCapableFile(file)
        ) {
            return [];
        }

        const commentManager = this.host.getCommentManager();
        const aggregateCommentIndex = this.host.getAggregateCommentIndex();
        try {
            const sourceRecord = this.sourceIdentityStore.getRecordByPath(file.path);
            const sourceThreads = sourceRecord
                ? await this.sidecarStorage.readForSource(sourceRecord.sourceId, file.path)
                : null;
            if (!isPluginEventExecutionActive(context)) {
                return [];
            }
            const pathThreads = sourceThreads === null
                ? await this.sidecarStorage.read(file.path)
                : null;
            if (!isPluginEventExecutionActive(context)) {
                return [];
            }
            const inMemoryThreads = commentManager.getThreadsForFile(file.path, { includeDeleted: true });
            let threads = sourceThreads ?? pathThreads ?? inMemoryThreads;
            let mainContent = "";
            if (this.host.isCommentableFile(file)) {
                const noteContent = await this.host.getCurrentNoteContent(file);
                if (!isPluginEventExecutionActive(context)) {
                    return [];
                }
                const parsed = this.host.getParsedNoteComments(file.path, noteContent);
                mainContent = parsed.mainContent;
                if (threads.length === 0) {
                    threads = parsed.threads;
                }
            }
            const normalizedThreads = await this.normalizeThreadsForFile(file.path, threads);
            if (!isPluginEventExecutionActive(context)) {
                return [];
            }

            commentManager.replaceThreadsForFile(file.path, normalizedThreads);
            if (this.host.isCommentableFile(file)) {
                await commentManager.updateCommentCoordinatesForFile(mainContent, file.path);
                if (!isPluginEventExecutionActive(context)) {
                    return [];
                }
            }
            const syncedThreads = commentManager
                .getThreadsForFile(file.path, { includeDeleted: true })
                .map((thread) => ({
                    ...thread,
                    entries: thread.entries.map((entry) => ({ ...entry })),
                }));
            if (!isPluginEventExecutionActive(context)) {
                return [];
            }
            aggregateCommentIndex.updateFile(file.path, syncedThreads);
            if (this.host.isCommentableFile(file) && isPluginEventExecutionActive(context)) {
                this.host.syncDerivedCommentLinksForFile(file, mainContent, syncedThreads);
            }
            return syncedThreads.map((thread) => threadToComment(thread));
        } catch (error) {
            if (!isPluginEventExecutionActive(context)) {
                return [];
            }
            throw error;
        }
    }

    private async loadStoredPageNoteCommentsForFile(file: TFile): Promise<Comment[]> {
        const sourceRecord = await this.ensureSourceIdentityForFilePath(file.path);
        if (this.disposed) {
            return [];
        }
        const sidecarResult = await this.readSourceOrPathSidecar(sourceRecord, file.path);
        const threads = await this.normalizeThreadsForFile(file.path, sidecarResult?.threads ?? []);
        this.host.getCommentManager().replaceThreadsForFile(file.path, threads);
        this.host.getAggregateCommentIndex().updateFile(file.path, threads);
        return threads.map((thread) => threadToComment(thread));
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

    private async enqueueCommentPersistence(
        filePaths: readonly string[],
        task: () => Promise<void>,
    ): Promise<void> {
        const queueKeys = Array.from(new Set(filePaths));
        const previousTails = Array.from(new Set(queueKeys
            .map((filePath) => this.commentPersistTails.get(filePath))
            .filter((tail): tail is Promise<void> => tail !== undefined)));
        const operation = Promise.all(previousTails.map((tail) => tail.catch(() => undefined)))
            .then(async () => {
                if (this.disposed) {
                    return;
                }
                await task();
            });

        for (const queueKey of queueKeys) {
            this.commentPersistTails.set(queueKey, operation);
        }
        try {
            await operation;
        } finally {
            for (const queueKey of queueKeys) {
                if (this.commentPersistTails.get(queueKey) === operation) {
                    this.commentPersistTails.delete(queueKey);
                }
            }
        }
    }

    private getCommentPersistenceQueueKeys(file: TFile, filePath: string): string[] {
        const previousFilePath = this.commentPersistPathByFile.get(file);
        this.commentPersistPathByFile.set(file, filePath);
        return previousFilePath && previousFilePath !== filePath
            ? [previousFilePath, filePath]
            : [filePath];
    }

    private async enqueueCommentPersist(file: TFile, options: PersistOptions): Promise<void> {
        const filePath = file.path;
        const queueKeys = this.getCommentPersistenceQueueKeys(file, filePath);

        await this.enqueueCommentPersistence(queueKeys, async () => {
            await this.writeCommentsForFile(file, filePath, options);
        });
    }

    public async persistCommentsForFile(file: TFile, options: PersistOptions = {}): Promise<void> {
        if (this.disposed) {
            return;
        }
        if (options.skipCommentViewRefresh) {
            this.scheduleCommentViewRefreshSuppression(file.path, 1);
        }

        await this.enqueueCommentPersist(file, options);
    }

    public async commitThreadEntry(
        file: TFile,
        threadId: string,
        entry: CommentThreadEntry,
        options: CommitThreadEntryOptions = {},
    ): Promise<boolean> {
        if (this.disposed) {
            return false;
        }

        const filePath = file.path;
        if (options.skipCommentViewRefresh) {
            this.scheduleCommentViewRefreshSuppression(filePath, 1);
        }
        const queueKeys = this.getCommentPersistenceQueueKeys(file, filePath);
        let committed = false;
        await this.enqueueCommentPersistence(queueKeys, async () => {
            if (this.disposed) {
                return;
            }
            const noteContent = this.host.isCommentableFile(file)
                ? await this.host.getCurrentNoteContent(file)
                : undefined;
            if (this.disposed) {
                return;
            }
            const sourceRecord = await this.ensureSourceIdentityForFilePath(filePath, noteContent);
            if (this.disposed) {
                return;
            }
            const storedThreads = (await this.readSourceOrPathSidecar(sourceRecord, filePath))?.threads;
            if (this.disposed) {
                return;
            }
            const storedCanonicalThreads = await this.normalizeThreadsForFile(
                filePath,
                storedThreads ?? [],
            );
            if (this.disposed) {
                return;
            }
            const liveThreads = this.host.getCommentManager().getThreadsForFile(filePath, { includeDeleted: true });
            if (options.onlyIfEntryAbsentOrBlank) {
                const existingCandidates = [storedCanonicalThreads, liveThreads]
                    .map((threads) => threads
                        .find((thread) => thread.id === threadId)
                        ?.entries.find((candidate) => candidate.id === entry.id))
                    .filter((candidate): candidate is CommentThreadEntry => !!candidate);
                const protectedCandidate = existingCandidates.find((candidate) => (
                    candidate.deletedAt !== undefined || candidate.body.trim().length > 0
                ));
                if (protectedCandidate) {
                    const manager = this.host.getCommentManager();
                    const currentEntry = manager.getCommentById(protectedCandidate.id);
                    if (!currentEntry) {
                        manager.appendEntry(threadId, protectedCandidate);
                    } else if (currentEntry.comment !== protectedCandidate.body) {
                        manager.editComment(protectedCandidate.id, protectedCandidate.body);
                    }
                    if (protectedCandidate.deletedAt !== undefined) {
                        manager.deleteComment(protectedCandidate.id, protectedCandidate.deletedAt);
                    }
                    committed = true;
                    return;
                }
            }
            const canonicalThreads = liveThreads.some((thread) => thread.id === threadId)
                ? liveThreads
                : storedCanonicalThreads;
            const targetThreadIndex = canonicalThreads.findIndex((thread) => thread.id === threadId);
            if (targetThreadIndex === -1) {
                return;
            }

            const nextThreads = canonicalThreads.map((thread) => ({
                ...thread,
                entries: thread.entries.map((candidate) => ({ ...candidate })),
            }));
            const targetThread = nextThreads[targetThreadIndex];
            const existingEntryIndex = targetThread.entries.findIndex((candidate) => candidate.id === entry.id);
            if (existingEntryIndex === -1) {
                const insertAfterIndex = options.insertAfterCommentId
                    ? targetThread.entries.findIndex((candidate) => candidate.id === options.insertAfterCommentId)
                    : -1;
                const insertionIndex = insertAfterIndex === -1
                    ? targetThread.entries.length
                    : insertAfterIndex + 1;
                targetThread.entries.splice(insertionIndex, 0, { ...entry });
            } else {
                const existingEntry = targetThread.entries[existingEntryIndex];
                targetThread.entries[existingEntryIndex] = {
                    ...existingEntry,
                    body: entry.body,
                };
            }
            targetThread.updatedAt = Math.max(targetThread.updatedAt, entry.timestamp);

            this.host.getCommentManager().replaceThreadsForFile(filePath, nextThreads);

            await this.writeCommentsForFile(file, filePath, {
                ...options,
                immediateAggregateRefresh: options.immediateAggregateRefresh ?? false,
            });
            if (this.disposed) {
                return;
            }
            committed = true;
        });
        return committed;
    }

    public scheduleAggregateNoteRefresh(): void {
        this.scheduleAggregateNoteRefreshRequest(ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT, false);
    }

    private scheduleAggregateNoteRefreshForEvent(context: PluginEventExecutionContext): void {
        this.scheduleAggregateNoteRefreshRequest(context, true);
    }

    private scheduleAggregateNoteRefreshRequest(
        context: PluginEventExecutionContext,
        skipPersistenceMaintenance: boolean,
    ): void {
        if (this.disposed || !isPluginEventExecutionActive(context)) {
            return;
        }
        if (!this.aggregateRefreshTimerRequests.some((request) =>
            request.context === context
            && request.skipPersistenceMaintenance === skipPersistenceMaintenance)) {
            this.aggregateRefreshTimerRequests.push({ context, skipPersistenceMaintenance });
        }
        if (this.aggregateRefreshTimer !== null) {
            window.clearTimeout(this.aggregateRefreshTimer);
        }
        this.aggregateRefreshTimer = window.setTimeout(() => {
            this.aggregateRefreshTimer = null;
            const requests = this.aggregateRefreshTimerRequests.splice(0);
            void this.enqueueAggregateNoteRefreshRequests(requests).catch(() => {});
        }, 150);
    }

    public async refreshAggregateNoteNow(): Promise<void> {
        if (this.disposed) {
            return;
        }
        const pendingRequests = this.takeScheduledAggregateNoteRefreshRequests();
        await this.enqueueAggregateNoteRefreshRequests([
            ...pendingRequests,
            {
                context: ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
                skipPersistenceMaintenance: false,
            },
        ]);
    }

    public async refreshAggregateNoteNowForEvent(
        context: PluginEventExecutionContext,
    ): Promise<void> {
        if (this.disposed || !isPluginEventExecutionActive(context)) {
            return;
        }
        const pendingRequests = this.takeScheduledAggregateNoteRefreshRequests();
        await this.enqueueAggregateNoteRefreshRequests([
            ...pendingRequests,
            { context, skipPersistenceMaintenance: true },
        ]);
    }

    public hasPendingAggregateRefresh(): boolean {
        return this.aggregateRefreshTimer !== null
            || this.aggregateRefreshTimerRequests.length > 0
            || this.aggregateRefreshPromise !== null
            || this.aggregateRefreshRequests.length > 0;
    }

    private takeScheduledAggregateNoteRefreshRequests(): AggregateRefreshRequestInput[] {
        if (this.aggregateRefreshTimer !== null) {
            window.clearTimeout(this.aggregateRefreshTimer);
            this.aggregateRefreshTimer = null;
        }
        return this.aggregateRefreshTimerRequests.splice(0);
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

        await this.persistCommentsForFile(file);
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
                    const file = this.getPageNoteCapableFileByPath(record.notePath);
                    if (!this.isPageNoteCapableFile(file)) {
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
        await this.syncEventStore.refreshFromLatestPersistedData(ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
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

        return !this.isPageNoteCapableFile(this.getPageNoteCapableFileByPath(filePath));
    }

    private async getPersistedCommentSourcePaths(): Promise<string[]> {
        if (this.disposed) {
            return [];
        }
        await this.sourceIdentityStore.refreshFromLatestPersistedData(ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
        if (this.disposed) {
            return [];
        }
        await this.syncEventStore.refreshFromLatestPersistedData(ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
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

            await this.deleteStoredComments(filePath, ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
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
            normalizedThreads.push(normalizeCommentThread(thread));
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

        const parsed = this.host.getParsedNoteComments(filePath, noteContent);
        const retainedThreads = await this.normalizeThreadsForFile(filePath, parsed.threads);

        return {
            mainContent: parsed.mainContent,
            threads: retainedThreads,
            comments: retainedThreads.map((thread) => threadToComment(thread)),
        };
    }

    private async syncFileCommentsFromContent(
        file: TFile,
        noteContent: string,
        filePath = file.path,
    ): Promise<SyncedFileComments> {
        const parsed = await this.getCanonicalThreadState(file, noteContent, filePath);
        const synced = await this.syncThreadsIntoVisibleNoteContent(file, parsed.mainContent, parsed.threads, filePath);
        return {
            ...synced,
            source: parsed.source,
        };
    }

    private async syncFileCommentsFromContentForEvent(
        file: TFile,
        noteContent: string,
        filePath: string,
        context: PluginEventExecutionContext,
    ): Promise<SyncedFileComments | null> {
        const parsed = await this.getCanonicalThreadStateForEvent(file, noteContent, filePath, context);
        if (!parsed || !isPluginEventExecutionActive(context)) {
            return null;
        }
        const synced = await this.syncThreadsIntoVisibleNoteContentForEvent(
            file,
            parsed.mainContent,
            parsed.threads,
            filePath,
            context,
        );
        return synced && isPluginEventExecutionActive(context)
            ? { ...synced, source: parsed.source }
            : null;
    }

    private async syncThreadsIntoVisibleNoteContent(
        file: TFile,
        mainContent: string,
        threads: CommentThread[],
        filePath = file.path,
    ): Promise<VisibleSyncedFileComments> {
        const syncedComments = await syncLoadedCommentsForCurrentNote(
            filePath,
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

    private async syncThreadsIntoVisibleNoteContentForEvent(
        file: TFile,
        mainContent: string,
        threads: CommentThread[],
        filePath: string,
        context: PluginEventExecutionContext,
    ): Promise<VisibleSyncedFileComments | null> {
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        const commentManager = this.host.getCommentManager();
        commentManager.replaceThreadsForFile(
            filePath,
            threads.map((thread) => ({
                ...thread,
                entries: thread.entries.map((entry) => ({ ...entry })),
            })),
        );
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        await commentManager.updateCommentCoordinatesForFile(mainContent, filePath);
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        const syncedThreads = commentManager
            .getThreadsForFile(filePath, { includeDeleted: true })
            .map((thread) => ({
                ...thread,
                entries: thread.entries.map((entry) => ({ ...entry })),
            }));
        const syncedComments = syncedThreads.map((thread) => threadToComment(thread));
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        this.host.getAggregateCommentIndex().updateFile(filePath, syncedThreads);
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        this.host.syncDerivedCommentLinksForFile(file, mainContent, syncedThreads);
        return isPluginEventExecutionActive(context)
            ? { mainContent, threads: syncedThreads, comments: syncedComments }
            : null;
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
            const file = this.getPageNoteCapableFileByPath(snapshot.notePath);
            if (!this.isPageNoteCapableFile(file)) {
                await this.deleteStoredComments(snapshot.notePath, ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
                this.host.getCommentManager().replaceCommentsForFile(snapshot.notePath, []);
                this.host.getAggregateCommentIndex().deleteFile(snapshot.notePath);
                continue;
            }

            const noteContent = this.host.isCommentableFile(file)
                ? await this.host.getCurrentNoteContent(file)
                : undefined;
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
                noteContent !== undefined
                &&
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

            await this.writeSourceAndPathSidecars(
                sourceRecord.sourceId,
                snapshot.notePath,
                normalizedThreads,
                ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
            );
            if (noteContent !== undefined) {
                const parsed = await this.parseAndNormalizeFileComments(snapshot.notePath, noteContent);
                await this.syncThreadsIntoVisibleNoteContent(file, parsed.mainContent, normalizedThreads);
            } else {
                this.host.getCommentManager().replaceThreadsForFile(snapshot.notePath, normalizedThreads);
                this.host.getAggregateCommentIndex().updateFile(snapshot.notePath, normalizedThreads);
            }
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

    private async compactSyncedSideNoteEventsForSnapshots(
        snapshots: SideNoteSyncSnapshotInput[],
        context: PluginEventExecutionContext,
    ): Promise<void> {
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        const compacted = await this.syncEventStore.compactProcessedEventsForSnapshots(context, snapshots);
        if (!isPluginEventExecutionActive(context)
            || (compacted.removedEventCount === 0 && compacted.snapshotCount === 0)) {
            return;
        }

        void this.host.log?.("info", "persistence", "sync.plugin-data.compact", {
            removedEventCount: compacted.removedEventCount,
            snapshotCount: compacted.snapshotCount,
        });
    }

    private async readLegacyCacheCandidate(
        storagePath: string,
        context: PluginEventExecutionContext,
    ): Promise<LegacySourceCandidate | null> {
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        try {
            const rawContent = await this.host.app.vault.adapter.read(storagePath);
            if (!isPluginEventExecutionActive(context)) {
                return null;
            }
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
            if (!isPluginEventExecutionActive(context) || threads.length === 0) {
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

    private async readLegacyCacheCandidates(
        context: PluginEventExecutionContext,
    ): Promise<LegacySourceCandidate[]> {
        if (!isPluginEventExecutionActive(context)) {
            return [];
        }
        const cacheDirPath = `${this.host.getPluginDataDirPath()}/cache`;
        try {
            if (!(await this.host.app.vault.adapter.exists(cacheDirPath))) {
                return [];
            }
            if (!isPluginEventExecutionActive(context)) {
                return [];
            }

            const listed = await this.host.app.vault.adapter.list(cacheDirPath);
            if (!isPluginEventExecutionActive(context)) {
                return [];
            }
            const candidates: LegacySourceCandidate[] = [];
            for (const filePath of listed.files.filter((path) => path.endsWith(".json"))) {
                const candidate = await this.readLegacyCacheCandidate(filePath, context);
                if (!isPluginEventExecutionActive(context)) {
                    return [];
                }
                if (candidate) {
                    candidates.push(candidate);
                }
            }
            return candidates;
        } catch {
            return [];
        }
    }

    private async findRenamedSourceCandidate(
        filePath: string,
        noteContent: string,
        context: PluginEventExecutionContext,
    ): Promise<LegacySourceCandidate | null> {
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
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
        const cacheCandidates = await this.readLegacyCacheCandidates(context);
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        const candidates = [...snapshotCandidates, ...cacheCandidates]
            .filter((candidate) =>
                candidate.notePath !== filePath
                && candidate.threads.length > 0
                && !this.getPageNoteCapableFileByPath(candidate.notePath)
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

        return !this.getPageNoteCapableFileByPath(claimedSourceRecord.currentPath);
    }

    private async recoverRenamedSourceThreadsForFile(
        file: TFile,
        noteContent: string,
        filePath: string,
        context: PluginEventExecutionContext,
    ): Promise<CommentThread[] | null> {
        const candidate = await this.findRenamedSourceCandidate(filePath, noteContent, context);
        if (!candidate || !isPluginEventExecutionActive(context)) {
            return null;
        }

        const normalizedThreads = await this.normalizeThreadsForFile(filePath, candidate.threads);
        if (!isPluginEventExecutionActive(context) || normalizedThreads.length === 0) {
            return null;
        }

        const fingerprint = await this.getSourceContentFingerprint(noteContent);
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        const sourceRecord = await this.sourceIdentityStore.recordRename(
            candidate.notePath,
            filePath,
            context,
            fingerprint,
        );
        if (!sourceRecord || !isPluginEventExecutionActive(context)) {
            return null;
        }
        if (!(await this.writeSourceAndPathSidecars(
            sourceRecord.sourceId,
            filePath,
            normalizedThreads,
            context,
        ))) {
            return null;
        }
        await this.sidecarStorage.remove(candidate.notePath, context);
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        await this.syncEventStore.appendLocalEvents(candidate.notePath, context, [{
            op: "renameSource",
            payload: {
                sourceId: sourceRecord.sourceId,
                previousPath: candidate.notePath,
                nextPath: filePath,
                previousNotePath: candidate.notePath,
                nextNotePath: filePath,
            },
        }]);
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        await this.compactSyncedSideNoteEventsForSnapshots([{
            notePath: filePath,
            coveredNotePath: candidate.notePath,
            threads: normalizedThreads,
        }, {
            notePath: filePath,
            threads: normalizedThreads,
        }], context);
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        void this.host.log?.("info", "persistence", "sync.plugin-data.rename.recover", {
            previousNotePath: candidate.notePath,
            nextNotePath: filePath,
            threadCount: normalizedThreads.length,
            origin: candidate.origin,
        });
        return normalizedThreads;
    }

    private async writeCommentsForFile(
        file: TFile,
        filePath: string,
        options: PersistOptions = {},
        explicitThreads?: CommentThread[],
    ): Promise<string> {
        this.clearPendingCommentPersistTimer(filePath);
        this.host.getCommentManager().purgeExpiredDeletedComments();
        if (!this.host.isCommentableFile(file)) {
            return this.writePageNoteCommentsForFile(file, filePath, options, explicitThreads);
        }

        return this.writeMarkdownCommentsForFile(file, filePath, options, explicitThreads);
    }

    private async writeMarkdownCommentsForFile(
        file: TFile,
        filePath: string,
        options: PersistOptions = {},
        explicitThreads?: CommentThread[],
    ): Promise<string> {
        void this.host.log?.("info", "persistence", "storage.note.write.begin", {
            filePath,
            threadCount: this.host.getCommentManager().getThreadsForFile(filePath, { includeDeleted: true }).length,
        });
        const currentContent = await this.host.getCurrentNoteContent(file);
        if (this.disposed) {
            return currentContent;
        }
        const sourceRecord = await this.ensureSourceIdentityForFilePath(filePath, currentContent);
        if (this.disposed) {
            return currentContent;
        }
        const sourceThreads = await this.sidecarStorage.readForSource(sourceRecord.sourceId, filePath);
        if (this.disposed) {
            return currentContent;
        }
        const pathThreads = sourceThreads ? null : await this.sidecarStorage.read(filePath);
        if (this.disposed) {
            return currentContent;
        }
        const previousThreads = sourceThreads ?? pathThreads ?? [];
        const parsedCurrentContent = await this.parseAndNormalizeFileComments(filePath, currentContent);
        if (this.disposed) {
            return currentContent;
        }
        const threads = explicitThreads
            ?? this.host.getCommentManager().getThreadsForFile(filePath, { includeDeleted: true });
        const synced = await this.syncThreadsIntoVisibleNoteContent(file, parsedCurrentContent.mainContent, threads, filePath);
        if (this.disposed) {
            return currentContent;
        }
        const normalizedPreviousThreads = await this.normalizeThreadsForFile(filePath, previousThreads);
        if (this.disposed) {
            return currentContent;
        }
        const eventInputs = buildSideNoteSyncEventInputsForThreadDiff(
            normalizedPreviousThreads,
            synced.threads,
        );
        await this.syncEventStore.appendLocalEvents(
            filePath,
            ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
            eventInputs,
        );
        if (this.disposed) {
            return currentContent;
        }
        await this.writeSourceAndPathSidecars(
            sourceRecord.sourceId,
            filePath,
            synced.threads,
            ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
        );
        if (this.disposed) {
            return currentContent;
        }
        await this.compactSyncedSideNoteEventsForSnapshots([{
            notePath: filePath,
            threads: synced.threads,
        }], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
        if (this.disposed) {
            return currentContent;
        }
        await this.afterCommentsChanged(filePath, options);
        void this.host.log?.("info", "persistence", "storage.note.write.success", {
            filePath,
            threadCount: synced.threads.length,
        });
        return currentContent;
    }

    private async writePageNoteCommentsForFile(
        file: TFile,
        filePath: string,
        options: PersistOptions = {},
        explicitThreads?: CommentThread[],
    ): Promise<string> {
        if (!this.isPageNoteCapableFile(file)) {
            return "";
        }

        const threads = await this.normalizeThreadsForFile(
            filePath,
            explicitThreads
                ?? this.host.getCommentManager().getThreadsForFile(filePath, { includeDeleted: true }),
        );
        if (this.disposed) {
            return "";
        }
        void this.host.log?.("info", "persistence", "storage.page.write.begin", {
            filePath,
            threadCount: threads.length,
        });
        const sourceRecord = await this.ensureSourceIdentityForFilePath(filePath);
        if (this.disposed) {
            return "";
        }
        const previousThreads = (await this.readSourceOrPathSidecar(sourceRecord, filePath))?.threads ?? [];
        if (this.disposed) {
            return "";
        }
        const normalizedPreviousThreads = await this.normalizeThreadsForFile(filePath, previousThreads);
        if (this.disposed) {
            return "";
        }
        const eventInputs = buildSideNoteSyncEventInputsForThreadDiff(
            normalizedPreviousThreads,
            threads,
        );
        await this.syncEventStore.appendLocalEvents(
            filePath,
            ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
            eventInputs,
        );
        if (this.disposed) {
            return "";
        }
        await this.writeSourceAndPathSidecars(
            sourceRecord.sourceId,
            filePath,
            threads,
            ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
        );
        if (this.disposed) {
            return "";
        }
        await this.compactSyncedSideNoteEventsForSnapshots([{
            notePath: filePath,
            threads,
        }], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
        if (this.disposed) {
            return "";
        }
        this.host.getAggregateCommentIndex().updateFile(filePath, threads);
        await this.afterCommentsChanged(filePath, options);
        void this.host.log?.("info", "persistence", "storage.page.write.success", {
            filePath,
            threadCount: threads.length,
        });
        return "";
    }

    private async getCanonicalThreadState(file: TFile, noteContent: string, filePath = file.path): Promise<{
        mainContent: string;
        threads: CommentThread[];
        source: CanonicalCommentStorageSource;
    }> {
        const inlineParsed = await this.parseAndNormalizeFileComments(filePath, noteContent);
        const sourceRecord = await this.ensureSourceIdentityForFilePath(filePath, noteContent);
        const sidecarResult = await this.readSourceOrPathSidecar(sourceRecord, filePath);
        const sidecarThreads = sidecarResult?.threads ?? null;
        const storagePlan = planCanonicalCommentStorage({
            sidecarRecordFound: sidecarResult !== null,
        });

        if (storagePlan.action === "use-sidecar" && sidecarThreads) {
            return {
                mainContent: inlineParsed.mainContent,
                threads: await this.normalizeThreadsForFile(filePath, sidecarThreads),
                source: storagePlan.source,
            };
        }

        if (storagePlan.shouldRecoverRenamedSource) {
            const recoveredThreads = await this.recoverRenamedSourceThreadsForFile(
                file,
                noteContent,
                filePath,
                ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
            );
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

        return {
            mainContent: inlineParsed.mainContent,
            threads: [],
            source: storagePlan.source,
        };
    }

    private async getCanonicalThreadStateForEvent(
        file: TFile,
        noteContent: string,
        filePath: string,
        context: PluginEventExecutionContext,
    ): Promise<{
        mainContent: string;
        threads: CommentThread[];
        source: CanonicalCommentStorageSource;
    } | null> {
        const inlineParsed = await this.parseAndNormalizeFileComments(filePath, noteContent);
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        const sourceRecord = await this.ensureSourceIdentityForFilePathForEvent(filePath, noteContent, context);
        if (!sourceRecord || !isPluginEventExecutionActive(context)) {
            return null;
        }
        const sidecarResult = await this.readSourceOrPathSidecarForEvent(sourceRecord, filePath, context);
        if (!isPluginEventExecutionActive(context)) {
            return null;
        }
        const sidecarThreads = sidecarResult?.threads ?? null;
        const storagePlan = planCanonicalCommentStorage({
            sidecarRecordFound: sidecarResult !== null,
        });

        if (storagePlan.action === "use-sidecar" && sidecarThreads) {
            const normalizedThreads = await this.normalizeThreadsForFile(filePath, sidecarThreads);
            return isPluginEventExecutionActive(context)
                ? {
                    mainContent: inlineParsed.mainContent,
                    threads: normalizedThreads,
                    source: storagePlan.source,
                }
                : null;
        }

        if (storagePlan.shouldRecoverRenamedSource) {
            const recoveredThreads = await this.recoverRenamedSourceThreadsForFile(
                file,
                noteContent,
                filePath,
                context,
            );
            if (!isPluginEventExecutionActive(context)) {
                return null;
            }
            return {
                mainContent: inlineParsed.mainContent,
                threads: recoveredThreads ?? [],
                source: recoveredThreads ? "sidecar" : storagePlan.source,
            };
        }

        return {
            mainContent: inlineParsed.mainContent,
            threads: [],
            source: storagePlan.source,
        };
    }

    private async afterCommentsChanged(filePath: string | null = null, options: PersistOptions = {}): Promise<void> {
        if (this.disposed) {
            return;
        }
        const viewRefreshOptions = {
            skipDataRefresh: true,
        };
        if (filePath && this.host.isAllCommentsNotePath(filePath)) {
            await this.host.refreshAllCommentsSidebarViews(
                viewRefreshOptions,
                ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
            );
        } else if (!filePath || !this.consumeCommentViewRefreshSuppression(filePath)) {
            await this.host.refreshCommentViews(viewRefreshOptions, ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
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

    private async afterCommentsChangedForEvent(
        filePath: string | null,
        context: PluginEventExecutionContext,
    ): Promise<void> {
        if (this.disposed || !isPluginEventExecutionActive(context)) {
            return;
        }
        const viewRefreshOptions = { skipDataRefresh: true };
        if (filePath && this.host.isAllCommentsNotePath(filePath)) {
            await this.host.refreshAllCommentsSidebarViews(viewRefreshOptions, context);
        } else if (!filePath || !this.consumeCommentViewRefreshSuppression(filePath)) {
            await this.host.refreshCommentViews(viewRefreshOptions, context);
        }
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        this.host.refreshEditorDecorations();
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        this.host.refreshMarkdownPreviews();
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        this.scheduleAggregateNoteRefreshForEvent(context);
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

    private enqueueAggregateNoteRefreshRequests(
        requests: readonly AggregateRefreshRequestInput[],
    ): Promise<void> {
        if (this.disposed) {
            return Promise.resolve();
        }
        const requestedRefreshes: Promise<void>[] = [];
        for (const request of requests) {
            if (!isPluginEventExecutionActive(request.context)) {
                continue;
            }
            requestedRefreshes.push(new Promise<void>((resolve, reject) => {
                this.aggregateRefreshRequests.push({
                    ...request,
                    resolve,
                    reject,
                });
            }));
        }
        if (requestedRefreshes.length === 0) {
            return Promise.resolve();
        }
        this.startAggregateNoteRefreshDrain();
        return Promise.all(requestedRefreshes).then(() => undefined);
    }

    private startAggregateNoteRefreshDrain(): void {
        if (this.disposed || this.aggregateRefreshPromise || this.aggregateRefreshRequests.length === 0) {
            return;
        }
        const drainPromise = this.drainAggregateNoteRefreshes();
        this.aggregateRefreshPromise = drainPromise;
        void drainPromise.finally(() => {
            if (this.aggregateRefreshPromise === drainPromise) {
                this.aggregateRefreshPromise = null;
            }
            this.startAggregateNoteRefreshDrain();
        });
    }

    private async drainAggregateNoteRefreshes(): Promise<void> {
        while (!this.disposed && this.aggregateRefreshRequests.length > 0) {
            const requests = this.aggregateRefreshRequests.splice(0);
            const activeRequests = requests.filter((request) =>
                isPluginEventExecutionActive(request.context));
            if (activeRequests.length === 0) {
                for (const request of requests) {
                    request.resolve();
                }
                continue;
            }
            const compositeContext: PluginEventExecutionContext = {
                signal: new AbortController().signal,
                isActive: () => activeRequests.some((request) =>
                    isPluginEventExecutionActive(request.context)),
            };
            try {
                await this.refreshAggregateNote(
                    compositeContext,
                    activeRequests.every((request) => request.skipPersistenceMaintenance),
                );
                for (const request of requests) {
                    request.resolve();
                }
            } catch (error) {
                for (const request of requests) {
                    if (isPluginEventExecutionActive(request.context)) {
                        request.reject(error);
                    } else {
                        request.resolve();
                    }
                }
            }
        }
        if (this.disposed) {
            for (const request of this.aggregateRefreshRequests.splice(0)) {
                request.resolve();
            }
        }
    }

    private async refreshAggregateNote(
        context: PluginEventExecutionContext,
        skipPersistenceMaintenance: boolean,
    ): Promise<void> {
        if (this.disposed || !isPluginEventExecutionActive(context)) {
            return;
        }
        void this.host.log?.("info", "index", "index.refresh.begin", {});
        try {
            let prunedMissingSourceCount = 0;
            if (!skipPersistenceMaintenance) {
                prunedMissingSourceCount = await this.pruneMissingStoredCommentSources();
                if (this.disposed || !isPluginEventExecutionActive(context)) {
                    return;
                }
                await this.ensureAggregateCommentIndexInitialized();
                if (this.disposed || !isPluginEventExecutionActive(context)) {
                    return;
                }
            }
            const comments = this.host.getAggregateCommentIndex().getAllThreads();
            const noteOptions: AllCommentsNoteBuildOptions = {
                allCommentsNotePath: this.host.getAllCommentsNotePath(),
                headerImageUrl: this.host.getIndexHeaderImageUrl(),
                headerImageCaption: this.host.getIndexHeaderImageCaption(),
                hasSourceFile: (filePath: string) => isTFileLike(this.host.app.vault.getAbstractFileByPath(filePath)),
                getSourceFileTags: (filePath: string) => {
                    const file = this.host.app.vault.getAbstractFileByPath(filePath);
                    if (!isTFileLike(file)) {
                        return [];
                    }

                    const metadataCache = this.host.app.metadataCache as {
                        getFileCache?: (metadataFile: TFile) => CachedMetadata | null;
                    } | undefined;
                    return collectCachedMetadataTags(metadataCache?.getFileCache?.(file) ?? null);
                },
                getMentionedPageLabels: (comment: Comment) => this.host.getCommentMentionedPageLabels(comment),
                resolveWikiLinkPath: (linkPath: string, sourceFilePath: string) => {
                    const linkedFile = this.host.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFilePath);
                    return isTFileLike(linkedFile) ? linkedFile.path : null;
                },
            };
            const nextContent = buildAllCommentsNoteContent(this.host.app.vault.getName(), comments, noteOptions);
            const allCommentsNotePath = this.host.getAllCommentsNotePath();
            const existingFile = this.host.getMarkdownFileByPath(allCommentsNotePath);

            if (!existingFile) {
                if (!isPluginEventExecutionActive(context)) {
                    return;
                }
                await this.host.app.vault.create(allCommentsNotePath, nextContent);
                if (!isPluginEventExecutionActive(context)) {
                    return;
                }
                void this.host.log?.("info", "index", "index.refresh.success", {
                    commentCount: comments.length,
                    created: true,
                    prunedMissingSourceCount,
                });
                return;
            }

            const currentContent = await this.host.getCurrentNoteContent(existingFile);
            if (this.disposed || !isPluginEventExecutionActive(context)) {
                return;
            }
            const openView = this.host.getMarkdownViewForFile(existingFile);
            const contentChanged = currentContent !== nextContent;
            if (openView) {
                await this.host.syncIndexNoteLeafMode(openView.leaf);
                if (!isPluginEventExecutionActive(context)) {
                    return;
                }
                const viewContentChanged = openView.getViewData() !== nextContent;
                if (viewContentChanged) {
                    openView.setViewData(nextContent, false);
                }
                if (contentChanged) {
                    await openView.save();
                    if (!isPluginEventExecutionActive(context)) {
                        return;
                    }
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
                if (!isPluginEventExecutionActive(context)) {
                    return;
                }
                await this.host.app.vault.modify(existingFile, nextContent);
                if (!isPluginEventExecutionActive(context)) {
                    return;
                }
            }

            void this.host.log?.("info", "index", "index.refresh.success", {
                commentCount: comments.length,
                skippedViewRefresh: false,
                prunedMissingSourceCount,
            });
        } catch (error) {
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            void this.host.log?.("error", "index", "index.refresh.error", {
                error,
            });
            throw error;
        }
    }
}
