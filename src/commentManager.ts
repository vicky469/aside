import { resolveAnchorRange } from "./core/anchors/anchorResolver";
import { getPageCommentLabel, isPageComment } from "./core/anchors/commentAnchors";
import {
    isSoftDeleted,
    isSoftDeletedExpired,
    normalizeDeletedAt,
    purgeExpiredDeletedThreads,
} from "./core/rules/deletedCommentVisibility";
import {
    buildCommentLookupIndexes,
    type CommentEntryLookup,
    type CommentLookupIndexes,
} from "./core/commentLookupIndex";

export type CommentAnchorKind = "selection" | "page";

export interface CommentThreadEntry {
    id: string;
    body: string;
    timestamp: number;
    deletedAt?: number;
}

export interface CommentThread {
    id: string;
    filePath: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    selectedText: string;
    selectedTextHash: string;
    anchorKind?: CommentAnchorKind;
    orphaned?: boolean;
    isPinned?: boolean;
    resolved?: boolean;
    deletedAt?: number;
    entries: CommentThreadEntry[];
    createdAt: number;
    updatedAt: number;
}

export interface Comment {
    id: string;
    filePath: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    selectedText: string;
    selectedTextHash: string;
    comment: string;
    timestamp: number;
    anchorKind?: CommentAnchorKind;
    orphaned?: boolean;
    isPinned?: boolean;
    resolved?: boolean;
    deletedAt?: number;
    entryCount?: number;
}

export interface CommentQueryOptions {
    includeDeleted?: boolean;
}

export type ReorderPlacement = "before" | "after";

const COORDINATE_SYNC_MIN_BATCH_SIZE = 5;
const COORDINATE_SYNC_MAX_BATCH_MS = 8;

type CoordinateUpdate = {
    threadId: string;
    orphaned: boolean;
    nextPosition: ReturnType<typeof resolveAnchorRange>;
};

function getMonotonicNow(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
    }

    return Date.now();
}

function yieldToMainThread(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof globalThis.requestAnimationFrame === "function") {
            globalThis.requestAnimationFrame(() => {
                resolve();
            });
            return;
        }

        setTimeout(resolve, 0);
    });
}

function compareThreadsByPosition(left: CommentThread, right: CommentThread): number {
    if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine;
    }
    if (left.startChar !== right.startChar) {
        return left.startChar - right.startChar;
    }
    return left.createdAt - right.createdAt;
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

export function cloneCommentThread(thread: CommentThread): CommentThread {
    return {
        ...thread,
        entries: thread.entries.map((entry) => cloneThreadEntry(entry)),
    };
}

export function cloneCommentThreads(threads: CommentThread[]): CommentThread[] {
    return threads.map((thread) => cloneCommentThread(thread));
}

export function getLatestThreadEntry(thread: CommentThread): CommentThreadEntry {
    return thread.entries[thread.entries.length - 1] ?? {
        id: thread.id,
        body: "",
        timestamp: thread.updatedAt || thread.createdAt,
    };
}

export function getFirstThreadEntry(thread: CommentThread): CommentThreadEntry {
    return thread.entries[0] ?? {
        id: thread.id,
        body: "",
        timestamp: thread.createdAt || thread.updatedAt,
    };
}

function normalizeThread(thread: CommentThread): CommentThread {
    const entries = thread.entries.length > 0
        ? thread.entries.map((entry) => cloneThreadEntry(entry))
        : [{
            id: thread.id,
            body: "",
            timestamp: thread.updatedAt || thread.createdAt,
        }];
    const firstEntry = entries[0];
    const latestEntry = entries[entries.length - 1];

    return {
        ...thread,
        anchorKind: thread.anchorKind === "page" ? "page" : "selection",
        orphaned: thread.anchorKind === "page" ? false : thread.orphaned === true,
        isPinned: thread.isPinned === true,
        resolved: thread.resolved === true,
        deletedAt: normalizeDeletedAt(thread.deletedAt),
        entries,
        createdAt: thread.createdAt || firstEntry.timestamp,
        updatedAt: thread.updatedAt || latestEntry.timestamp,
    };
}

function hasExpiredDeletedComments(threads: readonly CommentThread[], now: number): boolean {
    return threads.some((thread) =>
        isSoftDeletedExpired(thread.deletedAt, now)
        || thread.entries.some((entry) => isSoftDeletedExpired(entry.deletedAt, now)));
}

