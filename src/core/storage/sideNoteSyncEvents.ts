import { cloneCommentThread, cloneCommentThreads, type CommentThread, type CommentThreadEntry } from "../../commentManager";
import { normalizeDeletedAt, purgeExpiredDeletedThreads } from "../rules/deletedCommentVisibility";

export const SIDE_NOTE_SYNC_EVENT_SCHEMA_VERSION = 1;
export const SIDE_NOTE_SYNC_EVENT_MARKER = "side-note2-event";

export type SideNoteSyncOp =
    | "createThread"
    | "appendEntry"
    | "updateEntry"
    | "deleteEntry"
    | "setThreadResolved"
    | "setThreadDeleted"
    | "setThreadPinned"
    | "updateAnchor"
    | "moveThread"
    | "moveEntry"
    | "renameNote"
    | "deleteNote";

export interface SideNoteSyncEvent {
    schemaVersion: 1;
    eventId: string;
    deviceId: string;
    notePath: string;
    noteHash: string;
    logicalClock: number;
    baseRevisionId: string | null;
    createdAt: number;
    op: SideNoteSyncOp;
    payload: unknown;
}

export interface SideNoteSyncEventInput {
    op: SideNoteSyncOp;
    payload: unknown;
}

export interface SideNoteSyncReductionResult {
    threads: CommentThread[];
    appliedEvents: SideNoteSyncEvent[];
    appliedEventIds: Set<string>;
    appliedLogicalClocks: Set<string>;
}

