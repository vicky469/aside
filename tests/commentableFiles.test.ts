import * as assert from "node:assert/strict";
import test from "node:test";
import { ALL_COMMENTS_NOTE_PATH } from "../src/core/derived/allCommentsNote";
import {
    isMarkdownCommentablePath,
    isPageNoteCapablePath,
    isPdfPageNotePath,
    isSidebarSupportedPath,
} from "../src/core/rules/commentableFiles";
import { getPageCommentLabel } from "../src/core/anchors/commentAnchors";

test("commentable file helpers distinguish markdown and index files", () => {
    assert.equal(isMarkdownCommentablePath("notes/tmp.md"), true);
    assert.equal(isMarkdownCommentablePath(ALL_COMMENTS_NOTE_PATH), false);
    assert.equal(isMarkdownCommentablePath("Aside custom.md", "Aside custom.md"), false);
    assert.equal(isMarkdownCommentablePath("aside/node_modules/pkg/README.md"), true);
    assert.equal(isMarkdownCommentablePath("aside/.worktrees/fix/README.md"), true);
    assert.equal(isMarkdownCommentablePath("repo/.git/COMMIT_EDITMSG.md"), true);
    assert.equal(isMarkdownCommentablePath("docs/paper.pdf"), false);

    assert.equal(isPdfPageNotePath("docs/paper.pdf"), true);
    assert.equal(isPdfPageNotePath("docs/report.docx"), false);

    assert.equal(isPageNoteCapablePath("notes/tmp.md"), true);
    assert.equal(isPageNoteCapablePath("docs/paper.pdf"), true);
    assert.equal(isPageNoteCapablePath(ALL_COMMENTS_NOTE_PATH), false);
    assert.equal(isPageNoteCapablePath("Aside custom.md", "Aside custom.md"), false);
    assert.equal(isPageNoteCapablePath("docs/report.docx"), false);

    assert.equal(isSidebarSupportedPath("notes/tmp.md"), true);
    assert.equal(isSidebarSupportedPath("docs/paper.pdf"), true);
    assert.equal(isSidebarSupportedPath(ALL_COMMENTS_NOTE_PATH), true);
    assert.equal(isSidebarSupportedPath("Aside custom.md", "Aside custom.md"), true);
    assert.equal(isSidebarSupportedPath("docs/report.docx"), false);
    assert.equal(isSidebarSupportedPath("aside/node_modules/pkg/README.md"), true);
});

test("page comment labels strip the final file extension", () => {
    assert.equal(getPageCommentLabel("notes/tmp.md"), "tmp");
    assert.equal(getPageCommentLabel("docs/Formal Methods.canvas"), "Formal Methods");
});
