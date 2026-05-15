import * as assert from "node:assert/strict";
import test from "node:test";
import type { TAbstractFile, TFile } from "obsidian";
import { CommentManager, type Comment } from "../src/commentManager";
import { PluginLifecycleController } from "../src/app/pluginLifecycleController";
import { AggregateCommentIndex } from "../src/index/AggregateCommentIndex";

function createFile(path: string): TFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
        extension: path.split(".").pop() ?? "",
    } as TFile;
}

function createFolder(path: string, children: TAbstractFile[] = []): TAbstractFile {
    return {
        path,
        name: path.split("/").pop() ?? path,
        children,
    } as unknown as TAbstractFile;
}

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "docs/file.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 4,
        selectedText: overrides.selectedText ?? "text",
        selectedTextHash: overrides.selectedTextHash ?? "hash:text",
        comment: overrides.comment ?? "body",
        timestamp: overrides.timestamp ?? 1,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
    };
}

function createHarness(options: {
    initialComments?: Comment[];
    refreshThrows?: boolean;
} = {}) {
    const commentManager = new CommentManager(options.initialComments ?? []);
    const aggregateCommentIndex = new AggregateCommentIndex();
    const commentsByFile = new Map<string, Comment[]>();
    for (const comment of options.initialComments ?? []) {
        const commentsForFile = commentsByFile.get(comment.filePath) ?? [];
        commentsForFile.push(comment);
        commentsByFile.set(comment.filePath, commentsForFile);
    }
    for (const [filePath, comments] of commentsByFile.entries()) {
        aggregateCommentIndex.updateFile(filePath, comments);
    }

    const clearedParsedPaths: string[] = [];
    const clearedDerivedPaths: string[] = [];
    const loadedFiles: string[] = [];
    const warnings: Array<{ message: string; error: unknown }> = [];
    const scheduledTimers = new Map<number, () => void>();
    const clearedTimers: number[] = [];
    let nextTimerId = 1;
    let refreshCommentViewsCount = 0;
    let refreshEditorDecorationsCount = 0;
    let scheduleAggregateNoteRefreshCount = 0;
    let refreshAggregateNoteNowCount = 0;
    let syncIndexNoteViewClassesCount = 0;
    let modifyHandledPath: string | null = null;
    let detachSidebarViewsCount = 0;
    const renamedStoredComments: Array<{ previousFilePath: string; nextFilePath: string }> = [];
    const deletedStoredComments: string[] = [];
    const deletedStoredCommentFolders: string[] = [];

    const controller = new PluginLifecycleController({
        app: {} as never,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        renameStoredComments: async (previousFilePath, nextFilePath) => {
            renamedStoredComments.push({ previousFilePath, nextFilePath });
        },
        deleteStoredComments: async (filePath) => {
            deletedStoredComments.push(filePath);
        },
        deleteStoredCommentsInFolder: async (folderPath) => {
            deletedStoredCommentFolders.push(folderPath);
        },
        clearParsedNoteCache: (filePath) => {
            clearedParsedPaths.push(filePath);
        },
        clearDerivedCommentLinksForFile: (filePath) => {
            clearedDerivedPaths.push(filePath);
        },
        isCommentableFile: (file): file is TFile => !!file && (file as { extension?: unknown }).extension === "md",
        loadCommentsForFile: async (file) => {
            if (file) {
                loadedFiles.push(file.path);
            }
        },
        refreshCommentViews: async () => {
            refreshCommentViewsCount += 1;
        },
        refreshEditorDecorations: () => {
            if (options.refreshThrows) {
                throw new Error("boom");
            }

            refreshEditorDecorationsCount += 1;
        },
        refreshAggregateNoteNow: async () => {
            refreshAggregateNoteNowCount += 1;
        },
        scheduleAggregateNoteRefresh: () => {
            scheduleAggregateNoteRefreshCount += 1;
        },
        syncIndexNoteViewClasses: () => {
            syncIndexNoteViewClassesCount += 1;
        },
        handleMarkdownFileModified: async (file) => {
            modifyHandledPath = file.path;
        },
        detachSidebarViews: () => {
            detachSidebarViewsCount += 1;
        },
        scheduleTimer: (callback, _ms) => {
            const timerId = nextTimerId;
            nextTimerId += 1;
            scheduledTimers.set(timerId, callback);
            return timerId;
        },
        clearTimer: (timerId) => {
            clearedTimers.push(timerId);
            scheduledTimers.delete(timerId);
        },
        warn: (message, error) => {
            warnings.push({ message, error });
        },
    });

    return {
        controller,
        commentManager,
        aggregateCommentIndex,
        clearedParsedPaths,
        clearedDerivedPaths,
        loadedFiles,
        warnings,
        getScheduledTimerIds: () => Array.from(scheduledTimers.keys()),
        runTimer: (timerId: number) => scheduledTimers.get(timerId)?.(),
        clearedTimers,
        getRefreshCommentViewsCount: () => refreshCommentViewsCount,
        getRefreshEditorDecorationsCount: () => refreshEditorDecorationsCount,
        getRefreshAggregateNoteNowCount: () => refreshAggregateNoteNowCount,
        getScheduleAggregateNoteRefreshCount: () => scheduleAggregateNoteRefreshCount,
        getSyncIndexNoteViewClassesCount: () => syncIndexNoteViewClassesCount,
        getDetachSidebarViewsCount: () => detachSidebarViewsCount,
        getModifyHandledPath: () => modifyHandledPath,
        renamedStoredComments,
        deletedStoredComments,
        deletedStoredCommentFolders,
    };
}

