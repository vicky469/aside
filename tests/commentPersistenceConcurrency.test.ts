import * as assert from "node:assert/strict";
import test from "node:test";
import type { DataAdapter, MarkdownView, TFile } from "obsidian";
import { CommentManager, type CommentThread } from "../src/commentManager";
import { CommentPersistenceController } from "../src/comments/commentPersistenceController";
import { parseNoteComments } from "../src/core/storage/noteCommentStorage";
import { AggregateCommentIndex } from "../src/index/AggregateCommentIndex";
import type { PersistedPluginData } from "../src/settings/indexNoteSettingsPlanner";

class CollisionAwareAdapter implements Pick<DataAdapter, "exists" | "mkdir" | "write" | "read" | "remove" | "rename" | "list"> {
    public readonly directories = new Set<string>();
    public readonly files = new Map<string, string>();
    public failNextWriteContaining: string | null = null;

    async exists(normalizedPath: string): Promise<boolean> {
        return this.directories.has(normalizedPath) || this.files.has(normalizedPath);
    }

    async mkdir(normalizedPath: string): Promise<void> {
        this.directories.add(normalizedPath);
    }

    async write(normalizedPath: string, data: string): Promise<void> {
        if (this.failNextWriteContaining && normalizedPath.includes(this.failNextWriteContaining)) {
            this.failNextWriteContaining = null;
            throw new Error(`Injected sidecar write failure: ${normalizedPath}`);
        }
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

    async rename(sourcePath: string, destinationPath: string): Promise<void> {
        const content = this.files.get(sourcePath);
        if (content === undefined) {
            throw new Error(`Missing file: ${sourcePath}`);
        }
        if (this.files.has(destinationPath)) {
            throw new Error("Destination file already exists!");
        }

        this.files.set(destinationPath, content);
        this.files.delete(sourcePath);
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

function createThread(filePath: string, id = "thread-1"): CommentThread {
    return {
        id,
        filePath,
        startLine: 2,
        startChar: 6,
        endLine: 2,
        endChar: 12,
        selectedText: "target",
        selectedTextHash: "hash-target",
        anchorKind: "selection",
        orphaned: false,
        entries: [{
            id: "entry-1",
            body: "reply one",
            timestamp: 1710000000000,
        }],
        createdAt: 1710000000000,
        updatedAt: 1710000000000,
    };
}

function hashText(text: string): string {
    return `hash-${text.replace(/\//g, "_")}`;
}

function getSidecarStoragePath(filePath: string): string {
    const noteHash = hashText(filePath);
    return `.obsidian/plugins/aside/sidenotes/by-note/${noteHash.slice(0, 2)}/${noteHash}.json`;
}

function createDeferred() {
    let resolvePromise!: () => void;
    const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve: resolvePromise,
    };
}

async function settlesWithinMicrotasks(promise: Promise<void>, turnCount = 20): Promise<boolean> {
    let settled = false;
    void promise.then(() => {
        settled = true;
    });
    for (let turn = 0; turn < turnCount && !settled; turn += 1) {
        await Promise.resolve();
    }
    return settled;
}

function createHarness(files: TFile[], threads: CommentThread[]) {
    const adapter = new CollisionAwareAdapter();
    const commentManager = new CommentManager(threads);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let persistedData: PersistedPluginData = {};
    let persistedWriteCount = 0;
    let nextId = 0;
    const noteBody = "# Title\n\nAlpha target omega\n";
    let currentNoteContentReader = async (_file: TFile) => noteBody;
    const parsedNoteFilePaths: string[] = [];
    const controller = new CommentPersistenceController({
        app: {
            vault: {
                adapter: adapter as unknown as DataAdapter,
            },
        } as never,
        getAllCommentsNotePath: () => "Aside index.md",
        getIndexHeaderImageUrl: () => "",
        getIndexHeaderImageCaption: () => "",
        getMarkdownViewForFile: () => null as MarkdownView | null,
        getMarkdownFileByPath: (filePath) => files.find((file) => file.path === filePath) ?? null,
        getCurrentNoteContent: (file) => currentNoteContentReader(file),
        getStoredNoteContent: async () => noteBody,
        getParsedNoteComments: (filePath, noteContent) => {
            parsedNoteFilePaths.push(filePath);
            return parseNoteComments(noteContent, filePath);
        },
        getPluginDataDirPath: () => ".obsidian/plugins/aside",
        getSideNoteSyncDeviceId: () => "device-a",
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedWriteCount += 1;
            persistedData = data;
        },
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => `generated-${nextId += 1}`,
        hashText: async (text) => hashText(text),
        syncDerivedCommentLinksForFile: () => {},
        refreshCommentViews: async () => {},
        refreshAllCommentsSidebarViews: async () => {},
        refreshEditorDecorations: () => {},
        refreshMarkdownPreviews: () => {},
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        log: async () => {},
    });

    return {
        adapter,
        commentManager,
        controller,
        parsedNoteFilePaths,
        setCurrentNoteContentReader: (reader: (file: TFile) => Promise<string>) => {
            currentNoteContentReader = reader;
        },
        getPersistedWriteCount: () => persistedWriteCount,
        resetPersistedWriteCount: () => {
            persistedWriteCount = 0;
        },
    };
}

test("folder comment retarget isolates a failed sidecar, batches metadata, and remains replayable", async () => {
    const previousPaths = ["Drafts/a.md", "Drafts/b.md", "Drafts/c.md"];
    const nextPaths = ["Published/a.md", "Published/b.md", "Published/c.md"];
    const threads = previousPaths.map((filePath, index) => createThread(filePath, `thread-${index}`));
    const harness = createHarness(nextPaths.map(createFile), threads);
    for (const [index, filePath] of previousPaths.entries()) {
        harness.adapter.files.set(getSidecarStoragePath(filePath), `${JSON.stringify({
            version: 1,
            notePath: filePath,
            threads: [threads[index]],
        })}\n`);
    }
    const retargets = previousPaths.map((previousFilePath, index) => ({
        previousFilePath,
        nextFilePath: nextPaths[index],
        retargetOptions: {
            selectionCapable: true,
            pageLabelHash: `page-hash-${index}`,
        },
    }));
    harness.adapter.failNextWriteContaining = "hash-Published_b.md";

    const first = await harness.controller.renameStoredCommentsInFolder(retargets);

    assert.deepEqual(first.successfulRetargets.map((retarget) => retarget.nextFilePath), [
        "Published/a.md",
        "Published/c.md",
    ]);
    assert.equal(first.failures.length, 1);
    assert.equal(first.failures[0]?.retarget.nextFilePath, "Published/b.md");
    assert.equal(harness.commentManager.getThreadById("thread-0")?.filePath, "Published/a.md");
    assert.equal(harness.commentManager.getThreadById("thread-1")?.filePath, "Drafts/b.md");
    assert.equal(harness.commentManager.getThreadById("thread-2")?.filePath, "Published/c.md");
    assert.equal(harness.getPersistedWriteCount(), 2, "source identity and sync each write once");

    harness.resetPersistedWriteCount();
    const replay = await harness.controller.renameStoredCommentsInFolder(retargets);

    assert.equal(replay.failures.length, 0);
    assert.equal(harness.commentManager.getThreadById("thread-1")?.filePath, "Published/b.md");
    assert.equal(await harness.adapter.exists(getSidecarStoragePath("Published/b.md")), true);
    assert.equal(harness.getPersistedWriteCount() <= 1, true);
});

test("comment persistence serializes simultaneous saves for one note", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const file = createFile("docs/note.md");
    const thread = createThread(file.path);
    const { adapter, commentManager, controller } = createHarness([file], [thread]);

    try {
        const firstSave = controller.persistCommentsForFile(file);
        commentManager.appendEntry(thread.id, {
            id: "entry-2",
            body: "reply two",
            timestamp: 1710000002000,
        });
        const secondSave = controller.persistCommentsForFile(file);

        await Promise.all([firstSave, secondSave]);

        const payload = JSON.parse(await adapter.read(getSidecarStoragePath(file.path))) as {
            threads: CommentThread[];
        };
        assert.deepEqual(
            payload.threads[0]?.entries.map((entry) => entry.id),
            ["entry-1", "entry-2"],
        );
    } finally {
        controller.dispose();
        globalThis.window = originalWindow;
    }
});

