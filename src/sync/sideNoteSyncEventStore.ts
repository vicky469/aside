import {
    SIDE_NOTE_SYNC_EVENT_SCHEMA_VERSION,
    normalizeSideNoteSyncEvent,
    type SideNoteSyncEvent,
    type SideNoteSyncEventInput,
} from "../core/storage/sideNoteSyncEvents";
import { cloneCommentThreads, type CommentThread } from "../commentManager";
import type { PersistedPluginData } from "../settings/indexNoteSettingsPlanner";

export const SIDE_NOTE_SYNC_EVENT_STATE_SCHEMA_VERSION = 1;

export interface SideNoteSyncDeviceLog {
    lastClock: number;
    events: SideNoteSyncEvent[];
}

export interface SideNoteSyncEventState {
    schemaVersion: 1;
    deviceLogs: Record<string, SideNoteSyncDeviceLog>;
    processedWatermarks: Record<string, Record<string, number>>;
    compactedWatermarks: Record<string, number>;
    noteSnapshots: Record<string, SideNoteSyncNoteSnapshot>;
}

export interface SideNoteSyncNoteSnapshot {
    notePath: string;
    noteHash: string;
    updatedAt: number;
    coveredWatermarks: Record<string, number>;
    threads: CommentThread[];
}

export interface SideNoteSyncSnapshotInput {
    notePath: string;
    threads: CommentThread[];
    coveredNotePath?: string;
}

