import type { PersistedPluginData } from "../settings/indexNoteSettingsPlanner";
import { isPathInsideFolder } from "../core/files/pathScope";

export const SOURCE_IDENTITY_STATE_SCHEMA_VERSION = 1;

export interface SourceIdentityRecord {
    sourceId: string;
    currentPath: string;
    aliases: string[];
    contentFingerprint: string | null;
    createdAt: number;
    updatedAt: number;
}

export interface SourceIdentityState {
    schemaVersion: 1;
    sources: Record<string, SourceIdentityRecord>;
    pathToSourceId: Record<string, string>;
}

export interface SourceIdentityStoreHost {
    readPersistedPluginData(): PersistedPluginData;
    readLatestPersistedPluginData?(): Promise<PersistedPluginData | null>;
    writePersistedPluginData(data: PersistedPluginData): Promise<void>;
    createSourceId(): string;
    now(): number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizePathValue(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : null;
}

function normalizeFingerprint(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : null;
}

function uniquePaths(paths: Iterable<string>): string[] {
    return Array.from(new Set(Array.from(paths)
        .map((path) => path.trim())
        .filter((path) => path.length > 0)))
        .sort((left, right) => left.localeCompare(right));
}

function normalizeRecord(sourceId: string, value: unknown): SourceIdentityRecord | null {
    if (!isRecord(value)) {
        return null;
    }

    const recordSourceId = normalizePathValue(value.sourceId) ?? sourceId;
    const currentPath = normalizePathValue(value.currentPath);
    const createdAt = typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
        ? value.createdAt
        : 0;
    const updatedAt = typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : createdAt;
    if (!recordSourceId || !currentPath) {
        return null;
    }

    const aliases = Array.isArray(value.aliases)
        ? uniquePaths(value.aliases.filter((alias): alias is string => typeof alias === "string"))
        : [];

    return {
        sourceId: recordSourceId,
        currentPath,
        aliases: aliases.filter((alias) => alias !== currentPath),
        contentFingerprint: normalizeFingerprint(value.contentFingerprint),
        createdAt,
        updatedAt,
    };
}

function cloneRecord(record: SourceIdentityRecord): SourceIdentityRecord {
    return {
        ...record,
        aliases: [...record.aliases],
    };
}

function cloneState(state: SourceIdentityState): SourceIdentityState {
    return {
        schemaVersion: SOURCE_IDENTITY_STATE_SCHEMA_VERSION,
        sources: Object.fromEntries(Object.entries(state.sources).map(([sourceId, record]) => [
            sourceId,
            cloneRecord(record),
        ])),
        pathToSourceId: { ...state.pathToSourceId },
    };
}

function chooseCurrentPath(left: SourceIdentityRecord, right: SourceIdentityRecord): string {
    if (right.updatedAt > left.updatedAt) {
        return right.currentPath;
    }
    if (left.updatedAt > right.updatedAt) {
        return left.currentPath;
    }
    return right.currentPath.localeCompare(left.currentPath) >= 0
        ? right.currentPath
        : left.currentPath;
}

function chooseFingerprint(left: SourceIdentityRecord, right: SourceIdentityRecord): string | null {
    if (right.contentFingerprint && right.updatedAt >= left.updatedAt) {
        return right.contentFingerprint;
    }
    if (left.contentFingerprint) {
        return left.contentFingerprint;
    }
    return right.contentFingerprint;
}

function mergeRecords(left: SourceIdentityRecord, right: SourceIdentityRecord): SourceIdentityRecord {
    const currentPath = chooseCurrentPath(left, right);
    return {
        sourceId: left.sourceId,
        currentPath,
        aliases: uniquePaths([
            left.currentPath,
            right.currentPath,
            ...left.aliases,
            ...right.aliases,
        ]).filter((path) => path !== currentPath),
        contentFingerprint: chooseFingerprint(left, right),
        createdAt: Math.min(left.createdAt, right.createdAt),
        updatedAt: Math.max(left.updatedAt, right.updatedAt),
    };
}

function rebuildPathIndex(sources: Record<string, SourceIdentityRecord>): Record<string, string> {
    const candidatesByPath = new Map<string, SourceIdentityRecord[]>();
    for (const record of Object.values(sources)) {
        const candidates = candidatesByPath.get(record.currentPath) ?? [];
        candidates.push(record);
        candidatesByPath.set(record.currentPath, candidates);
    }

    const pathToSourceId: Record<string, string> = {};
    for (const [path, candidates] of candidatesByPath.entries()) {
        const [winner] = candidates.sort((left, right) =>
            right.updatedAt - left.updatedAt
            || right.sourceId.localeCompare(left.sourceId));
        if (winner) {
            pathToSourceId[path] = winner.sourceId;
        }
    }
    return pathToSourceId;
}

export function normalizeSourceIdentityState(value: unknown): SourceIdentityState {
    if (!isRecord(value) || value.schemaVersion !== SOURCE_IDENTITY_STATE_SCHEMA_VERSION) {
        return {
            schemaVersion: SOURCE_IDENTITY_STATE_SCHEMA_VERSION,
            sources: {},
            pathToSourceId: {},
        };
    }

    const sources: Record<string, SourceIdentityRecord> = {};
    if (isRecord(value.sources)) {
        for (const [sourceId, rawRecord] of Object.entries(value.sources)) {
            const record = normalizeRecord(sourceId, rawRecord);
            if (record) {
                sources[record.sourceId] = record;
            }
        }
    }

    return {
        schemaVersion: SOURCE_IDENTITY_STATE_SCHEMA_VERSION,
        sources,
        pathToSourceId: rebuildPathIndex(sources),
    };
}

export function mergeSourceIdentityStates(
    left: SourceIdentityState,
    right: SourceIdentityState,
): SourceIdentityState {
    const sources: Record<string, SourceIdentityRecord> = {};
    for (const [sourceId, record] of Object.entries(left.sources)) {
        sources[sourceId] = cloneRecord(record);
    }
    for (const [sourceId, record] of Object.entries(right.sources)) {
        sources[sourceId] = sources[sourceId]
            ? mergeRecords(sources[sourceId], record)
            : cloneRecord(record);
    }

    return {
        schemaVersion: SOURCE_IDENTITY_STATE_SCHEMA_VERSION,
        sources,
        pathToSourceId: rebuildPathIndex(sources),
    };
}

function areStatesEqual(left: SourceIdentityState, right: SourceIdentityState): boolean {
    return JSON.stringify(cloneState(left)) === JSON.stringify(cloneState(right));
}

export class SourceIdentityStore {
    constructor(private readonly host: SourceIdentityStoreHost) {}

