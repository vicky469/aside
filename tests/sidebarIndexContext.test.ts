import * as assert from "node:assert/strict";
import test from "node:test";
import {
    buildCommentRevealScrollTarget,
    pickExactFileLeafCandidate,
    pickPinnedCommentableFile,
    pickPreferredFileLeafCandidate,
    pickSidebarTargetFile,
    resolveIndexSidebarScopeRootPath,
    shouldRevealSidebarLeaf,
} from "../src/comments/commentNavigationPlanner";
import {
    resolveWorkspaceTargetInput,
    resolveIndexLeafMode,
    resolveWorkspaceFileTargets,
} from "../src/app/workspaceContextPlanner";
import { shouldSkipAggregateViewRefresh } from "../src/comments/commentPersistencePlanner";
import { ALL_COMMENTS_NOTE_PATH } from "../src/core/derived/allCommentsNote";

interface MockFile {
    path: string;
    extension: string;
}

interface MockDraftComment {
    id: string;
    filePath: string;
}

interface MockComment {
    id: string;
    filePath: string;
    anchorKind?: "selection" | "page";
}

interface MockLeaf {
    id: string;
    kind: "file" | "sidebar";
    filePath?: string;
    active?: boolean;
    recent?: boolean;
    mode?: "source" | "preview";
    source?: boolean;
}

class MockPlugin {
    public activeMarkdownFile: MockFile | null = { path: "last-note.md", extension: "md" };
    public activeSidebarFile: MockFile | null = null;
    public draftComment: MockDraftComment | null = null;
    public draftHostFilePath: string | null = null;
    public commentManagerComments: MockComment[] = [];
    public aggregateComments: MockComment[] = [];

    getSidebarTargetFileOld(activeFile: MockFile | null): MockFile | null {
        if (activeFile && activeFile.extension === "md" && activeFile.path !== ALL_COMMENTS_NOTE_PATH) {
            return activeFile;
        }

        return this.activeMarkdownFile;
    }

    getSidebarTargetFileFixed(activeFile: MockFile | null): MockFile | null {
        return pickSidebarTargetFile(
            activeFile,
            this.activeMarkdownFile,
            (file): file is MockFile => !!file && file.extension === "md",
        );
    }

    handleFileOpenOld(file: MockFile | null): MockFile | null {
        if (!(file && file.extension === "md") || file.path === ALL_COMMENTS_NOTE_PATH) {
            return null;
        }

        this.activeMarkdownFile = file;
        return file;
    }

    handleFileOpenFixed(file: MockFile | null): MockFile | null {
        const nextState = resolveWorkspaceFileTargets(
            file,
            this.activeMarkdownFile,
            this.activeSidebarFile,
            (candidate): candidate is MockFile => !!candidate && candidate.extension === "md" && candidate.path !== ALL_COMMENTS_NOTE_PATH,
            (candidate): candidate is MockFile => !!candidate && candidate.extension === "md",
        );
        this.activeMarkdownFile = nextState.activeMarkdownFile;
        this.activeSidebarFile = nextState.activeSidebarFile;
        return nextState.sidebarFile;
    }

    getDraftForFile(filePath: string): MockDraftComment | null {
        return this.draftComment?.filePath === filePath ? this.draftComment : null;
    }

    getDraftForView(filePath: string): MockDraftComment | null {
        return this.draftComment && this.draftHostFilePath === filePath
            ? this.draftComment
            : null;
    }

    getKnownCommentById(commentId: string): MockComment | null {
        return this.commentManagerComments.find((comment) => comment.id === commentId)
            ?? this.aggregateComments.find((comment) => comment.id === commentId)
            ?? null;
    }

    getDeleteTargetOld(commentId: string): MockComment | null {
        return this.commentManagerComments.find((comment) => comment.id === commentId) ?? null;
    }

    getDeleteTargetFixed(commentId: string): MockComment | null {
        return this.getKnownCommentById(commentId);
    }

    getRevealTargetOld(leaves: MockLeaf[], filePath: string): string {
        const matchedLeaf = leaves.find((leaf) => leaf.kind === "file" && leaf.filePath === filePath);
        return matchedLeaf?.id ?? "new-tab";
    }

