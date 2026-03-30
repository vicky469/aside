import * as assert from "node:assert/strict";
import test from "node:test";
import { ALL_COMMENTS_NOTE_PATH } from "../src/core/allCommentsNote";
import {
    isAttachmentCommentablePath,
    isMarkdownCommentablePath,
    isSidebarSupportedPath,
} from "../src/core/commentableFiles";
import { getPageCommentLabel } from "../src/core/commentAnchors";

test("commentable file helpers distinguish markdown, PDF, and index files", () => {
    assert.equal(isMarkdownCommentablePath("notes/tmp.md"), true);
    assert.equal(isMarkdownCommentablePath(ALL_COMMENTS_NOTE_PATH), false);
    assert.equal(isMarkdownCommentablePath("SideNote2 custom.md", "SideNote2 custom.md"), false);
    assert.equal(isAttachmentCommentablePath("docs/paper.pdf"), true);
    assert.equal(isAttachmentCommentablePath("docs/report.docx"), false);

    assert.equal(isSidebarSupportedPath("notes/tmp.md"), true);
    assert.equal(isSidebarSupportedPath("docs/paper.pdf"), true);
    assert.equal(isSidebarSupportedPath(ALL_COMMENTS_NOTE_PATH), true);
    assert.equal(isSidebarSupportedPath("SideNote2 custom.md", "SideNote2 custom.md"), true);
    assert.equal(isSidebarSupportedPath("docs/report.docx"), false);
});

test("page comment labels strip the final file extension", () => {
    assert.equal(getPageCommentLabel("notes/tmp.md"), "tmp");
    assert.equal(getPageCommentLabel("docs/Formal Methods.pdf"), "Formal Methods");
});