export function commentToThread(comment: Comment): CommentThread {
    return normalizeThread({
        id: comment.id,
        filePath: comment.filePath,
        startLine: comment.startLine,
        startChar: comment.startChar,
        endLine: comment.endLine,
        endChar: comment.endChar,
        selectedText: comment.selectedText,
        selectedTextHash: comment.selectedTextHash,
        anchorKind: comment.anchorKind === "page" ? "page" : "selection",
        orphaned: comment.orphaned === true,
        isPinned: comment.isPinned === true,
        resolved: comment.resolved === true,
        deletedAt: normalizeDeletedAt(comment.deletedAt),
        entries: [{
            id: comment.id,
            body: comment.comment,
            timestamp: comment.timestamp,
            deletedAt: normalizeDeletedAt(comment.deletedAt),
        }],
        createdAt: comment.timestamp,
        updatedAt: comment.timestamp,
    });
}

export function threadToComment(thread: CommentThread): Comment {
    const normalized = normalizeThread(thread);
    const latestEntry = getLatestThreadEntry(normalized);
    return {
        ...threadEntryToComment(normalized, latestEntry),
        id: normalized.id,
        isPinned: normalized.isPinned === true,
    };
}

export function threadEntryToComment(thread: CommentThread, entry: CommentThreadEntry): Comment {
    const normalized = normalizeThread(thread);
    const deletedAt = normalizeDeletedAt(entry.deletedAt) ?? normalized.deletedAt;

    return {
        id: entry.id,
        filePath: normalized.filePath,
        startLine: normalized.startLine,
        startChar: normalized.startChar,
        endLine: normalized.endLine,
        endChar: normalized.endChar,
        selectedText: normalized.selectedText,
        selectedTextHash: normalized.selectedTextHash,
        comment: entry.body,
        timestamp: entry.timestamp,
        anchorKind: normalized.anchorKind,
        orphaned: normalized.orphaned === true,
        ...(normalized.id === entry.id && normalized.isPinned === true ? { isPinned: true } : {}),
        resolved: normalized.resolved === true,
        ...(deletedAt !== undefined ? { deletedAt } : {}),
        entryCount: normalized.entries.length,
    };
}

function isThreadLike(value: Comment | CommentThread): value is CommentThread {
    return Array.isArray((value as CommentThread).entries);
}

function moveItemByIdRelative<T extends { id: string }>(
    items: readonly T[],
    movedId: string,
    targetId: string,
    placement: ReorderPlacement,
): T[] | null {
    if (movedId === targetId) {
        return null;
    }

    const movedItem = items.find((item) => item.id === movedId);
    if (!movedItem) {
        return null;
    }

    const remainingItems = items.filter((item) => item.id !== movedId);
    const targetIndex = remainingItems.findIndex((item) => item.id === targetId);
    if (targetIndex === -1) {
        return null;
    }

    const insertionIndex = placement === "before"
        ? targetIndex
        : targetIndex + 1;
    const nextItems = remainingItems.slice();
    nextItems.splice(insertionIndex, 0, movedItem);
    return nextItems;
}

export class CommentManager {
    private threads: CommentThread[];
    private lookupIndexes: CommentLookupIndexes = buildCommentLookupIndexes([]);
    private coordinateSyncVersionByFile = new Map<string, number>();

    constructor(items: Array<Comment | CommentThread>) {
        this.threads = items.map((item) => normalizeThread(isThreadLike(item) ? item : commentToThread(item)));
        this.rebuildLookupIndexes();
        this.purgeExpiredDeletedComments();
    }

    private rebuildLookupIndexes(): void {
        this.lookupIndexes = buildCommentLookupIndexes(this.threads);
    }

    private setThreads(threads: CommentThread[]): void {
        this.threads = threads;
        this.rebuildLookupIndexes();
    }

    private findThreadById(id: string): CommentThread | undefined {
        return this.lookupIndexes.threadByThreadId.get(id)
            ?? this.lookupIndexes.threadByEntryId.get(id);
    }

    private findEntryById(id: string): CommentEntryLookup | undefined {
        const entryLookup = this.lookupIndexes.entryById.get(id);
        if (entryLookup) {
            return entryLookup;
        }

        const thread = this.lookupIndexes.threadByThreadId.get(id);
        const entry = thread?.entries[0];
        return thread && entry ? { thread, entry } : undefined;
    }

    getThreadsForFile(filePath: string, options: CommentQueryOptions = {}): CommentThread[] {
        this.purgeExpiredDeletedComments();
        return (this.lookupIndexes.threadsByFilePath.get(filePath) ?? [])
            .map((thread) => cloneThreadForVisibility(thread, options))
            .filter((thread): thread is CommentThread => thread !== null);
    }

