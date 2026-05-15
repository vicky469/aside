import * as assert from "node:assert/strict";
import test from "node:test";
import type { DataAdapter } from "obsidian";
import type { MarkdownView, TFile } from "obsidian";
import { CommentManager, type CommentThread } from "../src/commentManager";
import { CommentPersistenceController } from "../src/comments/commentPersistenceController";
import type { PersistedPluginData } from "../src/settings/indexNoteSettingsPlanner";
import { SideNoteSyncEventStore, type SideNoteSyncEventState } from "../src/sync/sideNoteSyncEventStore";
import { serializeNoteCommentThreads, parseNoteComments } from "../src/core/storage/noteCommentStorage";
import { AggregateCommentIndex } from "../src/index/AggregateCommentIndex";

class FakeAdapter implements Pick<DataAdapter, "exists" | "mkdir" | "write" | "read" | "remove" | "rename" | "list"> {
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
        return this.files.get(normalizedPath) ?? "";
    }

    async remove(normalizedPath: string): Promise<void> {
        this.files.delete(normalizedPath);
    }

    async rename(normalizedPath: string, normalizedNewPath: string): Promise<void> {
        const content = this.files.get(normalizedPath);
        if (content === undefined) {
            return;
        }

        this.files.set(normalizedNewPath, content);
        this.files.delete(normalizedPath);
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

function createFile(path: string): TFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
        extension: path.split(".").pop() ?? "",
    } as TFile;
}

function createThread(filePath: string): CommentThread {
    return {
        id: "thread-1",
        filePath,
        startLine: 2,
        startChar: 6,
        endLine: 2,
        endChar: 12,
        selectedText: "target",
        selectedTextHash: "hash-target",
        anchorKind: "selection",
        orphaned: false,
        resolved: false,
        entries: [
            {
                id: "entry-1",
                body: "external body",
                timestamp: 1710000000000,
            },
        ],
        createdAt: 1710000000000,
        updatedAt: 1710000000000,
    };
}

function getSidecarStoragePath(filePath: string): string {
    const noteHash = `hash-${filePath.replace(/\//g, "_")}`;
    return `.obsidian/plugins/aside/sidenotes/by-note/${noteHash.slice(0, 2)}/${noteHash}.json`;
}

function getSourceSidecarStoragePath(sourceId: string): string {
    const sourceHash = `hash-${sourceId.replace(/\//g, "_")}`;
    return `.obsidian/plugins/aside/sidenotes/by-source/${sourceHash.slice(0, 2)}/${sourceHash}.json`;
}

function serializeSidecarThreads(filePath: string, threads: CommentThread[]): string {
    return `${JSON.stringify({
        version: 1,
        notePath: filePath,
        threads,
    })}\n`;
}

test("comment persistence controller syncs external managed-block updates into an open note without rewriting the file", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const file = createFile("docs/note.md");
    const noteBody = "# Title\n\nAlpha target omega\n";
    const storedThread = createThread(file.path);
    const currentContent = noteBody;
    const storedContent = serializeNoteCommentThreads(noteBody, [storedThread]);
    const adapter = new FakeAdapter();

    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let refreshCommentViewsCount = 0;
    let refreshEditorDecorationsCount = 0;
    let refreshMarkdownPreviewsCount = 0;
    let processCount = 0;
    let persistedData: PersistedPluginData = {};
    const derivedSyncCalls: Array<{ filePath: string; noteContent: string; commentCount: number }> = [];

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async () => {
                    processCount += 1;
                    throw new Error("Should not rewrite the file for external managed-block sync.");
                },
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => ({}) as MarkdownView,
        getMarkdownFileByPath: () => file,
        getCurrentNoteContent: async () => currentContent,
        getStoredNoteContent: async () => storedContent,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: (syncedFile, noteContent, comments) => {
            derivedSyncCalls.push({
                filePath: syncedFile.path,
                noteContent,
                commentCount: comments.length,
            });
        },
        refreshCommentViews: async () => {
            refreshCommentViewsCount += 1;
        },
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {
            refreshEditorDecorationsCount += 1;
        },
        refreshMarkdownPreviews: () => {
            refreshMarkdownPreviewsCount += 1;
        },
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    try {
        await controller.handleMarkdownFileModified(file);

        assert.equal(processCount, 0);
        assert.equal(adapter.files.size, 2);
        assert.equal(commentManager.getCommentsForFile(file.path).length, 1);
        assert.equal(commentManager.getCommentById("thread-1")?.comment, "external body");
        assert.equal(aggregateCommentIndex.getCommentById("thread-1")?.comment, "external body");
        assert.equal(refreshCommentViewsCount, 1);
        assert.equal(refreshEditorDecorationsCount, 1);
        assert.equal(refreshMarkdownPreviewsCount, 1);
        assert.deepEqual(derivedSyncCalls, [{
            filePath: file.path,
            noteContent: noteBody.trimEnd(),
            commentCount: 1,
        }]);
    } finally {
        globalThis.window = originalWindow;
    }
});

test("comment persistence controller migrates inline note storage into a sidecar and strips the source note block", async () => {
    const file = createFile("docs/note.md");
    const noteBody = "# Title\n\nAlpha target omega\n";
    const legacyContent = serializeNoteCommentThreads(noteBody, [createThread(file.path)]);
    const adapter = new FakeAdapter();

    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let processCount = 0;
    let rewrittenNoteContent = "";
    let persistedData: PersistedPluginData = {};

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async (_file: TFile, updater: (currentContent: string) => string) => {
                    processCount += 1;
                    rewrittenNoteContent = updater(legacyContent);
                    return rewrittenNoteContent;
                },
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: () => file,
        getCurrentNoteContent: async () => legacyContent,
        getStoredNoteContent: async () => legacyContent,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    const comments = await controller.loadCommentsForFile(file);

    assert.equal(processCount, 1);
    assert.equal(rewrittenNoteContent, noteBody);
    assert.equal(adapter.files.size, 2);
    assert.ok(persistedData.sideNoteSyncEventState);
    assert.equal(comments.length, 1);
    assert.equal(commentManager.getCommentById("thread-1")?.comment, "external body");
    assert.equal(aggregateCommentIndex.getCommentById("thread-1")?.comment, "external body");
});

