import type { DataAdapter } from "obsidian";
import { cloneCommentThread, cloneCommentThreads, type CommentThread } from "../../commentManager";
import { isPathInsideFolder } from "../files/pathScope";
import {
    isPluginEventExecutionActive,
    type PluginEventExecutionContext,
} from "../events/pluginEventExecutionContext";

const SIDECAR_STORAGE_VERSION = 1;
const storagePathMutationTails = new WeakMap<object, Map<string, Promise<void>>>();
const storageDiscoveryTails = new WeakMap<object, Promise<void>>();

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

async function ensureDirectory(
    adapter: DataAdapter,
    targetPath: string,
    context: PluginEventExecutionContext,
): Promise<void> {
    const segments = normalizeStoragePath(targetPath).split("/").filter(Boolean);
    let nextPath = "";
    for (const segment of segments) {
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        nextPath = nextPath ? `${nextPath}/${segment}` : segment;
        if (await adapter.exists(nextPath)) {
            continue;
        }
        if (!isPluginEventExecutionActive(context)) {
            return;
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

function isMissingFileError(error: unknown): boolean {
    if (isRecord(error) && error.code === "ENOENT") {
        return true;
    }

    return error instanceof Error && error.message.includes("ENOENT");
}

async function enqueueStoragePathMutation<T>(
    adapter: DataAdapter,
    storagePath: string,
    operation: () => Promise<T>,
): Promise<T> {
    let tails = storagePathMutationTails.get(adapter);
    if (!tails) {
        tails = new Map<string, Promise<void>>();
        storagePathMutationTails.set(adapter, tails);
    }
    const previousTail = tails.get(storagePath) ?? Promise.resolve();
    const discoveryTail = storageDiscoveryTails.get(adapter) ?? Promise.resolve();
    const result = Promise.all([
        previousTail.catch(() => {}),
        discoveryTail.catch(() => {}),
    ]).then(operation);
    const nextTail = result.then(() => {}, () => {});
    tails.set(storagePath, nextTail);
    try {
        return await result;
    } finally {
        if (tails.get(storagePath) === nextTail) {
            tails.delete(storagePath);
        }
    }
}

async function enqueueStorageDiscovery<T>(
    adapter: DataAdapter,
    operation: () => Promise<T>,
): Promise<T> {
    const previousDiscovery = storageDiscoveryTails.get(adapter) ?? Promise.resolve();
    const mutationTails = Array.from(storagePathMutationTails.get(adapter)?.values() ?? []);
    const result = previousDiscovery
        .catch(() => {})
        .then(() => Promise.all(mutationTails))
        .then(operation);
    const nextDiscovery = result.then(() => {}, () => {});
    storageDiscoveryTails.set(adapter, nextDiscovery);
    try {
        return await result;
    } finally {
        if (storageDiscoveryTails.get(adapter) === nextDiscovery) {
            storageDiscoveryTails.delete(adapter);
        }
    }
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
        .map((thread) => cloneCommentThread({
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

    constructor(private readonly options: SidecarCommentStorageOptions) {
        this.baseDirPath = normalizeStoragePath(`${options.pluginDirPath}/sidenotes/by-note`);
        this.sourceBaseDirPath = normalizeStoragePath(`${options.pluginDirPath}/sidenotes/by-source`);
    }

    public getBaseDirPath(): string {
        return this.baseDirPath;
    }

    public getSourceBaseDirPath(): string {
        return this.sourceBaseDirPath;
    }

    public async exists(notePath: string): Promise<boolean> {
        const storagePath = await this.getNoteStoragePath(notePath);
        return enqueueStoragePathMutation(
            this.options.adapter,
            storagePath,
            () => this.options.adapter.exists(storagePath),
        );
    }

    public async read(notePath: string): Promise<CommentThread[] | null> {
        return this.readStoragePath(await this.getNoteStoragePath(notePath), notePath);
    }

    public async existsForSource(sourceId: string): Promise<boolean> {
        const storagePath = await this.getSourceStoragePath(sourceId);
        return enqueueStoragePathMutation(
            this.options.adapter,
            storagePath,
            () => this.options.adapter.exists(storagePath),
        );
    }

    public async readForSource(sourceId: string, notePath: string): Promise<CommentThread[] | null> {
        return this.readStoragePath(await this.getSourceStoragePath(sourceId), notePath);
    }

    private async readStoragePath(storagePath: string, notePath: string): Promise<CommentThread[] | null> {
        const payload = await this.readStoragePayload(storagePath);
        return payload
            ? cloneThreadsForNote(notePath, payload.threads)
            : null;
    }

    private async readStoragePayload(storagePath: string): Promise<StoredSidecarComments | null> {
        return enqueueStoragePathMutation(
            this.options.adapter,
            storagePath,
            () => this.readStoragePayloadExclusive(storagePath),
        );
    }

    private async readStoragePayloadExclusive(storagePath: string): Promise<StoredSidecarComments | null> {
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

    public async write(
        notePath: string,
        threads: CommentThread[],
        context: PluginEventExecutionContext,
    ): Promise<void> {
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        const storagePath = await this.getNoteStoragePath(notePath);
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        await this.writeStoragePath(storagePath, notePath, threads, context);
    }

    public async writeForSource(
        sourceId: string,
        notePath: string,
        threads: CommentThread[],
        context: PluginEventExecutionContext,
    ): Promise<void> {
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        const storagePath = await this.getSourceStoragePath(sourceId);
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        await this.writeStoragePath(storagePath, notePath, threads, context, sourceId);
    }

    private async writeStoragePath(
        storagePath: string,
        notePath: string,
        threads: CommentThread[],
        context: PluginEventExecutionContext,
        sourceId?: string,
    ): Promise<void> {
        await enqueueStoragePathMutation(
            this.options.adapter,
            storagePath,
            () => this.writeStoragePathExclusive(storagePath, notePath, threads, context, sourceId),
        );
    }

    private async writeStoragePathExclusive(
        storagePath: string,
        notePath: string,
        threads: CommentThread[],
        context: PluginEventExecutionContext,
        sourceId?: string,
    ): Promise<void> {
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        if (threads.length === 0) {
            await this.removeStoragePathExclusive(storagePath, context);
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
        let previousContent: string | null = null;

        if (await this.options.adapter.exists(storagePath)) {
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            try {
                previousContent = await this.options.adapter.read(storagePath);
            } catch (error) {
                if (!isMissingFileError(error)) {
                    throw error;
                }
            }
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
        }

        await ensureDirectory(this.options.adapter, getParentPath(storagePath), context);
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        await this.options.adapter.write(tempPath, serialized);
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        try {
            await this.removeStoragePathExclusive(storagePath, context);
            if (!isPluginEventExecutionActive(context)) {
                await this.restoreCanonicalAfterInterruptedCommit(storagePath, tempPath, previousContent);
                return;
            }
            await this.options.adapter.rename(tempPath, storagePath);
            if (!isPluginEventExecutionActive(context)) {
                await this.rollbackCommittedReplacement(storagePath, previousContent);
            }
        } catch (error) {
            if (!isPluginEventExecutionActive(context)) {
                await this.restoreCanonicalAfterInterruptedCommit(storagePath, tempPath, previousContent);
                return;
            }
            await this.restoreCanonicalAfterInterruptedCommit(storagePath, tempPath, previousContent);
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            throw error;
        }
    }

    private async rollbackCommittedReplacement(
        storagePath: string,
        previousContent: string | null,
    ): Promise<void> {
        if (previousContent !== null) {
            await this.options.adapter.write(storagePath, previousContent);
            return;
        }
        try {
            await this.options.adapter.remove(storagePath);
        } catch (error) {
            if (!isMissingFileError(error)) {
                throw error;
            }
        }
    }

    private async restoreCanonicalAfterInterruptedCommit(
        storagePath: string,
        tempPath: string,
        previousContent: string | null,
    ): Promise<void> {
        if (previousContent !== null && !(await this.options.adapter.exists(storagePath))) {
            await this.options.adapter.write(storagePath, previousContent);
        }
        try {
            await this.options.adapter.remove(tempPath);
        } catch (error) {
            if (!isMissingFileError(error)) {
                throw error;
            }
        }
    }

    public async rename(
        previousNotePath: string,
        nextNotePath: string,
        context: PluginEventExecutionContext,
    ): Promise<void> {
        if (previousNotePath === nextNotePath || !isPluginEventExecutionActive(context)) {
            return;
        }

        const previousThreads = await this.read(previousNotePath);
        if (!previousThreads || !isPluginEventExecutionActive(context)) {
            return;
        }

        if (previousThreads.length === 0) {
            await this.remove(previousNotePath, context);
            return;
        }

        await this.write(nextNotePath, previousThreads.map((thread) => ({
            ...thread,
            filePath: nextNotePath,
        })), context);
        if (!isPluginEventExecutionActive(context)) {
            return;
        }

        const previousStoragePath = await this.getNoteStoragePath(previousNotePath);
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        await this.removeStoragePath(previousStoragePath, context);
    }

    public async remove(notePath: string, context: PluginEventExecutionContext): Promise<void> {
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        const storagePath = await this.getNoteStoragePath(notePath);
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        await this.removeStoragePath(storagePath, context);
    }

    public async removeForSource(sourceId: string, context: PluginEventExecutionContext): Promise<void> {
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        const storagePath = await this.getSourceStoragePath(sourceId);
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        await this.removeStoragePath(storagePath, context);
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

    public async removeNote(
        notePath: string,
        context: PluginEventExecutionContext,
    ): Promise<RemovedSidecarComments | null> {
        const [removed] = await this.removeMatchingRecords(
            (payload) => payload.notePath === notePath,
            context,
        );
        return removed ?? null;
    }

    public async removeFolder(
        folderPath: string,
        context: PluginEventExecutionContext,
    ): Promise<RemovedSidecarComments[]> {
        return this.removeMatchingRecords(
            (payload) => isPathInsideFolder(payload.notePath, folderPath),
            context,
        );
    }

    private async removeMatchingRecords(
        matches: (payload: StoredSidecarComments) => boolean,
        context: PluginEventExecutionContext,
    ): Promise<RemovedSidecarComments[]> {
        if (!isPluginEventExecutionActive(context)) {
            return [];
        }
        const removedByNotePath = new Map<string, RemovedSidecarComments>();
        const storagePaths = await this.getAllStorageFiles();
        if (!isPluginEventExecutionActive(context)) {
            return [];
        }
        for (const storagePath of storagePaths) {
            if (!isPluginEventExecutionActive(context)) {
                return [];
            }
            const payload = await this.readStoragePayload(storagePath);
            if (!isPluginEventExecutionActive(context)) {
                return [];
            }
            if (!payload || !matches(payload)) {
                continue;
            }

            await this.removeStoragePath(storagePath, context);
            if (!isPluginEventExecutionActive(context)) {
                return [];
            }
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

    private async removeStoragePath(
        storagePath: string,
        context: PluginEventExecutionContext,
    ): Promise<void> {
        await enqueueStoragePathMutation(
            this.options.adapter,
            storagePath,
            () => this.removeStoragePathExclusive(storagePath, context),
        );
    }

    private async removeStoragePathExclusive(
        storagePath: string,
        context: PluginEventExecutionContext,
    ): Promise<void> {
        if (!isPluginEventExecutionActive(context)) {
            return;
        }
        const exists = await this.options.adapter.exists(storagePath);
        if (!exists || !isPluginEventExecutionActive(context)) {
            return;
        }

        try {
            await this.options.adapter.remove(storagePath);
        } catch (error) {
            if (!isPluginEventExecutionActive(context)) {
                return;
            }
            if (!isMissingFileError(error)) {
                throw error;
            }
        }
    }

    private async getAllStorageFiles(): Promise<string[]> {
        return enqueueStorageDiscovery(
            this.options.adapter,
            () => this.listStorageFiles([
                this.baseDirPath,
                this.sourceBaseDirPath,
            ]),
        );
    }

    private async listStorageFiles(baseDirPaths: string[]): Promise<string[]> {
        const files = new Set<string>();
        for (const baseDirPath of baseDirPaths) {
            for (const filePath of await this.listStorageFilesRecursively(baseDirPath)) {
                if (this.isCanonicalStorageFilePath(baseDirPath, filePath)) {
                    files.add(filePath);
                }
            }
        }
        return Array.from(files).sort((left, right) => left.localeCompare(right));
    }

    private isCanonicalStorageFilePath(baseDirPath: string, filePath: string): boolean {
        const prefix = `${normalizeStoragePath(baseDirPath)}/`;
        const normalizedFilePath = normalizeStoragePath(filePath);
        if (!normalizedFilePath.startsWith(prefix)) {
            return false;
        }

        const relativeParts = normalizedFilePath.slice(prefix.length).split("/");
        if (relativeParts.length !== 2) {
            return false;
        }
        const [shard, fileName] = relativeParts;
        if (!fileName?.endsWith(".json")) {
            return false;
        }
        const hash = fileName.slice(0, -".json".length);
        return hash.length > 0 && shard === (hash.slice(0, 2) || "00");
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

    public async getSourceStoragePath(sourceId: string): Promise<string> {
        const sourceHash = await this.options.hashText(sourceId);
        const shard = sourceHash.slice(0, 2) || "00";
        return normalizeStoragePath(`${this.sourceBaseDirPath}/${shard}/${sourceHash}.json`);
    }

}