const EVENT_LINE_PATTERN = /^%% side-note2-event ([A-Za-z0-9_-]+) %%$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function encodeUtf8Base64Url(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    const base64 = typeof btoa === "function"
        ? btoa(binary)
        : Buffer.from(bytes).toString("base64");
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeUtf8Base64Url(value: string): string | null {
    const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - value.length % 4) % 4)}`;
    try {
        if (typeof atob === "function") {
            const binary = atob(padded);
            const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
            return new TextDecoder().decode(bytes);
        }

        return Buffer.from(padded, "base64").toString("utf8");
    } catch {
        return null;
    }
}

function isSideNoteSyncOp(value: unknown): value is SideNoteSyncOp {
    return value === "createThread"
        || value === "appendEntry"
        || value === "updateEntry"
        || value === "deleteEntry"
        || value === "setThreadResolved"
        || value === "setThreadDeleted"
        || value === "setThreadPinned"
        || value === "updateAnchor"
        || value === "moveThread"
        || value === "moveEntry"
        || value === "renameNote"
        || value === "deleteNote";
}

function normalizeThreadEntry(candidate: unknown): CommentThreadEntry | null {
    if (!isRecord(candidate)) {
        return null;
    }

    if (
        typeof candidate.id !== "string"
        || typeof candidate.body !== "string"
        || typeof candidate.timestamp !== "number"
    ) {
        return null;
    }

    const deletedAt = normalizeDeletedAt(candidate.deletedAt);
    return {
        id: candidate.id,
        body: candidate.body,
        timestamp: candidate.timestamp,
        ...(deletedAt !== undefined ? { deletedAt } : {}),
    };
}

function normalizeThread(candidate: unknown, notePath: string): CommentThread | null {
    if (!isRecord(candidate) || !Array.isArray(candidate.entries)) {
        return null;
    }

    if (
        typeof candidate.id !== "string"
        || typeof candidate.startLine !== "number"
        || typeof candidate.startChar !== "number"
        || typeof candidate.endLine !== "number"
        || typeof candidate.endChar !== "number"
        || typeof candidate.selectedText !== "string"
        || typeof candidate.selectedTextHash !== "string"
        || typeof candidate.createdAt !== "number"
        || typeof candidate.updatedAt !== "number"
    ) {
        return null;
    }

    const entries = candidate.entries
        .map((entry) => normalizeThreadEntry(entry))
        .filter((entry): entry is CommentThreadEntry => entry !== null);
    if (!entries.length) {
        return null;
    }

    return {
        id: candidate.id,
        filePath: notePath,
        startLine: candidate.startLine,
        startChar: candidate.startChar,
        endLine: candidate.endLine,
        endChar: candidate.endChar,
        selectedText: candidate.selectedText,
        selectedTextHash: candidate.selectedTextHash,
        anchorKind: candidate.anchorKind === "page" ? "page" : "selection",
        orphaned: candidate.anchorKind === "page" ? false : candidate.orphaned === true,
        isPinned: candidate.isPinned === true,
        resolved: candidate.resolved === true,
        deletedAt: normalizeDeletedAt(candidate.deletedAt),
        entries,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
    };
}

function compareEventOrder(left: SideNoteSyncEvent, right: SideNoteSyncEvent): number {
    if (left.logicalClock !== right.logicalClock) {
        return left.logicalClock - right.logicalClock;
    }
    const deviceComparison = left.deviceId.localeCompare(right.deviceId);
    if (deviceComparison !== 0) {
        return deviceComparison;
    }
    return left.eventId.localeCompare(right.eventId);
}

function getPayloadRecord(event: SideNoteSyncEvent): Record<string, unknown> | null {
    return isRecord(event.payload) ? event.payload : null;
}

function findThreadIndex(threads: CommentThread[], threadId: unknown): number {
    return typeof threadId === "string"
        ? threads.findIndex((thread) => thread.id === threadId)
        : -1;
}

function findEntryIndex(thread: CommentThread, entryId: unknown): number {
    return typeof entryId === "string"
        ? thread.entries.findIndex((entry) => entry.id === entryId)
        : -1;
}

function getConflictRecoveryEntryId(event: SideNoteSyncEvent): string {
    return `sync-conflict-${event.eventId}`;
}

function createConflictRecoveryEntry(event: SideNoteSyncEvent, overwrittenEntry: CommentThreadEntry): CommentThreadEntry {
    return {
        id: getConflictRecoveryEntryId(event),
        body: [
            "Sync conflict recovery.",
            "",
            "Another device edited this side note at the same time. SideNote2 kept the later edit in place and preserved this overwritten version:",
            "",
            overwrittenEntry.body,
        ].join("\n"),
        timestamp: event.createdAt,
    };
}

function applyCreateThread(threads: CommentThread[], event: SideNoteSyncEvent): CommentThread[] {
    const payload = getPayloadRecord(event);
    const nextThread = normalizeThread(payload?.thread, event.notePath);
    if (!nextThread || threads.some((thread) => thread.id === nextThread.id)) {
        return threads;
    }

    return [...threads, nextThread];
}

function applyAppendEntry(threads: CommentThread[], event: SideNoteSyncEvent): CommentThread[] {
    const payload = getPayloadRecord(event);
    const threadIndex = findThreadIndex(threads, payload?.threadId);
    const entry = normalizeThreadEntry(payload?.entry);
    if (threadIndex === -1 || !entry) {
        return threads;
    }

    const thread = threads[threadIndex];
    if (normalizeDeletedAt(thread.deletedAt) !== undefined || thread.entries.some((existing) => existing.id === entry.id)) {
        return threads;
    }

    const nextThreads = threads.slice();
    nextThreads[threadIndex] = {
        ...thread,
        entries: [...thread.entries, entry],
        updatedAt: Math.max(thread.updatedAt, entry.timestamp),
    };
    return nextThreads;
}

function applyUpdateEntry(threads: CommentThread[], event: SideNoteSyncEvent): CommentThread[] {
    const payload = getPayloadRecord(event);
    const threadIndex = findThreadIndex(threads, payload?.threadId);
    const entry = normalizeThreadEntry(payload?.entry);
    if (threadIndex === -1 || !entry) {
        return threads;
    }

    const thread = threads[threadIndex];
    if (normalizeDeletedAt(thread.deletedAt) !== undefined) {
        return threads;
    }

    const entryIndex = findEntryIndex(thread, payload?.entryId ?? entry.id);
    if (entryIndex === -1 || normalizeDeletedAt(thread.entries[entryIndex].deletedAt) !== undefined) {
        return threads;
    }

    const currentEntry = thread.entries[entryIndex];
    const previousEntry = normalizeThreadEntry(payload?.previousEntry);
    const hasConcurrentBodyChange = previousEntry
        && !areEntriesEqual(currentEntry, previousEntry)
        && currentEntry.body !== entry.body
        && !thread.entries.some((candidate) => candidate.id === getConflictRecoveryEntryId(event));
    const nextEntries = thread.entries.slice();
    nextEntries[entryIndex] = entry;
    if (hasConcurrentBodyChange) {
        nextEntries.push(createConflictRecoveryEntry(event, currentEntry));
    }
    const nextThreads = threads.slice();
    nextThreads[threadIndex] = {
        ...thread,
        entries: nextEntries,
        updatedAt: Math.max(thread.updatedAt, entry.timestamp, hasConcurrentBodyChange ? event.createdAt : 0),
    };
    return nextThreads;
}

function applyDeleteEntry(threads: CommentThread[], event: SideNoteSyncEvent): CommentThread[] {
    const payload = getPayloadRecord(event);
    const threadIndex = findThreadIndex(threads, payload?.threadId);
    if (threadIndex === -1) {
        return threads;
    }

    const thread = threads[threadIndex];
    const entryIndex = findEntryIndex(thread, payload?.entryId);
    if (entryIndex === -1) {
        return threads;
    }

    const deletedAt = typeof payload?.deletedAt === "number" ? payload.deletedAt : event.createdAt;
    const nextEntries = thread.entries.slice();
    nextEntries[entryIndex] = {
        ...nextEntries[entryIndex],
        deletedAt,
    };
    const nextThreads = threads.slice();
    nextThreads[threadIndex] = {
        ...thread,
        entries: nextEntries,
        updatedAt: Math.max(thread.updatedAt, deletedAt),
    };
    return nextThreads;
}

function applyThreadFlag(
    threads: CommentThread[],
    event: SideNoteSyncEvent,
    updater: (thread: CommentThread, payload: Record<string, unknown>) => CommentThread,
): CommentThread[] {
    const payload = getPayloadRecord(event);
    const threadIndex = findThreadIndex(threads, payload?.threadId);
    if (threadIndex === -1 || !payload) {
        return threads;
    }

    const nextThreads = threads.slice();
    nextThreads[threadIndex] = updater(threads[threadIndex], payload);
    return nextThreads;
}

function applyUpdateAnchor(threads: CommentThread[], event: SideNoteSyncEvent): CommentThread[] {
    return applyThreadFlag(threads, event, (thread, payload) => ({
        ...thread,
        startLine: typeof payload.startLine === "number" ? payload.startLine : thread.startLine,
        startChar: typeof payload.startChar === "number" ? payload.startChar : thread.startChar,
        endLine: typeof payload.endLine === "number" ? payload.endLine : thread.endLine,
        endChar: typeof payload.endChar === "number" ? payload.endChar : thread.endChar,
        selectedText: typeof payload.selectedText === "string" ? payload.selectedText : thread.selectedText,
        selectedTextHash: typeof payload.selectedTextHash === "string" ? payload.selectedTextHash : thread.selectedTextHash,
        anchorKind: payload.anchorKind === "page" ? "page" : "selection",
        orphaned: payload.anchorKind === "page" ? false : payload.orphaned === true,
        updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : Math.max(thread.updatedAt, event.createdAt),
    }));
}

function moveById<T extends { id: string }>(items: T[], movedId: unknown, beforeId: unknown): T[] {
    if (typeof movedId !== "string" || typeof beforeId !== "string" || movedId === beforeId) {
        return items;
    }

    const movingIndex = items.findIndex((item) => item.id === movedId);
    const beforeIndex = items.findIndex((item) => item.id === beforeId);
    if (movingIndex === -1 || beforeIndex === -1) {
        return items;
    }

    const nextItems = items.slice();
    const [movingItem] = nextItems.splice(movingIndex, 1);
    const nextBeforeIndex = nextItems.findIndex((item) => item.id === beforeId);
    nextItems.splice(nextBeforeIndex, 0, movingItem);
    return nextItems;
}

function applyMoveThread(threads: CommentThread[], event: SideNoteSyncEvent): CommentThread[] {
    const payload = getPayloadRecord(event);
    return payload ? moveById(threads, payload.threadId, payload.beforeThreadId) : threads;
}

function applyMoveEntry(threads: CommentThread[], event: SideNoteSyncEvent): CommentThread[] {
    const payload = getPayloadRecord(event);
    const threadIndex = findThreadIndex(threads, payload?.threadId);
    if (threadIndex === -1 || !payload) {
        return threads;
    }

    const thread = threads[threadIndex];
    const nextEntries = moveById(thread.entries, payload.entryId, payload.beforeEntryId);
    if (nextEntries === thread.entries) {
        return threads;
    }

    const nextThreads = threads.slice();
    nextThreads[threadIndex] = {
        ...thread,
        entries: nextEntries,
        updatedAt: Math.max(thread.updatedAt, event.createdAt),
    };
    return nextThreads;
}

function applyRenameNote(threads: CommentThread[], event: SideNoteSyncEvent): CommentThread[] {
    const payload = getPayloadRecord(event);
    const nextNotePath = typeof payload?.nextNotePath === "string" ? payload.nextNotePath : event.notePath;
    return threads.map((thread) => ({
        ...thread,
        filePath: nextNotePath,
    }));
}

function applyDeleteNote(threads: CommentThread[], event: SideNoteSyncEvent): CommentThread[] {
    return threads.map((thread) => ({
        ...thread,
        deletedAt: normalizeDeletedAt(thread.deletedAt) ?? event.createdAt,
        updatedAt: Math.max(thread.updatedAt, event.createdAt),
    }));
}

function applyEvent(threads: CommentThread[], event: SideNoteSyncEvent): CommentThread[] {
    switch (event.op) {
        case "createThread":
            return applyCreateThread(threads, event);
        case "appendEntry":
            return applyAppendEntry(threads, event);
        case "updateEntry":
            return applyUpdateEntry(threads, event);
        case "deleteEntry":
            return applyDeleteEntry(threads, event);
        case "setThreadResolved":
            return applyThreadFlag(threads, event, (thread, payload) => ({
                ...thread,
                resolved: payload.resolved === true,
                updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : Math.max(thread.updatedAt, event.createdAt),
            }));
        case "setThreadDeleted":
            return applyThreadFlag(threads, event, (thread, payload) => {
                const deletedAt = normalizeDeletedAt(payload.deletedAt) ?? (payload.deleted === false ? undefined : event.createdAt);
                return {
                    ...thread,
                    deletedAt,
                    updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : Math.max(thread.updatedAt, deletedAt ?? event.createdAt),
                };
            });
        case "setThreadPinned":
            return applyThreadFlag(threads, event, (thread, payload) => ({
                ...thread,
                isPinned: payload.isPinned === true,
                updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : Math.max(thread.updatedAt, event.createdAt),
            }));
        case "updateAnchor":
            return applyUpdateAnchor(threads, event);
        case "moveThread":
            return applyMoveThread(threads, event);
        case "moveEntry":
            return applyMoveEntry(threads, event);
        case "renameNote":
            return applyRenameNote(threads, event);
        case "deleteNote":
            return applyDeleteNote(threads, event);
    }
}

export function encodeSideNoteSyncEvent(event: SideNoteSyncEvent): string {
    return `%% ${SIDE_NOTE_SYNC_EVENT_MARKER} ${encodeUtf8Base64Url(JSON.stringify(event))} %%`;
}

export function normalizeSideNoteSyncEvent(value: unknown): SideNoteSyncEvent | null {
    if (!isRecord(value)) {
        return null;
    }

    if (
        value.schemaVersion !== SIDE_NOTE_SYNC_EVENT_SCHEMA_VERSION
        || typeof value.eventId !== "string"
        || typeof value.deviceId !== "string"
        || typeof value.notePath !== "string"
        || typeof value.noteHash !== "string"
        || typeof value.logicalClock !== "number"
        || !Number.isFinite(value.logicalClock)
        || (value.baseRevisionId !== null && typeof value.baseRevisionId !== "string")
        || typeof value.createdAt !== "number"
        || !Number.isFinite(value.createdAt)
        || !isSideNoteSyncOp(value.op)
    ) {
        return null;
    }

    return {
        schemaVersion: SIDE_NOTE_SYNC_EVENT_SCHEMA_VERSION,
        eventId: value.eventId,
        deviceId: value.deviceId,
        notePath: value.notePath,
        noteHash: value.noteHash,
        logicalClock: value.logicalClock,
        baseRevisionId: value.baseRevisionId,
        createdAt: value.createdAt,
        op: value.op,
        payload: value.payload,
    };
}

export function decodeSideNoteSyncEventLine(line: string): SideNoteSyncEvent | null {
    const match = EVENT_LINE_PATTERN.exec(line.trim());
    if (!match) {
        return null;
    }

    const decoded = decodeUtf8Base64Url(match[1]);
    if (!decoded) {
        return null;
    }

    try {
        const parsed: unknown = JSON.parse(decoded);
        return normalizeSideNoteSyncEvent(parsed);
    } catch {
        return null;
    }
}

export function parseSideNoteSyncEvents(content: string): SideNoteSyncEvent[] {
    return content
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => decodeSideNoteSyncEventLine(line))
        .filter((event): event is SideNoteSyncEvent => event !== null);
}

export function reduceSideNoteSyncEvents(
    baseThreads: CommentThread[],
    events: SideNoteSyncEvent[],
    options: {
        appliedEventIds?: Iterable<string>;
        appliedLogicalClocks?: Iterable<string>;
    } = {},
): SideNoteSyncReductionResult {
    let threads = cloneCommentThreads(baseThreads);
    const appliedEventIds = new Set(options.appliedEventIds ?? []);
    const appliedLogicalClocks = new Set(options.appliedLogicalClocks ?? []);
    const appliedEvents: SideNoteSyncEvent[] = [];

    for (const event of events.slice().sort(compareEventOrder)) {
        const clockKey = `${event.deviceId}:${event.logicalClock}`;
        if (appliedEventIds.has(event.eventId) || appliedLogicalClocks.has(clockKey)) {
            continue;
        }

        threads = applyEvent(threads, event);
        appliedEventIds.add(event.eventId);
        appliedLogicalClocks.add(clockKey);
        appliedEvents.push(event);
    }

    return {
        threads: purgeExpiredDeletedThreads(threads),
        appliedEvents,
        appliedEventIds,
        appliedLogicalClocks,
    };
}

export function cloneThreadForSyncPayload(thread: CommentThread): CommentThread {
    return cloneCommentThread(thread);
}

function areEntriesEqual(left: CommentThreadEntry, right: CommentThreadEntry): boolean {
    return left.id === right.id
        && left.body === right.body
        && left.timestamp === right.timestamp
        && normalizeDeletedAt(left.deletedAt) === normalizeDeletedAt(right.deletedAt);
}

function hasAnchorChanged(left: CommentThread, right: CommentThread): boolean {
    return left.startLine !== right.startLine
        || left.startChar !== right.startChar
        || left.endLine !== right.endLine
        || left.endChar !== right.endChar
        || left.selectedText !== right.selectedText
        || left.selectedTextHash !== right.selectedTextHash
        || (left.anchorKind ?? "selection") !== (right.anchorKind ?? "selection")
        || (left.orphaned === true) !== (right.orphaned === true);
}

export function buildSideNoteSyncEventInputsForThreadDiff(
    previousThreads: CommentThread[],
    nextThreads: CommentThread[],
): SideNoteSyncEventInput[] {
    const inputs: SideNoteSyncEventInput[] = [];
    const previousById = new Map(previousThreads.map((thread) => [thread.id, cloneCommentThread(thread)]));

    for (const nextThread of nextThreads) {
        const previousThread = previousById.get(nextThread.id);
        if (!previousThread) {
            inputs.push({
                op: "createThread",
                payload: {
                    thread: cloneThreadForSyncPayload(nextThread),
                },
            });
            continue;
        }

        if (hasAnchorChanged(previousThread, nextThread)) {
            inputs.push({
                op: "updateAnchor",
                payload: {
                    threadId: nextThread.id,
                    startLine: nextThread.startLine,
                    startChar: nextThread.startChar,
                    endLine: nextThread.endLine,
                    endChar: nextThread.endChar,
                    selectedText: nextThread.selectedText,
                    selectedTextHash: nextThread.selectedTextHash,
                    anchorKind: nextThread.anchorKind ?? "selection",
                    orphaned: nextThread.orphaned === true,
                    updatedAt: nextThread.updatedAt,
                },
            });
        }

        if ((previousThread.resolved === true) !== (nextThread.resolved === true)) {
            inputs.push({
                op: "setThreadResolved",
                payload: {
                    threadId: nextThread.id,
                    resolved: nextThread.resolved === true,
                    updatedAt: nextThread.updatedAt,
                },
            });
        }

        if ((previousThread.isPinned === true) !== (nextThread.isPinned === true)) {
            inputs.push({
                op: "setThreadPinned",
                payload: {
                    threadId: nextThread.id,
                    isPinned: nextThread.isPinned === true,
                    updatedAt: nextThread.updatedAt,
                },
            });
        }

        if (normalizeDeletedAt(previousThread.deletedAt) !== normalizeDeletedAt(nextThread.deletedAt)) {
            inputs.push({
                op: "setThreadDeleted",
                payload: {
                    threadId: nextThread.id,
                    deletedAt: normalizeDeletedAt(nextThread.deletedAt),
                    deleted: normalizeDeletedAt(nextThread.deletedAt) !== undefined,
                    updatedAt: nextThread.updatedAt,
                },
            });
        }

        const previousEntriesById = new Map(previousThread.entries.map((entry) => [entry.id, entry]));
        const nextEntriesById = new Map(nextThread.entries.map((entry) => [entry.id, entry]));
        for (const nextEntry of nextThread.entries) {
            const previousEntry = previousEntriesById.get(nextEntry.id);
            if (!previousEntry) {
                inputs.push({
                    op: "appendEntry",
                    payload: {
                        threadId: nextThread.id,
                        entry: {
                            ...nextEntry,
                        },
                    },
                });
                continue;
            }

            if (!areEntriesEqual(previousEntry, nextEntry)) {
                inputs.push({
                    op: "updateEntry",
                    payload: {
                        threadId: nextThread.id,
                        entryId: nextEntry.id,
                        previousEntry: {
                            ...previousEntry,
                        },
                        entry: {
                            ...nextEntry,
                        },
                    },
                });
            }
        }

        for (const previousEntry of previousThread.entries) {
            if (nextEntriesById.has(previousEntry.id)) {
                continue;
            }

            inputs.push({
                op: "deleteEntry",
                payload: {
                    threadId: nextThread.id,
                    entryId: previousEntry.id,
                    deletedAt: nextThread.updatedAt,
                },
            });
        }
    }

    const nextIds = new Set(nextThreads.map((thread) => thread.id));
    for (const previousThread of previousThreads) {
        if (nextIds.has(previousThread.id) || normalizeDeletedAt(previousThread.deletedAt) !== undefined) {
            continue;
        }

        inputs.push({
            op: "setThreadDeleted",
            payload: {
                threadId: previousThread.id,
                deleted: true,
                updatedAt: previousThread.updatedAt,
            },
        });
    }

    return inputs;
}