    public readState(): SourceIdentityState {
        return normalizeSourceIdentityState(this.host.readPersistedPluginData().sourceIdentityState);
    }

    public getRecordByPath(filePath: string): SourceIdentityRecord | null {
        const state = this.readState();
        const sourceId = state.pathToSourceId[filePath];
        return sourceId ? cloneRecord(state.sources[sourceId]) : null;
    }

    public getRecordByPathIncludingAliases(filePath: string): SourceIdentityRecord | null {
        const state = this.readState();
        const sourceId = this.getSourceIdByPathIncludingAliases(state, filePath);
        return sourceId ? cloneRecord(state.sources[sourceId]) : null;
    }

    public getRecordBySourceId(sourceId: string): SourceIdentityRecord | null {
        const record = this.readState().sources[sourceId];
        return record ? cloneRecord(record) : null;
    }

    public getRecords(): SourceIdentityRecord[] {
        return Object.values(this.readState().sources)
            .map((record) => cloneRecord(record))
            .sort((left, right) => left.currentPath.localeCompare(right.currentPath));
    }

    public async removeSourceForPath(filePath: string): Promise<SourceIdentityRecord | null> {
        const latestPersistedData = await this.host.readLatestPersistedPluginData?.()
            ?? this.host.readPersistedPluginData();
        const state = normalizeSourceIdentityState(latestPersistedData.sourceIdentityState);
        const sourceId = state.pathToSourceId[filePath];
        const record = sourceId ? state.sources[sourceId] : null;
        if (!sourceId || !record) {
            return null;
        }

        delete state.sources[sourceId];
        await this.host.writePersistedPluginData({
            ...latestPersistedData,
            sourceIdentityState: cloneState({
                ...state,
                pathToSourceId: rebuildPathIndex(state.sources),
            }),
        });
        return cloneRecord(record);
    }

