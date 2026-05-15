import type { DataAdapter } from "obsidian";
import { cloneCommentThreads, type CommentThread } from "../../commentManager";
import { isPathInsideFolder } from "../files/pathScope";

const SIDECAR_STORAGE_VERSION = 1;

interface StoredSidecarComments {
    version: number;
    notePath: string;
    sourceId?: string;
    threads: CommentThread[];
}

export interface RemovedSidecarComments {
    notePath: string;
    sourceId?: string;
    threads: CommentThread[];
}

export interface SidecarCommentStorageOptions {
    adapter: DataAdapter;
    pluginDirPath: string;
    legacyPluginDirPaths?: string[];
    hashText(text: string): Promise<string>;
}

function normalizeStoragePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function getParentPath(path: string): string {
    const normalized = normalizeStoragePath(path);
    const slashIndex = normalized.lastIndexOf("/");
    return slashIndex <= 0 ? "" : normalized.slice(0, slashIndex);
}

async function ensureDirectory(adapter: DataAdapter, targetPath: string): Promise<void> {
    const segments = normalizeStoragePath(targetPath).split("/").filter(Boolean);
    let nextPath = "";
    for (const segment of segments) {
        nextPath = nextPath ? `${nextPath}/${segment}` : segment;
        if (await adapter.exists(nextPath)) {
            continue;
        }

        await adapter.mkdir(nextPath);
    }
}

