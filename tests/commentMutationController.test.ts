import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import { CommentManager, type Comment } from "../src/commentManager";
import {
    CommentMutationController,
    type CommentMutationHost,
} from "../src/control/commentMutationController";
import type { SavedUserEntryEvent } from "../src/control/commentAgentController";
import type { DraftComment, DraftSelection } from "../src/domain/drafts";

function createFile(path: string): TFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
        extension: path.split(".").pop() ?? "",
    } as TFile;
}

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "Folder/Note.md",
        startLine: overrides.startLine ?? 2,
        startChar: overrides.startChar ?? 4,
        endLine: overrides.endLine ?? 2,
        endChar: overrides.endChar ?? 8,
        selectedText: overrides.selectedText ?? "beta",
        selectedTextHash: overrides.selectedTextHash ?? "hash:beta",
        comment: overrides.comment ?? "Original comment",
        timestamp: overrides.timestamp ?? 123,
        anchorKind: overrides.anchorKind ?? "selection",
        isBookmark: overrides.isBookmark ?? false,
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
        ...(overrides.deletedAt !== undefined ? { deletedAt: overrides.deletedAt } : {}),
    };
}

function toDraft(comment: Comment, overrides: Partial<DraftComment> = {}): DraftComment {
    return {
        ...comment,
        ...overrides,
        mode: overrides.mode ?? "new",
        comment: overrides.comment ?? comment.comment,
    };
}

function createHost(options: {
    draftComment?: DraftComment | null;
    sidebarTargetFilePath?: string | null;
    knownComments?: Comment[];
    loadedComments?: Comment[];
    extraFiles?: string[];
    currentNoteContentByPath?: Record<string, string>;
    getCurrentNoteContent?: (file: TFile) => Promise<string>;
    currentSelectionByPath?: Record<string, DraftSelection | null>;
    persistCommentsForFile?: (file: TFile, options?: {
        immediateAggregateRefresh?: boolean;
        skipCommentViewRefresh?: boolean;
        refreshEditorDecorations?: boolean;
        refreshMarkdownPreviews?: boolean;
    }) => Promise<void> | void;
    now?: number;
    showResolvedComments?: boolean;
    handleSavedUserEntry?: (event: SavedUserEntryEvent) => Promise<void> | void;
} = {}) {
    const manager = new CommentManager(options.loadedComments ?? options.knownComments ?? []);
    let draftComment = options.draftComment ?? null;
    let draftHostFilePath: string | null = draftComment?.filePath ?? null;
    let savingDraftCommentId: string | null = null;
    let showResolvedComments = options.showResolvedComments ?? false;
    const notices: string[] = [];
    const loadedFiles: string[] = [];
    const persistedFiles: Array<{
        path: string;
        immediateAggregateRefresh?: boolean;
        skipCommentViewRefresh?: boolean;
        refreshEditorDecorations?: boolean;
        refreshMarkdownPreviews?: boolean;
    }> = [];
    const highlightedCommentIds: string[] = [];
    const openedMoveTargetFiles: string[] = [];
    const setDraftCalls: Array<{
        draftComment: DraftComment | null;
        hostFilePath?: string | null;
        skipCommentViewRefresh?: boolean;
    }> = [];
    const setShowResolvedCalls: Array<{
        showResolved: boolean;
        skipCommentViewRefresh?: boolean;
        deferAggregateRefresh?: boolean;
    }> = [];
    const savedUserEntryEvents: SavedUserEntryEvent[] = [];
    let refreshCommentViewsCount = 0;
    let refreshEditorDecorationsCount = 0;

    const filesByPath = new Map<string, TFile>();
    for (const comment of options.knownComments ?? options.loadedComments ?? []) {
        filesByPath.set(comment.filePath, createFile(comment.filePath));
    }
    for (const filePath of options.extraFiles ?? []) {
        filesByPath.set(filePath, createFile(filePath));
    }
    for (const filePath of Object.keys(options.currentNoteContentByPath ?? {})) {
        filesByPath.set(filePath, createFile(filePath));
    }
    for (const filePath of Object.keys(options.currentSelectionByPath ?? {})) {
        filesByPath.set(filePath, createFile(filePath));
    }
    if (options.sidebarTargetFilePath) {
        filesByPath.set(options.sidebarTargetFilePath, createFile(options.sidebarTargetFilePath));
    }

    const knownCommentsById = new Map((options.knownComments ?? options.loadedComments ?? []).map((comment) => [comment.id, comment]));

    const host: CommentMutationHost = {
        getAllCommentsNotePath: () => "SideNote2 index.md",
        getSidebarTargetFilePath: () => options.sidebarTargetFilePath ?? null,
        getDraftComment: () => draftComment,
        getSavingDraftCommentId: () => savingDraftCommentId,
        shouldShowResolvedComments: () => showResolvedComments,
        setShowResolvedComments: async (nextShowResolved, setShowResolvedOptions) => {
            setShowResolvedCalls.push({
                showResolved: nextShowResolved,
                ...(setShowResolvedOptions?.skipCommentViewRefresh !== undefined
                    ? { skipCommentViewRefresh: setShowResolvedOptions.skipCommentViewRefresh }
                    : {}),
                ...(setShowResolvedOptions?.deferAggregateRefresh !== undefined
                    ? { deferAggregateRefresh: setShowResolvedOptions.deferAggregateRefresh }
                    : {}),
            });
            if (showResolvedComments === nextShowResolved) {
                return false;
            }

            showResolvedComments = nextShowResolved;
            return true;
        },
        setDraftComment: async (nextDraftComment, hostFilePath, setDraftOptions) => {
            draftComment = nextDraftComment;
            draftHostFilePath = nextDraftComment ? (hostFilePath ?? nextDraftComment.filePath) : null;
            setDraftCalls.push({
                draftComment: nextDraftComment,
                hostFilePath,
                skipCommentViewRefresh: setDraftOptions?.skipCommentViewRefresh,
            });
        },
        setDraftCommentValue: (nextDraftComment) => {
            draftComment = nextDraftComment;
        },
        clearDraftState: () => {
            draftComment = null;
            draftHostFilePath = null;
        },
        setSavingDraftCommentId: (commentId) => {
            savingDraftCommentId = commentId;
        },
        refreshCommentViews: async () => {
            refreshCommentViewsCount += 1;
        },
        refreshEditorDecorations: () => {
            refreshEditorDecorationsCount += 1;
        },
        getKnownCommentById: (commentId) => manager.getCommentById(commentId) ?? knownCommentsById.get(commentId) ?? null,
        getLoadedCommentById: (commentId) => manager.getCommentById(commentId) ?? null,
        getFileByPath: (filePath) => filesByPath.get(filePath) ?? null,
        getCurrentNoteContent: async (file) => options.getCurrentNoteContent
            ? options.getCurrentNoteContent(file)
            : options.currentNoteContentByPath?.[file.path] ?? "",
        getCurrentSelectionForFile: (file) => options.currentSelectionByPath?.[file.path] ?? null,
        isCommentableFile: (file): file is TFile => !!file && file.extension === "md",
        loadCommentsForFile: async (file) => {
            loadedFiles.push(file.path);
        },
        persistCommentsForFile: async (file, persistOptions) => {
            persistedFiles.push({
                path: file.path,
                ...(persistOptions?.immediateAggregateRefresh !== undefined
                    ? { immediateAggregateRefresh: persistOptions.immediateAggregateRefresh }
                    : {}),
                ...(persistOptions?.skipCommentViewRefresh !== undefined
                    ? { skipCommentViewRefresh: persistOptions.skipCommentViewRefresh }
                    : {}),
                ...(persistOptions?.refreshEditorDecorations !== undefined
                    ? { refreshEditorDecorations: persistOptions.refreshEditorDecorations }
                    : {}),
                ...(persistOptions?.refreshMarkdownPreviews !== undefined
                    ? { refreshMarkdownPreviews: persistOptions.refreshMarkdownPreviews }
                    : {}),
            });
            await options.persistCommentsForFile?.(file, persistOptions);
        },
        getCommentManager: () => manager,
        activateViewAndHighlightComment: async (commentId) => {
            highlightedCommentIds.push(commentId);
        },
        openMoveTargetFile: async (file) => {
            openedMoveTargetFiles.push(file.path);
        },
        hashText: async (text) => `hash:${text}`,
        showNotice: (message) => {
            notices.push(message);
        },
        now: () => options.now ?? 1_000,
        handleSavedUserEntry: async (event) => {
            savedUserEntryEvents.push(event);
            await options.handleSavedUserEntry?.(event);
        },
    };

    return {
        controller: new CommentMutationController(host),
        manager,
        notices,
        loadedFiles,
        persistedFiles,
        highlightedCommentIds,
        openedMoveTargetFiles,
        setShowResolvedCalls,
        setDraftCalls,
        savedUserEntryEvents,
        getDraftComment: () => draftComment,
        getDraftHostFilePath: () => draftHostFilePath,
        getSavingDraftCommentId: () => savingDraftCommentId,
        getShowResolvedComments: () => showResolvedComments,
        getRefreshCommentViewsCount: () => refreshCommentViewsCount,
        getRefreshEditorDecorationsCount: () => refreshEditorDecorationsCount,
    };
}