export interface SideNoteSyncEventStoreHost {
    readPersistedPluginData(): PersistedPluginData;
    readLatestPersistedPluginData?(): Promise<PersistedPluginData | null>;
    writePersistedPluginData(data: PersistedPluginData): Promise<void>;
    getDeviceId(): string;
    createEventId(): string;
    hashText(text: string): Promise<string>;
    now(): number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneEvent(event: SideNoteSyncEvent): SideNoteSyncEvent {
    return {
        ...event,
        payload: isRecord(event.payload) || Array.isArray(event.payload)
            ? JSON.parse(JSON.stringify(event.payload)) as unknown
            : event.payload,
    };
}

function normalizeDeviceLog(value: unknown): SideNoteSyncDeviceLog {
    if (!isRecord(value)) {
        return {
            lastClock: 0,
            events: [],
        };
    }

    const events = Array.isArray(value.events)
        ? value.events
            .map((event) => normalizeSideNoteSyncEvent(event))
            .filter((event): event is SideNoteSyncEvent => event !== null)
        : [];
    const maxEventClock = events.reduce((max, event) => Math.max(max, event.logicalClock), 0);
    const lastClock = typeof value.lastClock === "number" && Number.isFinite(value.lastClock)
        ? Math.max(0, Math.floor(value.lastClock), maxEventClock)
        : maxEventClock;

    return {
        lastClock,
        events: events.map((event) => cloneEvent(event)),
    };
}

function normalizeWatermarks(value: unknown): Record<string, Record<string, number>> {
    if (!isRecord(value)) {
        return {};
    }

    const normalized: Record<string, Record<string, number>> = {};
    for (const [processorDeviceId, deviceWatermarks] of Object.entries(value)) {
        if (!isRecord(deviceWatermarks)) {
            continue;
        }

        const normalizedDeviceWatermarks: Record<string, number> = {};
        for (const [eventDeviceId, logicalClock] of Object.entries(deviceWatermarks)) {
            if (typeof logicalClock === "number" && Number.isFinite(logicalClock) && logicalClock > 0) {
                normalizedDeviceWatermarks[eventDeviceId] = Math.floor(logicalClock);
            }
        }
        normalized[processorDeviceId] = normalizedDeviceWatermarks;
    }

    return normalized;
}

function normalizeCoveredWatermarks(value: unknown): Record<string, number> {
    if (!isRecord(value)) {
        return {};
    }

    const normalized: Record<string, number> = {};
    for (const [deviceId, logicalClock] of Object.entries(value)) {
        if (typeof logicalClock === "number" && Number.isFinite(logicalClock) && logicalClock > 0) {
            normalized[deviceId] = Math.floor(logicalClock);
        }
    }
    return normalized;
}

function normalizeSnapshot(value: unknown): SideNoteSyncNoteSnapshot | null {
    if (
        !isRecord(value)
        || typeof value.notePath !== "string"
        || typeof value.noteHash !== "string"
        || typeof value.updatedAt !== "number"
        || !Number.isFinite(value.updatedAt)
        || !Array.isArray(value.threads)
    ) {
        return null;
    }

    return {
        notePath: value.notePath,
        noteHash: value.noteHash,
        updatedAt: value.updatedAt,
        coveredWatermarks: normalizeCoveredWatermarks(value.coveredWatermarks),
        threads: cloneCommentThreads(value.threads.filter(isCommentThreadLike)),
    };
}

function isCommentThreadLike(value: unknown): value is CommentThread {
    return isRecord(value)
        && typeof value.id === "string"
        && typeof value.filePath === "string"
        && Array.isArray(value.entries);
}

function cloneSnapshot(snapshot: SideNoteSyncNoteSnapshot): SideNoteSyncNoteSnapshot {
    return {
        notePath: snapshot.notePath,
        noteHash: snapshot.noteHash,
        updatedAt: snapshot.updatedAt,
        coveredWatermarks: { ...snapshot.coveredWatermarks },
        threads: cloneCommentThreads(snapshot.threads),
    };
}

export function normalizeSideNoteSyncEventState(value: unknown): SideNoteSyncEventState {
    if (!isRecord(value) || value.schemaVersion !== SIDE_NOTE_SYNC_EVENT_STATE_SCHEMA_VERSION) {
        return {
            schemaVersion: SIDE_NOTE_SYNC_EVENT_STATE_SCHEMA_VERSION,
            deviceLogs: {},
            processedWatermarks: {},
            compactedWatermarks: {},
            noteSnapshots: {},
        };
    }

    const deviceLogs: Record<string, SideNoteSyncDeviceLog> = {};
    if (isRecord(value.deviceLogs)) {
        for (const [deviceId, deviceLog] of Object.entries(value.deviceLogs)) {
            deviceLogs[deviceId] = normalizeDeviceLog(deviceLog);
        }
    }

    const noteSnapshots: Record<string, SideNoteSyncNoteSnapshot> = {};
    if (isRecord(value.noteSnapshots)) {
        for (const [noteHash, snapshotValue] of Object.entries(value.noteSnapshots)) {
            const snapshot = normalizeSnapshot(snapshotValue);
            if (snapshot) {
                noteSnapshots[noteHash] = snapshot;
            }
        }
    }

    return {
        schemaVersion: SIDE_NOTE_SYNC_EVENT_STATE_SCHEMA_VERSION,
        deviceLogs,
        processedWatermarks: normalizeWatermarks(value.processedWatermarks),
        compactedWatermarks: normalizeCoveredWatermarks(value.compactedWatermarks),
        noteSnapshots,
    };
}

function cloneState(state: SideNoteSyncEventState): SideNoteSyncEventState {
    return {
        schemaVersion: SIDE_NOTE_SYNC_EVENT_STATE_SCHEMA_VERSION,
        deviceLogs: Object.fromEntries(Object.entries(state.deviceLogs).map(([deviceId, log]) => [
            deviceId,
            {
                lastClock: log.lastClock,
                events: log.events.map((event) => cloneEvent(event)),
            },
        ])),
        processedWatermarks: Object.fromEntries(Object.entries(state.processedWatermarks).map(([deviceId, watermarks]) => [
            deviceId,
            { ...watermarks },
        ])),
        compactedWatermarks: { ...state.compactedWatermarks },
        noteSnapshots: Object.fromEntries(Object.entries(state.noteSnapshots).map(([noteHash, snapshot]) => [
            noteHash,
            cloneSnapshot(snapshot),
        ])),
    };
}

function compareEvents(left: SideNoteSyncEvent, right: SideNoteSyncEvent): number {
    if (left.logicalClock !== right.logicalClock) {
        return left.logicalClock - right.logicalClock;
    }
    const deviceComparison = left.deviceId.localeCompare(right.deviceId);
    if (deviceComparison !== 0) {
        return deviceComparison;
    }
    return left.eventId.localeCompare(right.eventId);
}

function getEventMergeKey(event: SideNoteSyncEvent): string {
    return `${event.deviceId}:${event.logicalClock}:${event.eventId}`;
}

function mergeDeviceLogs(
    left: SideNoteSyncDeviceLog | undefined,
    right: SideNoteSyncDeviceLog | undefined,
): SideNoteSyncDeviceLog {
    const eventsByKey = new Map<string, SideNoteSyncEvent>();
    for (const event of left?.events ?? []) {
        eventsByKey.set(getEventMergeKey(event), cloneEvent(event));
    }
    for (const event of right?.events ?? []) {
        eventsByKey.set(getEventMergeKey(event), cloneEvent(event));
    }

    const events = Array.from(eventsByKey.values()).sort(compareEvents);
    const maxEventClock = events.reduce((max, event) => Math.max(max, event.logicalClock), 0);
    return {
        lastClock: Math.max(left?.lastClock ?? 0, right?.lastClock ?? 0, maxEventClock),
        events,
    };
}

function mergeProcessorWatermarks(
    left: Record<string, number> | undefined,
    right: Record<string, number> | undefined,
): Record<string, number> {
    return mergeWatermarks(left ?? {}, right ?? {});
}

function getWatermarkCoverageScore(watermarks: Record<string, number>): number {
    return Object.values(watermarks).reduce((sum, value) => sum + value, 0);
}

function chooseSnapshot(
    left: SideNoteSyncNoteSnapshot | undefined,
    right: SideNoteSyncNoteSnapshot | undefined,
): SideNoteSyncNoteSnapshot | undefined {
    if (!left) {
        return right ? cloneSnapshot(right) : undefined;
    }
    if (!right) {
        return cloneSnapshot(left);
    }
    if (right.updatedAt > left.updatedAt) {
        return cloneSnapshot(right);
    }
    if (left.updatedAt > right.updatedAt) {
        return cloneSnapshot(left);
    }

    return getWatermarkCoverageScore(right.coveredWatermarks) > getWatermarkCoverageScore(left.coveredWatermarks)
        ? cloneSnapshot(right)
        : cloneSnapshot(left);
}

export function mergeSideNoteSyncEventStates(
    left: SideNoteSyncEventState,
    right: SideNoteSyncEventState,
): SideNoteSyncEventState {
    const compactedWatermarks = mergeWatermarks(left.compactedWatermarks, right.compactedWatermarks);
    const deviceLogIds = new Set([
        ...Object.keys(left.deviceLogs),
        ...Object.keys(right.deviceLogs),
    ]);
    const deviceLogs: Record<string, SideNoteSyncDeviceLog> = {};
    for (const deviceId of deviceLogIds) {
        const mergedLog = mergeDeviceLogs(left.deviceLogs[deviceId], right.deviceLogs[deviceId]);
        const compactedClock = compactedWatermarks[deviceId] ?? 0;
        const events = mergedLog.events.filter((event) => event.logicalClock > compactedClock);
        deviceLogs[deviceId] = {
            lastClock: Math.max(
                mergedLog.lastClock,
                compactedClock,
                events.reduce((max, event) => Math.max(max, event.logicalClock), 0),
            ),
            events,
        };
    }

    const processorIds = new Set([
        ...Object.keys(left.processedWatermarks),
        ...Object.keys(right.processedWatermarks),
    ]);
    const processedWatermarks: Record<string, Record<string, number>> = {};
    for (const processorId of processorIds) {
        processedWatermarks[processorId] = mergeProcessorWatermarks(
            left.processedWatermarks[processorId],
            right.processedWatermarks[processorId],
        );
    }

    const snapshotIds = new Set([
        ...Object.keys(left.noteSnapshots),
        ...Object.keys(right.noteSnapshots),
    ]);
    const noteSnapshots: Record<string, SideNoteSyncNoteSnapshot> = {};
    for (const noteHash of snapshotIds) {
        const snapshot = chooseSnapshot(left.noteSnapshots[noteHash], right.noteSnapshots[noteHash]);
        if (snapshot) {
            noteSnapshots[noteHash] = snapshot;
        }
    }

    return {
        schemaVersion: SIDE_NOTE_SYNC_EVENT_STATE_SCHEMA_VERSION,
        deviceLogs,
        processedWatermarks,
        compactedWatermarks,
        noteSnapshots,
    };
}

function advanceContiguousWatermark(currentClock: number, clocks: Iterable<number>): number {
    const clockSet = new Set(clocks);
    let nextClock = currentClock;
    while (clockSet.has(nextClock + 1)) {
        nextClock += 1;
    }
    return nextClock;
}

function getKnownDeviceIds(state: SideNoteSyncEventState): string[] {
    return Array.from(new Set([
        ...Object.keys(state.deviceLogs),
        ...Object.keys(state.processedWatermarks),
        ...Object.keys(state.compactedWatermarks),
    ])).sort();
}

function getCompactableWatermarks(state: SideNoteSyncEventState): Record<string, number> {
    const knownDeviceIds = getKnownDeviceIds(state);
    const compactableWatermarks: Record<string, number> = {};

    for (const eventDeviceId of Object.keys(state.deviceLogs)) {
        const coveredClocks = knownDeviceIds.map((processorDeviceId) =>
            state.processedWatermarks[processorDeviceId]?.[eventDeviceId] ?? 0);
        const processedByAllKnownDevices = coveredClocks.length
            ? Math.min(...coveredClocks)
            : 0;
        compactableWatermarks[eventDeviceId] = Math.max(
            state.compactedWatermarks[eventDeviceId] ?? 0,
            processedByAllKnownDevices,
        );
    }

    return compactableWatermarks;
}

function getNextCompactedWatermarks(
    state: SideNoteSyncEventState,
    compactableWatermarks: Record<string, number>,
): Record<string, number> {
    const nextWatermarks = { ...state.compactedWatermarks };

    for (const [deviceId, deviceLog] of Object.entries(state.deviceLogs)) {
        const currentCompactedClock = state.compactedWatermarks[deviceId] ?? 0;
        const maxCompactableClock = compactableWatermarks[deviceId] ?? 0;
        if (maxCompactableClock <= currentCompactedClock) {
            nextWatermarks[deviceId] = currentCompactedClock;
            continue;
        }

        let nextCompactedClock = currentCompactedClock;
        const eventsByClock = new Map(deviceLog.events.map((event) => [event.logicalClock, event]));
        while (nextCompactedClock < maxCompactableClock) {
            const nextEvent = eventsByClock.get(nextCompactedClock + 1);
            if (!nextEvent) {
                break;
            }

            const snapshot = state.noteSnapshots[nextEvent.noteHash];
            if ((snapshot?.coveredWatermarks[nextEvent.deviceId] ?? 0) < nextEvent.logicalClock) {
                break;
            }

            nextCompactedClock += 1;
        }

        nextWatermarks[deviceId] = nextCompactedClock;
    }

    return nextWatermarks;
}

function mergeWatermarks(
    left: Record<string, number>,
    right: Record<string, number>,
): Record<string, number> {
    const merged = { ...left };
    for (const [deviceId, logicalClock] of Object.entries(right)) {
        merged[deviceId] = Math.max(merged[deviceId] ?? 0, logicalClock);
    }
    return merged;
}

function areSyncEventStatesEqual(left: SideNoteSyncEventState, right: SideNoteSyncEventState): boolean {
    return JSON.stringify(cloneState(left)) === JSON.stringify(cloneState(right));
}

export class SideNoteSyncEventStore {
    constructor(private readonly host: SideNoteSyncEventStoreHost) {}