test("comment persistence keeps different note saves concurrent", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const fileA = createFile("docs/a.md");
    const fileB = createFile("docs/b.md");
    const threadA = createThread(fileA.path, "thread-a");
    const threadB = createThread(fileB.path, "thread-b");
    const harness = createHarness([fileA, fileB], [threadA, threadB]);
    const aEntered = createDeferred();
    const bEntered = createDeferred();
    const releaseA = createDeferred();
    harness.setCurrentNoteContentReader(async (file) => {
        if (file.path === fileA.path) {
            aEntered.resolve();
            await releaseA.promise;
        } else if (file.path === fileB.path) {
            bEntered.resolve();
        }
        return "# Title\n\nAlpha target omega\n";
    });

    try {
        const saveA = harness.controller.persistCommentsForFile(fileA);
        await aEntered.promise;
        const saveB = harness.controller.persistCommentsForFile(fileB);

        assert.equal(
            await settlesWithinMicrotasks(bEntered.promise),
            true,
            "note B was globally blocked by note A",
        );

        releaseA.resolve();
        await Promise.all([saveA, saveB]);
        assert.equal(await harness.adapter.exists(getSidecarStoragePath(fileA.path)), true);
        assert.equal(await harness.adapter.exists(getSidecarStoragePath(fileB.path)), true);
    } finally {
        releaseA.resolve();
        harness.controller.dispose();
        globalThis.window = originalWindow;
    }
});