test("comment mutation controller starts an edit draft from an already loaded local comment without reloading the file", async () => {
    const comment = createComment({ comment: "Existing note" });
    const host = createHost({
        knownComments: [comment],
        loadedComments: [comment],
        sidebarTargetFilePath: "SideNote2 index.md",
    });

    const started = await host.controller.startEditDraft(comment.id);

    assert.equal(started, true);
    assert.deepEqual(host.loadedFiles, []);
    assert.deepEqual(host.highlightedCommentIds, [comment.id]);
    assert.equal(host.setDraftCalls.length, 1);
    assert.equal(host.setDraftCalls[0].skipCommentViewRefresh, true);
    assert.equal(host.getDraftHostFilePath(), "SideNote2 index.md");
    assert.deepEqual(host.getDraftComment(), {
        ...comment,
        entryCount: 1,
        mode: "edit",
        threadId: comment.id,
    });
});

test("comment mutation controller reloads the file when the target comment is only known from aggregate state", async () => {
    const comment = createComment({ comment: "Known from index" });
    const host = createHost({
        knownComments: [comment],
        loadedComments: [],
    });

    const started = await host.controller.startEditDraft(comment.id);

    assert.equal(started, false);
    assert.deepEqual(host.loadedFiles, [comment.filePath]);
    assert.deepEqual(host.notices, ["Unable to find that side note."]);
});

test("comment mutation controller saves a new draft by trimming and persisting it", async () => {
    const draft = toDraft(createComment({
        id: "draft-1",
        comment: "  Ship it  ",
    }));
    const host = createHost({
        draftComment: draft,
        knownComments: [draft],
        loadedComments: [],
        currentNoteContentByPath: {
            [draft.filePath]: "# Title\n\nAlpha beta gamma.\n",
        },
    });

    await host.controller.saveDraft(draft.id);

    assert.equal(host.manager.getAllComments().length, 1);
    assert.equal(host.manager.getAllComments()[0].comment, "Ship it");
    assert.deepEqual(host.persistedFiles, [{
        path: draft.filePath,
        immediateAggregateRefresh: false,
        skipCommentViewRefresh: true,
    }]);
    assert.equal(host.getDraftComment(), null);
    assert.equal(host.getSavingDraftCommentId(), null);
    assert.equal(host.getRefreshCommentViewsCount(), 1);
    assert.equal(host.getRefreshEditorDecorationsCount(), 1);
    assert.deepEqual(host.notices, []);
});

test("comment mutation controller hashes draft selections lazily during save", async () => {
    const draft = toDraft(createComment({
        id: "draft-lazy-hash-1",
        comment: "Ship it",
    }), {
        selectedTextHash: "",
    });
    const host = createHost({
        draftComment: draft,
        currentNoteContentByPath: {
            [draft.filePath]: "# Title\n\nAlpha beta gamma.\n",
        },
    });

    await host.controller.saveDraft(draft.id);

    assert.equal(host.manager.getAllComments().length, 1);
    assert.equal(host.manager.getAllComments()[0].selectedTextHash, "hash:beta");
    assert.deepEqual(host.notices, []);
});