    public readState(): SideNoteSyncEventState {
        return normalizeSideNoteSyncEventState(this.host.readPersistedPluginData().sideNoteSyncEventState);
    }

    public async refreshFromLatestPersistedData(): Promise<boolean> {
        const latestPersistedData = await this.host.readLatestPersistedPluginData?.();
        if (!latestPersistedData) {
            return false;
        }

        const cachedState = this.readState();
        const latestState = normalizeSideNoteSyncEventState(latestPersistedData.sideNoteSyncEventState);
        const mergedState = mergeSideNoteSyncEventStates(cachedState, latestState);
        if (areSyncEventStatesEqual(cachedState, mergedState)) {
            return false;
        }

        await this.host.writePersistedPluginData({
            ...latestPersistedData,
            sideNoteSyncEventState: cloneState(mergedState),
        });
        return true;
    }

    public async appendLocalEvents(
        notePath: string,
        inputs: SideNoteSyncEventInput[],
        baseRevisionId: string | null = null,
    ): Promise<SideNoteSyncEvent[]> {
        if (inputs.length === 0) {
            return [];
        }

        const state = this.readState();
        const deviceId = this.host.getDeviceId();
        const noteHash = await this.host.hashText(notePath);
        const deviceLog = state.deviceLogs[deviceId] ?? {
            lastClock: 0,
            events: [],
        };
        const createdAt = this.host.now();
        const startClock = deviceLog.lastClock + 1;
        const events = inputs.map((input, index): SideNoteSyncEvent => ({
            schemaVersion: SIDE_NOTE_SYNC_EVENT_SCHEMA_VERSION,
            eventId: this.host.createEventId(),
            deviceId,
            notePath,
            noteHash,
            logicalClock: startClock + index,
            baseRevisionId,
            createdAt,
            op: input.op,
            payload: input.payload,
        }));

        state.deviceLogs[deviceId] = {
            lastClock: startClock + events.length - 1,
            events: deviceLog.events.concat(events.map((event) => cloneEvent(event))),
        };
        state.processedWatermarks[deviceId] = {
            ...(state.processedWatermarks[deviceId] ?? {}),
            [deviceId]: state.deviceLogs[deviceId].lastClock,
        };

        await this.writeState(state);
        return events.map((event) => cloneEvent(event));
    }

