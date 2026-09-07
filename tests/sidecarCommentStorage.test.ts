import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { DataAdapter } from "obsidian";
import type { CommentThread } from "../src/commentManager";
import { SidecarCommentStorage } from "../src/core/storage/sidecarCommentStorage";
import { ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT } from "../src/app/pluginEventExecutionContext";

class FakeAdapter implements Pick<DataAdapter, "exists" | "mkdir" | "write" | "read" | "remove" | "rename" | "list"> {
    public readonly directories = new Set<string>();
    public readonly files = new Map<string, string>();
    public beforeRemove: ((normalizedPath: string) => Promise<void>) | null = null;
    public afterRemove: ((normalizedPath: string) => Promise<void>) | null = null;
    public beforeRename: ((normalizedPath: string, normalizedNewPath: string) => Promise<void>) | null = null;
    public afterRename: ((normalizedPath: string, normalizedNewPath: string) => Promise<void>) | null = null;
    public afterWrite: ((normalizedPath: string) => Promise<void>) | null = null;
    public readonly removeAttempts: string[] = [];

    async exists(normalizedPath: string): Promise<boolean> {
        return this.directories.has(normalizedPath) || this.files.has(normalizedPath);
    }

    async mkdir(normalizedPath: string): Promise<void> {
        this.directories.add(normalizedPath);
    }

    async write(normalizedPath: string, data: string): Promise<void> {
        this.files.set(normalizedPath, data);
        await this.afterWrite?.(normalizedPath);
    }

    async read(normalizedPath: string): Promise<string> {
        const content = this.files.get(normalizedPath);
        if (content === undefined) {
            throw new Error(`Missing file: ${normalizedPath}`);
        }

        return content;
    }

    async remove(normalizedPath: string): Promise<void> {
        this.removeAttempts.push(normalizedPath);
        await this.beforeRemove?.(normalizedPath);
        this.files.delete(normalizedPath);
        await this.afterRemove?.(normalizedPath);
    }

    async rename(normalizedPath: string, normalizedNewPath: string): Promise<void> {
        await this.beforeRename?.(normalizedPath, normalizedNewPath);
        const content = this.files.get(normalizedPath);
        if (content === undefined) {
            throw new Error(`Missing file: ${normalizedPath}`);
        }

        this.files.set(normalizedNewPath, content);
        this.files.delete(normalizedPath);
        await this.afterRename?.(normalizedPath, normalizedNewPath);
    }

    async list(normalizedPath: string): Promise<{ files: string[]; folders: string[] }> {
        const prefix = normalizedPath.endsWith("/") ? normalizedPath : `${normalizedPath}/`;
        const files: string[] = [];
        const folders = new Set<string>();
        for (const filePath of this.files.keys()) {
            if (!filePath.startsWith(prefix)) {
                continue;
            }

            const relativePath = filePath.slice(prefix.length);
            const slashIndex = relativePath.indexOf("/");
            if (slashIndex === -1) {
                files.push(filePath);
            } else {
                folders.add(`${prefix}${relativePath.slice(0, slashIndex)}`);
            }
        }
        return {
            files: files.sort((left, right) => left.localeCompare(right)),
            folders: Array.from(folders).sort((left, right) => left.localeCompare(right)),
        };
    }
}

class EnoentOnRemoveAdapter extends FakeAdapter {
    public readonly enoentOnRemove = new Set<string>();

    async remove(normalizedPath: string): Promise<void> {
        if (this.enoentOnRemove.has(normalizedPath)) {
            this.files.delete(normalizedPath);
            const error = new Error(`ENOENT: no such file or directory, unlink '${normalizedPath}'`) as Error & { code: string };
            error.code = "ENOENT";
            throw error;
        }

        await super.remove(normalizedPath);
    }
}

