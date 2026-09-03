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

function createHarness(file: TFile, threads: CommentThread[]) {
    const adapter = new CollisionAwareAdapter();
    const commentManager = new CommentManager(threads);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let persistedData: PersistedPluginData = {};
    let nextId = 0;
    const noteBody = "# Title\n\nAlpha target omega\n";
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
        getMarkdownFileByPath: (filePath) => filePath === file.path ? file : null,
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
    const { adapter, commentManager, controller } = createHarness(file, [thread]);

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