    getRevealTargetFixed(leaves: MockLeaf[], filePath: string): string {
        const leaf = pickPreferredFileLeafCandidate(
            leaves.map((candidate) => ({
                value: candidate,
                filePath: candidate.filePath ?? null,
                eligible: candidate.kind === "file",
                active: candidate.active === true,
                recent: candidate.recent === true,
            })),
            filePath,
        );

        return leaf?.id ?? "existing-or-new";
    }

    getMoveTargetFixed(leaves: MockLeaf[], filePath: string): string {
        const leaf = pickExactFileLeafCandidate(
            leaves.map((candidate) => ({
                value: candidate,
                filePath: candidate.filePath ?? null,
                eligible: candidate.kind === "file",
                active: candidate.active === true,
                recent: candidate.recent === true,
            })),
            filePath,
        );

        return leaf?.id ?? "new-tab";
    }

    syncIndexLeafModeOld(leaf: MockLeaf): MockLeaf {
        if (leaf.kind === "file" && leaf.filePath === ALL_COMMENTS_NOTE_PATH) {
            return { ...leaf, mode: "preview" };
        }

        return leaf;
    }

    syncIndexLeafModeFixed(leaf: MockLeaf): MockLeaf {
        const nextMode = resolveIndexLeafMode({
            isMarkdownLeaf: leaf.kind === "file",
            isIndexLeaf: leaf.filePath === ALL_COMMENTS_NOTE_PATH,
            currentViewMode: leaf.mode ?? "source",
            isSourceMode: leaf.source,
        });

        return nextMode ? { ...leaf, mode: nextMode.mode, source: nextMode.sourceMode } : leaf;
    }
}

test("old sidebar target falls back to the last normal note for SideNote2 index", () => {
    const plugin = new MockPlugin();
    const target = plugin.getSidebarTargetFileOld({
        path: ALL_COMMENTS_NOTE_PATH,
        extension: "md",
    });

    assert.deepEqual(target, { path: "last-note.md", extension: "md" });
});

test("fixed sidebar target uses SideNote2 index when it is the active note", () => {
    const plugin = new MockPlugin();
    const target = plugin.getSidebarTargetFileFixed({
        path: ALL_COMMENTS_NOTE_PATH,
        extension: "md",
    });

    assert.deepEqual(target, { path: ALL_COMMENTS_NOTE_PATH, extension: "md" });
});

test("fixed sidebar target clears when the active file is unsupported", () => {
    const plugin = new MockPlugin();
    const target = plugin.getSidebarTargetFileFixed({
        path: "docs/file.pdf",
        extension: "pdf",
    });

    assert.equal(target, null);
});

test("pinned commentable file falls back from an unsupported active file to the sidebar target", () => {
    const target = pickPinnedCommentableFile(
        { path: "image.png", extension: "png" },
        { path: "doc.md", extension: "md" },
        { path: "last-note.md", extension: "md" },
        (file): file is MockFile => !!file && file.extension === "md",
    );

    assert.deepEqual(target, { path: "doc.md", extension: "md" });
});

test("fixed file-open keeps the last normal note while still targeting SideNote2 index", () => {
    const plugin = new MockPlugin();
    const openedFile = plugin.handleFileOpenFixed({
        path: ALL_COMMENTS_NOTE_PATH,
        extension: "md",
    });

    assert.deepEqual(openedFile, { path: ALL_COMMENTS_NOTE_PATH, extension: "md" });
    assert.deepEqual(plugin.activeMarkdownFile, { path: "last-note.md", extension: "md" });
});

test("workspace file targets preserve the last markdown note while pointing the sidebar at index", () => {
    const target = resolveWorkspaceFileTargets(
        { path: ALL_COMMENTS_NOTE_PATH, extension: "md" },
        { path: "last-note.md", extension: "md" },
        null,
        (file): file is MockFile => !!file && file.extension === "md" && file.path !== ALL_COMMENTS_NOTE_PATH,
        (file): file is MockFile => !!file && file.extension === "md",
    );

    assert.deepEqual(target.activeMarkdownFile, { path: "last-note.md", extension: "md" });
    assert.deepEqual(target.activeSidebarFile, { path: ALL_COMMENTS_NOTE_PATH, extension: "md" });
    assert.deepEqual(target.sidebarFile, { path: ALL_COMMENTS_NOTE_PATH, extension: "md" });
});