test("comment persistence continues queued saves after a same-note failure", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const file = createFile("docs/note.md");
    const harness = createHarness([file], [createThread(file.path)]);
    let readCount = 0;
    harness.setCurrentNoteContentReader(async () => {
        readCount += 1;
        if (readCount === 1) {
            throw new Error("first save failed");
        }
        return "# Title\n\nAlpha target omega\n";
    });

    try {
        const firstSave = harness.controller.persistCommentsForFile(file);
        const secondSave = harness.controller.persistCommentsForFile(file);

        await assert.rejects(firstSave, /first save failed/);
        await secondSave;

        assert.equal(await harness.adapter.exists(getSidecarStoragePath(file.path)), true);
    } finally {
        harness.controller.dispose();
        globalThis.window = originalWindow;
    }
});

test("markdown modification synchronization joins the same-note persistence queue", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const file = createFile("docs/note.md");
    const harness = createHarness([file], [createThread(file.path)]);
    const firstReadEntered = createDeferred();
    const secondReadEntered = createDeferred();
    const releaseFirstRead = createDeferred();
    let readCount = 0;
    harness.setCurrentNoteContentReader(async () => {
        readCount += 1;
        if (readCount === 1) {
            firstReadEntered.resolve();
            await releaseFirstRead.promise;
        } else if (readCount === 2) {
            secondReadEntered.resolve();
        }
        return "# Title\n\nAlpha target omega\n";
    });

    let savePromise: Promise<void> | null = null;
    let modificationPromise: Promise<void> | null = null;
    try {
        savePromise = harness.controller.persistCommentsForFile(file);
        await firstReadEntered.promise;
        modificationPromise = harness.controller.handleMarkdownFileModified(file);

        assert.equal(
            await settlesWithinMicrotasks(secondReadEntered.promise),
            false,
            "same-note Markdown synchronization bypassed the persistence queue",
        );

        releaseFirstRead.resolve();
        await Promise.all([savePromise, modificationPromise]);

        assert.equal(readCount >= 2, true);
        assert.equal(await harness.adapter.exists(getSidecarStoragePath(file.path)), true);
    } finally {
        releaseFirstRead.resolve();
        await Promise.allSettled(
            [savePromise, modificationPromise]
                .filter((promise): promise is Promise<void> => promise !== null),
        );
        harness.controller.dispose();
        globalThis.window = originalWindow;
    }
});