test("comment mutation controller saves an empty bookmarked draft without requiring body text", async () => {
    const draft = toDraft(createComment({
        id: "draft-bookmark-1",
        comment: "   ",
        isBookmark: true,
    }), {
        isBookmark: true,
    });
    const host = createHost({
        draftComment: draft,
        knownComments: [draft],
        loadedComments: [],
        currentNoteContentByPath: {
            [draft.filePath]: "# Title\n\nAlpha beta gamma.\n",
        },
    });

    await host.controller.saveDraft(draft.id);

    assert.equal(host.manager.getAllComments().length, 1);
    assert.equal(host.manager.getAllComments()[0].comment, "");
    assert.equal(host.manager.getAllComments()[0].isBookmark, true);
    assert.deepEqual(host.savedUserEntryEvents, []);
    assert.deepEqual(host.persistedFiles, [{
        path: draft.filePath,
        immediateAggregateRefresh: false,
        skipCommentViewRefresh: true,
    }]);
    assert.equal(host.getDraftComment(), null);
    assert.deepEqual(host.notices, []);
});

test("comment mutation controller still rejects empty non-bookmark drafts", async () => {
    const draft = toDraft(createComment({
        id: "draft-empty-1",
        comment: "   ",
        isBookmark: false,
    }));
    const host = createHost({
        draftComment: draft,
        knownComments: [draft],
        loadedComments: [],
        currentNoteContentByPath: {
            [draft.filePath]: "# Title\n\nAlpha beta gamma.\n",
        },
    });

    await host.controller.saveDraft(draft.id);

    assert.equal(host.manager.getAllComments().length, 0);
    assert.equal(host.getDraftComment()?.id, draft.id);
    assert.deepEqual(host.persistedFiles, []);
    assert.deepEqual(host.notices, []);
});

test("comment mutation controller can skip the pre-save rerender for quick draft saves", async () => {
    const draft = toDraft(createComment({
        id: "draft-1",
        comment: "  Ship it  ",
    }));
    const host = createHost({
        draftComment: draft,
        knownComments: [draft],
        loadedComments: [],
        currentNoteContentByPath: {
            [draft.filePath]: "# Title\n\nAlpha beta gamma.\n",
        },
    });

    await host.controller.saveDraft(draft.id, { skipPreSaveRefresh: true });

    assert.equal(host.manager.getAllComments().length, 1);
    assert.equal(host.manager.getAllComments()[0].comment, "Ship it");
    assert.equal(host.getDraftComment(), null);
    assert.equal(host.getSavingDraftCommentId(), null);
    assert.equal(host.getRefreshCommentViewsCount(), 1);
    assert.equal(host.getRefreshEditorDecorationsCount(), 1);
    assert.deepEqual(host.notices, []);
});

test("comment mutation controller can skip anchor revalidation for quick bookmark saves", async () => {
    const draft = toDraft(createComment({
        id: "draft-bookmark-fast-1",
        comment: "  ",
        isBookmark: true,
        selectedText: "beta",
        startLine: 2,
        startChar: 6,
        endLine: 2,
        endChar: 10,
    }), {
        isBookmark: true,
    });
    let getCurrentNoteContentCalled = false;
    const host = createHost({
        draftComment: draft,
        knownComments: [draft],
        loadedComments: [],
        getCurrentNoteContent: async () => {
            getCurrentNoteContentCalled = true;
            return "# Title\n\nAlpha beta gamma.\n";
        },
    });

    await host.controller.saveDraft(draft.id, {
        skipPreSaveRefresh: true,
        skipAnchorRevalidation: true,
        deferAggregateRefresh: true,
        skipPersistedViewRefresh: true,
    });

    assert.equal(getCurrentNoteContentCalled, false);
    assert.equal(host.manager.getAllComments().length, 1);
    assert.equal(host.manager.getAllComments()[0].isBookmark, true);
    assert.equal(host.getDraftComment(), null);
    assert.deepEqual(host.persistedFiles, [{
        path: draft.filePath,
        immediateAggregateRefresh: false,
        skipCommentViewRefresh: true,
    }]);
    assert.deepEqual(host.notices, []);
});

test("comment mutation controller dispatches saved new entries to the agent hook after persistence", async () => {
    const draft = toDraft(createComment({
        id: "draft-agent-1",
        comment: "@codex fix the parser",
    }));
    const host = createHost({
        draftComment: draft,
        knownComments: [draft],
        currentNoteContentByPath: {
            [draft.filePath]: "# Title\n\nAlpha beta gamma.\n",
        },
    });

    await host.controller.saveDraft(draft.id);

    assert.deepEqual(host.savedUserEntryEvents, [{
        threadId: draft.id,
        entryId: draft.id,
        filePath: draft.filePath,
        body: "@codex fix the parser",
    }]);
});

test("comment mutation controller closes a saved draft before a slow agent dispatch finishes", async () => {
    const draft = toDraft(createComment({
        id: "draft-agent-slow-1",
        comment: "@codex fix the parser",
    }));
    let releaseDispatch!: () => void;
    let dispatchResolved = false;
    const dispatchPromise = new Promise<void>((resolve) => {
        releaseDispatch = () => {
            dispatchResolved = true;
            resolve();
        };
    });
    const host = createHost({
        draftComment: draft,
        knownComments: [draft],
        currentNoteContentByPath: {
            [draft.filePath]: "# Title\n\nAlpha beta gamma.\n",
        },
        handleSavedUserEntry: async () => dispatchPromise,
    });

    await host.controller.saveDraft(draft.id);

    assert.equal(dispatchResolved, false);
    assert.equal(host.getDraftComment(), null);
    assert.equal(host.getSavingDraftCommentId(), null);
    assert.equal(host.getRefreshCommentViewsCount(), 1);
    assert.equal(host.getRefreshEditorDecorationsCount(), 1);
    assert.deepEqual(host.savedUserEntryEvents, [{
        threadId: draft.id,
        entryId: draft.id,
        filePath: draft.filePath,
        body: "@codex fix the parser",
    }]);

    releaseDispatch();
    await dispatchPromise;
});

test("comment mutation controller dispatches saved append entries to the agent hook after persistence", async () => {
    const existing = createComment({ id: "thread-1", comment: "Original" });
    const draft: DraftComment = {
        ...toDraft(existing, {
            id: "entry-2",
            comment: "@codex explain this",
            mode: "append",
        }),
        threadId: existing.id,
    };
    const host = createHost({
        draftComment: draft,
        knownComments: [existing],
        loadedComments: [existing],
    });

    await host.controller.saveDraft(draft.id);

    assert.deepEqual(host.savedUserEntryEvents, [{
        threadId: existing.id,
        entryId: draft.id,
        filePath: draft.filePath,
        body: "@codex explain this",
    }]);
});