test("comment persistence controller replays synced plugin-data events into the local sidecar cache", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const oldFile = createFile("docs/old.md");
    const newFile = createFile("docs/new.md");
    const noteBody = "# Title\n\nAlpha target omega\n";
    const adapter = new FakeAdapter();
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let persistedData: PersistedPluginData = {};
    let eventCounter = 0;

    const remoteEventStore = new SideNoteSyncEventStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        getDeviceId: () => "device-b",
        createEventId: () => `remote-event-${++eventCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        now: () => 1710000000100 + eventCounter,
    });

    await remoteEventStore.appendLocalEvents(oldFile.path, [{
        op: "createThread",
        payload: {
            thread: createThread(oldFile.path),
        },
    }]);
    await remoteEventStore.appendLocalEvents(oldFile.path, [{
        op: "renameNote",
        payload: {
            previousNotePath: oldFile.path,
            nextNotePath: newFile.path,
        },
    }]);

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async () => "",
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (path) => path === newFile.path ? newFile : null,
        getCurrentNoteContent: async () => noteBody,
        getStoredNoteContent: async () => noteBody,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    try {
        const appliedEventCount = await controller.replaySyncedSideNoteEvents();
        const sidecarPaths = Array.from(adapter.files.keys());

        assert.equal(appliedEventCount, 2);
        assert.equal(commentManager.getCommentsForFile(oldFile.path).length, 0);
        assert.equal(commentManager.getCommentById("thread-1")?.filePath, newFile.path);
        assert.equal(commentManager.getCommentById("thread-1")?.comment, "external body");
        assert.equal(aggregateCommentIndex.getCommentById("thread-1")?.filePath, newFile.path);
        assert.equal(sidecarPaths.some((path) => path.includes("hash-docs_new.md.json")), true);
        assert.equal(sidecarPaths.some((path) => path.includes("hash-docs_old.md.json")), false);
        assert.equal(
            (persistedData.sideNoteSyncEventState as {
                processedWatermarks?: Record<string, Record<string, number>>;
            }).processedWatermarks?.["device-a"]?.["device-b"],
            2,
        );
    } finally {
        globalThis.window = originalWindow;
    }
});

test("comment persistence controller hydrates compacted snapshots over a stale sidecar cache", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const file = createFile("docs/note.md");
    const noteBody = "# Title\n\nAlpha target omega\n";
    const adapter = new FakeAdapter();
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let persistedData: PersistedPluginData = {};
    let eventCounter = 0;
    const staleThread = createThread(file.path);
    const remoteThread: CommentThread = {
        ...createThread(file.path),
        entries: [
            ...staleThread.entries,
            {
                id: "entry-2",
                body: "mobile reply",
                timestamp: 1710000000200,
            },
        ],
        updatedAt: 1710000000200,
    };
    adapter.files.set(getSidecarStoragePath(file.path), serializeSidecarThreads(file.path, [staleThread]));

    const remoteEventStore = new SideNoteSyncEventStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        getDeviceId: () => "device-b",
        createEventId: () => `remote-event-${++eventCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        now: () => 1710000000300 + eventCounter,
    });

    await remoteEventStore.appendLocalEvents(file.path, [{
        op: "createThread",
        payload: {
            thread: remoteThread,
        },
    }]);
    await remoteEventStore.compactProcessedEventsForSnapshots([{
        notePath: file.path,
        threads: [remoteThread],
    }]);
    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async () => "",
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (path) => path === file.path ? file : null,
        getCurrentNoteContent: async () => noteBody,
        getStoredNoteContent: async () => noteBody,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    try {
        const appliedEventCount = await controller.replaySyncedSideNoteEvents();
        const thread = commentManager.getThreadById("thread-1");

        assert.equal(appliedEventCount, 0);
        assert.deepEqual(thread?.entries.map((entry) => entry.body), ["external body", "mobile reply"]);
        assert.equal(aggregateCommentIndex.getCommentById("entry-2")?.comment, "mobile reply");
    } finally {
        globalThis.window = originalWindow;
    }
});

