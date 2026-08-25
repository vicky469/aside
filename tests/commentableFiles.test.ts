import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import { ALL_COMMENTS_NOTE_PATH } from "../src/core/derived/allCommentsNote";
import {
    isMarkdownCommentablePath,
    isMarkdownCommentableFile,
    isHtmlPageNotePath,
    isPageNoteCapablePath,
    isPageNoteCapableFile,
    isSidebarSupportedPath,
    isSidebarSupportedFile,
} from "../src/core/rules/commentableFiles";
import { getPageCommentLabel } from "../src/core/anchors/commentAnchors";

function createFile(path: string): TFile {
    return { path } as TFile;
}

test("commentable file helpers distinguish markdown and HTML format rules", () => {
    assert.equal(isMarkdownCommentablePath("notes/tmp.md"), true);
    assert.equal(isMarkdownCommentablePath(ALL_COMMENTS_NOTE_PATH), false);
    assert.equal(isMarkdownCommentablePath("Aside custom.md", "Aside custom.md"), false);
    assert.equal(isMarkdownCommentablePath("aside/node_modules/pkg/README.md"), true);
    assert.equal(isMarkdownCommentablePath("aside/.worktrees/fix/README.md"), true);
    assert.equal(isMarkdownCommentablePath("repo/.git/COMMIT_EDITMSG.md"), true);
    assert.equal(isMarkdownCommentablePath("docs/paper.pdf"), false);

    assert.equal(isHtmlPageNotePath("share/page.html"), true);
    assert.equal(isHtmlPageNotePath("share/page.htm"), true);
    assert.equal(isHtmlPageNotePath("docs/report.docx"), false);
});

test("commentable file policy supports page notes and sidebars for vault file paths", () => {
    const supportedPaths = [
        "notes/tmp.md",
        "docs/paper.pdf",
        "share/page.html",
        "media/image.PNG",
        "media/interview.m4a",
        "media/demo.mp4",
        "maps/strategy.canvas",
        "docs/proposal.docx",
        "LICENSE",
    ];

    for (const filePath of supportedPaths) {
        const file = createFile(filePath);
        assert.equal(isPageNoteCapablePath(filePath), true, filePath);
        assert.equal(isSidebarSupportedPath(filePath), true, filePath);
        assert.equal(isPageNoteCapableFile(file), true, filePath);
        assert.equal(isSidebarSupportedFile(file), true, filePath);
    }

    assert.equal(isMarkdownCommentableFile(createFile("notes/tmp.md")), true);
    assert.equal(isMarkdownCommentableFile(createFile("docs/paper.pdf")), false);
    assert.equal(isPageNoteCapablePath(""), false);
    assert.equal(isPageNoteCapableFile(createFile("")), false);
    assert.equal(isPageNoteCapablePath(ALL_COMMENTS_NOTE_PATH), false);
    assert.equal(isPageNoteCapablePath("Aside custom.md", "Aside custom.md"), false);
    assert.equal(isPageNoteCapableFile(createFile(ALL_COMMENTS_NOTE_PATH)), false);
    assert.equal(isPageNoteCapableFile(createFile("Aside custom.md"), "Aside custom.md"), false);
    assert.equal(isSidebarSupportedPath(ALL_COMMENTS_NOTE_PATH), true);
    assert.equal(isSidebarSupportedPath("Aside custom.md", "Aside custom.md"), true);
    assert.equal(isSidebarSupportedFile(createFile(ALL_COMMENTS_NOTE_PATH)), true);
    assert.equal(isSidebarSupportedFile(createFile("Aside custom.md"), "Aside custom.md"), true);

    assert.equal(isMarkdownCommentableFile(null), false);
    assert.equal(isPageNoteCapableFile(null), false);
    assert.equal(isSidebarSupportedFile(null), false);
});

test("page comment labels strip the final file extension", () => {
    assert.equal(getPageCommentLabel("notes/tmp.md"), "tmp");
    assert.equal(getPageCommentLabel("docs/Formal Methods.canvas"), "Formal Methods");
});