test("comment mutation controller inserts child-targeted append drafts after the clicked child entry", async () => {
    const existing = createComment({ id: "thread-1", comment: "Original" });
    const draft: DraftComment = {
        ...toDraft(existing, {
            comment: "Inserted after child",
            mode: "append",
        }),
        id: "entry-4",
        threadId: existing.id,
        appendAfterCommentId: "entry-2",
    };
    const host = createHost({
        draftComment: draft,
        knownComments: [existing],
        loadedComments: [existing],
    });
    host.manager.appendEntry(existing.id, {
        id: "entry-2",
        body: "First child",
        timestamp: 200,
    });
    host.manager.appendEntry(existing.id, {
        id: "entry-3",
        body: "Second child",
        timestamp: 300,
    });

    await host.controller.saveDraft(draft.id);

    assert.deepEqual(
        host.manager.getThreadById(existing.id)?.entries.map((entry) => entry.id),
        ["thread-1", "entry-2", "entry-4", "entry-3"],
    );
});

test("comment mutation controller inserts appended thread entries after the targeted child entry", async () => {
    const existing = createComment({ id: "thread-1", comment: "Original" });
    const host = createHost({
        knownComments: [existing],
        loadedComments: [existing],
    });
    host.manager.appendEntry(existing.id, {
        id: "entry-2",
        body: "First child",
        timestamp: 200,
    });
    host.manager.appendEntry(existing.id, {
        id: "entry-3",
        body: "Second child",
        timestamp: 300,
    });

    const appended = await host.controller.appendThreadEntry(existing.id, {
        id: "entry-4",
        body: "",
        timestamp: 400,
    }, {
        insertAfterCommentId: "entry-2",
    });

    assert.equal(appended, true);
    assert.deepEqual(
        host.manager.getThreadById(existing.id)?.entries.map((entry) => entry.id),
        ["thread-1", "entry-2", "entry-4", "entry-3"],
    );
});

test("comment mutation controller can insert appended thread entries immediately after the thread root", async () => {
    const existing = createComment({ id: "thread-1", comment: "Original" });
    const host = createHost({
        knownComments: [existing],
        loadedComments: [existing],
    });
    host.manager.appendEntry(existing.id, {
        id: "entry-2",
        body: "Later child",
        timestamp: 200,
    });
    host.manager.appendEntry(existing.id, {
        id: "entry-3",
        body: "Even later child",
        timestamp: 300,
    });

    const appended = await host.controller.appendThreadEntry(existing.id, {
        id: "entry-4",
        body: "",
        timestamp: 400,
    }, {
        insertAfterCommentId: existing.id,
        alwaysInsertAfterTarget: true,
    });

    assert.equal(appended, true);
    assert.deepEqual(
        host.manager.getThreadById(existing.id)?.entries.map((entry) => entry.id),
        ["thread-1", "entry-4", "entry-2", "entry-3"],
    );
});

test("comment mutation controller does not dispatch edited entries to the agent hook", async () => {
    const existing = createComment({ id: "thread-1", comment: "@codex original" });
    const draft = toDraft(existing, {
        comment: "@codex edited",
        mode: "edit",
        threadId: existing.id,
    });
    const host = createHost({
        draftComment: draft,
        knownComments: [existing],
        loadedComments: [existing],
    });

    await host.controller.saveDraft(draft.id);

    assert.deepEqual(host.savedUserEntryEvents, []);
    assert.equal(host.getRefreshCommentViewsCount(), 1);
    assert.equal(host.getRefreshEditorDecorationsCount(), 1);
});

test("comment mutation controller can convert an edited note thread to bookmark state without rewriting the body", async () => {
    const existing = createComment({
        id: "thread-1",
        comment: "Existing idea",
        isBookmark: false,
    });
    const draft: DraftComment = {
        ...toDraft(existing, {
            comment: "Existing idea",
            mode: "edit",
            threadId: existing.id,
            isBookmark: true,
        }),
        isBookmark: true,
    };
    const host = createHost({
        draftComment: draft,
        knownComments: [existing],
        loadedComments: [existing],
    });

    await host.controller.saveDraft(draft.id);

    assert.equal(host.manager.getCommentById(existing.id)?.comment, "Existing idea");
    assert.equal(host.manager.getThreadById(existing.id)?.isBookmark, true);
    assert.deepEqual(host.savedUserEntryEvents, []);
});

test("comment mutation controller can toggle bookmark state without entering edit mode", async () => {
    const existing = createComment({
        id: "thread-1",
        comment: "Existing idea",
        isBookmark: false,
    });
    const host = createHost({
        knownComments: [existing],
        loadedComments: [existing],
    });

    const updated = await host.controller.setCommentBookmarkState(existing.id, true);

    assert.equal(updated, true);
    assert.equal(host.getDraftComment(), null);
    assert.equal(host.manager.getThreadById(existing.id)?.isBookmark, true);
    assert.deepEqual(host.persistedFiles, [{
        path: existing.filePath,
        immediateAggregateRefresh: true,
    }]);
});

test("comment mutation controller can defer delete refresh work for lightweight local sidebar updates", async () => {
    const existing = createComment({
        id: "thread-1",
        comment: "Existing idea",
        resolved: false,
    });
    const deletedAt = Date.now();
    const host = createHost({
        knownComments: [existing],
        loadedComments: [existing],
        now: deletedAt,
    });

    const deleted = await host.controller.deleteComment(existing.id, {
        deferAggregateRefresh: true,
        skipPersistedViewRefresh: true,
    });

    assert.equal(deleted, true);
    assert.equal(host.manager.getThreadById(existing.id)?.deletedAt, deletedAt);
    assert.deepEqual(host.persistedFiles, [{
        path: existing.filePath,
        immediateAggregateRefresh: false,
        skipCommentViewRefresh: true,
    }]);
});

test("comment mutation controller can defer bookmark refresh work for lightweight local sidebar updates", async () => {
    const existing = createComment({
        id: "thread-1",
        comment: "Existing idea",
        isBookmark: false,
    });
    const host = createHost({
        knownComments: [existing],
        loadedComments: [existing],
    });

    const updated = await host.controller.setCommentBookmarkState(existing.id, true, {
        deferAggregateRefresh: true,
        skipPersistedViewRefresh: true,
        refreshEditorDecorations: false,
        refreshMarkdownPreviews: false,
    });

    assert.equal(updated, true);
    assert.deepEqual(host.persistedFiles, [{
        path: existing.filePath,
        immediateAggregateRefresh: false,
        skipCommentViewRefresh: true,
        refreshEditorDecorations: false,
        refreshMarkdownPreviews: false,
    }]);
});