test("comment persistence controller stops hydrating snapshots after disposal", async () => {
    const file = createFile("docs/note.md");
    const otherFile = createFile("docs/other.md");
    const noteBody = "# Title\n\nAlpha target omega\n";
    const adapter = new FakeAdapter();
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let persistedData: PersistedPluginData = {};
    let eventCounter = 0;
    const readPaths: string[] = [];

    const remoteEventStore = new SideNoteSyncEventStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        getDeviceId: () => "device-b",
        createEventId: () => `remote-event-${++eventCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        now: () => 1710000000300 + eventCounter,
    });

    await remoteEventStore.appendLocalEvents(file.path, [{
        op: "createThread",
        payload: {
            thread: createThread(file.path),
        },
    }]);
    await remoteEventStore.appendLocalEvents(otherFile.path, [{
        op: "createThread",
        payload: {
            thread: {
                ...createThread(otherFile.path),
                id: "other-thread",
            },
        },
    }]);
    await remoteEventStore.compactProcessedEventsForSnapshots([
        {
            notePath: file.path,
            threads: [createThread(file.path)],
        },
        {
            notePath: otherFile.path,
            threads: [{
                ...createThread(otherFile.path),
                id: "other-thread",
            }],
        },
    ]);

    let controller: CommentPersistenceController;
    controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async () => "",
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (path) => {
            if (path === file.path) {
                return file;
            }
            if (path === otherFile.path) {
                return otherFile;
            }
            return null;
        },
        getCurrentNoteContent: async (currentFile) => {
            readPaths.push(currentFile.path);
            controller.dispose();
            return noteBody;
        },
        getStoredNoteContent: async () => noteBody,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    const appliedEventCount = await controller.replaySyncedSideNoteEvents();

    assert.equal(appliedEventCount, 0);
    assert.deepEqual(readPaths, [file.path]);
    assert.equal(commentManager.getCommentById("other-thread"), undefined);
    assert.equal(aggregateCommentIndex.getCommentById("other-thread"), null);
});

test("comment persistence controller refreshes synced plugin data before sidebar comment load", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const file = createFile("docs/note.md");
    const otherFile = createFile("docs/other.md");
    const noteBody = "# Title\n\nAlpha target omega\n";
    const adapter = new FakeAdapter();
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let cachedPersistedData: PersistedPluginData = {};
    let latestPersistedData: PersistedPluginData = {};
    let eventCounter = 0;
    const staleThread = createThread(file.path);
    const remoteThread: CommentThread = {
        ...createThread(file.path),
        entries: [
            ...staleThread.entries,
            {
                id: "entry-2",
                body: "mobile reply",
                timestamp: 1710000000200,
            },
        ],
        updatedAt: 1710000000200,
    };
    const otherRemoteThread: CommentThread = {
        ...createThread(otherFile.path),
        id: "other-thread",
        entries: [{
            id: "other-entry",
            body: "unrelated mobile reply",
            timestamp: 1710000000400,
        }],
        createdAt: 1710000000400,
        updatedAt: 1710000000400,
    };
    adapter.files.set(getSidecarStoragePath(file.path), serializeSidecarThreads(file.path, [staleThread]));

    const remoteEventStore = new SideNoteSyncEventStore({
        readPersistedPluginData: () => latestPersistedData,
        writePersistedPluginData: async (data) => {
            latestPersistedData = data;
        },
        getDeviceId: () => "device-b",
        createEventId: () => `remote-event-${++eventCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        now: () => 1710000000300 + eventCounter,
    });

    await remoteEventStore.appendLocalEvents(file.path, [{
        op: "createThread",
        payload: {
            thread: remoteThread,
        },
    }]);
    await remoteEventStore.compactProcessedEventsForSnapshots([{
        notePath: file.path,
        threads: [remoteThread],
    }]);
    await remoteEventStore.appendLocalEvents(otherFile.path, [{
        op: "createThread",
        payload: {
            thread: otherRemoteThread,
        },
    }]);
    await remoteEventStore.compactProcessedEventsForSnapshots([{
        notePath: otherFile.path,
        threads: [otherRemoteThread],
    }]);

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async () => "",
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (path) => path === file.path ? file : null,
        getCurrentNoteContent: async () => noteBody,
        getStoredNoteContent: async () => noteBody,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => cachedPersistedData,
        loadPersistedPluginData: async () => latestPersistedData,
        writePersistedPluginData: async (data) => {
            cachedPersistedData = data;
            latestPersistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    try {
        const comments = await controller.loadCommentsForFile(file);
        const thread = commentManager.getThreadById("thread-1");

        assert.equal(comments[0]?.comment, "mobile reply");
        assert.deepEqual(thread?.entries.map((entry) => entry.body), ["external body", "mobile reply"]);
        assert.equal(aggregateCommentIndex.getCommentById("entry-2")?.comment, "mobile reply");
        assert.equal(adapter.files.has(getSidecarStoragePath(otherFile.path)), false);
        assert.equal(
            (cachedPersistedData.sideNoteSyncEventState as {
                processedWatermarks?: Record<string, Record<string, number>>;
            }).processedWatermarks?.["device-a"]?.["device-b"],
            1,
        );
    } finally {
        globalThis.window = originalWindow;
    }
});