    public getUnprocessedEvents(): SideNoteSyncEvent[] {
        const state = this.readState();
        const processorDeviceId = this.host.getDeviceId();
        const watermarks = state.processedWatermarks[processorDeviceId] ?? {};
        const events: SideNoteSyncEvent[] = [];

        for (const [eventDeviceId, deviceLog] of Object.entries(state.deviceLogs)) {
            const processedClock = Math.max(
                watermarks[eventDeviceId] ?? 0,
                state.compactedWatermarks[eventDeviceId] ?? 0,
            );
            events.push(...deviceLog.events.filter((event) => event.logicalClock > processedClock));
        }

        return events.map((event) => cloneEvent(event)).sort(compareEvents);
    }

    public getSnapshots(): SideNoteSyncNoteSnapshot[] {
        return Object.values(this.readState().noteSnapshots)
            .map((snapshot) => cloneSnapshot(snapshot))
            .sort((left, right) => left.notePath.localeCompare(right.notePath));
    }

    public getCompactedWatermarks(): Record<string, number> {
        return { ...this.readState().compactedWatermarks };
    }

    public async markEventsProcessed(events: SideNoteSyncEvent[]): Promise<void> {
        if (events.length === 0) {
            return;
        }

        const state = this.readState();
        const processorDeviceId = this.host.getDeviceId();
        const processorWatermarks = {
            ...(state.processedWatermarks[processorDeviceId] ?? {}),
        };
        const processedClocksByDevice = new Map<string, number[]>();
        for (const event of events) {
            const clocks = processedClocksByDevice.get(event.deviceId) ?? [];
            clocks.push(event.logicalClock);
            processedClocksByDevice.set(event.deviceId, clocks);
        }

        for (const [eventDeviceId, processedClocks] of processedClocksByDevice.entries()) {
            const currentClock = Math.max(
                processorWatermarks[eventDeviceId] ?? 0,
                state.compactedWatermarks[eventDeviceId] ?? 0,
            );
            processorWatermarks[eventDeviceId] = advanceContiguousWatermark(currentClock, processedClocks);
        }

        state.processedWatermarks[processorDeviceId] = processorWatermarks;
        await this.writeState(state);
    }