    getThreadById(id: string): CommentThread | undefined {
        this.purgeExpiredDeletedComments();
        const thread = this.findThreadById(id);
        return thread ? cloneCommentThread(thread) : undefined;
    }

    getAllThreads(options: CommentQueryOptions = {}): CommentThread[] {
        this.purgeExpiredDeletedComments();
        return this.threads
            .map((thread) => cloneThreadForVisibility(thread, options))
            .filter((thread): thread is CommentThread => thread !== null);
    }

    getCommentsForFile(filePath: string, options: CommentQueryOptions = {}): Comment[] {
        return this.getThreadsForFile(filePath, options)
            .map((thread) => threadToComment(thread));
    }

    getCommentById(id: string): Comment | undefined {
        this.purgeExpiredDeletedComments();
        const thread = this.threads.find((candidate) =>
            candidate.id === id || candidate.entries.some((entry) => entry.id === id));
        if (!thread) {
            return undefined;
        }

        const entry = thread.entries.find((candidate) => candidate.id === id) ?? getFirstThreadEntry(thread);
        return threadEntryToComment(thread, entry);
    }

    getAllComments(options: CommentQueryOptions = {}): Comment[] {
        return this.getAllThreads(options).map((thread) => threadToComment(thread));
    }

    replaceCommentsForFile(filePath: string, nextComments: Comment[]) {
        this.replaceThreadsForFile(
            filePath,
            nextComments.map((comment) => commentToThread(comment)),
        );
    }

    replaceThreadsForFile(filePath: string, nextThreads: CommentThread[]) {
        this.setThreads(this.threads
            .filter((thread) => thread.filePath !== filePath)
            .concat(nextThreads.map((thread) => normalizeThread(thread))));
        this.purgeExpiredDeletedComments();
    }

    addComment(newComment: Comment) {
        this.addThread(commentToThread(newComment));
    }

    addThread(newThread: CommentThread) {
        const normalizedThread = normalizeThread(newThread);
        const insertionIndex = this.threads.findIndex((thread) =>
            thread.filePath === normalizedThread.filePath
            && compareThreadsByPosition(normalizedThread, thread) < 0);

        if (insertionIndex === -1) {
            this.threads.push(normalizedThread);
            this.rebuildLookupIndexes();
            return;
        }

        this.threads.splice(insertionIndex, 0, normalizedThread);
        this.rebuildLookupIndexes();
    }

    appendEntry(threadId: string, entry: CommentThreadEntry) {
        const thread = this.findThreadById(threadId);
        if (!thread) {
            return;
        }

        thread.entries.push(cloneThreadEntry(entry));
        thread.updatedAt = Math.max(thread.updatedAt, entry.timestamp);
        this.rebuildLookupIndexes();
    }

    reorderThreadsForFile(
        filePath: string,
        movedThreadId: string,
        targetThreadId: string,
        placement: ReorderPlacement,
    ): boolean {
        const fileThreads = this.threads.filter((thread) => thread.filePath === filePath);
        const reorderedThreads = moveItemByIdRelative(fileThreads, movedThreadId, targetThreadId, placement);
        if (!reorderedThreads) {
            return false;
        }

        const reorderedThreadIds = new Set(reorderedThreads.map((thread) => thread.id));
        const nextThreads: CommentThread[] = [];
        let inserted = false;

        for (const thread of this.threads) {
            if (thread.filePath !== filePath) {
                nextThreads.push(thread);
                continue;
            }

            if (!inserted) {
                nextThreads.push(...reorderedThreads);
                inserted = true;
            }

            if (!reorderedThreadIds.has(thread.id)) {
                nextThreads.push(thread);
            }
        }

        this.setThreads(nextThreads);
        return true;
    }

    reorderThreadEntries(
        threadId: string,
        movedEntryId: string,
        targetEntryId: string,
        placement: ReorderPlacement,
    ): boolean {
        const thread = this.findThreadById(threadId);
        if (!thread || thread.entries.length < 2) {
            return false;
        }

        const parentEntry = thread.entries[0];
        if (!parentEntry || movedEntryId === parentEntry.id) {
            return false;
        }

        const childEntries = thread.entries.slice(1);
        if (targetEntryId === parentEntry.id) {
            if (placement !== "after") {
                return false;
            }

            const movedEntry = childEntries.find((entry) => entry.id === movedEntryId);
            if (!movedEntry) {
                return false;
            }

            thread.entries = [parentEntry, movedEntry, ...childEntries.filter((entry) => entry.id !== movedEntryId)];
            return true;
        }

        const reorderedChildEntries = moveItemByIdRelative(childEntries, movedEntryId, targetEntryId, placement);
        if (!reorderedChildEntries) {
            return false;
        }

        thread.entries = [parentEntry, ...reorderedChildEntries];
        return true;
    }