test("comment persistence controller does not recover renamed source notes when the matching source note still exists", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const previousFile = createFile("Notes/The Goal - A Process of Ongoing Improvement.md");
    const nextFile = createFile("books/The Goal.md");
    const noteBody = "# The Goal\n\nA process of ongoing improvement.\n";
    const adapter = new FakeAdapter();
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let persistedData: PersistedPluginData = {};
    let eventCounter = 0;
    const remoteThread: CommentThread = {
        ...createThread(previousFile.path),
        anchorKind: "page",
        selectedText: "A process of ongoing improvement.",
        selectedTextHash: "hash-subtitle",
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 0,
    };
    const remoteThread2: CommentThread = {
        ...createThread(previousFile.path),
        id: "thread-2",
        selectedText: "The Goal",
        selectedTextHash: "hash-title",
        entries: [{
            id: "entry-2",
            body: "second body",
            timestamp: 1710000000100,
        }],
        createdAt: 1710000000100,
        updatedAt: 1710000000100,
    };

    const remoteEventStore = new SideNoteSyncEventStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        getDeviceId: () => "device-b",
        createEventId: () => `remote-event-${++eventCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        now: () => 1710000000300 + eventCounter,
    });
    await remoteEventStore.appendLocalEvents(previousFile.path, [{
        op: "createThread",
        payload: {
            thread: remoteThread,
        },
    }, {
        op: "createThread",
        payload: {
            thread: remoteThread2,
        },
    }]);
    await remoteEventStore.compactProcessedEventsForSnapshots([{
        notePath: previousFile.path,
        threads: [remoteThread, remoteThread2],
    }]);

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async () => "",
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (path) => {
            if (path === nextFile.path) {
                return nextFile;
            }
            return path === previousFile.path ? previousFile : null;
        },
        getCurrentNoteContent: async () => noteBody,
        getStoredNoteContent: async () => noteBody,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    try {
        const comments = await controller.loadCommentsForFile(nextFile);
        const snapshots = new SideNoteSyncEventStore({
            readPersistedPluginData: () => persistedData,
            writePersistedPluginData: async (data) => {
                persistedData = data;
            },
            getDeviceId: () => "device-a",
            createEventId: () => "unused",
            hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
            now: () => 1710000000400,
        }).getSnapshots();

        assert.deepEqual(comments, []);
        assert.equal(commentManager.getThreadById("thread-1"), undefined);
        assert.equal(aggregateCommentIndex.getCommentById("thread-1"), null);
        assert.equal(adapter.files.has(getSidecarStoragePath(nextFile.path)), false);
        assert.equal(
            snapshots.some((snapshot) =>
                snapshot.notePath === previousFile.path
                && snapshot.threads.some((thread) => thread.id === "thread-1")),
            true,
        );
        assert.equal(
            snapshots.some((snapshot) =>
                snapshot.notePath === nextFile.path
                && snapshot.threads.some((thread) => thread.id === "thread-1")),
            false,
        );
    } finally {
        globalThis.window = originalWindow;
    }
});

test("comment persistence controller recovers renamed source notes from synced snapshots when the old source path is missing", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const previousFile = createFile("Notes/The Goal - A Process of Ongoing Improvement.md");
    const nextFile = createFile("books/The Goal.md");
    const noteBody = "# The Goal\n\nA process of ongoing improvement.\n";
    const adapter = new FakeAdapter();
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let persistedData: PersistedPluginData = {};
    let eventCounter = 0;
    const remoteThread: CommentThread = {
        ...createThread(previousFile.path),
        anchorKind: "page",
        selectedText: "A process of ongoing improvement.",
        selectedTextHash: "hash-subtitle",
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 0,
    };
    const remoteThread2: CommentThread = {
        ...createThread(previousFile.path),
        id: "thread-2",
        selectedText: "The Goal",
        selectedTextHash: "hash-title",
        entries: [{
            id: "entry-2",
            body: "second body",
            timestamp: 1710000000100,
        }],
        createdAt: 1710000000100,
        updatedAt: 1710000000100,
    };

    const remoteEventStore = new SideNoteSyncEventStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        getDeviceId: () => "device-b",
        createEventId: () => `remote-event-${++eventCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        now: () => 1710000000300 + eventCounter,
    });
    await remoteEventStore.appendLocalEvents(previousFile.path, [{
        op: "createThread",
        payload: {
            thread: remoteThread,
        },
    }, {
        op: "createThread",
        payload: {
            thread: remoteThread2,
        },
    }]);
    await remoteEventStore.compactProcessedEventsForSnapshots([{
        notePath: previousFile.path,
        threads: [remoteThread, remoteThread2],
    }]);

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async () => "",
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (path) => path === nextFile.path ? nextFile : null,
        getCurrentNoteContent: async () => noteBody,
        getStoredNoteContent: async () => noteBody,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    try {
        const comments = await controller.loadCommentsForFile(nextFile);
        const sidecar = JSON.parse(adapter.files.get(getSidecarStoragePath(nextFile.path)) ?? "{}") as {
            notePath?: string;
            threads?: CommentThread[];
        };
        const snapshots = new SideNoteSyncEventStore({
            readPersistedPluginData: () => persistedData,
            writePersistedPluginData: async (data) => {
                persistedData = data;
            },
            getDeviceId: () => "device-a",
            createEventId: () => "unused",
            hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
            now: () => 1710000000400,
        }).getSnapshots();

        assert.equal(comments[0]?.filePath, nextFile.path);
        assert.equal(comments[0]?.comment, "external body");
        assert.equal(commentManager.getThreadById("thread-1")?.filePath, nextFile.path);
        assert.equal(aggregateCommentIndex.getCommentById("thread-1")?.filePath, nextFile.path);
        assert.equal(sidecar.notePath, nextFile.path);
        assert.equal(sidecar.threads?.[0]?.filePath, nextFile.path);
        assert.equal(adapter.files.has(getSidecarStoragePath(previousFile.path)), false);
        assert.equal(
            snapshots.some((snapshot) =>
                snapshot.notePath === nextFile.path
                && snapshot.threads.some((thread) => thread.id === "thread-1")),
            true,
        );
    } finally {
        globalThis.window = originalWindow;
    }
});