test("comment mutation controller can defer resolve refresh work for lightweight local sidebar updates", async () => {
    const comment = createComment({
        id: "thread-1",
        resolved: false,
    });
    const host = createHost({
        knownComments: [comment],
        loadedComments: [comment],
    });

    const resolved = await host.controller.resolveComment(comment.id, {
        deferAggregateRefresh: true,
        skipPersistedViewRefresh: true,
    });

    assert.equal(resolved, true);
    assert.equal(host.manager.getCommentById(comment.id)?.resolved, true);
    assert.deepEqual(host.persistedFiles, [{
        path: comment.filePath,
        immediateAggregateRefresh: false,
        skipCommentViewRefresh: true,
    }]);
});

test("comment mutation controller can defer reopen refresh work while exiting resolved mode", async () => {
    const comment = createComment({ resolved: true });
    const host = createHost({
        knownComments: [comment],
        loadedComments: [comment],
        showResolvedComments: true,
    });

    const reopened = await host.controller.unresolveComment(comment.id, {
        deferAggregateRefresh: true,
        skipPersistedViewRefresh: true,
    });

    assert.equal(reopened, true);
    assert.equal(host.manager.getCommentById(comment.id)?.resolved, false);
    assert.deepEqual(host.persistedFiles, [{
        path: comment.filePath,
        immediateAggregateRefresh: false,
        skipCommentViewRefresh: true,
    }]);
    assert.deepEqual(host.setShowResolvedCalls, [{
        showResolved: false,
        skipCommentViewRefresh: true,
        deferAggregateRefresh: true,
    }]);
});

test("comment mutation controller keeps child edit drafts attached to their parent thread", async () => {
    const parent = createComment({ id: "thread-1", comment: "@codex parent" });
    const host = createHost({
        knownComments: [parent],
        loadedComments: [parent],
    });
    host.manager.appendEntry(parent.id, {
        id: "entry-2",
        body: "@codex child before",
        timestamp: 200,
    });

    const started = await host.controller.startEditDraft("entry-2");
    assert.equal(started, true);
    assert.equal(host.getDraftComment()?.threadId, parent.id);

    host.getDraftComment()!.comment = "@codex child after";
    await host.controller.saveDraft("entry-2");

    assert.deepEqual(host.savedUserEntryEvents, []);
});

test("comment mutation controller stores shortened markdown links when saving a draft", async () => {
    const draft = toDraft(createComment({
        id: "draft-1",
        comment: "Check https://www.shipmonk.com/resources/content-hub/dropshipping-with-a-fulfillment-company?utm_source=google&utm_medium=cpc&utm_campaign=summer",
    }));
    const host = createHost({
        draftComment: draft,
        knownComments: [draft],
        loadedComments: [],
        currentNoteContentByPath: {
            [draft.filePath]: "# Title\n\nAlpha beta gamma.\n",
        },
    });

    await host.controller.saveDraft(draft.id);

    assert.equal(
        host.manager.getAllComments()[0]?.comment,
        "Check [shipmonk.com/resources/.../dropshipping-with-a-fulfillment-company](https://www.shipmonk.com/resources/content-hub/dropshipping-with-a-fulfillment-company?utm_source=google&utm_medium=cpc&utm_campaign=summer)",
    );
});

test("comment mutation controller marks a new draft as saving before anchor resolution completes", async () => {
    const draft = toDraft(createComment({
        id: "draft-1",
        comment: "  Ship it  ",
        selectedText: "beta",
        startLine: 2,
        startChar: 6,
        endLine: 2,
        endChar: 10,
    }));
    let resolveCurrentNoteContent!: (value: string) => void;
    const currentNoteContentPromise = new Promise<string>((resolve) => {
        resolveCurrentNoteContent = resolve;
    });
    const host = createHost({
        draftComment: draft,
        knownComments: [draft],
        loadedComments: [],
        getCurrentNoteContent: async () => currentNoteContentPromise,
    });

    const savePromise = host.controller.saveDraft(draft.id);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(host.getDraftComment()?.comment, "Ship it");
    assert.equal(host.getSavingDraftCommentId(), draft.id);
    assert.equal(host.getRefreshCommentViewsCount(), 0);
    assert.equal(host.getRefreshEditorDecorationsCount(), 0);

    resolveCurrentNoteContent("# Title\n\nAlpha beta gamma.\n");
    await savePromise;

    assert.equal(host.manager.getAllComments().length, 1);
    assert.equal(host.getDraftComment(), null);
    assert.equal(host.getSavingDraftCommentId(), null);
    assert.deepEqual(host.notices, []);
});

test("comment mutation controller keeps a new draft open when the selected text no longer exists", async () => {
    const draft = toDraft(createComment({
        id: "draft-1",
        comment: "  Ship it  ",
        selectedText: "beta",
        startLine: 2,
        startChar: 6,
        endLine: 2,
        endChar: 10,
    }));
    const host = createHost({
        draftComment: draft,
        knownComments: [draft],
        loadedComments: [],
        currentNoteContentByPath: {
            [draft.filePath]: "# Title\n\nAlpha gamma delta.\n",
        },
    });

    await host.controller.saveDraft(draft.id);

    assert.equal(host.manager.getAllComments().length, 0);
    assert.deepEqual(host.persistedFiles, []);
    assert.equal(host.getDraftComment()?.id, draft.id);
    assert.equal(host.getDraftComment()?.comment, "Ship it");
    assert.equal(host.getSavingDraftCommentId(), null);
    assert.equal(host.getRefreshCommentViewsCount(), 1);
    assert.equal(host.getRefreshEditorDecorationsCount(), 1);
    assert.deepEqual(host.notices, [
        "Selected text changed before save. Review the draft and reselect the anchor text.",
    ]);
});

