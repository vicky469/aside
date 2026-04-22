import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import type { CommentThread } from "../src/commentManager";
import { CommentExportController } from "../src/control/commentExportController";
import { buildSideNoteMarkdownExport } from "../src/core/export/commentMarkdownExport";

function createFile(path: string): TFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/u, "") ?? path,
        extension: path.split(".").pop() ?? "",
    } as TFile;
}

function createThread(overrides: Partial<CommentThread> = {}): CommentThread {
    return {
        id: overrides.id ?? "thread-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        startLine: overrides.startLine ?? 1,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 1,
        endChar: overrides.endChar ?? 12,
        selectedText: overrides.selectedText ?? "Architecture",
        selectedTextHash: overrides.selectedTextHash ?? "hash-architecture",
        anchorKind: overrides.anchorKind ?? "selection",
        isBookmark: overrides.isBookmark ?? false,
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
        entries: overrides.entries ?? [{
            id: overrides.id ?? "thread-1",
            body: "Initial note body",
            timestamp: 1713700000000,
        }],
        createdAt: overrides.createdAt ?? 1713700000000,
        updatedAt: overrides.updatedAt ?? 1713700000000,
    };
}

function createHarness(options: {
    now?: number;
    sourceFile?: TFile;
    threads?: CommentThread[];
    allIndexedThreads?: CommentThread[];
    existingFiles?: Array<{ path: string; content: string }>;
    existingFolders?: string[];
} = {}) {
    const sourceFile = options.sourceFile ?? createFile("docs/architecture.md");
    const threads = options.threads ?? [createThread({ filePath: sourceFile.path })];
    const allIndexedThreads = options.allIndexedThreads ?? threads;
    const folders = new Map<string, { path: string }>();
    const files = new Map<string, { file: TFile; content: string }>();
    const createdFolders: string[] = [];
    const createdFiles: Array<{ path: string; content: string }> = [];
    const modifiedFiles: Array<{ path: string; content: string }> = [];
    let loadCommentsForFileCount = 0;

    files.set(sourceFile.path, {
        file: sourceFile,
        content: "# Source note\n",
    });

    for (const folderPath of options.existingFolders ?? []) {
        folders.set(folderPath, { path: folderPath });
    }

    for (const entry of options.existingFiles ?? []) {
        files.set(entry.path, {
            file: createFile(entry.path),
            content: entry.content,
        });
    }

    const controller = new CommentExportController({
        app: {
            vault: {
                getAbstractFileByPath: (path: string) => files.get(path)?.file ?? folders.get(path) ?? null,
                createFolder: async (path: string) => {
                    folders.set(path, { path });
                    createdFolders.push(path);
                },
                create: async (path: string, content: string) => {
                    const file = createFile(path);
                    files.set(path, { file, content });
                    createdFiles.push({ path, content });
                    return file;
                },
                modify: async (file: TFile, content: string) => {
                    files.set(file.path, { file, content });
                    modifiedFiles.push({ path: file.path, content });
                },
            },
        } as never,
        isCommentableFile: (file): file is TFile => !!file && file.extension === "md",
        loadCommentsForFile: async () => {
            loadCommentsForFileCount += 1;
        },
        getAllIndexedThreads: () => allIndexedThreads,
        getThreadsForFile: () => threads,
        now: () => options.now ?? 1713703600000,
    });

    return {
        controller,
        sourceFile,
        threads,
        createdFolders,
        createdFiles,
        modifiedFiles,
        getLoadCommentsForFileCount: () => loadCommentsForFileCount,
    };
}

test("comment export controller creates missing export folders and writes a clean markdown note", async () => {
    const harness = createHarness();

    const result = await harness.controller.exportCommentsForFile(harness.sourceFile);

    assert.equal(harness.getLoadCommentsForFileCount(), 1);
    assert.deepEqual(harness.createdFolders, ["SideNote2", "SideNote2/exports"]);
    assert.deepEqual(harness.createdFiles, [{
        path: "SideNote2/exports/docs - architecture side notes.md",
        content: buildSideNoteMarkdownExport({
            filePath: harness.sourceFile.path,
            referenceThreads: harness.threads,
            threads: harness.threads,
            exportedAt: 1713703600000,
        }),
    }]);
    assert.deepEqual(harness.modifiedFiles, []);
    assert.deepEqual(result, {
        filePath: "docs/architecture.md",
        exportFilePath: "SideNote2/exports/docs - architecture side notes.md",
        threadCount: 1,
        entryCount: 1,
        updatedExistingFile: false,
    });
});

test("comment export controller updates an existing export file in place", async () => {
    const harness = createHarness({
        existingFolders: ["SideNote2", "SideNote2/exports"],
        existingFiles: [{
            path: "SideNote2/exports/docs - architecture side notes.md",
            content: "Old export\n",
        }],
    });

    const result = await harness.controller.exportCommentsForFile(harness.sourceFile);

    assert.deepEqual(harness.createdFolders, []);
    assert.deepEqual(harness.createdFiles, []);
    assert.deepEqual(harness.modifiedFiles, [{
        path: "SideNote2/exports/docs - architecture side notes.md",
        content: buildSideNoteMarkdownExport({
            filePath: harness.sourceFile.path,
            referenceThreads: harness.threads,
            threads: harness.threads,
            exportedAt: 1713703600000,
        }),
    }]);
    assert.equal(result.updatedExistingFile, true);
});

test("comment export controller refuses to create export folders through an existing file path", async () => {
    const harness = createHarness({
        existingFiles: [{
            path: "SideNote2",
            content: "not a folder\n",
        }],
    });

    await assert.rejects(
        harness.controller.exportCommentsForFile(harness.sourceFile),
        /Cannot export side notes because SideNote2 is a file\./u,
    );
});