    public async removeSourcesInFolder(folderPath: string): Promise<SourceIdentityRecord[]> {
        const latestPersistedData = await this.host.readLatestPersistedPluginData?.()
            ?? this.host.readPersistedPluginData();
        const state = normalizeSourceIdentityState(latestPersistedData.sourceIdentityState);
        const removedRecords: SourceIdentityRecord[] = [];
        for (const [sourceId, record] of Object.entries(state.sources)) {
            if (!isPathInsideFolder(record.currentPath, folderPath)) {
                continue;
            }

            removedRecords.push(cloneRecord(record));
            delete state.sources[sourceId];
        }

        if (removedRecords.length === 0) {
            return [];
        }

        await this.host.writePersistedPluginData({
            ...latestPersistedData,
            sourceIdentityState: cloneState({
                ...state,
                pathToSourceId: rebuildPathIndex(state.sources),
            }),
        });
        return removedRecords.sort((left, right) => left.currentPath.localeCompare(right.currentPath));
    }

    public async ensureSourceForPath(filePath: string, contentFingerprint: string | null = null): Promise<SourceIdentityRecord> {
        const state = this.readState();
        const existingSourceId = state.pathToSourceId[filePath];
        if (existingSourceId && state.sources[existingSourceId]) {
            const record = state.sources[existingSourceId];
            const nextRecord = this.buildUpdatedRecord(record, {
                currentPath: filePath,
                aliases: record.currentPath === filePath ? record.aliases : [...record.aliases, record.currentPath],
                contentFingerprint: contentFingerprint ?? record.contentFingerprint,
            });
            if (!areRecordsEqual(record, nextRecord)) {
                state.sources[existingSourceId] = nextRecord;
                await this.writeState(state);
            }
            return cloneRecord(nextRecord);
        }

        const now = this.host.now();
        const sourceId = this.host.createSourceId();
        const record: SourceIdentityRecord = {
            sourceId,
            currentPath: filePath,
            aliases: [],
            contentFingerprint,
            createdAt: now,
            updatedAt: now,
        };
        state.sources[sourceId] = record;
        await this.writeState(state);
        return cloneRecord(record);
    }

    public async createSourceForPath(filePath: string, contentFingerprint: string | null = null): Promise<SourceIdentityRecord> {
        const state = this.readState();
        const now = this.host.now();
        const record: SourceIdentityRecord = {
            sourceId: this.host.createSourceId(),
            currentPath: filePath,
            aliases: [],
            contentFingerprint,
            createdAt: now,
            updatedAt: now,
        };
        state.sources[record.sourceId] = record;
        await this.writeState(state);
        return cloneRecord(record);
    }

    public async recordRename(
        previousPath: string,
        nextPath: string,
        contentFingerprint: string | null = null,
    ): Promise<SourceIdentityRecord> {
        const state = this.readState();
        const sourceId = this.getSourceIdByPathIncludingAliases(state, previousPath)
            ?? this.getSourceIdByPathIncludingAliases(state, nextPath);
        if (sourceId && state.sources[sourceId]) {
            const record = state.sources[sourceId];
            const nextRecord = this.buildUpdatedRecord(record, {
                currentPath: nextPath,
                aliases: [...record.aliases, previousPath, record.currentPath].filter((path) => path !== nextPath),
                contentFingerprint: contentFingerprint ?? record.contentFingerprint,
            });
            state.sources[sourceId] = nextRecord;
            await this.writeState(state);
            return cloneRecord(nextRecord);
        }

        const now = this.host.now();
        const record: SourceIdentityRecord = {
            sourceId: this.host.createSourceId(),
            currentPath: nextPath,
            aliases: previousPath === nextPath ? [] : [previousPath],
            contentFingerprint,
            createdAt: now,
            updatedAt: now,
        };
        state.sources[record.sourceId] = record;
        await this.writeState(state);
        return cloneRecord(record);
    }