test("comment persistence controller recovers renamed source notes from a legacy cache orphan", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const previousPath = "books/The Goal_ long old name.md";
    const nextFile = createFile("books/The Goal.md");
    const duplicateFile = createFile("books/The Goal Copy.md");
    const filesByPath = new Map([
        [nextFile.path, nextFile],
        [duplicateFile.path, duplicateFile],
    ]);
    const noteBody = [
        "# The Goal",
        "",
        "## Chapter 1",
        "",
        "\"Okay, but we'll be wasting a set-up,\" says Ray.",
        "",
        "\"So we waste it!\" I tell him.",
        "",
    ].join("\n");
    const adapter = new FakeAdapter();
    adapter.directories.add(".obsidian/plugins/aside/cache");
    const cachedThreads: CommentThread[] = [
        {
            ...createThread(previousPath),
            id: "thread-1",
            anchorKind: "page",
            selectedText: "\"So we waste it!\" I tell him.",
            selectedTextHash: "hash-quote-2",
            startLine: 6,
            startChar: 0,
            endLine: 6,
            endChar: 29,
        },
        {
            ...createThread(previousPath),
            id: "thread-2",
            selectedText: "\"Okay, but we'll be wasting a set-up,\" says Ray.",
            selectedTextHash: "hash-quote",
            entries: [{
                id: "entry-2",
                body: "quote body",
                timestamp: 1710000000200,
            }],
            createdAt: 1710000000200,
            updatedAt: 1710000000200,
        },
    ];
    adapter.files.set(
        ".obsidian/plugins/aside/cache/hash-old-goal.json",
        serializeSidecarThreads(previousPath, cachedThreads),
    );
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let persistedData: PersistedPluginData = {};
    let generatedIdCounter = 0;

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async () => "",
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (path) => filesByPath.get(path) ?? null,
        getCurrentNoteContent: async () => noteBody,
        getStoredNoteContent: async () => noteBody,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => `generated-id-${++generatedIdCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    try {
        const comments = await controller.loadCommentsForFile(nextFile);
        const sourceIdentityState = persistedData.sourceIdentityState as {
            sources?: Record<string, { currentPath?: unknown }>;
            pathToSourceId?: Record<string, string>;
        };
        const sourceId = sourceIdentityState.pathToSourceId?.[nextFile.path] ?? "";
        const sourceSidecar = JSON.parse(adapter.files.get(getSourceSidecarStoragePath(sourceId)) ?? "{}") as {
            notePath?: string;
            threads?: CommentThread[];
        };
        const pathSidecar = JSON.parse(adapter.files.get(getSidecarStoragePath(nextFile.path)) ?? "{}") as {
            notePath?: string;
            threads?: CommentThread[];
        };

        assert.equal(comments.length, 2);
        assert.equal(comments[0]?.filePath, nextFile.path);
        assert.equal(sourceSidecar.notePath, nextFile.path);
        assert.equal(sourceSidecar.threads?.length, 2);
        assert.equal(sourceSidecar.threads?.[0]?.filePath, nextFile.path);
        assert.equal(pathSidecar.notePath, nextFile.path);
        assert.equal(pathSidecar.threads?.length, 2);
        assert.equal(
            sourceIdentityState.pathToSourceId?.[previousPath],
            undefined,
        );
        assert.equal(
            sourceIdentityState.pathToSourceId?.[nextFile.path],
            sourceId,
        );

        const duplicateComments = await controller.loadCommentsForFile(duplicateFile);
        const nextSourceIdentityState = persistedData.sourceIdentityState as {
            sources?: Record<string, { currentPath?: unknown }>;
            pathToSourceId?: Record<string, string>;
        };

        assert.deepEqual(duplicateComments, []);
        assert.equal(commentManager.getCommentsForFile(duplicateFile.path).length, 0);
        assert.equal(nextSourceIdentityState.sources?.[sourceId]?.currentPath, nextFile.path);
        assert.notEqual(nextSourceIdentityState.pathToSourceId?.[duplicateFile.path], sourceId);
    } finally {
        globalThis.window = originalWindow;
    }
});

test("comment persistence controller ignores generic chapter headings during renamed source recovery", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const previousPath = "books/The Goal_ long old name.md";
    const nextFile = createFile("books/The Effective Executive.md");
    const noteBody = [
        "# The Effective Executive",
        "",
        "## Chapter 1",
        "",
        "Effectiveness is a discipline.",
        "",
        "## Chapter 2",
        "",
        "Different content from the previous source.",
    ].join("\n");
    const adapter = new FakeAdapter();
    adapter.directories.add(".obsidian/plugins/aside/cache");
    adapter.files.set(
        ".obsidian/plugins/aside/cache/hash-old-goal.json",
        serializeSidecarThreads(previousPath, [{
            ...createThread(previousPath),
            id: "thread-1",
            selectedText: "## Chapter 1",
            selectedTextHash: "hash-chapter-1",
        }, {
            ...createThread(previousPath),
            id: "thread-2",
            selectedText: "## Chapter 2",
            selectedTextHash: "hash-chapter-2",
            entries: [{
                id: "entry-2",
                body: "chapter body",
                timestamp: 1710000000200,
            }],
            createdAt: 1710000000200,
            updatedAt: 1710000000200,
        }]),
    );
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let persistedData: PersistedPluginData = {};

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async () => "",
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (path) => path === nextFile.path ? nextFile : null,
        getCurrentNoteContent: async () => noteBody,
        getStoredNoteContent: async () => noteBody,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    try {
        const comments = await controller.loadCommentsForFile(nextFile);

        assert.deepEqual(comments, []);
        assert.equal(commentManager.getThreadById("thread-1"), undefined);
        assert.equal(adapter.files.has(getSidecarStoragePath(nextFile.path)), false);
    } finally {
        globalThis.window = originalWindow;
    }
});

test("comment persistence controller hydrates compacted snapshots into a missing sidecar cache", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const file = createFile("docs/note.md");
    const noteBody = "# Title\n\nAlpha target omega\n";
    const adapter = new FakeAdapter();
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let persistedData: PersistedPluginData = {};
    let eventCounter = 0;
    const remoteThread = createThread(file.path);
    const remoteEventStore = new SideNoteSyncEventStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        getDeviceId: () => "device-b",
        createEventId: () => `remote-event-${++eventCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        now: () => 1710000000100 + eventCounter,
    });

    await remoteEventStore.appendLocalEvents(file.path, [{
        op: "createThread",
        payload: {
            thread: remoteThread,
        },
    }]);
    await remoteEventStore.compactProcessedEventsForSnapshots([{
        notePath: file.path,
        threads: [remoteThread],
    }]);

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async () => "",
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (path) => path === file.path ? file : null,
        getCurrentNoteContent: async () => noteBody,
        getStoredNoteContent: async () => noteBody,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    try {
        const appliedEventCount = await controller.replaySyncedSideNoteEvents();
        const sidecarPaths = Array.from(adapter.files.keys());

        assert.equal(appliedEventCount, 0);
        assert.equal(commentManager.getCommentById("thread-1")?.comment, "external body");
        assert.equal(aggregateCommentIndex.getCommentById("thread-1")?.comment, "external body");
        assert.equal(sidecarPaths.some((path) => path.includes("hash-docs_note.md.json")), true);
        assert.equal(
            (persistedData.sideNoteSyncEventState as {
                processedWatermarks?: Record<string, Record<string, number>>;
            }).processedWatermarks?.["device-a"]?.["device-b"],
            1,
        );
    } finally {
        globalThis.window = originalWindow;
    }
});

