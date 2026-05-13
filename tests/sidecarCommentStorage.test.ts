import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { DataAdapter } from "obsidian";
import type { CommentThread } from "../src/commentManager";
import { SidecarCommentStorage } from "../src/core/storage/sidecarCommentStorage";

class FakeAdapter implements Pick<DataAdapter, "exists" | "mkdir" | "write" | "read" | "remove" | "rename"> {
    public readonly directories = new Set<string>();
    public readonly files = new Map<string, string>();

    async exists(normalizedPath: string): Promise<boolean> {
        return this.directories.has(normalizedPath) || this.files.has(normalizedPath);
    }

    async mkdir(normalizedPath: string): Promise<void> {
        this.directories.add(normalizedPath);
    }

    async write(normalizedPath: string, data: string): Promise<void> {
        this.files.set(normalizedPath, data);
    }

    async read(normalizedPath: string): Promise<string> {
        const content = this.files.get(normalizedPath);
        if (content === undefined) {
            throw new Error(`Missing file: ${normalizedPath}`);
        }

        return content;
    }

    async remove(normalizedPath: string): Promise<void> {
        this.files.delete(normalizedPath);
    }

    async rename(normalizedPath: string, normalizedNewPath: string): Promise<void> {
        const content = this.files.get(normalizedPath);
        if (content === undefined) {
            throw new Error(`Missing file: ${normalizedPath}`);
        }

        this.files.set(normalizedNewPath, content);
        this.files.delete(normalizedPath);
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
        resolved: false,
        entries: [{
            id: "entry-1",
            body: "hello",
            timestamp: 1710000000000,
        }],
        createdAt: 1710000000000,
        updatedAt: 1710000000000,
    };
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

    await storage.write(notePath, [createThread(notePath)]);

    assert.equal(await storage.exists(notePath), true);
    assert.equal(adapter.directories.has(".obsidian/plugins/aside/sidenotes/by-note"), true);
    assert.equal(adapter.files.has(expectedPath), true);

    const readThreads = await storage.read(notePath);
    assert.ok(readThreads);
    assert.equal(readThreads.length, 1);
    assert.equal(readThreads[0].filePath, notePath);
    assert.equal(readThreads[0].entries[0]?.body, "hello");
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

    await storage.write(originalNotePath, [createThread(originalNotePath)]);
    const originalStoragePath = await storage.getNoteStoragePath(originalNotePath);
    const renamedStoragePath = await storage.getNoteStoragePath(renamedNotePath);

    await storage.rename(originalNotePath, renamedNotePath);

    assert.equal(adapter.files.has(originalStoragePath), false);
    assert.equal(adapter.files.has(renamedStoragePath), true);

    const renamedThreads = await storage.read(renamedNotePath);
    assert.ok(renamedThreads);
    assert.equal(renamedThreads[0].filePath, renamedNotePath);
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

    await storage.writeForSource(sourceId, originalNotePath, [createThread(originalNotePath)]);

    assert.equal(await storage.existsForSource(sourceId), true);
    assert.equal(adapter.files.has(expectedPath), true);

    const readThreads = await storage.readForSource(sourceId, renamedNotePath);
    assert.ok(readThreads);
    assert.equal(readThreads[0].filePath, renamedNotePath);
    assert.equal(readThreads[0].entries[0]?.body, "hello");
});

test("sidecar comment storage reads legacy SideNote2 cache paths", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        legacyPluginDirPaths: [".obsidian/plugins/side-note2"],
        hashText: async (text) => hashText(text),
    });
    const notePath = "books/example.md";
    const expectedHash = hashText(notePath);
    const legacyPath = `.obsidian/plugins/side-note2/sidenotes/by-note/${expectedHash.slice(0, 2)}/${expectedHash}.json`;
    adapter.files.set(legacyPath, `${JSON.stringify({
        version: 1,
        notePath,
        threads: [createThread(notePath)],
    })}\n`);

    assert.equal(await storage.exists(notePath), true);
    const readThreads = await storage.read(notePath);
    assert.ok(readThreads);
    assert.equal(readThreads[0].filePath, notePath);
    assert.equal(readThreads[0].entries[0]?.body, "hello");
});

test("sidecar comment storage removes the sidecar file when the thread list becomes empty", async () => {
    const adapter = new FakeAdapter();
    const storage = new SidecarCommentStorage({
        adapter: adapter as unknown as DataAdapter,
        pluginDirPath: ".obsidian/plugins/aside",
        hashText: async (text) => hashText(text),
    });
    const notePath = "books/example.md";

    await storage.write(notePath, [createThread(notePath)]);
    await storage.write(notePath, []);

    assert.equal(await storage.exists(notePath), false);
    assert.equal(await storage.read(notePath), null);
});
