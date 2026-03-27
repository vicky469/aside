import * as assert from "node:assert/strict";
import test from "node:test";
import { getSelectedSidebarClipboardText } from "../src/ui/views/sidebarClipboardSelection";

test("getSelectedSidebarClipboardText returns null without a selection", () => {
    assert.equal(getSelectedSidebarClipboardText(null), null);
});

test("getSelectedSidebarClipboardText returns null for collapsed selections", () => {
    assert.equal(
        getSelectedSidebarClipboardText({
            isCollapsed: true,
            selectedText: "copied text",
            anchorInsideSidebar: true,
            focusInsideSidebar: true,
        }),
        null,
    );
});

test("getSelectedSidebarClipboardText returns null when the selection is outside the sidebar", () => {
    assert.equal(
        getSelectedSidebarClipboardText({
            isCollapsed: false,
            selectedText: "copied text",
            anchorInsideSidebar: true,
            focusInsideSidebar: false,
        }),
        null,
    );
});

test("getSelectedSidebarClipboardText returns selected sidebar text", () => {
    assert.equal(
        getSelectedSidebarClipboardText({
            isCollapsed: false,
            selectedText: "copied text",
            anchorInsideSidebar: true,
            focusInsideSidebar: true,
        }),
        "copied text",
    );
});