function hashText(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

function createThread(filePath: string): CommentThread {
    return {
        id: "thread-1",
        filePath,
        startLine: 1,
        startChar: 2,
        endLine: 1,
        endChar: 7,
        selectedText: "target",
        selectedTextHash: "hash-target",
        anchorKind: "selection",
        orphaned: false,
        entries: [{
            id: "entry-1",
            body: "hello",
            timestamp: 1710000000000,
        }],
        createdAt: 1710000000000,
        updatedAt: 1710000000000,
    };
}

function createDeferred() {
    let resolvePromise!: () => void;
    const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
}

async function settlesWithinMicrotasks(promise: Promise<unknown>, turnCount = 20): Promise<boolean> {
    let settled = false;
    void promise.then(() => {
        settled = true;
    });
    for (let turn = 0; turn < turnCount && !settled; turn += 1) {
        await Promise.resolve();
    }
    return settled;
}

test("sidecar comment storage writes hashed per-note files and reads them back", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const notePath = "books/example.md";
    const expectedHash = hashText(notePath);
    const expectedPath = `.obsidian/plugins/aside/sidenotes/by-note/${expectedHash.slice(0, 2)}/${expectedHash}.json`;

    await storage.write(notePath, [createThread(notePath)], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);

    assert.equal(await storage.exists(notePath), true);
    assert.equal(adapter.directories.has(".obsidian/plugins/aside/sidenotes/by-note"), true);
    assert.equal(adapter.files.has(expectedPath), true);

    const readThreads = await storage.read(notePath);
    assert.ok(readThreads);
    assert.equal(readThreads.length, 1);
    assert.equal(readThreads[0].filePath, notePath);
    assert.equal(readThreads[0].entries[0]?.body, "hello");
});

test("sidecar comment storage strips legacy resolution state on read and rewrite", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const notePath = "books/legacy.md";
    const storagePath = await storage.getNoteStoragePath(notePath);
    adapter.files.set(storagePath, JSON.stringify({
        version: 1,
        notePath,
        threads: [{
            ...createThread(notePath),
            resolved: true,
        }],
    }));

    const readThreads = await storage.read(notePath);

    assert.ok(readThreads);
    assert.equal(Object.prototype.hasOwnProperty.call(readThreads[0], "resolved"), false);

    await storage.write(notePath, readThreads, ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);

    const rewrittenPayload = JSON.parse(await adapter.read(storagePath)) as {
        threads: Array<Record<string, unknown>>;
    };
    const rereadThreads = await storage.read(notePath);
    assert.equal(Object.prototype.hasOwnProperty.call(rewrittenPayload.threads[0], "resolved"), false);
    assert.ok(rereadThreads);
    assert.equal(Object.prototype.hasOwnProperty.call(rereadThreads[0], "resolved"), false);
});

test("sidecar comment storage renames the hashed file when the note path changes", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const originalNotePath = "books/original.md";
    const renamedNotePath = "books/renamed.md";

    await storage.write(originalNotePath, [createThread(originalNotePath)], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    const originalStoragePath = await storage.getNoteStoragePath(originalNotePath);
    const renamedStoragePath = await storage.getNoteStoragePath(renamedNotePath);
    const retargetedThread = {
        ...createThread(renamedNotePath),
        anchorKind: "page" as const,
        selectedText: "",
        selectedTextHash: "renamed-page-label-hash",
    };

    await storage.rename(
        originalNotePath,
        renamedNotePath,
        [retargetedThread],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );

    assert.equal(adapter.files.has(originalStoragePath), false);
    assert.equal(adapter.files.has(renamedStoragePath), true);

    const renamedThreads = await storage.read(renamedNotePath);
    assert.ok(renamedThreads);
    assert.deepEqual(renamedThreads, [retargetedThread]);
});

