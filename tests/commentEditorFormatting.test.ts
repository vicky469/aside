import * as assert from "node:assert/strict";
import test from "node:test";
import { continueMarkdownList, toggleMarkdownBold, toggleMarkdownHighlight } from "../src/ui/editor/commentEditorFormatting";
import { renderStyledDraftCommentHtml } from "../src/ui/editor/commentEditorStyling";

test("continueMarkdownList continues unordered list items on enter", () => {
    const edit = continueMarkdownList("- first item", 12, 12);

    assert.deepEqual(edit, {
        value: "- first item\n- ",
        selectionStart: 15,
        selectionEnd: 15,
    });
});

test("continueMarkdownList continues ordered list items on enter", () => {
    const edit = continueMarkdownList("1. first item", 13, 13);

    assert.deepEqual(edit, {
        value: "1. first item\n2. ",
        selectionStart: 17,
        selectionEnd: 17,
    });
});

test("continueMarkdownList continues alphabetic list items on enter", () => {
    const edit = continueMarkdownList("a. first item", 13, 13);

    assert.deepEqual(edit, {
        value: "a. first item\nb. ",
        selectionStart: 17,
        selectionEnd: 17,
    });
});

test("continueMarkdownList exits an empty bullet item instead of nesting forever", () => {
    const edit = continueMarkdownList("Title\n- ", 8, 8);

    assert.deepEqual(edit, {
        value: "Title\n",
        selectionStart: 6,
        selectionEnd: 6,
    });
});

test("continueMarkdownList exits an empty alphabetic item", () => {
    const edit = continueMarkdownList("Title\na. ", 9, 9);

    assert.deepEqual(edit, {
        value: "Title\n",
        selectionStart: 6,
        selectionEnd: 6,
    });
});

test("continueMarkdownList ignores non-list lines", () => {
    assert.equal(continueMarkdownList("plain text", 10, 10), null);
});

test("toggleMarkdownHighlight wraps the current selection", () => {
    const edit = toggleMarkdownHighlight("alpha beta", 6, 10);

    assert.deepEqual(edit, {
        value: "alpha ==beta==",
        selectionStart: 8,
        selectionEnd: 12,
    });
});

test("toggleMarkdownHighlight removes surrounding markers when the selection is already highlighted", () => {
    const edit = toggleMarkdownHighlight("alpha ==beta==", 8, 12);

    assert.deepEqual(edit, {
        value: "alpha beta",
        selectionStart: 6,
        selectionEnd: 10,
    });
});

test("toggleMarkdownHighlight unwraps a fully selected highlighted span", () => {
    const edit = toggleMarkdownHighlight("alpha ==beta==", 6, 14);

    assert.deepEqual(edit, {
        value: "alpha beta",
        selectionStart: 6,
        selectionEnd: 10,
    });
});

test("toggleMarkdownHighlight inserts paired markers when there is no selection", () => {
    const edit = toggleMarkdownHighlight("alpha", 5, 5);

    assert.deepEqual(edit, {
        value: "alpha====",
        selectionStart: 7,
        selectionEnd: 7,
    });
});

test("toggleMarkdownHighlight skips unordered list markers when the full line is selected", () => {
    const value = "- indexing/cache layer";
    const edit = toggleMarkdownHighlight(value, 0, value.length);

    assert.deepEqual(edit, {
        value: "- ==indexing/cache layer==",
        selectionStart: 4,
        selectionEnd: value.length + 2,
    });
});

test("toggleMarkdownBold skips ordered list markers when the full line is selected", () => {
    const value = "1. indexed item";
    const edit = toggleMarkdownBold(value, 0, value.length);

    assert.deepEqual(edit, {
        value: "1. **indexed item**",
        selectionStart: 5,
        selectionEnd: value.length + 2,
    });
});

test("toggleMarkdownHighlight skips alphabetic list markers when the full line is selected", () => {
    const value = "a. indexed item";
    const edit = toggleMarkdownHighlight(value, 0, value.length);

    assert.deepEqual(edit, {
        value: "a. ==indexed item==",
        selectionStart: 5,
        selectionEnd: value.length + 2,
    });
});

test("toggleMarkdownBold wraps the current selection", () => {
    const edit = toggleMarkdownBold("alpha beta", 6, 10);

    assert.deepEqual(edit, {
        value: "alpha **beta**",
        selectionStart: 8,
        selectionEnd: 12,
    });
});

test("toggleMarkdownBold inserts paired markers when there is no selection", () => {
    const edit = toggleMarkdownBold("alpha", 5, 5);

    assert.deepEqual(edit, {
        value: "alpha****",
        selectionStart: 7,
        selectionEnd: 7,
    });
});

test("toggleMarkdownBold unwraps a list item selection without touching the list marker", () => {
    const value = "- **indexed item**";
    const edit = toggleMarkdownBold(value, 0, value.length);

    assert.deepEqual(edit, {
        value: "- indexed item",
        selectionStart: 2,
        selectionEnd: 14,
    });
});

test("renderStyledDraftCommentHtml keeps bold markers and highlights mentions", () => {
    assert.equal(
        renderStyledDraftCommentHtml("Hi **@blue** and @green"),
        "Hi **<span class=\"sidenote2-editor-token-bold\"><span class=\"sidenote2-editor-token-mention\">@blue</span></span>** and <span class=\"sidenote2-editor-token-mention\">@green</span>",
    );
});

test("renderStyledDraftCommentHtml does not treat emails as mentions", () => {
    assert.equal(
        renderStyledDraftCommentHtml("ping foo@example.com and @teammate"),
        "ping foo@example.com and <span class=\"sidenote2-editor-token-mention\">@teammate</span>",
    );
});
