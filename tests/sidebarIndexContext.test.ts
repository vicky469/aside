import * as assert from "node:assert/strict";
import test from "node:test";
import { ALL_COMMENTS_NOTE_PATH } from "../src/core/allCommentsNote";

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
}

class MockPlugin {
    public activeMarkdownFile: MockFile | null = { path: "last-note.md", extension: "md" };
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
        if (activeFile && activeFile.extension === "md") {
            return activeFile;
        }

        return this.activeMarkdownFile;
    }

    handleFileOpenOld(file: MockFile | null): MockFile | null {
        if (!(file && file.extension === "md") || file.path === ALL_COMMENTS_NOTE_PATH) {
            return null;
        }

        this.activeMarkdownFile = file;
        return file;
    }

    handleFileOpenFixed(file: MockFile | null): MockFile | null {
        if (!(file && file.extension === "md")) {
            return null;
        }

        if (file.path !== ALL_COMMENTS_NOTE_PATH) {
            this.activeMarkdownFile = file;
        }

        return file;
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
        const exactLeaf = leaves.find((leaf) => leaf.kind === "file" && leaf.filePath === filePath);
        if (exactLeaf) {
            return exactLeaf.id;
        }

        const activeFileLeaf = leaves.find((leaf) => leaf.kind === "file" && leaf.active);
        if (activeFileLeaf) {
            return activeFileLeaf.id;
        }

        const recentFileLeaf = leaves.find((leaf) => leaf.kind === "file" && leaf.recent);
        if (recentFileLeaf) {
            return recentFileLeaf.id;
        }

        const anyFileLeaf = leaves.find((leaf) => leaf.kind === "file");
        return anyFileLeaf?.id ?? "existing-or-new";
    }

    shouldSkipAggregateViewRefreshOld(currentContent: string, nextContent: string): boolean {
        return currentContent === nextContent;
    }

    shouldSkipAggregateViewRefreshFixed(currentContent: string, nextContent: string, hasOpenView: boolean): boolean {
        return currentContent === nextContent && !hasOpenView;
    }

    syncIndexLeafModeOld(leaf: MockLeaf): MockLeaf {
        if (leaf.kind === "file" && leaf.filePath === ALL_COMMENTS_NOTE_PATH) {
            return { ...leaf, mode: "preview" };
        }

        return leaf;
    }

    syncIndexLeafModeFixed(leaf: MockLeaf): MockLeaf {
        if (leaf.kind !== "file") {
            return leaf;
        }

        if (leaf.filePath === ALL_COMMENTS_NOTE_PATH) {
            return { ...leaf, mode: "preview" };
        }

        return { ...leaf, mode: "source" };
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

test("fixed file-open keeps the last normal note while still targeting SideNote2 index", () => {
    const plugin = new MockPlugin();
    const openedFile = plugin.handleFileOpenFixed({
        path: ALL_COMMENTS_NOTE_PATH,
        extension: "md",
    });

    assert.deepEqual(openedFile, { path: ALL_COMMENTS_NOTE_PATH, extension: "md" });
    assert.deepEqual(plugin.activeMarkdownFile, { path: "last-note.md", extension: "md" });
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

test("fixed aggregate refresh still updates an open index view when content is unchanged", () => {
    const plugin = new MockPlugin();

    assert.equal(plugin.shouldSkipAggregateViewRefreshOld("same", "same"), true);
    assert.equal(plugin.shouldSkipAggregateViewRefreshFixed("same", "same", true), false);
    assert.equal(plugin.shouldSkipAggregateViewRefreshFixed("same", "same", false), true);
});

test("fixed index preview mode returns non-index files to the default editing mode", () => {
    const plugin = new MockPlugin();
    const indexLeaf = plugin.syncIndexLeafModeFixed({
        id: "main-1",
        kind: "file",
        filePath: ALL_COMMENTS_NOTE_PATH,
        mode: "preview",
    });
    const noteLeaf = plugin.syncIndexLeafModeFixed({
        ...indexLeaf,
        filePath: "Folder/Note.md",
    });

    assert.equal(indexLeaf.mode, "preview");
    assert.equal(noteLeaf.mode, "source");
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