test("comment persistence controller prunes compacted snapshots for missing files", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const missingPath = "Deleted/missing.md";
    const adapter = new FakeAdapter();
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let persistedData: PersistedPluginData = {};
    let eventCounter = 0;
    const remoteThread = createThread(missingPath);
    const remoteEventStore = new SideNoteSyncEventStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        getDeviceId: () => "device-b",
        createEventId: () => `remote-event-${++eventCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        now: () => 1710000000100 + eventCounter,
    });

    await remoteEventStore.appendLocalEvents(missingPath, [{
        op: "createThread",
        payload: {
            thread: remoteThread,
        },
    }]);
    await remoteEventStore.compactProcessedEventsForSnapshots([{
        notePath: missingPath,
        threads: [remoteThread],
    }]);

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async () => "",
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: () => null,
        getCurrentNoteContent: async () => "",
        getStoredNoteContent: async () => "",
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    try {
        const appliedEventCount = await controller.replaySyncedSideNoteEvents();
        const snapshot = Object.values((persistedData.sideNoteSyncEventState as SideNoteSyncEventState).noteSnapshots)
            .find((candidate) => candidate.notePath === missingPath);

        assert.equal(appliedEventCount, 0);
        assert.equal(commentManager.getThreadById("thread-1"), undefined);
        assert.equal(aggregateCommentIndex.getThreadById("thread-1"), null);
        assert.equal(adapter.files.has(getSidecarStoragePath(missingPath)), false);
        assert.deepEqual(snapshot?.threads, []);
    } finally {
        globalThis.window = originalWindow;
    }
});

test("comment persistence controller records a delete tombstone for synced comments without a sidecar", async () => {
    const file = createFile("docs/deleted.md");
    const adapter = new FakeAdapter();
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let persistedData: PersistedPluginData = {};
    let remoteEventCounter = 0;
    let localEventCounter = 0;
    const remoteThread = createThread(file.path);
    const remoteEventStore = new SideNoteSyncEventStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        getDeviceId: () => "device-b",
        createEventId: () => `remote-event-${++remoteEventCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        now: () => 1710000000100 + remoteEventCounter,
    });

    await remoteEventStore.appendLocalEvents(file.path, [{
        op: "createThread",
        payload: {
            thread: remoteThread,
        },
    }]);
    await remoteEventStore.compactProcessedEventsForSnapshots([{
        notePath: file.path,
        threads: [remoteThread],
    }]);

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async () => "",
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: () => null,
        getCurrentNoteContent: async () => "",
        getStoredNoteContent: async () => "",
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => `local-event-${++localEventCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    await controller.deleteStoredComments(file.path);

    const state = persistedData.sideNoteSyncEventState as SideNoteSyncEventState;
    const localDeleteEvents = state.deviceLogs["device-a"]?.events.filter((event) =>
        event.op === "deleteNote"
        && event.notePath === file.path
        && (event.payload as { notePath?: string }).notePath === file.path) ?? [];
    const snapshot = Object.values(state.noteSnapshots).find((candidate) => candidate.notePath === file.path);

    assert.equal(localDeleteEvents.length, 1);
    assert.deepEqual(snapshot?.threads, []);
});

test("comment persistence controller prunes missing sidecar records before writing the index note", async () => {
    const missingPath = "Deleted/missing.md";
    const indexFile = createFile("Aside index.md");
    const liveFile = createFile("docs/live.md");
    const missingThread = createThread(missingPath);
    const adapter = new FakeAdapter();
    const noteSidecarPath = getSidecarStoragePath(missingPath);
    const sourceSidecarPath = getSourceSidecarStoragePath("src-deleted");
    adapter.directories.add(".obsidian/plugins/aside/sidenotes/by-note");
    adapter.directories.add(".obsidian/plugins/aside/sidenotes/by-note/ha");
    adapter.directories.add(".obsidian/plugins/aside/sidenotes/by-source");
    adapter.directories.add(".obsidian/plugins/aside/sidenotes/by-source/ha");
    adapter.files.set(noteSidecarPath, serializeSidecarThreads(missingPath, [missingThread]));
    adapter.files.set(sourceSidecarPath, `${JSON.stringify({
        version: 1,
        notePath: missingPath,
        sourceId: "src-deleted",
        threads: [missingThread],
    })}\n`);

    const aggregateCommentIndex = new AggregateCommentIndex();
    aggregateCommentIndex.updateFile(missingPath, [missingThread]);
    const commentManager = new CommentManager([missingThread]);
    let persistedData: PersistedPluginData = {
        sourceIdentityState: {
            schemaVersion: 1,
            sources: {
                "src-deleted": {
                    sourceId: "src-deleted",
                    currentPath: missingPath,
                    aliases: [],
                    contentFingerprint: null,
                    createdAt: 1710000000000,
                    updatedAt: 1710000000000,
                },
            },
            pathToSourceId: {
                [missingPath]: "src-deleted",
            },
        },
        sideNoteSyncEventState: {
            schemaVersion: 1,
            deviceLogs: {},
            processedWatermarks: {},
            compactedWatermarks: {},
            noteSnapshots: {
                "hash-Deleted_missing.md": {
                    notePath: missingPath,
                    noteHash: "hash-Deleted_missing.md",
                    updatedAt: 1710000000000,
                    coveredWatermarks: {},
                    threads: [missingThread],
                },
            },
        },
    };
    let indexContent = `# Stale\n\n${missingPath}\n`;
    const filesByPath = new Map<string, TFile>([
        [indexFile.path, indexFile],
        [liveFile.path, liveFile],
    ]);

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                getName: () => "dev",
                getMarkdownFiles: () => [indexFile, liveFile],
                getAbstractFileByPath: (filePath: string) => filesByPath.get(filePath) ?? null,
                create: async (_path: string, content: string) => {
                    indexContent = content;
                    return indexFile;
                },
                modify: async (_file: TFile, content: string) => {
                    indexContent = content;
                },
                process: async () => "",
            },
            metadataCache: {
                getFirstLinkpathDest: () => null,
            },
            fileManager: {
                renameFile: async () => {},
            },
        } as never,
        getAllCommentsNotePath: () => indexFile.path,
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (filePath) => filesByPath.get(filePath) ?? null,
        getCurrentNoteContent: async (file) => file.path === indexFile.path ? indexContent : "# Live\n",
        getStoredNoteContent: async () => "",
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: (filePath) => filePath === indexFile.path,
        isCommentableFile: (candidate): candidate is TFile =>
            !!candidate && candidate.extension === "md" && candidate.path !== indexFile.path,
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    await controller.refreshAggregateNoteNow();

    const sourceIdentityState = persistedData.sourceIdentityState as {
        pathToSourceId?: Record<string, string>;
    };
    const snapshot = Object.values((persistedData.sideNoteSyncEventState as SideNoteSyncEventState).noteSnapshots)
        .find((candidate) => candidate.notePath === missingPath);

    assert.equal(indexContent.includes(missingPath), false);
    assert.equal(adapter.files.has(noteSidecarPath), false);
    assert.equal(adapter.files.has(sourceSidecarPath), false);
    assert.equal(commentManager.getThreadById("thread-1"), undefined);
    assert.equal(aggregateCommentIndex.getThreadById("thread-1"), null);
    assert.equal(sourceIdentityState.pathToSourceId?.[missingPath], undefined);
    assert.deepEqual(snapshot?.threads, []);
});

