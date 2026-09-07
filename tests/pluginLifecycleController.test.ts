import * as assert from "node:assert/strict";
import test from "node:test";
import type { TAbstractFile, TFile } from "obsidian";
import { CommentManager, type Comment } from "../src/commentManager";
import {
    FolderRenameError,
    PluginLifecycleController,
} from "../src/app/pluginLifecycleController";
import { AggregateCommentIndex } from "../src/index/AggregateCommentIndex";
import type {
    CommentFileRetarget,
    CommentFileRetargetResult,
} from "../src/domain/comments/folderCommentRetarget";

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
    };
}

function createDeferred<T>() {
    let resolve = (_value: T) => {};
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function createHarness(options: {
    initialComments?: Comment[];
    refreshThrows?: boolean;
    publishedArtifactPaths?: string[];
    getFileByPath?: (filePath: string) => TFile | null;
    loadCommentsForFile?: (file: TFile) => void | Promise<void>;
    renameStoredCommentsInFolder?: (
        retargets: readonly CommentFileRetarget[],
    ) => CommentFileRetargetResult | Promise<CommentFileRetargetResult>;
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
    const refreshCommentViewOptions: Array<{ skipDataRefresh?: boolean } | undefined> = [];
    let refreshEditorDecorationsCount = 0;
    let scheduleAggregateNoteRefreshCount = 0;
    let refreshAggregateNoteNowCount = 0;
    let syncIndexNoteViewClassesCount = 0;
    let modifyHandledPath: string | null = null;
    let detachSidebarViewsCount = 0;
    const renamedAgentRuns: Array<{ previousFilePath: string; nextFilePath: string }> = [];
    const renamedScriptRuns: Array<{ previousFilePath: string; nextFilePath: string }> = [];
    const renamedStoredComments: Array<{ previousFilePath: string; nextFilePath: string }> = [];
    const renamedAgentRunFolders: Array<{ previousFolderPath: string; nextFolderPath: string }> = [];
    const renamedScriptRunFolders: Array<{ previousFolderPath: string; nextFolderPath: string }> = [];
    const renamedStoredCommentFolders: CommentFileRetarget[][] = [];
    const deletedStoredComments: string[] = [];
    const deletedStoredCommentFolders: string[] = [];
    const renamedPublishedArtifactPaths: Array<{ previousFilePath: string; nextFilePath: string }> = [];
    const renamedPublishedArtifactFolders: Array<{ previousFolderPath: string; nextFolderPath: string }> = [];
    const deletedPublishedArtifactPaths: string[] = [];
    const deletedPublishedArtifactFolders: string[] = [];
    const hashedTexts: string[] = [];

    const controller = new PluginLifecycleController({
        app: {
            vault: {
                getAbstractFileByPath: (filePath: string) =>
                    options.getFileByPath
                        ? options.getFileByPath(filePath)
                        : createFile(filePath),
            },
        } as never,
        getCommentManager: () => commentManager,
        getAggregateCommentIndex: () => aggregateCommentIndex,
        renameAgentRuns: async (previousFilePath, nextFilePath) => {
            renamedAgentRuns.push({ previousFilePath, nextFilePath });
            return true;
        },
        renameScriptRuns: async (previousFilePath, nextFilePath) => {
            renamedScriptRuns.push({ previousFilePath, nextFilePath });
            return true;
        },
        renameStoredComments: async (previousFilePath, nextFilePath, retargetOptions) => {
            renamedStoredComments.push({ previousFilePath, nextFilePath });
            commentManager.renameFile(previousFilePath, nextFilePath, retargetOptions);
        },
        renameAgentRunsInFolder: async (previousFolderPath, nextFolderPath) => {
            renamedAgentRunFolders.push({ previousFolderPath, nextFolderPath });
            return true;
        },
        renameScriptRunsInFolder: async (previousFolderPath, nextFolderPath) => {
            renamedScriptRunFolders.push({ previousFolderPath, nextFolderPath });
            return true;
        },
        renameStoredCommentsInFolder: async (retargets) => {
            renamedStoredCommentFolders.push(retargets.map((retarget) => ({
                ...retarget,
                retargetOptions: { ...retarget.retargetOptions },
            })));
            const result = await options.renameStoredCommentsInFolder?.(retargets) ?? {
                successfulRetargets: [...retargets],
                failures: [],
            };
            for (const retarget of result.successfulRetargets) {
                commentManager.renameFile(
                    retarget.previousFilePath,
                    retarget.nextFilePath,
                    retarget.retargetOptions,
                );
            }
            return result;
        },
        deleteStoredComments: async (filePath) => {
            deletedStoredComments.push(filePath);
        },
        deleteStoredCommentsInFolder: async (folderPath) => {
            deletedStoredCommentFolders.push(folderPath);
        },
        renamePublishedPublicArtifactPath: async (previousFilePath, nextFilePath) => {
            renamedPublishedArtifactPaths.push({ previousFilePath, nextFilePath });
        },
        renamePublishedPublicArtifactPathsInFolder: async (previousFolderPath, nextFolderPath) => {
            renamedPublishedArtifactFolders.push({ previousFolderPath, nextFolderPath });
        },
        deletePublishedPublicArtifactPath: async (filePath) => {
            deletedPublishedArtifactPaths.push(filePath);
        },
        deletePublishedPublicArtifactPathsInFolder: async (folderPath) => {
            deletedPublishedArtifactFolders.push(folderPath);
        },
        clearParsedNoteCache: (filePath) => {
            clearedParsedPaths.push(filePath);
        },
        clearDerivedCommentLinksForFile: (filePath) => {
            clearedDerivedPaths.push(filePath);
        },
        isCommentableFile: (file): file is TFile => !!file && (file as { extension?: unknown }).extension === "md",
        isPageNoteCapableFile: (file): file is TFile =>
            !!file && typeof (file as { extension?: unknown }).extension === "string",
        hashText: async (text) => {
            hashedTexts.push(text);
            return `hash:${text}`;
        },
        loadCommentsForFile: async (file) => {
            if (file) {
                loadedFiles.push(file.path);
                await options.loadCommentsForFile?.(file);
            }
        },
        refreshCommentViews: async (refreshOptions) => {
            refreshCommentViewsCount += 1;
            refreshCommentViewOptions.push(refreshOptions);
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
        refreshCommentViewOptions,
        getRefreshEditorDecorationsCount: () => refreshEditorDecorationsCount,
        getRefreshAggregateNoteNowCount: () => refreshAggregateNoteNowCount,
        getScheduleAggregateNoteRefreshCount: () => scheduleAggregateNoteRefreshCount,
        getSyncIndexNoteViewClassesCount: () => syncIndexNoteViewClassesCount,
        getDetachSidebarViewsCount: () => detachSidebarViewsCount,
        getModifyHandledPath: () => modifyHandledPath,
        renamedAgentRuns,
        renamedScriptRuns,
        renamedStoredComments,
        renamedAgentRunFolders,
        renamedScriptRunFolders,
        renamedStoredCommentFolders,
        deletedStoredComments,
        deletedStoredCommentFolders,
        renamedPublishedArtifactPaths,
        renamedPublishedArtifactFolders,
        deletedPublishedArtifactPaths,
        deletedPublishedArtifactFolders,
        hashedTexts,
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

test("plugin lifecycle controller refreshes attachment availability for PNG lifecycle events", async () => {
    const harness = createHarness();

    await harness.controller.handleFileCreate(null);
    assert.equal(harness.getRefreshCommentViewsCount(), 0);

    await harness.controller.handleFileCreate(createFile("assets/image.png"));
    await harness.controller.handleFileRename(createFile("assets/renamed.png"), "assets/image.png");
    await harness.controller.handleFileDelete(createFile("assets/renamed.png"));

    assert.equal(harness.getRefreshCommentViewsCount(), 3);
    assert.deepEqual(harness.refreshCommentViewOptions, [
        { skipDataRefresh: true },
        undefined,
        undefined,
    ]);
});

test("plugin lifecycle controller refreshes attachment availability after metadata resolution", async () => {
    const harness = createHarness();

    await harness.controller.handleMetadataResolved();

    assert.equal(harness.getRefreshCommentViewsCount(), 1);
    assert.deepEqual(harness.refreshCommentViewOptions, [{ skipDataRefresh: true }]);
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
    assert.deepEqual(harness.renamedAgentRuns, [{
        previousFilePath: originalFile.path,
        nextFilePath: renamedFile.path,
    }]);
    assert.deepEqual(harness.renamedScriptRuns, [{
        previousFilePath: originalFile.path,
        nextFilePath: renamedFile.path,
    }]);
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

test("plugin lifecycle controller bulk-retargets a production-shaped renamed folder", async () => {
    const originalFolderPath = "Drafts";
    const renamedFolder = createFolder("Published", [
        createFile("Published/one.md"),
        createFolder("Published/nested", [
            createFile("Published/nested/two.pdf"),
        ]),
    ]);
    const harness = createHarness({
        initialComments: [
            createComment({ id: "one", filePath: "Drafts/one.md" }),
            createComment({
                id: "two",
                filePath: "Drafts/nested/two.pdf",
                anchorKind: "page",
                selectedText: "two",
                selectedTextHash: "hash:two",
            }),
        ],
    });

    await harness.controller.handleFileRename(renamedFolder, originalFolderPath);

    assert.deepEqual(harness.renamedAgentRuns, []);
    assert.deepEqual(harness.renamedScriptRuns, []);
    assert.deepEqual(harness.renamedStoredComments, []);
    assert.deepEqual(harness.renamedPublishedArtifactPaths, []);
    assert.deepEqual(harness.renamedAgentRunFolders, [{
        previousFolderPath: "Drafts",
        nextFolderPath: "Published",
    }]);
    assert.deepEqual(harness.renamedScriptRunFolders, harness.renamedAgentRunFolders);
    assert.deepEqual(harness.renamedPublishedArtifactFolders, harness.renamedAgentRunFolders);
    assert.deepEqual(
        harness.renamedStoredCommentFolders[0]?.map(({ previousFilePath, nextFilePath }) => ({
            previousFilePath,
            nextFilePath,
        })),
        [
            { previousFilePath: "Drafts/one.md", nextFilePath: "Published/one.md" },
            { previousFilePath: "Drafts/nested/two.pdf", nextFilePath: "Published/nested/two.pdf" },
        ],
    );
    assert.equal(harness.commentManager.getCommentById("one")?.filePath, "Published/one.md");
    assert.equal(harness.commentManager.getCommentById("two")?.filePath, "Published/nested/two.pdf");
    assert.equal(harness.aggregateCommentIndex.getCommentById("one")?.filePath, "Published/one.md");
    assert.equal(harness.aggregateCommentIndex.getCommentById("two")?.filePath, "Published/nested/two.pdf");
    assert.equal(harness.getRefreshCommentViewsCount(), 1);
    assert.equal(harness.getRefreshEditorDecorationsCount(), 1);
    assert.equal(harness.getScheduleAggregateNoteRefreshCount(), 1);
});

test("plugin lifecycle controller bounds persisted folder rename calls for many descendants", async () => {
    const fileCount = 200;
    const renamedFolder = createFolder("Published", Array.from(
        { length: fileCount },
        (_value, index) => createFile(`Published/nested-${index}/note-${index}.md`),
    ));
    const harness = createHarness({
        initialComments: Array.from({ length: fileCount }, (_value, index) => createComment({
            id: `comment-${index}`,
            filePath: `Drafts/nested-${index}/note-${index}.md`,
        })),
    });

    await harness.controller.handleFileRename(renamedFolder, "Drafts");

    assert.equal(harness.renamedAgentRunFolders.length, 1);
    assert.equal(harness.renamedScriptRunFolders.length, 1);
    assert.equal(harness.renamedStoredCommentFolders.length, 1);
    assert.equal(harness.renamedPublishedArtifactFolders.length, 1);
    assert.equal(harness.renamedStoredCommentFolders[0]?.length, fileCount);
    assert.deepEqual(harness.renamedAgentRuns, []);
    assert.deepEqual(harness.renamedScriptRuns, []);
    assert.deepEqual(harness.renamedStoredComments, []);
    assert.deepEqual(harness.renamedPublishedArtifactPaths, []);
    assert.equal(harness.loadedFiles.length, 0);
    assert.equal(harness.getRefreshCommentViewsCount(), 1);
    assert.equal(harness.getRefreshEditorDecorationsCount(), 1);
    assert.equal(harness.getScheduleAggregateNoteRefreshCount(), 1);
});

test("plugin lifecycle controller applies later folder retargets after one sidecar failure and can replay", async () => {
    const failure = new Error("middle sidecar failed");
    let attempt = 0;
    const renamedFolder = createFolder("Published", [
        createFile("Published/a.md"),
        createFile("Published/b.md"),
        createFile("Published/c.md"),
    ]);
    const harness = createHarness({
        initialComments: ["a", "b", "c"].map((name) => createComment({
            id: name,
            filePath: `Drafts/${name}.md`,
        })),
        renameStoredCommentsInFolder: (retargets) => {
            attempt += 1;
            if (attempt > 1) {
                return {
                    successfulRetargets: [...retargets],
                    failures: [],
                };
            }

            const failedRetarget = retargets[1];
            return {
                successfulRetargets: retargets.filter((_retarget, index) => index !== 1),
                failures: failedRetarget ? [{ retarget: failedRetarget, error: failure }] : [],
            };
        },
    });

    await assert.rejects(
        harness.controller.handleFileRename(renamedFolder, "Drafts"),
        (error: unknown) => error instanceof FolderRenameError
            && error.errors.includes(failure)
            && error.message.includes("Drafts/b.md"),
    );

    assert.equal(harness.commentManager.getCommentById("a")?.filePath, "Published/a.md");
    assert.equal(harness.commentManager.getCommentById("b")?.filePath, "Drafts/b.md");
    assert.equal(harness.commentManager.getCommentById("c")?.filePath, "Published/c.md");
    assert.equal(harness.aggregateCommentIndex.getCommentById("a")?.filePath, "Published/a.md");
    assert.equal(harness.aggregateCommentIndex.getCommentById("b")?.filePath, "Drafts/b.md");
    assert.equal(harness.aggregateCommentIndex.getCommentById("c")?.filePath, "Published/c.md");
    assert.equal(harness.getRefreshCommentViewsCount(), 1);

    await harness.controller.handleFileRename(renamedFolder, "Drafts");

    assert.equal(harness.commentManager.getCommentById("b")?.filePath, "Published/b.md");
    assert.equal(harness.aggregateCommentIndex.getCommentById("b")?.filePath, "Published/b.md");
    assert.equal(harness.renamedStoredCommentFolders.length, 2);
    assert.equal(harness.getRefreshCommentViewsCount(), 2);
});

test("plugin lifecycle controller awaits live-file hydration before rename replay completes", async () => {
    const hydration = createDeferred<void>();
    const harness = createHarness({
        loadCommentsForFile: () => hydration.promise,
    });
    let renameCompleted = false;

    const rename = harness.controller
        .handleFileRename(createFile("docs/renamed.md"), "docs/original.md")
        .then(() => {
            renameCompleted = true;
        });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(renameCompleted, false);

    hydration.resolve(undefined);
    await rename;
    assert.equal(renameCompleted, true);
});

test("plugin lifecycle controller hydrates only the live target after chained startup renames", async () => {
    const harness = createHarness({
        getFileByPath: (filePath) => filePath === "docs/final.md"
            ? createFile(filePath)
            : null,
    });

    await harness.controller.handleFileRename(
        createFile("docs/intermediate.md"),
        "docs/original.md",
    );
    await harness.controller.handleFileRename(
        createFile("docs/final.md"),
        "docs/intermediate.md",
    );

    assert.deepEqual(harness.loadedFiles, ["docs/final.md"]);
    assert.deepEqual(harness.renamedStoredComments, [
        { previousFilePath: "docs/original.md", nextFilePath: "docs/intermediate.md" },
        { previousFilePath: "docs/intermediate.md", nextFilePath: "docs/final.md" },
    ]);
});

test("plugin lifecycle controller forwards one consistent retarget context to manager and aggregate index", async () => {
    const originalFile = createFile("docs/source.md");
    const renamedFile = createFile("docs/Final Proposal.docx");
    const harness = createHarness({
        initialComments: [createComment({
            filePath: originalFile.path,
            selectedText: "source selection",
            selectedTextHash: "hash:source selection",
            anchorKind: "selection",
            orphaned: true,
        })],
    });

    await harness.controller.handleFileRename(renamedFile, originalFile.path);

    const managerComment = harness.commentManager.getCommentById("comment-1");
    const indexComment = harness.aggregateCommentIndex.getCommentById("comment-1");
    assert.deepEqual(harness.hashedTexts, ["Final Proposal"]);
    assert.deepEqual({
        filePath: managerComment?.filePath,
        selectedText: managerComment?.selectedText,
        selectedTextHash: managerComment?.selectedTextHash,
        anchorKind: managerComment?.anchorKind,
        orphaned: managerComment?.orphaned,
    }, {
        filePath: renamedFile.path,
        selectedText: "Final Proposal",
        selectedTextHash: "hash:Final Proposal",
        anchorKind: "page",
        orphaned: false,
    });
    assert.deepEqual(indexComment, managerComment);
});

for (const { kind, originalPath, renamedPath, selectedText } of [
    { kind: "PDF", originalPath: "docs/file.pdf", renamedPath: "docs/renamed.pdf", selectedText: "file" },
    { kind: "DOCX", originalPath: "docs/proposal.docx", renamedPath: "docs/renamed-proposal.docx", selectedText: "proposal" },
]) {
    test(`plugin lifecycle controller keeps renamed ${kind} page-note files and indexes aligned`, async () => {
        const originalFile = createFile(originalPath);
        const renamedFile = createFile(renamedPath);
        const harness = createHarness({
            initialComments: [
                createComment({
                    filePath: originalFile.path,
                    anchorKind: "page",
                    selectedText,
                    selectedTextHash: `hash:${selectedText}`,
                }),
            ],
        });

        await harness.controller.handleFileRename(renamedFile, originalFile.path);

        assert.equal(harness.commentManager.getCommentById("comment-1")?.filePath, renamedFile.path);
        assert.equal(harness.aggregateCommentIndex.getCommentById("comment-1")?.filePath, renamedFile.path);
        assert.deepEqual(harness.renamedAgentRuns, [{
            previousFilePath: originalFile.path,
            nextFilePath: renamedFile.path,
        }]);
        assert.deepEqual(harness.renamedScriptRuns, [{
            previousFilePath: originalFile.path,
            nextFilePath: renamedFile.path,
        }]);
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
}

test("plugin lifecycle controller retargets published standalone artifacts on file rename", async () => {
    const originalFile = createFile("public/page.html");
    const renamedFile = createFile("public/renamed.html");
    const harness = createHarness();

    await harness.controller.handleFileRename(renamedFile, originalFile.path);

    assert.deepEqual(harness.renamedPublishedArtifactPaths, [{
        previousFilePath: originalFile.path,
        nextFilePath: renamedFile.path,
    }]);
});

test("plugin lifecycle controller clears a deleted Markdown comment file", async () => {
    const deletedFile = createFile("docs/file.md");
    const harness = createHarness({
        initialComments: [createComment({ filePath: deletedFile.path })],
    });

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

for (const { kind, path, selectedText } of [
    { kind: "PDF", path: "docs/file.pdf", selectedText: "file" },
    { kind: "DOCX", path: "docs/proposal.docx", selectedText: "proposal" },
]) {
    test(`plugin lifecycle controller clears deleted ${kind} page-note files`, async () => {
        const deletedFile = createFile(path);
        const harness = createHarness({
            initialComments: [
                createComment({
                    filePath: deletedFile.path,
                    anchorKind: "page",
                    selectedText,
                    selectedTextHash: `hash:${selectedText}`,
                }),
            ],
        });

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
}

test("plugin lifecycle controller prunes published standalone artifacts on file delete", async () => {
    const deletedFile = createFile("public/page.html");
    const harness = createHarness();

    await harness.controller.handleFileDelete(deletedFile);

    assert.deepEqual(harness.deletedPublishedArtifactPaths, [deletedFile.path]);
});

test("plugin lifecycle controller clears cached comments under deleted folders", async () => {
    const harness = createHarness({
        initialComments: [
            createComment({ filePath: "Deleted/a.md", id: "deleted-a" }),
            createComment({ filePath: "Deleted/nested/b.md", id: "deleted-b" }),
            createComment({
                filePath: "Deleted/c.pdf",
                id: "deleted-c",
                anchorKind: "page",
                selectedText: "c",
                selectedTextHash: "hash:c",
            }),
            createComment({
                filePath: "Deleted/nested/image.png",
                id: "deleted-image",
                anchorKind: "page",
                selectedText: "image",
                selectedTextHash: "hash:image",
            }),
            createComment({
                filePath: "Deleted/nested/proposal.docx",
                id: "deleted-docx",
                anchorKind: "page",
                selectedText: "proposal",
                selectedTextHash: "hash:proposal",
            }),
            createComment({ filePath: "Deletedness/c.md", id: "keep-c" }),
        ],
    });

    await harness.controller.handleFileDelete(createFolder("Deleted", [
        createFile("Deleted/a.md"),
        createFolder("Deleted/nested", [
            createFile("Deleted/nested/b.md"),
            createFile("Deleted/nested/image.png"),
            createFile("Deleted/nested/proposal.docx"),
        ]),
        createFile("Deleted/c.pdf"),
    ]));

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
    assert.deepEqual(harness.clearedParsedPaths.sort(), [
        "Deleted/a.md",
        "Deleted/c.pdf",
        "Deleted/nested/b.md",
        "Deleted/nested/image.png",
        "Deleted/nested/proposal.docx",
    ]);
    assert.deepEqual(harness.clearedDerivedPaths.sort(), [
        "Deleted/a.md",
        "Deleted/c.pdf",
        "Deleted/nested/b.md",
        "Deleted/nested/image.png",
        "Deleted/nested/proposal.docx",
    ]);
    assert.equal(harness.getRefreshCommentViewsCount(), 1);
    assert.equal(harness.getRefreshEditorDecorationsCount(), 1);
    assert.equal(harness.getRefreshAggregateNoteNowCount(), 1);
});

test("plugin lifecycle controller prunes published standalone artifacts under deleted folders", async () => {
    const harness = createHarness();

    await harness.controller.handleFileDelete(createFolder("public", [
        createFile("public/page.html"),
    ]));

    assert.deepEqual(harness.deletedPublishedArtifactFolders, ["public"]);
});

test("plugin lifecycle controller only forwards markdown modify events", async () => {
    const harness = createHarness();

    await harness.controller.handleFileModify(createFile("docs/file.pdf"));
    assert.equal(harness.getModifyHandledPath(), null);

    await harness.controller.handleFileModify(createFile("docs/image.png"));
    assert.equal(harness.getModifyHandledPath(), null);

    await harness.controller.handleFileModify(createFile("docs/proposal.docx"));
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
