import * as assert from "node:assert/strict";
import test from "node:test";
import type { DataAdapter } from "obsidian";
import type { MarkdownView, TFile } from "obsidian";
import { CommentManager, type CommentThread } from "../src/commentManager";
import { CommentPersistenceController } from "../src/control/commentPersistenceController";
import type { PersistedPluginData } from "../src/control/indexNoteSettingsPlanner";
import { SideNoteSyncEventStore } from "../src/control/sideNoteSyncEventStore";
import { serializeNoteCommentThreads, parseNoteComments } from "../src/core/storage/noteCommentStorage";
import { AggregateCommentIndex } from "../src/index/AggregateCommentIndex";

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
        getAllCommentsNotePath: () => "SideNote2 index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => ({}) as MarkdownView,
        getMarkdownFileByPath: () => file,
        getCurrentNoteContent: async () => currentContent,
        getStoredNoteContent: async () => storedContent,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/side-note2",
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
        assert.equal(adapter.files.size, 1);
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
        getAllCommentsNotePath: () => "SideNote2 index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: () => file,
        getCurrentNoteContent: async () => legacyContent,
        getStoredNoteContent: async () => legacyContent,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/side-note2",
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
    assert.equal(adapter.files.size, 1);
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
        getAllCommentsNotePath: () => "SideNote2 index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (path) => path === newFile.path ? newFile : null,
        getCurrentNoteContent: async () => noteBody,
        getStoredNoteContent: async () => noteBody,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/side-note2",
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
        getAllCommentsNotePath: () => "SideNote2 index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        shouldShowResolvedComments: () => false,
        getMarkdownViewForFile: () => null,
        getMarkdownFileByPath: (path) => path === file.path ? file : null,
        getCurrentNoteContent: async () => noteBody,
        getStoredNoteContent: async () => noteBody,
        getParsedNoteComments: (filePath, noteContent) => parseNoteComments(noteContent, filePath),
        getPluginDataDirPath: () => ".obsidian/plugins/side-note2",
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
