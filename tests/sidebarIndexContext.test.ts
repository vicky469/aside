import * as assert from "node:assert/strict";
import test from "node:test";
import { ALL_COMMENTS_NOTE_PATH } from "../src/core/allCommentsNote";

interface MockFile {
    path: string;
    extension: string;
}

class MockPlugin {
    public activeMarkdownFile: MockFile | null = { path: "last-note.md", extension: "md" };

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