    public async attachPathToSource(
        sourceId: string,
        filePath: string,
        options: {
            contentFingerprint?: string | null;
            aliases?: string[];
        } = {},
    ): Promise<SourceIdentityRecord> {
        const state = this.readState();
        const existing = state.sources[sourceId];
        const now = this.host.now();
        const base: SourceIdentityRecord = existing ?? {
            sourceId,
            currentPath: filePath,
            aliases: [],
            contentFingerprint: null,
            createdAt: now,
            updatedAt: now,
        };
        const nextRecord = this.buildUpdatedRecord(base, {
            currentPath: filePath,
            aliases: [
                ...base.aliases,
                base.currentPath,
                ...(options.aliases ?? []),
            ].filter((path) => path !== filePath),
            contentFingerprint: options.contentFingerprint ?? base.contentFingerprint,
        });
        state.sources[sourceId] = nextRecord;
        await this.writeState(state);
        return cloneRecord(nextRecord);
    }

    public async refreshFromLatestPersistedData(): Promise<boolean> {
        const latestPersistedData = await this.host.readLatestPersistedPluginData?.();
        if (!latestPersistedData) {
            return false;
        }

        const cachedState = this.readState();
        const latestState = normalizeSourceIdentityState(latestPersistedData.sourceIdentityState);
        const mergedState = mergeSourceIdentityStates(cachedState, latestState);
        if (areStatesEqual(cachedState, mergedState)) {
            return false;
        }

        await this.host.writePersistedPluginData({
            ...latestPersistedData,
            sourceIdentityState: cloneState(mergedState),
        });
        return true;
    }

    private buildUpdatedRecord(
        record: SourceIdentityRecord,
        updates: {
            currentPath: string;
            aliases: string[];
            contentFingerprint: string | null;
        },
    ): SourceIdentityRecord {
        const aliases = uniquePaths(updates.aliases).filter((path) => path !== updates.currentPath);
        const changed = record.currentPath !== updates.currentPath
            || record.contentFingerprint !== updates.contentFingerprint
            || record.aliases.length !== aliases.length
            || record.aliases.some((alias, index) => alias !== aliases[index]);
        return {
            ...record,
            currentPath: updates.currentPath,
            aliases,
            contentFingerprint: updates.contentFingerprint,
            updatedAt: changed ? this.host.now() : record.updatedAt,
        };
    }

    private async writeState(state: SourceIdentityState): Promise<void> {
        const latestPersistedData = await this.host.readLatestPersistedPluginData?.()
            ?? this.host.readPersistedPluginData();
        const latestState = normalizeSourceIdentityState(latestPersistedData.sourceIdentityState);
        const mergedState = mergeSourceIdentityStates(latestState, {
            ...state,
            pathToSourceId: rebuildPathIndex(state.sources),
        });
        await this.host.writePersistedPluginData({
            ...latestPersistedData,
            sourceIdentityState: cloneState(mergedState),
        });
    }

    private getSourceIdByPathIncludingAliases(state: SourceIdentityState, filePath: string): string | null {
        const currentPathSourceId = state.pathToSourceId[filePath];
        if (currentPathSourceId && state.sources[currentPathSourceId]) {
            return currentPathSourceId;
        }

        const candidates = Object.values(state.sources).filter((record) =>
            record.aliases.includes(filePath));
        const [winner] = candidates.sort((left, right) =>
            right.updatedAt - left.updatedAt
            || right.sourceId.localeCompare(left.sourceId));
        return winner?.sourceId ?? null;
    }
}

function areRecordsEqual(left: SourceIdentityRecord, right: SourceIdentityRecord): boolean {
    return left.sourceId === right.sourceId
        && left.currentPath === right.currentPath
        && left.contentFingerprint === right.contentFingerprint
        && left.createdAt === right.createdAt
        && left.updatedAt === right.updatedAt
        && left.aliases.length === right.aliases.length
        && left.aliases.every((alias, index) => alias === right.aliases[index]);
}