test("workspace file targets preserve the current sidebar file when leaf changes temporarily lose the file", () => {
    const target = resolveWorkspaceFileTargets(
        null,
        { path: "last-note.md", extension: "md" },
        { path: ALL_COMMENTS_NOTE_PATH, extension: "md" },
        (file): file is MockFile => !!file && file.extension === "md" && file.path !== ALL_COMMENTS_NOTE_PATH,
        (file): file is MockFile => !!file && file.extension === "md",
    );

    assert.deepEqual(target.activeMarkdownFile, { path: "last-note.md", extension: "md" });
    assert.deepEqual(target.activeSidebarFile, { path: ALL_COMMENTS_NOTE_PATH, extension: "md" });
    assert.deepEqual(target.sidebarFile, { path: ALL_COMMENTS_NOTE_PATH, extension: "md" });
});

test("workspace target input prefers the real active file when the event file is missing", () => {
    const resolved = resolveWorkspaceTargetInput(
        null,
        { path: "docs/file.pdf", extension: "pdf" },
    );

    assert.deepEqual(resolved, { path: "docs/file.pdf", extension: "pdf" });
});

test("draft can stay tied to the source file while rendering in SideNote2 index", () => {
    const plugin = new MockPlugin();
    plugin.draftComment = { id: "comment-1", filePath: "Folder/Note.md" };
    plugin.draftHostFilePath = ALL_COMMENTS_NOTE_PATH;

    assert.deepEqual(plugin.getDraftForFile("Folder/Note.md"), {
        id: "comment-1",
        filePath: "Folder/Note.md",
    });
    assert.deepEqual(plugin.getDraftForView(ALL_COMMENTS_NOTE_PATH), {
        id: "comment-1",
        filePath: "Folder/Note.md",
    });
    assert.equal(plugin.getDraftForView("Folder/Note.md"), null);
});

test("fixed index actions can target a page note that only exists in the aggregate index", () => {
    const plugin = new MockPlugin();
    plugin.aggregateComments = [{
        id: "page-note-1",
        filePath: "Folder/Note.md",
        anchorKind: "page",
    }];

    assert.equal(plugin.getDeleteTargetOld("page-note-1"), null);
    assert.deepEqual(plugin.getDeleteTargetFixed("page-note-1"), {
        id: "page-note-1",
        filePath: "Folder/Note.md",
        anchorKind: "page",
    });
});

test("old reveal flow creates a new tab when the target file is not already open", () => {
    const plugin = new MockPlugin();
    const target = plugin.getRevealTargetOld([
        { id: "sidebar", kind: "sidebar", active: true },
        { id: "main-1", kind: "file", filePath: ALL_COMMENTS_NOTE_PATH, recent: true },
    ], "Folder/Note.md");

    assert.equal(target, "new-tab");
});

test("fixed reveal flow reuses an existing file leaf instead of forcing a new tab", () => {
    const plugin = new MockPlugin();
    const target = plugin.getRevealTargetFixed([
        { id: "sidebar", kind: "sidebar", active: true },
        { id: "main-1", kind: "file", filePath: ALL_COMMENTS_NOTE_PATH, recent: true },
    ], "Folder/Note.md");

    assert.equal(target, "main-1");
});

test("move flow reuses the exact open file leaf when the destination note is already open", () => {
    const plugin = new MockPlugin();
    const target = plugin.getMoveTargetFixed([
        { id: "sidebar", kind: "sidebar", active: true },
        { id: "main-1", kind: "file", filePath: "Folder/Other.md", recent: true },
        { id: "main-2", kind: "file", filePath: ALL_COMMENTS_NOTE_PATH },
    ], "Folder/Other.md");

    assert.equal(target, "main-1");
});

test("move flow opens a new tab when the destination note is not already open", () => {
    const plugin = new MockPlugin();
    const target = plugin.getMoveTargetFixed([
        { id: "sidebar", kind: "sidebar", active: true },
        { id: "main-1", kind: "file", filePath: ALL_COMMENTS_NOTE_PATH, recent: true },
    ], "Folder/Other.md");

    assert.equal(target, "new-tab");
});

