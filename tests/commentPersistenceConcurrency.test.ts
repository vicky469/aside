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
    let nextId = 0;
    const noteBody = "# Title\n\nAlpha target omega\n";
    let currentNoteContentReader = async (_file: TFile) => noteBody;
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
        setCurrentNoteContentReader: (reader: (file: TFile) => Promise<string>) => {
            currentNoteContentReader = reader;
        },
    };
}

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