test("comment mutation controller re-resolves a moved anchor before saving a new draft", async () => {
    const draft = toDraft(createComment({
        id: "draft-1",
        comment: "  Ship it  ",
        selectedText: "beta",
        startLine: 2,
        startChar: 6,
        endLine: 2,
        endChar: 10,
    }));
    const host = createHost({
        draftComment: draft,
        knownComments: [draft],
        loadedComments: [],
        currentNoteContentByPath: {
            [draft.filePath]: "# Title\n\nAlpha gamma.\n\nbeta moved here.\n",
        },
    });

    await host.controller.saveDraft(draft.id);

    assert.equal(host.manager.getAllComments().length, 1);
    assert.equal(host.manager.getAllComments()[0].startLine, 4);
    assert.equal(host.manager.getAllComments()[0].startChar, 0);
    assert.equal(host.manager.getAllComments()[0].endLine, 4);
    assert.equal(host.manager.getAllComments()[0].endChar, 4);
    assert.deepEqual(host.persistedFiles, [{
        path: draft.filePath,
        immediateAggregateRefresh: false,
        skipCommentViewRefresh: true,
    }]);
    assert.equal(host.getDraftComment(), null);
    assert.deepEqual(host.notices, []);
});

test("comment mutation controller preserves visible whitespace around a hidden block when saving a new draft", async () => {
    const selectedText = "reason for having both ZohoBooks and QuickBooks before digging deeper.\n\n\nTrailing text";
    const draft = toDraft(createComment({
        id: "draft-1",
        comment: "  Ship it  ",
        selectedText,
        startLine: 0,
        startChar: 0,
        endLine: 2,
        endChar: 13,
    }));
    const host = createHost({
        draftComment: draft,
        knownComments: [draft],
        loadedComments: [],
        currentNoteContentByPath: {
            [draft.filePath]: [
                "We can start prototyping stuff right now. But I want to find out reason for having both ZohoBooks and QuickBooks before digging deeper.",
                "",
                "<!-- SideNote2 comments",
                "[]",
                "-->",
                "Trailing text",
                "",
            ].join("\n"),
        },
    });

    await host.controller.saveDraft(draft.id);

    assert.equal(host.manager.getAllComments().length, 1);
    assert.equal(host.manager.getAllComments()[0].selectedText, selectedText);
    assert.deepEqual(host.notices, []);
});

test("comment mutation controller suppresses duplicate adds inside the dedupe window", async () => {
    const comment = createComment();
    const host = createHost({
        loadedComments: [],
        knownComments: [comment],
        now: 500,
    });

    const firstAdded = await host.controller.addComment(comment);
    const secondAdded = await host.controller.addComment({ ...comment, id: "comment-2" });

    assert.equal(firstAdded, true);
    assert.equal(secondAdded, false);
    assert.equal(host.manager.getAllComments().length, 1);
    assert.equal(host.persistedFiles.length, 1);
});

test("comment mutation controller resolves an existing comment and persists the change", async () => {
    const comment = createComment({ resolved: false });
    const host = createHost({
        knownComments: [comment],
        loadedComments: [comment],
    });

    await host.controller.resolveComment(comment.id);

    assert.equal(host.manager.getCommentById(comment.id)?.resolved, true);
    assert.deepEqual(host.persistedFiles, [{
        path: comment.filePath,
        immediateAggregateRefresh: true,
    }]);
    assert.deepEqual(host.notices, []);
});

test("comment mutation controller exits resolved-only mode after reopening a comment", async () => {
    const comment = createComment({ resolved: true });
    const host = createHost({
        knownComments: [comment],
        loadedComments: [comment],
        showResolvedComments: true,
    });

    await host.controller.unresolveComment(comment.id);

    assert.equal(host.manager.getCommentById(comment.id)?.resolved, false);
    assert.deepEqual(host.persistedFiles, [{
        path: comment.filePath,
        immediateAggregateRefresh: true,
    }]);
    assert.deepEqual(host.setShowResolvedCalls, [{
        showResolved: false,
        skipCommentViewRefresh: false,
        deferAggregateRefresh: false,
    }]);
    assert.equal(host.getShowResolvedComments(), false);
});

test("comment mutation controller moves a thread into another file as a page note at the top", async () => {
    const source = createComment({
        id: "thread-1",
        filePath: "Folder/Source.md",
        selectedText: "Source anchor",
        selectedTextHash: "hash:Source anchor",
        startLine: 8,
        startChar: 2,
        endLine: 8,
        endChar: 15,
        comment: "Root body",
        timestamp: 300,
        anchorKind: "selection",
        isBookmark: true,
        resolved: true,
    });
    const targetExisting = createComment({
        id: "thread-2",
        filePath: "Folder/Other.md",
        selectedText: "Existing target note",
        selectedTextHash: "hash:Existing target note",
        comment: "Existing body",
        timestamp: 500,
        anchorKind: "selection",
    });
    const movedAt = 900;
    const host = createHost({
        knownComments: [source, targetExisting],
        loadedComments: [source, targetExisting],
        extraFiles: ["Folder/Other.md"],
        now: movedAt,
    });
    host.manager.appendEntry(source.id, {
        id: "entry-2",
        body: "Child reply",
        timestamp: 400,
    });

    const moved = await host.controller.moveCommentThreadToFile(source.id, "Folder/Other.md");

    assert.equal(moved, true);
    assert.deepEqual(host.loadedFiles, ["Folder/Other.md"]);
    assert.deepEqual(host.persistedFiles, [
        {
            path: "Folder/Source.md",
            immediateAggregateRefresh: false,
            skipCommentViewRefresh: true,
        },
        {
            path: "Folder/Other.md",
            immediateAggregateRefresh: true,
        },
    ]);
    assert.deepEqual(host.manager.getThreadsForFile("Folder/Source.md", { includeDeleted: true }), []);

    const movedThread = host.manager.getThreadById("thread-1");
    assert.ok(movedThread);
    assert.equal(movedThread.filePath, "Folder/Other.md");
    assert.equal(movedThread.anchorKind, "page");
    assert.equal(movedThread.selectedText, "Other");
    assert.equal(movedThread.selectedTextHash, "hash:Other");
    assert.equal(movedThread.startLine, 0);
    assert.equal(movedThread.startChar, 0);
    assert.equal(movedThread.endLine, 0);
    assert.equal(movedThread.endChar, 0);
    assert.equal(movedThread.orphaned, false);
    assert.equal(movedThread.isBookmark, true);
    assert.equal(movedThread.resolved, true);
    assert.equal(movedThread.updatedAt, movedAt);
    assert.deepEqual(movedThread.entries.map((entry) => entry.id), ["thread-1", "entry-2"]);
    assert.deepEqual(
        host.manager.getThreadsForFile("Folder/Other.md", { includeDeleted: true }).map((thread) => thread.id),
        ["thread-1", "thread-2"],
    );
    assert.deepEqual(host.notices, ["Moved side note to Other."]);
    assert.deepEqual(host.openedMoveTargetFiles, ["Folder/Other.md"]);
});