    editComment(id: string, newCommentText: string) {
        const matchingEntry = this.findEntryById(id)?.entry;
        if (!matchingEntry) {
            return;
        }

        matchingEntry.body = newCommentText;
    }

    deleteComment(id: string, deletedAt: number = Date.now()) {
        this.purgeExpiredDeletedComments(deletedAt);
        const thread = this.findThreadById(id);
        if (!thread) {
            return;
        }
        if (thread.id === id) {
            thread.deletedAt = deletedAt;
            thread.updatedAt = Math.max(thread.updatedAt, deletedAt);
            return;
        }

        const entry = thread.entries.find((candidate) => candidate.id === id);
        if (!entry) {
            return;
        }

        entry.deletedAt = deletedAt;
        thread.updatedAt = Math.max(thread.updatedAt, deletedAt);
    }

    restoreComment(id: string, restoredAt: number = Date.now()) {
        this.purgeExpiredDeletedComments(restoredAt);
        const thread = this.findThreadById(id);
        if (!thread) {
            return;
        }

        if (thread.id === id) {
            delete thread.deletedAt;
            const rootEntry = thread.entries.find((candidate) => candidate.id === id);
            if (rootEntry) {
                delete rootEntry.deletedAt;
            }
            thread.updatedAt = Math.max(thread.updatedAt, restoredAt);
            return;
        }

        const entry = thread.entries.find((candidate) => candidate.id === id);
        if (!entry) {
            return;
        }

        delete entry.deletedAt;
        thread.updatedAt = Math.max(thread.updatedAt, restoredAt);
    }

    clearDeletedCommentsForFile(filePath: string, clearedAt: number = Date.now()): boolean {
        this.purgeExpiredDeletedComments(clearedAt);

        let changed = false;
        const nextThreads: CommentThread[] = [];
        for (const thread of this.threads) {
            if (thread.filePath !== filePath) {
                nextThreads.push(thread);
                continue;
            }

            if (thread.deletedAt) {
                changed = true;
                continue;
            }

            const retainedEntries = thread.entries.filter((entry) => !entry.deletedAt);
            if (retainedEntries.length !== thread.entries.length) {
                changed = true;
            }

            if (!retainedEntries.length) {
                changed = true;
                continue;
            }

            if (retainedEntries.length === thread.entries.length) {
                nextThreads.push(thread);
                continue;
            }

            nextThreads.push({
                ...thread,
                entries: retainedEntries.map((entry) => ({ ...entry })),
                updatedAt: clearedAt,
            });
        }

        if (changed) {
            this.setThreads(nextThreads);
        }

        return changed;
    }

    clearDeletedComment(id: string, clearedAt: number = Date.now()): boolean {
        this.purgeExpiredDeletedComments(clearedAt);
        const thread = this.findThreadById(id);
        const threadIndex = thread ? this.threads.indexOf(thread) : -1;
        if (!thread || threadIndex === -1) {
            return false;
        }

        if (thread.id === id) {
            const rootEntry = thread.entries.find((entry) => entry.id === id);
            if (!thread.deletedAt && !rootEntry?.deletedAt) {
                return false;
            }

            this.threads.splice(threadIndex, 1);
            this.rebuildLookupIndexes();
            return true;
        }

        const entryIndex = thread.entries.findIndex((entry) => entry.id === id);
        const entry = entryIndex === -1 ? undefined : thread.entries[entryIndex];
        if (!entry?.deletedAt) {
            return false;
        }

        const retainedEntries = thread.entries.filter((entry) => entry.id !== id);
        if (!retainedEntries.length) {
            this.threads.splice(threadIndex, 1);
            this.rebuildLookupIndexes();
            return true;
        }

        this.threads[threadIndex] = {
            ...thread,
            entries: retainedEntries.map((entry) => ({ ...entry })),
            updatedAt: clearedAt,
        };
        this.rebuildLookupIndexes();
        return true;
    }

    resolveComment(id: string) {
        const thread = this.findThreadById(id);
        if (thread) {
            thread.resolved = true;
        }
    }

    setCommentPinnedState(id: string, isPinned: boolean) {
        const thread = this.findThreadById(id);
        if (thread) {
            thread.isPinned = isPinned;
        }
    }

