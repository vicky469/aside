import * as assert from "node:assert/strict";
import test from "node:test";
import type { Editor, TFile } from "obsidian";
import type { Comment } from "../src/commentManager";
import { getPageCommentLabel } from "../src/core/anchors/commentAnchors";
import { CommentEntryController, type CommentEntryHost } from "../src/control/commentEntryController";
import type { DraftComment } from "../src/domain/drafts";

const ALL_COMMENTS_NOTE_PATH = "SideNote2/index.md";

function createFile(path: string): TFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
        extension: path.split(".").pop() ?? "",
    } as TFile;
}

function createEditor(
    selectedText: string,
    from = { line: 2, ch: 4 },
    to = { line: 2, ch: 8 },
): Editor {
    return {
        getSelection: () => selectedText,
        getCursor: (which?: "from" | "to") => (which === "to" ? to : from),
    } as unknown as Editor;
}

function isCommentableFilePath(path: string): boolean {
    if (path === ALL_COMMENTS_NOTE_PATH) {
        return false;
    }

    return path.endsWith(".md");
}

function createHost(options: { knownComments?: Comment[]; threadIdsByCommentId?: Record<string, string> } = {}) {
    const draftCalls: Array<{ draft: DraftComment | null; hostFilePath?: string | null }> = [];
    const loadedFiles: string[] = [];
    const markedFiles: string[] = [];
    const highlightedCommentIds: string[] = [];
    const notices: string[] = [];
    const knownComments = new Map((options.knownComments ?? []).map((comment) => [comment.id, comment]));

    const host: CommentEntryHost = {
        getAllCommentsNotePath: () => ALL_COMMENTS_NOTE_PATH,
        getFileByPath: (filePath) => createFile(filePath),
        isCommentableFile: (file): file is TFile => !!file && isCommentableFilePath(file.path),
        loadCommentsForFile: async (file) => {
            loadedFiles.push(file.path);
        },
        getKnownCommentById: (commentId) => knownComments.get(commentId) ?? null,
        getKnownThreadIdByCommentId: (commentId) => options.threadIdsByCommentId?.[commentId] ?? null,
        markDraftFileActive: (file) => {
            markedFiles.push(file.path);
        },
        setDraftComment: async (draft, hostFilePath) => {
            draftCalls.push({ draft, hostFilePath });
        },
        activateViewAndHighlightComment: async (commentId) => {
            highlightedCommentIds.push(commentId);
        },
        createCommentId: () => "comment-1",
        hashText: async (text) => `hash:${text}`,
        showNotice: (message) => {
            notices.push(message);
        },
    };

    return {
        controller: new CommentEntryController(host),
        draftCalls,
        loadedFiles,
        markedFiles,
        highlightedCommentIds,
        notices,
    };
}

test("comment entry controller starts a draft from editor selection", async () => {
    const host = createHost();
    const file = createFile("docs/architecture.md");

    const started = await host.controller.startDraftFromEditorSelection(createEditor("beta"), file);

    assert.equal(started, true);
    assert.deepEqual(host.loadedFiles, [file.path]);
    assert.deepEqual(host.markedFiles, [file.path]);
    assert.equal(host.draftCalls.length, 1);
    assert.equal(host.highlightedCommentIds.length, 1);

    const draft = host.draftCalls[0].draft;
    assert.ok(draft);
    assert.equal(draft.id, "comment-1");
    assert.equal(draft.filePath, file.path);
    assert.equal(draft.selectedText, "beta");
    assert.equal(draft.selectedTextHash, "hash:beta");
    assert.equal(draft.startLine, 2);
    assert.equal(draft.startChar, 4);
    assert.equal(draft.endLine, 2);
    assert.equal(draft.endChar, 8);
    assert.equal(draft.anchorKind, "selection");
    assert.equal(host.draftCalls[0].hostFilePath, file.path);
    assert.deepEqual(host.highlightedCommentIds, ["comment-1"]);
    assert.deepEqual(host.notices, []);
});

test("comment entry controller rejects empty editor selections", async () => {
    const host = createHost();
    const file = createFile("docs/architecture.md");

    const started = await host.controller.startDraftFromEditorSelection(createEditor("   "), file);

    assert.equal(started, false);
    assert.deepEqual(host.loadedFiles, []);
    assert.equal(host.draftCalls.length, 0);
    assert.deepEqual(host.notices, ["Please select some text to add a comment."]);
});