test("queued Markdown synchronization keeps its captured path across a rename", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const previousPath = "docs/old.md";
    const nextPath = "docs/new.md";
    const file = createFile(previousPath);
    const harness = createHarness([file], [createThread(previousPath)]);
    const firstReadEntered = createDeferred();
    const releaseFirstRead = createDeferred();
    let readCount = 0;
    harness.setCurrentNoteContentReader(async () => {
        readCount += 1;
        if (readCount === 1) {
            firstReadEntered.resolve();
            await releaseFirstRead.promise;
        }
        return "# Title\n\nAlpha target omega\n";
    });

    let savePromise: Promise<void> | null = null;
    let modificationPromise: Promise<void> | null = null;
    let renamePromise: Promise<void> | null = null;
    try {
        savePromise = harness.controller.persistCommentsForFile(file);
        await firstReadEntered.promise;
        modificationPromise = harness.controller.handleMarkdownFileModified(file);
        (file as TFile & { path: string }).path = nextPath;
        renamePromise = harness.controller.renameStoredComments(previousPath, nextPath, {
            selectionCapable: true,
            pageLabelHash: "hash-page",
        });

        releaseFirstRead.resolve();
        await Promise.all([savePromise, modificationPromise, renamePromise]);

        assert.equal(
            harness.parsedNoteFilePaths.includes(nextPath),
            false,
            "the old-path modification transaction read mutable file.path after waiting",
        );
        const payload = JSON.parse(await harness.adapter.read(getSidecarStoragePath(nextPath))) as {
            threads: CommentThread[];
        };
        assert.equal(payload.threads[0]?.filePath, nextPath);
    } finally {
        releaseFirstRead.resolve();
        await Promise.allSettled(
            [savePromise, modificationPromise, renamePromise]
                .filter((promise): promise is Promise<void> => promise !== null),
        );
        harness.controller.dispose();
        globalThis.window = originalWindow;
    }
});

test("comment persistence carries an in-flight save across a note rename", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const previousPath = "docs/old.md";
    const nextPath = "docs/new.md";
    const file = createFile(previousPath);
    const thread = createThread(previousPath);
    const harness = createHarness([file], [thread]);
    const firstReadEntered = createDeferred();
    const releaseFirstRead = createDeferred();
    let readCount = 0;
    harness.setCurrentNoteContentReader(async () => {
        readCount += 1;
        if (readCount === 1) {
            firstReadEntered.resolve();
            await releaseFirstRead.promise;
        }
        return "# Title\n\nAlpha target omega\n";
    });

    let firstSave: Promise<void> | null = null;
    let renameSave: Promise<void> | null = null;
    let nextPathSave: Promise<void> | null = null;
    try {
        firstSave = harness.controller.persistCommentsForFile(file);
        await firstReadEntered.promise;
        (file as TFile & { path: string }).path = nextPath;
        renameSave = harness.controller.renameStoredComments(previousPath, nextPath, {
            selectionCapable: true,
            pageLabelHash: "hash-page",
        });
        harness.commentManager.appendEntry(thread.id, {
            id: "entry-2",
            body: "reply two",
            timestamp: 1710000002000,
        });
        nextPathSave = harness.controller.persistCommentsForFile(file);

        assert.equal(
            await settlesWithinMicrotasks(renameSave),
            false,
            "rename did not wait for the old-path persistence tail",
        );

        releaseFirstRead.resolve();
        await Promise.all([firstSave, renameSave, nextPathSave]);

        const payload = JSON.parse(await harness.adapter.read(getSidecarStoragePath(nextPath))) as {
            threads: CommentThread[];
        };
        assert.deepEqual(
            payload.threads[0]?.entries.map((entry) => entry.id),
            ["entry-1", "entry-2"],
        );
    } finally {
        releaseFirstRead.resolve();
        await Promise.allSettled(
            [firstSave, renameSave, nextPathSave]
                .filter((promise): promise is Promise<void> => promise !== null),
        );
        harness.controller.dispose();
        globalThis.window = originalWindow;
    }
});