    unresolveComment(id: string) {
        const thread = this.findThreadById(id);
        if (thread) {
            thread.resolved = false;
        }
    }

    reanchorCommentThread(
        id: string,
        anchor: {
            startLine: number;
            startChar: number;
            endLine: number;
            endChar: number;
            selectedText: string;
            selectedTextHash: string;
        },
    ) {
        const thread = this.findThreadById(id);
        if (!thread) {
            return;
        }

        thread.startLine = anchor.startLine;
        thread.startChar = anchor.startChar;
        thread.endLine = anchor.endLine;
        thread.endChar = anchor.endChar;
        thread.selectedText = anchor.selectedText;
        thread.selectedTextHash = anchor.selectedTextHash;
        thread.anchorKind = "selection";
        thread.orphaned = false;
    }

    renameFile(oldPath: string, newPath: string) {
        let changed = false;
        this.threads.forEach((thread) => {
            if (thread.filePath === oldPath) {
                thread.filePath = newPath;
                changed = true;
                if (isPageComment(thread)) {
                    thread.selectedText = getPageCommentLabel(newPath);
                    thread.orphaned = false;
                }
            }
        });
        if (changed) {
            this.rebuildLookupIndexes();
        }
    }

    async updateCommentCoordinatesForFile(fileContent: string, filePath: string): Promise<void> {
        const runVersion = (this.coordinateSyncVersionByFile.get(filePath) ?? 0) + 1;
        this.coordinateSyncVersionByFile.set(filePath, runVersion);

        const candidateThreads = (this.lookupIndexes.threadsByFilePath.get(filePath) ?? [])
            .map((thread) => cloneCommentThread(thread));
        const coordinateUpdates: CoordinateUpdate[] = [];
        let batchStartedAt = getMonotonicNow();

        for (let index = 0; index < candidateThreads.length; index += 1) {
            const thread = candidateThreads[index];
            if (isPageComment(thread)) {
                coordinateUpdates.push({
                    threadId: thread.id,
                    orphaned: false,
                    nextPosition: null,
                });
            } else {
                const nextPosition = resolveAnchorRange(fileContent, thread);
                coordinateUpdates.push({
                    threadId: thread.id,
                    orphaned: !nextPosition,
                    nextPosition,
                });
            }

            const processedCount = index + 1;
            if (
                processedCount < candidateThreads.length
                && processedCount % COORDINATE_SYNC_MIN_BATCH_SIZE === 0
                && getMonotonicNow() - batchStartedAt >= COORDINATE_SYNC_MAX_BATCH_MS
            ) {
                await yieldToMainThread();
                if (this.coordinateSyncVersionByFile.get(filePath) !== runVersion) {
                    return;
                }
                batchStartedAt = getMonotonicNow();
            }
        }

        if (this.coordinateSyncVersionByFile.get(filePath) !== runVersion) {
            return;
        }

        const currentThreadsById = new Map(
            (this.lookupIndexes.threadsByFilePath.get(filePath) ?? [])
                .map((thread) => [thread.id, thread] as const),
        );

        for (const update of coordinateUpdates) {
            const thread = currentThreadsById.get(update.threadId);
            if (!thread) {
                continue;
            }

            if (isPageComment(thread)) {
                thread.orphaned = false;
                continue;
            }

            if (update.nextPosition) {
                thread.startLine = update.nextPosition.startLine;
                thread.startChar = update.nextPosition.startChar;
                thread.endLine = update.nextPosition.endLine;
                thread.endChar = update.nextPosition.endChar;
                thread.selectedText = update.nextPosition.text;
                thread.orphaned = false;
            } else {
                thread.orphaned = update.orphaned;
            }
        }
    }

    purgeExpiredDeletedComments(now: number = Date.now()): void {
        if (!hasExpiredDeletedComments(this.threads, now)) {
            return;
        }

        this.setThreads(purgeExpiredDeletedThreads(this.threads, now)
            .map((thread) => normalizeThread(thread)));
    }
}

function cloneThreadForVisibility(
    thread: CommentThread,
    options: CommentQueryOptions,
): CommentThread | null {
    if (!options.includeDeleted && isSoftDeleted(thread)) {
        return null;
    }

    const cloned = cloneCommentThread(thread);
    if (!options.includeDeleted) {
        cloned.entries = cloned.entries.filter((entry) => !isSoftDeleted(entry));
    }
    if (!cloned.entries.length) {
        return null;
    }

    cloned.updatedAt = Math.max(
        cloned.createdAt,
        ...cloned.entries.map((entry) => entry.timestamp),
    );
    return cloned;
}
