import * as assert from "node:assert/strict";
import test from "node:test";
import { ALL_COMMENTS_NOTE_PATH } from "../src/core/derived/allCommentsNote";
import {
    isMarkdownCommentablePath,
    isSidebarSupportedPath,
} from "../src/core/rules/commentableFiles";
import { getPageCommentLabel } from "../src/core/anchors/commentAnchors";

test("commentable file helpers distinguish markdown and index files", () => {
    assert.equal(isMarkdownCommentablePath("notes/tmp.md"), true);
    assert.equal(isMarkdownCommentablePath(ALL_COMMENTS_NOTE_PATH), false);
    assert.equal(isMarkdownCommentablePath("SideNote2 custom.md", "SideNote2 custom.md"), false);

    assert.equal(isSidebarSupportedPath("notes/tmp.md"), true);
    assert.equal(isSidebarSupportedPath("docs/paper.pdf"), false);
    assert.equal(isSidebarSupportedPath(ALL_COMMENTS_NOTE_PATH), true);
    assert.equal(isSidebarSupportedPath("SideNote2 custom.md", "SideNote2 custom.md"), true);
    assert.equal(isSidebarSupportedPath("docs/report.docx"), false);
});

test("page comment labels strip the final file extension", () => {
    assert.equal(getPageCommentLabel("notes/tmp.md"), "tmp");
    assert.equal(getPageCommentLabel("docs/Formal Methods.canvas"), "Formal Methods");
});