function createTempFileSuffix(): string {
    const randomUuid = typeof window === "undefined"
        ? undefined
        : window.crypto?.randomUUID?.();
    if (randomUuid) {
        return randomUuid;
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object";
}

function parseStoredSidecarComments(value: unknown): StoredSidecarComments | null {
    if (
        !isRecord(value)
        || value.version !== SIDECAR_STORAGE_VERSION
        || typeof value.notePath !== "string"
        || !Array.isArray(value.threads)
    ) {
        return null;
    }

    const sourceId = typeof value.sourceId === "string" && value.sourceId.trim()
        ? value.sourceId.trim()
        : undefined;

    return {
        version: SIDECAR_STORAGE_VERSION,
        notePath: value.notePath,
        ...(sourceId ? { sourceId } : {}),
        threads: cloneThreadsForNote(value.notePath, value.threads),
    };
}

function cloneThreadsForNote(notePath: string, threads: unknown[]): CommentThread[] {
    return threads
        .filter((thread): thread is CommentThread => isRecord(thread))
        .map((thread) => ({
            ...thread,
            filePath: notePath,
            entries: Array.isArray(thread.entries)
                ? thread.entries.map((entry) => ({ ...entry }))
                : [],
        }));
}

export class SidecarCommentStorage {
    private readonly baseDirPath: string;
    private readonly sourceBaseDirPath: string;
    private readonly legacyBaseDirPaths: string[];
    private readonly legacySourceBaseDirPaths: string[];

    constructor(private readonly options: SidecarCommentStorageOptions) {
        this.baseDirPath = normalizeStoragePath(`${options.pluginDirPath}/sidenotes/by-note`);
        this.sourceBaseDirPath = normalizeStoragePath(`${options.pluginDirPath}/sidenotes/by-source`);
        const legacyPluginDirPaths = options.legacyPluginDirPaths ?? [];
        this.legacyBaseDirPaths = legacyPluginDirPaths
            .map((pluginDirPath) => normalizeStoragePath(`${pluginDirPath}/sidenotes/by-note`))
            .filter((path) => path !== this.baseDirPath);
        this.legacySourceBaseDirPaths = legacyPluginDirPaths
            .map((pluginDirPath) => normalizeStoragePath(`${pluginDirPath}/sidenotes/by-source`))
            .filter((path) => path !== this.sourceBaseDirPath);
    }

    public getBaseDirPath(): string {
        return this.baseDirPath;
    }

    public getSourceBaseDirPath(): string {
        return this.sourceBaseDirPath;
    }

    public async exists(notePath: string): Promise<boolean> {
        for (const storagePath of await this.getNoteStoragePaths(notePath)) {
            if (await this.options.adapter.exists(storagePath)) {
                return true;
            }
        }
        return false;
    }

    public async read(notePath: string): Promise<CommentThread[] | null> {
        return this.readFirstStoragePath(await this.getNoteStoragePaths(notePath), notePath);
    }

    public async existsForSource(sourceId: string): Promise<boolean> {
        for (const storagePath of await this.getSourceStoragePaths(sourceId)) {
            if (await this.options.adapter.exists(storagePath)) {
                return true;
            }
        }
        return false;
    }

    public async readForSource(sourceId: string, notePath: string): Promise<CommentThread[] | null> {
        return this.readFirstStoragePath(await this.getSourceStoragePaths(sourceId), notePath);
    }

    private async readFirstStoragePath(storagePaths: string[], notePath: string): Promise<CommentThread[] | null> {
        for (const storagePath of storagePaths) {
            const threads = await this.readStoragePath(storagePath, notePath);
            if (threads) {
                return threads;
            }
        }

        return null;
    }

    private async readStoragePath(storagePath: string, notePath: string): Promise<CommentThread[] | null> {
        const payload = await this.readStoragePayload(storagePath);
        return payload
            ? cloneThreadsForNote(notePath, payload.threads)
            : null;
    }

    private async readStoragePayload(storagePath: string): Promise<StoredSidecarComments | null> {
        if (!(await this.options.adapter.exists(storagePath))) {
            return null;
        }

        try {
            const rawContent = await this.options.adapter.read(storagePath);
            const parsed = JSON.parse(rawContent) as unknown;
            return parseStoredSidecarComments(parsed);
        } catch {
            return null;
        }
    }

    public async write(notePath: string, threads: CommentThread[]): Promise<void> {
        const storagePath = await this.getNoteStoragePath(notePath);
        await this.writeStoragePath(storagePath, notePath, threads);
    }

    public async writeForSource(sourceId: string, notePath: string, threads: CommentThread[]): Promise<void> {
        const storagePath = await this.getSourceStoragePath(sourceId);
        await this.writeStoragePath(storagePath, notePath, threads, sourceId);
    }

    private async writeStoragePath(
        storagePath: string,
        notePath: string,
        threads: CommentThread[],
        sourceId?: string,
    ): Promise<void> {
        if (threads.length === 0) {
            if (await this.options.adapter.exists(storagePath)) {
                await this.options.adapter.remove(storagePath);
            }
            return;
        }

        const normalizedThreads = cloneCommentThreads(threads).map((thread) => ({
            ...thread,
            filePath: notePath,
        }));
        const payload: StoredSidecarComments = {
            version: SIDECAR_STORAGE_VERSION,
            notePath,
            ...(sourceId ? { sourceId } : {}),
            threads: normalizedThreads,
        };
        const serialized = `${JSON.stringify(payload)}\n`;
        const tempPath = `${storagePath}.tmp-${createTempFileSuffix()}`;

        await ensureDirectory(this.options.adapter, getParentPath(storagePath));
        await this.options.adapter.write(tempPath, serialized);
        try {
            if (await this.options.adapter.exists(storagePath)) {
                await this.options.adapter.remove(storagePath);
            }
            await this.options.adapter.rename(tempPath, storagePath);
        } catch (error) {
            if (await this.options.adapter.exists(tempPath)) {
                await this.options.adapter.remove(tempPath);
            }
            throw error;
        }
    }

    public async rename(previousNotePath: string, nextNotePath: string): Promise<void> {
        if (previousNotePath === nextNotePath) {
            return;
        }

        const previousThreads = await this.read(previousNotePath);
        if (!previousThreads) {
            return;
        }

        if (previousThreads.length === 0) {
            await this.remove(previousNotePath);
            return;
        }

        await this.write(nextNotePath, previousThreads.map((thread) => ({
            ...thread,
            filePath: nextNotePath,
        })));

        const nextStoragePath = await this.getNoteStoragePath(nextNotePath);
        for (const oldStoragePath of await this.getNoteStoragePaths(previousNotePath)) {
            if (oldStoragePath !== nextStoragePath && await this.options.adapter.exists(oldStoragePath)) {
                await this.options.adapter.remove(oldStoragePath);
            }
        }
    }

    public async remove(notePath: string): Promise<void> {
        for (const storagePath of await this.getNoteStoragePaths(notePath)) {
            await this.removeStoragePath(storagePath);
        }
    }

    public async removeForSource(sourceId: string): Promise<void> {
        for (const storagePath of await this.getSourceStoragePaths(sourceId)) {
            await this.removeStoragePath(storagePath);
        }
    }

    public async listStoredComments(): Promise<RemovedSidecarComments[]> {
        const recordsByNotePath = new Map<string, RemovedSidecarComments>();
        for (const storagePath of await this.getAllStorageFiles()) {
            const payload = await this.readStoragePayload(storagePath);
            if (payload) {
                this.mergeStoredRecord(recordsByNotePath, payload);
            }
        }
        return this.sortStoredRecords(recordsByNotePath);
    }

    public async removeNote(notePath: string): Promise<RemovedSidecarComments | null> {
        const [removed] = await this.removeMatchingRecords((payload) => payload.notePath === notePath);
        return removed ?? null;
    }

    public async removeFolder(folderPath: string): Promise<RemovedSidecarComments[]> {
        return this.removeMatchingRecords((payload) => isPathInsideFolder(payload.notePath, folderPath));
    }

    private async removeMatchingRecords(
        matches: (payload: StoredSidecarComments) => boolean,
    ): Promise<RemovedSidecarComments[]> {
        const removedByNotePath = new Map<string, RemovedSidecarComments>();
        for (const storagePath of await this.getAllStorageFiles()) {
            const payload = await this.readStoragePayload(storagePath);
            if (!payload || !matches(payload)) {
                continue;
            }

            await this.removeStoragePath(storagePath);
            this.mergeStoredRecord(removedByNotePath, payload);
        }

        return this.sortStoredRecords(removedByNotePath);
    }

    private mergeStoredRecord(
        recordsByNotePath: Map<string, RemovedSidecarComments>,
        payload: StoredSidecarComments,
    ): void {
        const existing = recordsByNotePath.get(payload.notePath);
        recordsByNotePath.set(payload.notePath, {
            notePath: payload.notePath,
            sourceId: existing?.sourceId ?? payload.sourceId,
            threads: existing?.threads.length ? existing.threads : cloneCommentThreads(payload.threads),
        });
    }

    private sortStoredRecords(recordsByNotePath: Map<string, RemovedSidecarComments>): RemovedSidecarComments[] {
        return Array.from(recordsByNotePath.values())
            .sort((left, right) => left.notePath.localeCompare(right.notePath));
    }

    private async removeStoragePath(storagePath: string): Promise<void> {
        if (!(await this.options.adapter.exists(storagePath))) {
            return;
        }

        await this.options.adapter.remove(storagePath);
    }

    private async getAllStorageFiles(): Promise<string[]> {
        return this.listStorageFiles([
            this.baseDirPath,
            this.sourceBaseDirPath,
            ...this.legacyBaseDirPaths,
            ...this.legacySourceBaseDirPaths,
        ]);
    }

    private async listStorageFiles(baseDirPaths: string[]): Promise<string[]> {
        const files = new Set<string>();
        for (const baseDirPath of baseDirPaths) {
            for (const filePath of await this.listStorageFilesRecursively(baseDirPath)) {
                files.add(filePath);
            }
        }
        return Array.from(files).sort((left, right) => left.localeCompare(right));
    }

    private async listStorageFilesRecursively(directoryPath: string): Promise<string[]> {
        if (!(await this.options.adapter.exists(directoryPath))) {
            return [];
        }

        let listed: { files: string[]; folders: string[] };
        try {
            listed = await this.options.adapter.list(directoryPath);
        } catch {
            return [];
        }

        const nestedFiles = await Promise.all(
            listed.folders.map((folderPath) => this.listStorageFilesRecursively(folderPath)),
        );
        return [
            ...listed.files,
            ...nestedFiles.flat(),
        ];
    }

    public async getNoteStoragePath(notePath: string): Promise<string> {
        const noteHash = await this.options.hashText(notePath);
        const shard = noteHash.slice(0, 2) || "00";
        return normalizeStoragePath(`${this.baseDirPath}/${shard}/${noteHash}.json`);
    }

    private async getNoteStoragePaths(notePath: string): Promise<string[]> {
        const noteHash = await this.options.hashText(notePath);
        const shard = noteHash.slice(0, 2) || "00";
        return [this.baseDirPath, ...this.legacyBaseDirPaths]
            .map((baseDirPath) => normalizeStoragePath(`${baseDirPath}/${shard}/${noteHash}.json`));
    }

    public async getSourceStoragePath(sourceId: string): Promise<string> {
        const sourceHash = await this.options.hashText(sourceId);
        const shard = sourceHash.slice(0, 2) || "00";
        return normalizeStoragePath(`${this.sourceBaseDirPath}/${shard}/${sourceHash}.json`);
    }

    private async getSourceStoragePaths(sourceId: string): Promise<string[]> {
        const sourceHash = await this.options.hashText(sourceId);
        const shard = sourceHash.slice(0, 2) || "00";
        return [this.sourceBaseDirPath, ...this.legacySourceBaseDirPaths]
            .map((baseDirPath) => normalizeStoragePath(`${baseDirPath}/${shard}/${sourceHash}.json`));
    }
}