test("comment mutation controller can defer move-thread refresh work for lightweight local sidebar updates", async () => {
    const source = createComment({
        id: "thread-1",
        filePath: "Folder/Source.md",
        selectedText: "Source anchor",
        selectedTextHash: "hash:Source anchor",
        comment: "Root body",
        timestamp: 300,
    });
    const targetExisting = createComment({
        id: "thread-2",
        filePath: "Folder/Other.md",
        selectedText: "Existing target note",
        selectedTextHash: "hash:Existing target note",
        comment: "Existing body",
        timestamp: 500,
    });
    const host = createHost({
        knownComments: [source, targetExisting],
        loadedComments: [source, targetExisting],
        extraFiles: ["Folder/Other.md"],
        now: 900,
    });

    const moved = await host.controller.moveCommentThreadToFile(source.id, "Folder/Other.md", {
        deferAggregateRefresh: true,
        skipPersistedViewRefresh: true,
    });

    assert.equal(moved, true);
    assert.deepEqual(host.persistedFiles, [
        {
            path: "Folder/Source.md",
            immediateAggregateRefresh: false,
            skipCommentViewRefresh: true,
        },
        {
            path: "Folder/Other.md",
            immediateAggregateRefresh: false,
            skipCommentViewRefresh: true,
        },
    ]);
});

test("comment mutation controller moves a child entry under another thread in the same file", async () => {
    const source = createComment({
        id: "thread-1",
        filePath: "Folder/Source.md",
        selectedText: "Source anchor",
        selectedTextHash: "hash:Source anchor",
        comment: "Root body",
        timestamp: 300,
    });
    const target = createComment({
        id: "thread-2",
        filePath: "Folder/Source.md",
        selectedText: "Target anchor",
        selectedTextHash: "hash:Target anchor",
        comment: "Target root body",
        timestamp: 500,
    });
    const host = createHost({
        knownComments: [source, target],
        loadedComments: [source, target],
        now: 900,
    });
    host.manager.appendEntry(source.id, {
        id: "entry-2",
        body: "Child reply",
        timestamp: 400,
    });

    const moved = await host.controller.moveCommentEntryToThread("entry-2", target.id);

    assert.equal(moved, true);
    assert.deepEqual(host.loadedFiles, []);
    assert.deepEqual(host.persistedFiles, [{
        path: "Folder/Source.md",
        immediateAggregateRefresh: true,
    }]);
    assert.deepEqual(
        host.manager.getThreadById(source.id)?.entries.map((entry) => entry.id),
        ["thread-1"],
    );
    assert.deepEqual(
        host.manager.getThreadById(target.id)?.entries.map((entry) => entry.id),
        ["thread-2", "entry-2"],
    );
    assert.equal(host.manager.getCommentById("entry-2")?.comment, "Child reply");
    assert.deepEqual(host.notices, ["Moved side note under Target anchor."]);
});

test("comment mutation controller can defer move-entry refresh work for lightweight local sidebar updates", async () => {
    const source = createComment({
        id: "thread-1",
        filePath: "Folder/Source.md",
        selectedText: "Source anchor",
        selectedTextHash: "hash:Source anchor",
        comment: "Root body",
        timestamp: 300,
    });
    const target = createComment({
        id: "thread-2",
        filePath: "Folder/Source.md",
        selectedText: "Target anchor",
        selectedTextHash: "hash:Target anchor",
        comment: "Target root body",
        timestamp: 500,
    });
    const host = createHost({
        knownComments: [source, target],
        loadedComments: [source, target],
        now: 900,
    });
    host.manager.appendEntry(source.id, {
        id: "entry-2",
        body: "Child reply",
        timestamp: 400,
    });

    const moved = await host.controller.moveCommentEntryToThread("entry-2", target.id, {
        deferAggregateRefresh: true,
        skipPersistedViewRefresh: true,
        refreshEditorDecorations: false,
        refreshMarkdownPreviews: false,
    });

    assert.equal(moved, true);
    assert.deepEqual(host.persistedFiles, [{
        path: "Folder/Source.md",
        immediateAggregateRefresh: false,
        skipCommentViewRefresh: true,
        refreshEditorDecorations: false,
        refreshMarkdownPreviews: false,
    }]);
});

test("comment mutation controller rejects moving a root thread through the child move path", async () => {
    const source = createComment({
        id: "thread-1",
        filePath: "Folder/Source.md",
    });
    const target = createComment({
        id: "thread-2",
        filePath: "Folder/Source.md",
    });
    const host = createHost({
        knownComments: [source, target],
        loadedComments: [source, target],
    });

    const moved = await host.controller.moveCommentEntryToThread(source.id, target.id);

    assert.equal(moved, false);
    assert.deepEqual(host.loadedFiles, []);
    assert.deepEqual(host.persistedFiles, []);
    assert.deepEqual(host.notices, [
        "Only nested side notes can move under another parent side note.",
    ]);
});

test("comment mutation controller rejects moving a child entry onto the same parent thread", async () => {
    const source = createComment({
        id: "thread-1",
        filePath: "Folder/Source.md",
    });
    const host = createHost({
        knownComments: [source],
        loadedComments: [source],
    });
    host.manager.appendEntry(source.id, {
        id: "entry-2",
        body: "Child reply",
        timestamp: 400,
    });

    const moved = await host.controller.moveCommentEntryToThread("entry-2", source.id);

    assert.equal(moved, false);
    assert.deepEqual(host.loadedFiles, []);
    assert.deepEqual(host.persistedFiles, []);
    assert.deepEqual(host.notices, ["Choose a different parent side note."]);
});

test("comment mutation controller rejects moving a thread into the same file", async () => {
    const comment = createComment({
        id: "thread-1",
        filePath: "Folder/Source.md",
    });
    const host = createHost({
        knownComments: [comment],
        loadedComments: [comment],
    });

    const moved = await host.controller.moveCommentThreadToFile(comment.id, comment.filePath);

    assert.equal(moved, false);
    assert.deepEqual(host.loadedFiles, []);
    assert.deepEqual(host.persistedFiles, []);
    assert.deepEqual(host.notices, ["Choose a different note to move this side note."]);
});