    public async markWatermarksProcessed(watermarks: Record<string, number>): Promise<void> {
        if (Object.keys(watermarks).length === 0) {
            return;
        }

        const state = this.readState();
        const processorDeviceId = this.host.getDeviceId();
        const currentWatermarks = state.processedWatermarks[processorDeviceId] ?? {};
        const hasAdvancedWatermark = Object.entries(watermarks).some(([deviceId, logicalClock]) =>
            logicalClock > (currentWatermarks[deviceId] ?? 0));
        if (!hasAdvancedWatermark) {
            return;
        }

        state.processedWatermarks[processorDeviceId] = mergeWatermarks(
            currentWatermarks,
            watermarks,
        );
        await this.writeState(state);
    }

    public async compactProcessedEventsForSnapshots(
        snapshots: SideNoteSyncSnapshotInput[],
    ): Promise<{ removedEventCount: number; snapshotCount: number }> {
        if (snapshots.length === 0) {
            return {
                removedEventCount: 0,
                snapshotCount: 0,
            };
        }

        const state = this.readState();
        const compactableWatermarks = getCompactableWatermarks(state);
        const now = this.host.now();
        let snapshotCount = 0;
        for (const snapshot of snapshots) {
            const noteHash = await this.host.hashText(snapshot.coveredNotePath ?? snapshot.notePath);
            state.noteSnapshots[noteHash] = {
                notePath: snapshot.notePath,
                noteHash,
                updatedAt: now,
                coveredWatermarks: { ...compactableWatermarks },
                threads: cloneCommentThreads(snapshot.threads).map((thread) => ({
                    ...thread,
                    filePath: snapshot.notePath,
                })),
            };
            snapshotCount += 1;
        }

        state.compactedWatermarks = getNextCompactedWatermarks(state, compactableWatermarks);

        let removedEventCount = 0;
        for (const [deviceId, deviceLog] of Object.entries(state.deviceLogs)) {
            const compactedClock = state.compactedWatermarks[deviceId] ?? 0;
            const retainedEvents = deviceLog.events.filter((event) => {
                return event.logicalClock > compactedClock;
            });
            removedEventCount += deviceLog.events.length - retainedEvents.length;
            state.deviceLogs[deviceId] = {
                ...deviceLog,
                events: retainedEvents,
            };
        }

        await this.writeState(state);
        return {
            removedEventCount,
            snapshotCount,
        };
    }

    private async writeState(state: SideNoteSyncEventState): Promise<void> {
        const latestPersistedData = await this.host.readLatestPersistedPluginData?.()
            ?? this.host.readPersistedPluginData();
        const latestState = normalizeSideNoteSyncEventState(latestPersistedData.sideNoteSyncEventState);
        const mergedState = mergeSideNoteSyncEventStates(latestState, state);
        await this.host.writePersistedPluginData({
            ...latestPersistedData,
            sideNoteSyncEventState: cloneState(mergedState),
        });
    }
}