test("sidecar rename abort after destination commit restores both prior canonical files", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const previousNotePath = "books/original.md";
    const nextNotePath = "books/occupied.md";
    await storage.write(
        previousNotePath,
        [createThread(previousNotePath)],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );
    await storage.write(
        nextNotePath,
        [{ ...createThread(nextNotePath), id: "existing-next" }],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );
    const previousStoragePath = await storage.getNoteStoragePath(previousNotePath);
    const nextStoragePath = await storage.getNoteStoragePath(nextNotePath);
    const exactPreviousContent = adapter.files.get(previousStoragePath);
    const exactNextContent = adapter.files.get(nextStoragePath);
    const destinationCommitted = createDeferred();
    const releaseDestinationCommit = createDeferred();
    const abortController = new AbortController();
    adapter.afterRename = async (sourcePath, destinationPath) => {
        if (sourcePath.includes(".json.tmp-") && destinationPath === nextStoragePath) {
            destinationCommitted.resolve();
            await releaseDestinationCommit.promise;
        }
    };
    const context = {
        signal: abortController.signal,
        isActive: () => !abortController.signal.aborted,
    };

    const rename = storage.rename(
        previousNotePath,
        nextNotePath,
        [{ ...createThread(nextNotePath), id: "retargeted" }],
        context,
    );
    await destinationCommitted.promise;
    abortController.abort();
    releaseDestinationCommit.resolve();
    await rename;

    assert.equal(adapter.files.get(previousStoragePath), exactPreviousContent);
    assert.equal(adapter.files.get(nextStoragePath), exactNextContent);
    assert.deepEqual(
        (await storage.listStoredComments()).map((record) => ({
            notePath: record.notePath,
            threadId: record.threads[0]?.id,
        })),
        [
            { notePath: nextNotePath, threadId: "existing-next" },
            { notePath: previousNotePath, threadId: "thread-1" },
        ],
    );
    assert.equal(Array.from(adapter.files.keys()).some((path) => path.includes(".json.tmp-")), false);
});

test("sidecar rename abort after source removal restores the source and removes the new destination", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const previousNotePath = "books/original.md";
    const nextNotePath = "books/renamed.md";
    await storage.write(
        previousNotePath,
        [createThread(previousNotePath)],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );
    const previousStoragePath = await storage.getNoteStoragePath(previousNotePath);
    const nextStoragePath = await storage.getNoteStoragePath(nextNotePath);
    const exactPreviousContent = adapter.files.get(previousStoragePath);
    const sourceRemoved = createDeferred();
    const releaseSourceRemoval = createDeferred();
    const abortController = new AbortController();
    adapter.afterRemove = async (storagePath) => {
        if (storagePath === previousStoragePath) {
            sourceRemoved.resolve();
            await releaseSourceRemoval.promise;
        }
    };
    const context = {
        signal: abortController.signal,
        isActive: () => !abortController.signal.aborted,
    };

    const rename = storage.rename(
        previousNotePath,
        nextNotePath,
        [{ ...createThread(nextNotePath), id: "retargeted" }],
        context,
    );
    await sourceRemoved.promise;
    abortController.abort();
    releaseSourceRemoval.resolve();
    await rename;

    assert.equal(adapter.files.get(previousStoragePath), exactPreviousContent);
    assert.equal(adapter.files.has(nextStoragePath), false);
    assert.deepEqual(
        (await storage.listStoredComments()).map((record) => record.notePath),
        [previousNotePath],
    );
});

test("sidecar rename blocks reads and discovery until one fully retargeted state is visible", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const previousNotePath = "books/original.md";
    const nextNotePath = "books/renamed.md";
    await storage.write(
        previousNotePath,
        [createThread(previousNotePath)],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );
    const nextStoragePath = await storage.getNoteStoragePath(nextNotePath);
    const destinationCommitted = createDeferred();
    const releaseDestinationCommit = createDeferred();
    adapter.afterRename = async (sourcePath, destinationPath) => {
        if (sourcePath.includes(".json.tmp-") && destinationPath === nextStoragePath) {
            destinationCommitted.resolve();
            await releaseDestinationCommit.promise;
        }
    };
    const retargetedThread = {
        ...createThread(nextNotePath),
        id: "fully-retargeted",
        anchorKind: "page" as const,
        selectedText: "",
        selectedTextHash: "next-page-label-hash",
    };

    const rename = storage.rename(
        previousNotePath,
        nextNotePath,
        [retargetedThread],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );
    await destinationCommitted.promise;
    const oldExists = storage.exists(previousNotePath);
    const nextExists = storage.exists(nextNotePath);
    const oldRead = storage.read(previousNotePath);
    const nextRead = storage.read(nextNotePath);
    const discovery = storage.listStoredComments();

    assert.equal(await settlesWithinMicrotasks(oldExists), false);
    assert.equal(await settlesWithinMicrotasks(nextExists), false);
    assert.equal(await settlesWithinMicrotasks(oldRead), false);
    assert.equal(await settlesWithinMicrotasks(nextRead), false);
    assert.equal(await settlesWithinMicrotasks(discovery), false);

    releaseDestinationCommit.resolve();
    await rename;

    assert.equal(await oldExists, false);
    assert.equal(await nextExists, true);
    assert.equal(await oldRead, null);
    assert.deepEqual(await nextRead, [retargetedThread]);
    assert.deepEqual(
        (await discovery).map((record) => ({
            notePath: record.notePath,
            threadId: record.threads[0]?.id,
            selectedTextHash: record.threads[0]?.selectedTextHash,
        })),
        [{
            notePath: nextNotePath,
            threadId: "fully-retargeted",
            selectedTextHash: "next-page-label-hash",
        }],
    );
});