test("comment mutation controller soft deletes an existing comment and persists the change", async () => {
    const comment = createComment({ resolved: false });
    const deletedAt = Date.now();
    const host = createHost({
        knownComments: [comment],
        loadedComments: [comment],
        now: deletedAt,
    });

    await host.controller.deleteComment(comment.id);

    assert.equal(host.manager.getCommentById(comment.id)?.deletedAt, deletedAt);
    assert.deepEqual(host.manager.getCommentsForFile(comment.filePath), []);
    assert.deepEqual(host.persistedFiles, [{
        path: comment.filePath,
        immediateAggregateRefresh: true,
    }]);
});

test("comment mutation controller restores a soft deleted comment", async () => {
    const deletedAt = Date.now();
    const comment = createComment({ deletedAt });
    const host = createHost({
        knownComments: [comment],
        loadedComments: [comment],
        now: deletedAt + 1_000,
    });

    const restored = await host.controller.restoreComment(comment.id);

    assert.equal(restored, true);
    assert.equal(host.manager.getCommentById(comment.id)?.deletedAt, undefined);
    assert.equal(host.manager.getCommentsForFile(comment.filePath)[0]?.id, comment.id);
    assert.deepEqual(host.persistedFiles, [{
        path: comment.filePath,
        immediateAggregateRefresh: true,
    }]);
});

test("comment mutation controller restores a soft deleted child entry", async () => {
    const deletedAt = Date.now();
    const parent = createComment({ id: "thread-1", timestamp: deletedAt - 2_000 });
    const host = createHost({
        knownComments: [parent],
        loadedComments: [parent],
        now: deletedAt + 1_000,
    });
    host.manager.appendEntry(parent.id, {
        id: "entry-2",
        body: "Deleted child entry",
        timestamp: deletedAt - 1_000,
        deletedAt,
    });

    const restored = await host.controller.restoreComment("entry-2");

    assert.equal(restored, true);
    assert.equal(host.manager.getCommentById("entry-2")?.deletedAt, undefined);
    assert.deepEqual(host.persistedFiles, [{
        path: parent.filePath,
        immediateAggregateRefresh: true,
    }]);
});

test("comment mutation controller permanently clears deleted comments for a file", async () => {
    const baseTimestamp = Date.now();
    const activeComment = createComment({ id: "thread-1", timestamp: baseTimestamp });
    const deletedComment = createComment({ id: "thread-2", timestamp: baseTimestamp + 1_000 });
    const host = createHost({
        knownComments: [activeComment, deletedComment],
        loadedComments: [activeComment, deletedComment],
        now: baseTimestamp + 3_000,
    });
    host.manager.deleteComment(deletedComment.id, baseTimestamp + 2_000);

    const cleared = await host.controller.clearDeletedCommentsForFile(activeComment.filePath);

    assert.equal(cleared, true);
    assert.deepEqual(host.loadedFiles, [activeComment.filePath]);
    assert.deepEqual(host.persistedFiles, [{
        path: activeComment.filePath,
        immediateAggregateRefresh: true,
    }]);
    assert.equal(host.manager.getCommentById("thread-2"), undefined);
});

test("comment mutation controller skips clear when there is nothing deleted for the file", async () => {
    const activeComment = createComment({ id: "thread-1" });
    const host = createHost({
        knownComments: [activeComment],
        loadedComments: [activeComment],
    });

    const cleared = await host.controller.clearDeletedCommentsForFile(activeComment.filePath);

    assert.equal(cleared, false);
    assert.deepEqual(host.loadedFiles, [activeComment.filePath]);
    assert.deepEqual(host.persistedFiles, []);
});

test("comment mutation controller re-anchors an orphaned thread to the current selection", async () => {
    const comment = createComment({
        id: "comment-1",
        orphaned: true,
        selectedText: "Missing anchor",
        selectedTextHash: "hash:missing",
        startLine: 10,
        startChar: 2,
        endLine: 10,
        endChar: 15,
    });
    const host = createHost({
        knownComments: [comment],
        loadedComments: [comment],
        currentNoteContentByPath: {
            [comment.filePath]: "# Title\nBefore\n<!-- SideNote2 comments\n[]\n-->\nAfter\n",
        },
        currentSelectionByPath: {
            [comment.filePath]: {
                file: createFile(comment.filePath),
                selectedText: "After",
                startLine: 5,
                startChar: 0,
                endLine: 5,
                endChar: 5,
            },
        },
    });

    const reanchored = await host.controller.reanchorCommentThreadToCurrentSelection(comment.id);

    assert.equal(reanchored, true);
    assert.deepEqual(host.persistedFiles, [{
        path: comment.filePath,
        immediateAggregateRefresh: true,
    }]);
    assert.equal(host.manager.getCommentById(comment.id)?.orphaned, false);
    assert.equal(host.manager.getCommentById(comment.id)?.selectedText, "After");
    assert.equal(host.manager.getCommentById(comment.id)?.selectedTextHash, "hash:After");
    assert.equal(host.manager.getCommentById(comment.id)?.startLine, 3);
    assert.equal(host.manager.getCommentById(comment.id)?.startChar, 0);
    assert.equal(host.manager.getCommentById(comment.id)?.endLine, 3);
    assert.equal(host.manager.getCommentById(comment.id)?.endChar, 5);
    assert.deepEqual(host.notices, []);
});

test("comment mutation controller rejects re-anchoring inside the managed comment block", async () => {
    const comment = createComment({
        id: "comment-1",
        orphaned: true,
    });
    const host = createHost({
        knownComments: [comment],
        loadedComments: [comment],
        currentNoteContentByPath: {
            [comment.filePath]: "# Title\nBefore\n<!-- SideNote2 comments\n[]\n-->\nAfter\n",
        },
        currentSelectionByPath: {
            [comment.filePath]: {
                file: createFile(comment.filePath),
                selectedText: "<!-- SideNote2 comments",
                startLine: 2,
                startChar: 0,
                endLine: 2,
                endChar: 23,
            },
        },
    });

    const reanchored = await host.controller.reanchorCommentThreadToCurrentSelection(comment.id);

    assert.equal(reanchored, false);
    assert.deepEqual(host.persistedFiles, []);
    assert.equal(host.manager.getCommentById(comment.id)?.orphaned, true);
    assert.deepEqual(host.notices, [
        "Select text outside the SideNote2 comments block to re-anchor this side note.",
    ]);
});