test("comment persistence commits complete thread entries idempotently", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const file = createFile("docs/note.md");
    const thread = createThread(file.path);
    const harness = createHarness([file], [thread]);
    const firstReadEntered = createDeferred();
    const releaseFirstRead = createDeferred();
    let readCount = 0;
    harness.setCurrentNoteContentReader(async () => {
        readCount += 1;
        if (readCount === 1) {
            firstReadEntered.resolve();
            await releaseFirstRead.promise;
        }
        return "# Title\n\nAlpha target omega\n";
    });

    try {
        const firstCommit = harness.controller.commitThreadEntry(file, thread.id, {
            id: "agent-reply-1",
            body: "First complete reply",
            timestamp: 1710000001000,
        }, {
            insertAfterCommentId: thread.id,
        });
        await firstReadEntered.promise;
        const secondCommit = harness.controller.commitThreadEntry(file, thread.id, {
            id: "agent-reply-2",
            body: "Second complete reply",
            timestamp: 1710000002000,
        }, {
            insertAfterCommentId: thread.id,
        });

        releaseFirstRead.resolve();
        assert.equal(await firstCommit, true);
        assert.equal(await secondCommit, true);

        assert.equal(await harness.controller.commitThreadEntry(file, thread.id, {
            id: "agent-reply-1",
            body: "Updated complete reply",
            timestamp: 1710000003000,
        }, {
            insertAfterCommentId: thread.id,
        }), true);

        const payload = JSON.parse(await harness.adapter.read(getSidecarStoragePath(file.path))) as {
            threads: CommentThread[];
        };
        const entries = payload.threads[0]?.entries ?? [];
        assert.equal(entries.filter((entry) => entry.id === "agent-reply-1").length, 1);
        assert.equal(entries.find((entry) => entry.id === "agent-reply-1")?.body, "Updated complete reply");
        assert.equal(entries.find((entry) => entry.id === "agent-reply-2")?.body, "Second complete reply");
    } finally {
        releaseFirstRead.resolve();
        harness.controller.dispose();
        globalThis.window = originalWindow;
    }
});

test("interrupted reply commit preserves a concurrently stored completed reply", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const file = createFile("docs/note.md");
    const thread = createThread(file.path);
    thread.entries.push({
        id: "agent-reply",
        body: "",
        timestamp: 1710000001000,
    });
    const harness = createHarness([file], [thread]);

    try {
        await harness.controller.persistCommentsForFile(file);
        const storagePath = getSidecarStoragePath(file.path);
        let updatedSidecars = 0;
        for (const [candidatePath, content] of harness.adapter.files) {
            const concurrentPayload = JSON.parse(content) as { threads?: CommentThread[] };
            const storedReply = concurrentPayload.threads?.[0]?.entries.find((entry) => entry.id === "agent-reply");
            if (!storedReply) {
                continue;
            }
            storedReply.body = "Completed reply from the previous session";
            await harness.adapter.write(candidatePath, JSON.stringify(concurrentPayload));
            updatedSidecars += 1;
        }
        assert.equal(updatedSidecars, 2);

        assert.equal(await harness.controller.commitThreadEntry(file, thread.id, {
            id: "agent-reply",
            body: "The previous Aside agent run did not finish.",
            timestamp: 1710000002000,
        }, {
            insertAfterCommentId: thread.id,
            onlyIfEntryAbsentOrBlank: true,
        }), true);

        const persistedPayload = JSON.parse(await harness.adapter.read(storagePath)) as {
            threads: CommentThread[];
        };
        assert.equal(
            persistedPayload.threads[0]?.entries.find((entry) => entry.id === "agent-reply")?.body,
            "Completed reply from the previous session",
        );
        assert.equal(
            harness.commentManager.getCommentById("agent-reply")?.comment,
            "Completed reply from the previous session",
        );
    } finally {
        harness.controller.dispose();
        globalThis.window = originalWindow;
    }
});

