import * as assert from "node:assert/strict";
import test from "node:test";
import { getSidebarCommentCardOpenAction } from "../src/ui/views/sidebarCommentCardNavigation";

test("pinned markdown-file sidebars select comment cards without switching editor files", () => {
    assert.equal(
        getSidebarCommentCardOpenAction({
            isIndexView: false,
            isNonDesktopClient: false,
            isPinnedMarkdownFileSidebar: true,
        }),
        "select-only",
    );
});

test("index sidebars keep revealing the comment in the generated index note", () => {
    assert.equal(
        getSidebarCommentCardOpenAction({
            isIndexView: true,
            isNonDesktopClient: false,
            isPinnedMarkdownFileSidebar: true,
        }),
        "reveal-index",
    );
});

test("unpinned desktop markdown sidebars keep opening the comment in the editor", () => {
    assert.equal(
        getSidebarCommentCardOpenAction({
            isIndexView: false,
            isNonDesktopClient: false,
            isPinnedMarkdownFileSidebar: false,
        }),
        "open-editor",
    );
});

test("mobile sidebars keep selecting comment cards without editor reveal", () => {
    assert.equal(
        getSidebarCommentCardOpenAction({
            isIndexView: false,
            isNonDesktopClient: true,
            isPinnedMarkdownFileSidebar: false,
        }),
        "select-only",
    );
});