test("comment persistence controller skips incompatible compacted snapshots for existing files", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const file = createFile("docs/effective.md");
    const noteBody = "# Effective\n\nThis note has unrelated content.\n";
    const adapter = new FakeAdapter();
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let persistedData: PersistedPluginData = {};
    let eventCounter = 0;
    const incompatibleThread: CommentThread = {
        ...createThread(file.path),
        selectedText: "an unrelated bottleneck quote from another source",
        selectedTextHash: "hash-unrelated",
    };
    const remoteEventStore = new SideNoteSyncEventStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        getDeviceId: () => "device-b",
        createEventId: () => `remote-event-${++eventCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        now: () => 1710000000100 + eventCounter,
    });

    await remoteEventStore.appendLocalEvents(file.path, [{
        op: "createThread",
        payload: {
            thread: incompatibleThread,
        },
    }]);
    await remoteEventStore.compactProcessedEventsForSnapshots([{
        notePath: file.path,
        threads: [incompatibleThread],
    }]);

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async () => "",
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (path) => path === file.path ? file : null,
        getCurrentNoteContent: async () => noteBody,
        getStoredNoteContent: async () => noteBody,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    try {
        const appliedEventCount = await controller.replaySyncedSideNoteEvents();

        assert.equal(appliedEventCount, 0);
        assert.equal(commentManager.getCommentById("thread-1"), undefined);
        assert.equal(aggregateCommentIndex.getCommentById("thread-1"), null);
        assert.equal(adapter.files.has(getSidecarStoragePath(file.path)), false);
        assert.equal(
            (persistedData.sideNoteSyncEventState as {
                processedWatermarks?: Record<string, Record<string, number>>;
            }).processedWatermarks?.["device-a"]?.["device-b"],
            1,
        );
    } finally {
        globalThis.window = originalWindow;
    }
});

test("comment persistence startup index uses persisted sidecar paths instead of scanning vault markdown files", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;
    const adapter = new FakeAdapter();
    let persistedData: PersistedPluginData = {
        sourceIdentityState: {
            schemaVersion: 1,
            sources: {
                "src-commentless": {
                    sourceId: "src-commentless",
                    currentPath: "aside/node_modules/pkg/README.md",
                    aliases: [],
                    contentFingerprint: "hash-commentless",
                    createdAt: 1710000000000,
                    updatedAt: 1710000000000,
                },
            },
            pathToSourceId: {},
        },
        sideNoteSyncEventState: {
            schemaVersion: 1,
            deviceLogs: {},
            processedWatermarks: {},
            compactedWatermarks: {},
            noteSnapshots: {
                "hash-empty-snapshot": {
                    notePath: "aside/.worktrees/fix/README.md",
                    noteHash: "hash-empty-snapshot",
                    updatedAt: 1710000000000,
                    coveredWatermarks: {},
                    threads: [],
                },
            },
        },
    };
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    const indexNotePath = "Aside index.md";
    const keptFilePath = "notes/kept.md";
    const keptThread = createThread(keptFilePath);
    const files = [
        createFile(keptFilePath),
        createFile("aside/node_modules/pkg/README.md"),
        createFile("aside/.worktrees/fix/README.md"),
        createFile(indexNotePath),
    ];
    const readPaths: string[] = [];
    const indexWrites: string[] = [];
    const keptSidecarPath = getSidecarStoragePath(keptFilePath);
    adapter.directories.add(".obsidian/plugins/aside/sidenotes/by-note");
    adapter.directories.add(keptSidecarPath.slice(0, keptSidecarPath.lastIndexOf("/")));
    adapter.files.set(keptSidecarPath, serializeSidecarThreads(keptFilePath, [keptThread]));

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async (_file: TFile, change: (content: string) => string) => change(""),
                getMarkdownFiles: () => files,
                getName: () => "Dev Vault",
                getAbstractFileByPath: (filePath: string) =>
                    files.find((file) => file.path === filePath) ?? null,
                create: async (_filePath: string, content: string) => {
                    indexWrites.push(content);
                    return createFile(indexNotePath);
                },
                modify: async (_file: TFile, content: string) => {
                    indexWrites.push(content);
                },
            },
            metadataCache: {
                getFirstLinkpathDest: () => null,
            },
            fileManager: {
                renameFile: async () => {},
            },
        } as never,
        getAllCommentsNotePath: () => indexNotePath,
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (filePath) =>
            filePath === indexNotePath
                ? null
                : files.find((file) => file.path === filePath) ?? null,
        getCurrentNoteContent: async (file) => {
            readPaths.push(file.path);
            return "plain note";
        },
        getStoredNoteContent: async () => "plain note",
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: (filePath) => filePath === indexNotePath,
        isCommentableFile: (candidate): candidate is TFile =>
            !!candidate
            && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    try {
        await controller.ensureIndexedCommentsLoaded();

        assert.deepEqual(readPaths, [keptFilePath]);
        assert.equal(indexWrites.length, 1);
        assert.match(indexWrites[0], /data-aside-file-path="notes\/kept\.md"/);
        assert.doesNotMatch(indexWrites[0], /node_modules/);
    } finally {
        globalThis.window = originalWindow;
    }
});

test("comment persistence source identity startup migration uses persisted comment paths", async () => {
    const adapter = new FakeAdapter();
    let persistedData: PersistedPluginData = {};
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    const keptFilePath = "notes/kept.md";
    const keptThread = createThread(keptFilePath);
    const files = [
        createFile(keptFilePath),
        createFile("aside/node_modules/pkg/README.md"),
        createFile("aside/.worktrees/fix/README.md"),
    ];
    const readPaths: string[] = [];
    const keptSidecarPath = getSidecarStoragePath(keptFilePath);
    adapter.directories.add(".obsidian/plugins/aside/sidenotes/by-note");
    adapter.directories.add(keptSidecarPath.slice(0, keptSidecarPath.lastIndexOf("/")));
    adapter.files.set(keptSidecarPath, serializeSidecarThreads(keptFilePath, [keptThread]));

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                getMarkdownFiles: () => files,
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (filePath) =>
            files.find((file) => file.path === filePath) ?? null,
        getCurrentNoteContent: async (file) => {
            readPaths.push(file.path);
            return "plain note";
        },
        getStoredNoteContent: async () => "plain note",
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile =>
            !!candidate
            && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    await controller.migrateSourceIdentitiesOnStartup();

    const sourceIdentityState = persistedData.sourceIdentityState as {
        pathToSourceId?: Record<string, string>;
    };
    assert.deepEqual(readPaths, [keptFilePath]);
    assert.ok(sourceIdentityState.pathToSourceId?.[keptFilePath]);
    assert.equal(sourceIdentityState.pathToSourceId?.["aside/node_modules/pkg/README.md"], undefined);
    assert.equal(sourceIdentityState.pathToSourceId?.["aside/.worktrees/fix/README.md"], undefined);
});

test("comment persistence disposal stops in-flight startup indexing", async () => {
    const adapter = new FakeAdapter();
    let persistedData: PersistedPluginData = {};
    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    const indexNotePath = "Aside index.md";
    const firstFilePath = "notes/first.md";
    const secondFilePath = "notes/second.md";
    const files = [
        createFile(firstFilePath),
        createFile(secondFilePath),
    ];
    const readPaths: string[] = [];
    const indexWrites: string[] = [];
    let controller: CommentPersistenceController | null = null;
    adapter.directories.add(".obsidian/plugins/aside/sidenotes/by-note");
    for (const filePath of [firstFilePath, secondFilePath]) {
        const sidecarPath = getSidecarStoragePath(filePath);
        adapter.directories.add(sidecarPath.slice(0, sidecarPath.lastIndexOf("/")));
        adapter.files.set(sidecarPath, serializeSidecarThreads(filePath, [createThread(filePath)]));
    }

    controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async (_file: TFile, change: (content: string) => string) => change(""),
                getMarkdownFiles: () => files,
                getName: () => "Dev Vault",
                getAbstractFileByPath: (filePath: string) =>
                    files.find((file) => file.path === filePath) ?? null,
                create: async (_filePath: string, content: string) => {
                    indexWrites.push(content);
                    return createFile(indexNotePath);
                },
                modify: async (_file: TFile, content: string) => {
                    indexWrites.push(content);
                },
            },
            metadataCache: {
                getFirstLinkpathDest: () => null,
            },
            fileManager: {
                renameFile: async () => {},
            },
        } as never,
        getAllCommentsNotePath: () => indexNotePath,
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (filePath) =>
            files.find((file) => file.path === filePath) ?? null,
        getCurrentNoteContent: async (file) => {
            readPaths.push(file.path);
            if (file.path === firstFilePath) {
                controller?.dispose();
            }
            return "plain note";
        },
        getStoredNoteContent: async () => "plain note",
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: (filePath) => filePath === indexNotePath,
        isCommentableFile: (candidate): candidate is TFile =>
            !!candidate
            && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    await controller.ensureIndexedCommentsLoaded();

    assert.deepEqual(readPaths, [firstFilePath]);
    assert.equal(indexWrites.length, 0);
});

test("comment persistence can save again after a plugin reload", async () => {
    const adapter = new FakeAdapter();
    let persistedData: PersistedPluginData = {};
    const file = createFile("test2.md");
    const indexNotePath = "Aside index.md";
    const commentManager = new CommentManager([createThread(file.path)]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    const indexWrites: string[] = [];

    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
                process: async (_file: TFile, change: (content: string) => string) => change("plain note"),
                getMarkdownFiles: () => [file],
                getName: () => "Dev Vault",
                getAbstractFileByPath: (filePath: string) =>
                    filePath === file.path ? file : null,
                create: async (_filePath: string, content: string) => {
                    indexWrites.push(content);
                    return createFile(indexNotePath);
                },
                modify: async (_file: TFile, content: string) => {
                    indexWrites.push(content);
                },
            },
            metadataCache: {
                getFirstLinkpathDest: () => null,
            },
            fileManager: {
                renameFile: async () => {},
            },
        } as never,
        getAllCommentsNotePath: () => indexNotePath,
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (filePath) =>
            filePath === file.path ? file : null,
        getCurrentNoteContent: async () => "plain note",
        getStoredNoteContent: async () => "plain note",
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        isAllCommentsNotePath: (filePath) => filePath === indexNotePath,
        isCommentableFile: (candidate): candidate is TFile =>
            !!candidate
            && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    controller.dispose();
    await controller.persistCommentsForFile(file, { immediateAggregateRefresh: true });
    assert.equal(indexWrites.length, 0);

    const revived = (controller as unknown as { reviveForLoad(): CommentPersistenceController }).reviveForLoad();
    assert.notEqual(revived, controller);

    await revived.persistCommentsForFile(file, { immediateAggregateRefresh: true });

    assert.equal(indexWrites.length, 1);
    assert.match(indexWrites[0], /test2\.md/);
    const sidecar = JSON.parse(adapter.files.get(getSidecarStoragePath(file.path)) ?? "{}") as {
        threads?: CommentThread[];
    };
    assert.equal(sidecar.threads?.length, 1);
});
