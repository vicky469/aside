import * as assert from "node:assert/strict";
import test from "node:test";
import { continueMarkdownList } from "../src/ui/editor/commentEditorFormatting";

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
