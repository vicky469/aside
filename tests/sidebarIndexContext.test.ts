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