test("anchored reveal scroll target keeps the stored character range when no re-resolved anchor is available", () => {
    assert.deepEqual(
        buildCommentRevealScrollTarget({
            startLine: 378,
            startChar: 1026,
            endLine: 378,
            endChar: 1043,
        }),
        {
            from: { line: 378, ch: 1026 },
            to: { line: 378, ch: 1043 },
        },
    );
});

test("anchored reveal scroll target prefers the resolved anchor range when it changes", () => {
    assert.deepEqual(
        buildCommentRevealScrollTarget(
            {
                startLine: 378,
                startChar: 1026,
                endLine: 378,
                endChar: 1043,
            },
            {
                startLine: 379,
                startChar: 14,
                endLine: 379,
                endChar: 31,
            },
        ),
        {
            from: { line: 379, ch: 14 },
            to: { line: 379, ch: 31 },
        },
    );
});

test("sidebar reveal helper skips revealing an existing sidebar leaf for index-origin sync", () => {
    assert.equal(shouldRevealSidebarLeaf(false, false), false);
    assert.equal(shouldRevealSidebarLeaf(undefined, false), true);
    assert.equal(shouldRevealSidebarLeaf(false, true), true);
});

test("index sidebar scope root follows the target draft file when the sidebar is showing the index", () => {
    assert.equal(
        resolveIndexSidebarScopeRootPath(
            ALL_COMMENTS_NOTE_PATH,
            "Folder/Note.md",
            (filePath) => filePath === ALL_COMMENTS_NOTE_PATH,
        ),
        "Folder/Note.md",
    );
});

test("index sidebar scope root stays unchanged for non-index sidebar targets", () => {
    assert.equal(
        resolveIndexSidebarScopeRootPath(
            "Folder/Note.md",
            "Folder/Other.md",
            (filePath) => filePath === ALL_COMMENTS_NOTE_PATH,
        ),
        null,
    );
});

test("fixed aggregate refresh skips open index view when content is unchanged", () => {
    const shouldSkipOldAggregateRefresh = (currentContent: string, nextContent: string): boolean =>
        currentContent === nextContent;

    assert.equal(shouldSkipOldAggregateRefresh("same", "same"), true);
    assert.equal(shouldSkipAggregateViewRefresh("same", "same", true), true);
    assert.equal(shouldSkipAggregateViewRefresh("same", "same", false), true);
});

test("fixed index preview mode returns non-index files to live preview", () => {
    const plugin = new MockPlugin();
    const indexLeaf = plugin.syncIndexLeafModeFixed({
        id: "main-1",
        kind: "file",
        filePath: ALL_COMMENTS_NOTE_PATH,
        mode: "source",
        source: true,
    });
    const noteLeaf = plugin.syncIndexLeafModeFixed({
        ...indexLeaf,
        filePath: "Folder/Note.md",
    });

    assert.equal(indexLeaf.mode, "preview");
    assert.equal(indexLeaf.source, false);
    assert.equal(noteLeaf.mode, "source");
    assert.equal(noteLeaf.source, false);
});

test("fixed index preview mode converts true source mode back to live preview", () => {
    const plugin = new MockPlugin();
    const noteLeaf = plugin.syncIndexLeafModeFixed({
        id: "main-1",
        kind: "file",
        filePath: "Folder/Note.md",
        mode: "source",
        source: true,
    });

    assert.equal(noteLeaf.mode, "source");
    assert.equal(noteLeaf.source, false);
});

test("old index preview mode leaks preview onto the next file in the same leaf", () => {
    const plugin = new MockPlugin();
    const indexLeaf = plugin.syncIndexLeafModeOld({
        id: "main-1",
        kind: "file",
        filePath: ALL_COMMENTS_NOTE_PATH,
        mode: "source",
    });
    const noteLeaf = plugin.syncIndexLeafModeOld({
        ...indexLeaf,
        filePath: "Folder/Note.md",
    });

    assert.equal(indexLeaf.mode, "preview");
    assert.equal(noteLeaf.mode, "preview");
});