test("comment entry controller rejects text-anchored drafts for non-markdown files", async () => {
    const host = createHost();
    const file = createFile("docs/diagram.pdf");

    const started = await host.controller.startDraftFromEditorSelection(createEditor("label"), file);

    assert.equal(started, false);
    assert.deepEqual(host.loadedFiles, []);
    assert.equal(host.draftCalls.length, 0);
    assert.deepEqual(host.notices, ["Text-anchored side notes are only supported in markdown files."]);
});

test("comment entry controller rejects page drafts for non-markdown files", async () => {
    const host = createHost();
    const file = createFile("docs/diagram.pdf");

    const started = await host.controller.startPageCommentDraft(file);

    assert.equal(started, false);
    assert.deepEqual(host.loadedFiles, []);
    assert.equal(host.draftCalls.length, 0);
    assert.deepEqual(host.notices, []);
});

test("comment entry controller starts page drafts for markdown files", async () => {
    const host = createHost();
    const file = createFile("docs/architecture.md");

    const started = await host.controller.startPageCommentDraft(file);

    assert.equal(started, true);
    assert.deepEqual(host.loadedFiles, [file.path]);
    assert.deepEqual(host.markedFiles, [file.path]);
    assert.equal(host.draftCalls.length, 1);
    assert.deepEqual(host.highlightedCommentIds, ["comment-1"]);

    const draft = host.draftCalls[0].draft;
    assert.ok(draft);
    assert.equal(draft.anchorKind, "page");
    assert.equal(draft.selectedText, getPageCommentLabel(file.path));
    assert.equal(draft.selectedTextHash, `hash:${getPageCommentLabel(file.path)}`);
    assert.deepEqual(host.notices, []);
});

test("comment entry controller starts an append-entry draft using the resolved vault file", async () => {
    const existingComment: Comment = {
        id: "thread-1",
        filePath: "docs/architecture.md",
        startLine: 4,
        startChar: 2,
        endLine: 4,
        endChar: 8,
        selectedText: "system",
        selectedTextHash: "hash:system",
        comment: "existing body",
        timestamp: 123,
        anchorKind: "selection",
        orphaned: false,
        resolved: false,
    };
    const host = createHost({ knownComments: [existingComment] });

    const started = await host.controller.startAppendEntryDraft("thread-1", "docs/host.md");

    assert.equal(started, true);
    assert.deepEqual(host.loadedFiles, [existingComment.filePath]);
    assert.deepEqual(host.markedFiles, [existingComment.filePath]);
    assert.deepEqual(host.highlightedCommentIds, ["comment-1"]);
    assert.equal(host.draftCalls.length, 1);

    const draft = host.draftCalls[0].draft;
    assert.ok(draft);
    assert.equal(draft.id, "comment-1");
    assert.equal(draft.threadId, "thread-1");
    assert.equal(draft.mode, "append");
    assert.equal(draft.filePath, existingComment.filePath);
    assert.equal(draft.comment, "");
    assert.equal(host.draftCalls[0].hostFilePath, "docs/host.md");
    assert.deepEqual(host.notices, []);
});

test("comment entry controller can start an append-entry draft from a child entry id", async () => {
    const childComment: Comment = {
        id: "entry-2",
        filePath: "docs/architecture.md",
        startLine: 4,
        startChar: 2,
        endLine: 4,
        endChar: 8,
        selectedText: "system",
        selectedTextHash: "hash:system",
        comment: "child body",
        timestamp: 456,
        anchorKind: "selection",
        orphaned: false,
        resolved: false,
    };
    const host = createHost({
        knownComments: [childComment],
        threadIdsByCommentId: {
            "entry-2": "thread-1",
        },
    });

    const started = await host.controller.startAppendEntryDraft("entry-2", "docs/host.md");

    assert.equal(started, true);
    assert.deepEqual(host.loadedFiles, [childComment.filePath]);
    assert.deepEqual(host.markedFiles, [childComment.filePath]);
    assert.deepEqual(host.highlightedCommentIds, ["comment-1"]);
    assert.equal(host.draftCalls.length, 1);

    const draft = host.draftCalls[0].draft;
    assert.ok(draft);
    assert.equal(draft.id, "comment-1");
    assert.equal(draft.threadId, "thread-1");
    assert.equal(draft.mode, "append");
    assert.equal(draft.filePath, childComment.filePath);
    assert.equal(draft.comment, "");
    assert.equal(host.draftCalls[0].hostFilePath, "docs/host.md");
    assert.deepEqual(host.notices, []);
});