test("agent reply commit stops when persistence is disposed during its read", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const file = createFile("docs/note.md");
    const thread = createThread(file.path);
    const harness = createHarness([file], [thread]);
    const readStarted = createDeferred();
    const releaseRead = createDeferred();
    harness.setCurrentNoteContentReader(async () => {
        readStarted.resolve();
        await releaseRead.promise;
        return "# Title\n\nAlpha target omega\n";
    });

    const commit = harness.controller.commitThreadEntry(file, thread.id, {
        id: "agent-reply",
        body: "Late reply",
        timestamp: 1710000001000,
    }, {
        insertAfterCommentId: thread.id,
    });
    await readStarted.promise;
    harness.controller.dispose();
    releaseRead.resolve();

    assert.equal(await commit, false);
    assert.equal(harness.commentManager.getCommentById("agent-reply"), undefined);
    globalThis.window = originalWindow;
});

test("agent reply commit stops when persistence is disposed during its write preparation", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const file = createFile("docs/note.md");
    const thread = createThread(file.path);
    const harness = createHarness([file], [thread]);
    const secondReadStarted = createDeferred();
    const releaseSecondRead = createDeferred();
    let readCount = 0;
    harness.setCurrentNoteContentReader(async () => {
        readCount += 1;
        if (readCount === 2) {
            secondReadStarted.resolve();
            await releaseSecondRead.promise;
        }
        return "# Title\n\nAlpha target omega\n";
    });

    const commit = harness.controller.commitThreadEntry(file, thread.id, {
        id: "agent-reply",
        body: "Late reply",
        timestamp: 1710000001000,
    }, {
        insertAfterCommentId: thread.id,
    });
    await secondReadStarted.promise;
    harness.controller.dispose();
    releaseSecondRead.resolve();

    assert.equal(await commit, false);
    assert.equal(await harness.adapter.exists(getSidecarStoragePath(file.path)), false);
    globalThis.window = originalWindow;
});

test("agent reply commit preserves a user mutation made while the commit is writing", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as typeof globalThis.window;

    const file = createFile("docs/note.md");
    const thread = createThread(file.path);
    const harness = createHarness([file], [thread]);
    const commitWriteEntered = createDeferred();
    const releaseCommitWrite = createDeferred();
    let readCount = 0;
    harness.setCurrentNoteContentReader(async () => {
        readCount += 1;
        if (readCount === 2) {
            commitWriteEntered.resolve();
            await releaseCommitWrite.promise;
        }
        return "# Title\n\nAlpha target omega\n";
    });

    try {
        const agentCommit = harness.controller.commitThreadEntry(file, thread.id, {
            id: "agent-reply",
            body: "Agent reply",
            timestamp: 1710000001000,
        }, {
            insertAfterCommentId: thread.id,
        });
        await commitWriteEntered.promise;

        harness.commentManager.appendEntry(thread.id, {
            id: "user-reply",
            body: "User reply",
            timestamp: 1710000002000,
        });
        const userSave = harness.controller.persistCommentsForFile(file);

        releaseCommitWrite.resolve();
        assert.equal(await agentCommit, true);
        await userSave;

        const payload = JSON.parse(await harness.adapter.read(getSidecarStoragePath(file.path))) as {
            threads: CommentThread[];
        };
        assert.deepEqual(
            payload.threads[0]?.entries.map((entry) => entry.id),
            ["entry-1", "agent-reply", "user-reply"],
        );
        assert.deepEqual(
            harness.commentManager.getThreadById(thread.id)?.entries.map((entry) => entry.id),
            ["entry-1", "agent-reply", "user-reply"],
        );
    } finally {
        releaseCommitWrite.resolve();
        harness.controller.dispose();
        globalThis.window = originalWindow;
    }
});