test("sidecar comment storage writes source-id keyed files and retargets threads on read", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const sourceId = "src-123";
    const originalNotePath = "books/original.md";
    const renamedNotePath = "books/renamed.md";
    const expectedHash = hashText(sourceId);
    const expectedPath = `.obsidian/plugins/aside/sidenotes/by-source/${expectedHash.slice(0, 2)}/${expectedHash}.json`;

    await storage.writeForSource(
        sourceId,
        originalNotePath,
        [createThread(originalNotePath)],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );

    assert.equal(await storage.existsForSource(sourceId), true);
    assert.equal(adapter.files.has(expectedPath), true);

    const readThreads = await storage.readForSource(sourceId, renamedNotePath);
    assert.ok(readThreads);
    assert.equal(readThreads[0].filePath, renamedNotePath);
    assert.equal(readThreads[0].entries[0]?.body, "hello");
});

test("sidecar comment storage writes only under the current Aside plugin directory", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const notePath = "books/example.md";

    await storage.write(notePath, [createThread(notePath)], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    await storage.writeForSource(
        "src-example",
        notePath,
        [createThread(notePath)],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );

    assert.equal(Array.from(adapter.files.keys()).every((filePath) =>
        filePath.startsWith(".obsidian/plugins/aside/sidenotes/"),
    ), true);
});

test("sidecar comment storage removes the sidecar file when the thread list becomes empty", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const notePath = "books/example.md";

    await storage.write(notePath, [createThread(notePath)], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    await storage.write(notePath, [], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);

    assert.equal(await storage.exists(notePath), false);
    assert.equal(await storage.read(notePath), null);
});