test("plugin lifecycle controller handles layout ready without eager comment hydration", async () => {
    const harness = createHarness();

    await harness.controller.handleLayoutReady();

    assert.equal(harness.getRefreshCommentViewsCount(), 0);
    assert.equal(harness.getRefreshEditorDecorationsCount(), 0);
    assert.equal(harness.getScheduleAggregateNoteRefreshCount(), 0);
    assert.equal(harness.getSyncIndexNoteViewClassesCount(), 1);
});

test("plugin lifecycle controller keeps renamed comment files and indexes aligned", async () => {
    const originalFile = createFile("docs/file.md");
    const renamedFile = createFile("docs/renamed.md");
    const harness = createHarness({
        initialComments: [createComment({ filePath: originalFile.path })],
    });

    await harness.controller.handleFileRename(renamedFile, originalFile.path);

    assert.equal(harness.commentManager.getCommentById("comment-1")?.filePath, renamedFile.path);
    assert.equal(harness.aggregateCommentIndex.getCommentById("comment-1")?.filePath, renamedFile.path);
    assert.deepEqual(harness.renamedStoredComments, [{
        previousFilePath: originalFile.path,
        nextFilePath: renamedFile.path,
    }]);
    assert.deepEqual(harness.clearedParsedPaths, [originalFile.path, renamedFile.path]);
    assert.deepEqual(harness.clearedDerivedPaths, [originalFile.path]);
    assert.deepEqual(harness.loadedFiles, [renamedFile.path]);
    assert.equal(harness.getRefreshCommentViewsCount(), 1);
    assert.equal(harness.getRefreshEditorDecorationsCount(), 1);
    assert.equal(harness.getScheduleAggregateNoteRefreshCount(), 1);
});

test("plugin lifecycle controller clears deleted comment files only when commentable", async () => {
    const deletedFile = createFile("docs/file.md");
    const harness = createHarness({
        initialComments: [createComment({ filePath: deletedFile.path })],
    });

    await harness.controller.handleFileDelete(createFile("docs/ignored.png"));
    await harness.controller.handleFileDelete(deletedFile);

    assert.deepEqual(harness.commentManager.getCommentsForFile(deletedFile.path), []);
    assert.deepEqual(
        harness.aggregateCommentIndex.getAllComments().filter((comment) => comment.filePath === deletedFile.path),
        [],
    );
    assert.deepEqual(harness.deletedStoredComments, [deletedFile.path]);
    assert.deepEqual(harness.clearedParsedPaths, [deletedFile.path]);
    assert.deepEqual(harness.clearedDerivedPaths, [deletedFile.path]);
    assert.equal(harness.getRefreshCommentViewsCount(), 1);
    assert.equal(harness.getRefreshEditorDecorationsCount(), 1);
    assert.equal(harness.getRefreshAggregateNoteNowCount(), 1);
    assert.equal(harness.getScheduleAggregateNoteRefreshCount(), 0);
});

test("plugin lifecycle controller clears cached comments under deleted folders", async () => {
    const deletedFolder = createFolder("Deleted");
    const harness = createHarness({
        initialComments: [
            createComment({ filePath: "Deleted/a.md", id: "deleted-a" }),
            createComment({ filePath: "Deleted/nested/b.md", id: "deleted-b" }),
            createComment({ filePath: "Deletedness/c.md", id: "keep-c" }),
        ],
    });

    await harness.controller.handleFileDelete(deletedFolder);

    assert.deepEqual(
        harness.commentManager.getAllComments().map((comment) => comment.id).sort(),
        ["keep-c"],
    );
    assert.deepEqual(
        harness.aggregateCommentIndex.getAllComments().map((comment) => comment.id).sort(),
        ["keep-c"],
    );
    assert.deepEqual(harness.deletedStoredComments, []);
    assert.deepEqual(harness.deletedStoredCommentFolders, ["Deleted"]);
    assert.equal(harness.getRefreshCommentViewsCount(), 1);
    assert.equal(harness.getRefreshEditorDecorationsCount(), 1);
    assert.equal(harness.getRefreshAggregateNoteNowCount(), 1);
});

test("plugin lifecycle controller only forwards markdown modify events", async () => {
    const harness = createHarness();

    await harness.controller.handleFileModify(createFile("docs/file.pdf"));
    assert.equal(harness.getModifyHandledPath(), null);

    await harness.controller.handleFileModify(createFile("docs/file.md"));
    assert.equal(harness.getModifyHandledPath(), "docs/file.md");
});

test("plugin lifecycle controller debounces editor refreshes and reports refresh errors", () => {
    const harness = createHarness({ refreshThrows: true });

    harness.controller.handleEditorChange("docs/file.md");
    const firstTimerId = harness.getScheduledTimerIds()[0];
    harness.controller.handleEditorChange("docs/file.md");
    const secondTimerId = harness.getScheduledTimerIds()[0];

    assert.notEqual(firstTimerId, secondTimerId);
    assert.deepEqual(harness.clearedTimers, [firstTimerId]);

    harness.runTimer(secondTimerId);

    assert.equal(harness.getRefreshEditorDecorationsCount(), 0);
    assert.equal(harness.warnings.length, 1);
    assert.equal(harness.warnings[0].message, "Failed to refresh decorations on editor-change");
});

test("plugin lifecycle controller unload clears timers and detaches stale sidebar views", () => {
    const harness = createHarness();

    harness.controller.handleEditorChange("docs/file.md");
    const timerId = harness.getScheduledTimerIds()[0];

    harness.controller.handleUnload();

    assert.deepEqual(harness.clearedTimers, [timerId]);
    assert.deepEqual(harness.getScheduledTimerIds(), []);
    assert.equal(harness.getDetachSidebarViewsCount(), 1);
});
