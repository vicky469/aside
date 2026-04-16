import * as assert from "node:assert/strict";
import test from "node:test";
import type { MarkdownView, TFile } from "obsidian";
import { CommentManager, type CommentThread } from "../src/commentManager";
import { CommentPersistenceController } from "../src/control/commentPersistenceController";
import { serializeNoteCommentThreads, parseNoteComments } from "../src/core/storage/noteCommentStorage";
import { AggregateCommentIndex } from "../src/index/AggregateCommentIndex";

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

    const commentManager = new CommentManager([]);
    const aggregateCommentIndex = new AggregateCommentIndex();
    let refreshCommentViewsCount = 0;
    let refreshEditorDecorationsCount = 0;
    let refreshMarkdownPreviewsCount = 0;
    let processCount = 0;
    const derivedSyncCalls: Array<{ filePath: string; noteContent: string; commentCount: number }> = [];

    const controller = new CommentPersistenceController({
        app: {
            vault: {
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
        isAllCommentsNotePath: () => false,
        isCommentableFile: (candidate): candidate is TFile => !!candidate && candidate.extension === "md",
        isMarkdownEditorFocused: () => false,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        createCommentId: () => "generated-id",
        hashText: async (text) => `hash:${text}`,
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
        refreshEditorDecorations: () => {
            refreshEditorDecorationsCount += 1;
        },
        refreshMarkdownPreviews: () => {
            refreshMarkdownPreviewsCount += 1;
        },
        getCommentMentionedPageLabels: () => [],
        syncIndexNoteLeafMode: async () => {},
        saveSettings: async () => {},
        log: async () => {},
    });

    try {
        await controller.handleMarkdownFileModified(file);

        assert.equal(processCount, 0);
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