test("sidecar comment storage removes note and source records for one missing note", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const removedNotePath = "books/deleted.md";
    const keptNotePath = "books/kept.md";

    await storage.write(removedNotePath, [createThread(removedNotePath)], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    await storage.writeForSource(
        "src-deleted",
        removedNotePath,
        [createThread(removedNotePath)],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );
    await storage.write(keptNotePath, [createThread(keptNotePath)], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);

    const removed = await storage.removeNote(removedNotePath, ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    const remaining = await storage.listStoredComments();

    assert.equal(removed?.notePath, removedNotePath);
    assert.equal(removed?.sourceId, "src-deleted");
    assert.equal(await storage.exists(removedNotePath), false);
    assert.equal(await storage.existsForSource("src-deleted"), false);
    assert.deepEqual(remaining.map((record) => record.notePath), [keptNotePath]);
});

test("sidecar comment storage lists records across note and source sidecars without duplicates", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const notePath = "books/example.md";

    await storage.write(notePath, [createThread(notePath)], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    await storage.writeForSource(
        "src-example",
        notePath,
        [createThread(notePath)],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );

    const records = await storage.listStoredComments();

    assert.equal(records.length, 1);
    assert.equal(records[0].notePath, notePath);
    assert.equal(records[0].sourceId, "src-example");
});

test("sidecar comment storage removes note and source sidecars under a deleted folder", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const deletedNotePath = "Deleted/note.md";
    const nestedDeletedNotePath = "Deleted/nested/other.md";
    const keptNotePath = "Deletedness/keep.md";

    await storage.write(deletedNotePath, [createThread(deletedNotePath)], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    await storage.writeForSource(
        "src-deleted",
        deletedNotePath,
        [createThread(deletedNotePath)],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );
    await storage.write(
        nestedDeletedNotePath,
        [createThread(nestedDeletedNotePath)],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );
    await storage.writeForSource(
        "src-nested",
        nestedDeletedNotePath,
        [createThread(nestedDeletedNotePath)],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );
    await storage.write(keptNotePath, [createThread(keptNotePath)], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    await storage.writeForSource(
        "src-kept",
        keptNotePath,
        [createThread(keptNotePath)],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );

    const removed = await storage.removeFolder("Deleted", ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);

    assert.deepEqual(
        removed.map((record) => ({
            notePath: record.notePath,
            sourceId: record.sourceId,
        })).sort((left, right) => left.notePath.localeCompare(right.notePath)),
        [
            { notePath: nestedDeletedNotePath, sourceId: "src-nested" },
            { notePath: deletedNotePath, sourceId: "src-deleted" },
        ],
    );
    assert.equal(await storage.exists(deletedNotePath), false);
    assert.equal(await storage.existsForSource("src-deleted"), false);
    assert.equal(await storage.exists(nestedDeletedNotePath), false);
    assert.equal(await storage.existsForSource("src-nested"), false);
    assert.equal(await storage.exists(keptNotePath), true);
    assert.equal(await storage.existsForSource("src-kept"), true);
});

test("sidecar comment storage ignores ENOENT while removing a deleted folder", async () => {
    const adapter = new EnoentOnRemoveAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const deletedNotePath = "Deleted/note.md";

    await storage.write(deletedNotePath, [createThread(deletedNotePath)], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    const storagePath = await storage.getNoteStoragePath(deletedNotePath);
    adapter.enoentOnRemove.add(storagePath);

    const removed = await storage.removeFolder("Deleted", ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);

    assert.deepEqual(removed.map((record) => record.notePath), [deletedNotePath]);
    assert.equal(await storage.exists(deletedNotePath), false);
});

test("sidecar folder removal stops before later records after its epoch aborts", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const firstPath = "Deleted/a.md";
    const secondPath = "Deleted/b.md";
    await storage.write(firstPath, [createThread(firstPath)], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    await storage.write(secondPath, [createThread(secondPath)], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    const removeStarted = createDeferred();
    const releaseRemove = createDeferred();
    const abortController = new AbortController();
    adapter.beforeRemove = async () => {
        if (adapter.removeAttempts.length === 1) {
            removeStarted.resolve();
            await releaseRemove.promise;
        }
    };
    const context = {
        signal: abortController.signal,
        isActive: () => !abortController.signal.aborted,
    };

    const staleRemoval = storage.removeFolder("Deleted", context);
    await removeStarted.promise;
    abortController.abort();
    releaseRemove.resolve();

    assert.deepEqual(await staleRemoval, []);
    assert.equal(adapter.removeAttempts.length, 1);
    assert.equal(adapter.files.size, 1);

    adapter.beforeRemove = null;
    const removed = await storage.removeFolder("Deleted", ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    assert.deepEqual(removed.map((record) => record.notePath), [secondPath]);
});

test("sidecar discovery ignores an aborted atomic-write temp while retaining canonical files", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const canonicalPath = "notes/canonical.md";
    const stalePath = "notes/stale.md";
    await storage.write(
        canonicalPath,
        [createThread(canonicalPath)],
        ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT,
    );
    const tempWriteStarted = createDeferred();
    const releaseTempWrite = createDeferred();
    const abortController = new AbortController();
    adapter.afterWrite = async (storagePath) => {
        if (storagePath.includes(".json.tmp-")) {
            tempWriteStarted.resolve();
            await releaseTempWrite.promise;
        }
    };
    const context = {
        signal: abortController.signal,
        isActive: () => !abortController.signal.aborted,
    };

    const abortedWrite = storage.write(stalePath, [createThread(stalePath)], context);
    await tempWriteStarted.promise;
    abortController.abort();
    releaseTempWrite.resolve();
    await abortedWrite;

    assert.ok(Array.from(adapter.files.keys()).some((filePath) => filePath.includes(".json.tmp-")));
    assert.deepEqual(
        (await storage.listStoredComments()).map((record) => record.notePath),
        [canonicalPath],
    );
});

test("aborting while replacing a canonical sidecar preserves the committed record", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const notePath = "notes/existing.md";
    const originalThread = createThread(notePath);
    await storage.write(notePath, [originalThread], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    const canonicalPath = await storage.getNoteStoragePath(notePath);
    const canonicalRemoveStarted = createDeferred();
    const releaseCanonicalRemove = createDeferred();
    const abortController = new AbortController();
    adapter.beforeRemove = async (storagePath) => {
        if (storagePath === canonicalPath) {
            canonicalRemoveStarted.resolve();
            await releaseCanonicalRemove.promise;
        }
    };
    const context = {
        signal: abortController.signal,
        isActive: () => !abortController.signal.aborted,
    };
    const replacementThread = {
        ...originalThread,
        entries: [{ ...originalThread.entries[0], body: "uncommitted replacement" }],
    };

    const replacement = storage.write(notePath, [replacementThread], context);
    await canonicalRemoveStarted.promise;
    abortController.abort();
    releaseCanonicalRemove.resolve();
    await replacement;

    const records = await storage.listStoredComments();
    assert.equal(adapter.files.has(canonicalPath), true);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.notePath, notePath);
    assert.equal(records[0]?.threads[0]?.entries[0]?.body, "hello");
});

test("aborting during the canonical rename rolls back the stale replacement", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const notePath = "notes/existing.md";
    const originalThread = createThread(notePath);
    await storage.write(notePath, [originalThread], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    const canonicalPath = await storage.getNoteStoragePath(notePath);
    const canonicalRenameStarted = createDeferred();
    const releaseCanonicalRename = createDeferred();
    const abortController = new AbortController();
    adapter.beforeRename = async (sourcePath, destinationPath) => {
        if (sourcePath.includes(".json.tmp-") && destinationPath === canonicalPath) {
            canonicalRenameStarted.resolve();
            await releaseCanonicalRename.promise;
        }
    };
    const context = {
        signal: abortController.signal,
        isActive: () => !abortController.signal.aborted,
    };
    const replacementThread = {
        ...originalThread,
        entries: [{ ...originalThread.entries[0], body: "uncommitted replacement" }],
    };

    const replacement = storage.write(notePath, [replacementThread], context);
    await canonicalRenameStarted.promise;
    abortController.abort();
    releaseCanonicalRename.resolve();
    await replacement;

    const records = await storage.listStoredComments();
    assert.equal(adapter.files.has(canonicalPath), true);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.threads[0]?.entries[0]?.body, "hello");
});

test("sidecar discovery waits for an interrupted canonical replacement to roll back", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const notePath = "notes/existing.md";
    const originalThread = createThread(notePath);
    await storage.write(notePath, [originalThread], ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT);
    const canonicalPath = await storage.getNoteStoragePath(notePath);
    const canonicalRemoved = createDeferred();
    const releaseRemovedCanonical = createDeferred();
    const abortController = new AbortController();
    adapter.afterRemove = async (storagePath) => {
        if (storagePath === canonicalPath) {
            canonicalRemoved.resolve();
            await releaseRemovedCanonical.promise;
        }
    };
    const context = {
        signal: abortController.signal,
        isActive: () => !abortController.signal.aborted,
    };

    const replacement = storage.write(notePath, [{
        ...originalThread,
        entries: [{ ...originalThread.entries[0], body: "uncommitted replacement" }],
    }], context);
    await canonicalRemoved.promise;
    abortController.abort();
    const discovery = storage.listStoredComments();
    const canonicalExists = storage.exists(notePath);
    assert.equal(
        await settlesWithinMicrotasks(discovery),
        false,
        "discovery observed the transient missing canonical path",
    );
    assert.equal(
        await settlesWithinMicrotasks(canonicalExists),
        false,
        "existence check observed the transient missing canonical path",
    );
    releaseRemovedCanonical.resolve();
    await replacement;

    const records = await discovery;
    assert.equal(await canonicalExists, true);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.notePath, notePath);
    assert.equal(records[0]?.threads[0]?.entries[0]?.body, "hello");
});
