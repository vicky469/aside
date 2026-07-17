import * as assert from "node:assert/strict";
import test from "node:test";
import { createDraftPasteEdit } from "../src/ui/editor/commentEditorPaste";

function clipboardData(values: Record<string, string>) {
    return {
        getData(type: string): string {
            return values[type] ?? "";
        },
    };
}

test("createDraftPasteEdit inserts Obsidian-converted markdown from rich HTML clipboard data", () => {
    const html = [
        "<h2>JLCPCB</h2>",
        "<p>This one is especially interesting.</p>",
        "<blockquote><p>Upload files -> get boards in days</p></blockquote>",
        "<ul>",
        "<li>PCB fabrication</li>",
        "<li>PCB assembly</li>",
        "</ul>",
    ].join("");
    const plain = [
        "JLCPCB",
        "",
        "This one is especially interesting.",
        "",
        "Upload files -> get boards in days",
        "",
        "PCB fabrication",
        "PCB assembly",
    ].join("\n");

    const convertedMarkdown = [
        "## JLCPCB",
        "",
        "This one is especially interesting.",
        "",
        "> Upload files -> get boards in days",
        "",
        "- PCB fabrication",
        "- PCB assembly",
    ].join("\n");

    const edit = createDraftPasteEdit(
        "",
        0,
        0,
        clipboardData({
            "text/html": html,
            "text/plain": plain,
        }),
        () => convertedMarkdown,
    );

    assert.deepEqual(edit, {
        value: convertedMarkdown,
        selectionStart: convertedMarkdown.length,
        selectionEnd: convertedMarkdown.length,
    });
});

test("createDraftPasteEdit lets native paste handle plain text clipboard data", () => {
    assert.equal(
        createDraftPasteEdit(
            "Before\nAfter",
            7,
            7,
            clipboardData({
                "text/plain": "- already markdown",
            }),
            () => {
                throw new Error("should not convert without HTML");
            },
        ),
        null,
    );
});

test("createDraftPasteEdit compacts plain text Excalidraw clipboard data", () => {
    const excalidrawClipboard = JSON.stringify({
        type: "excalidraw/clipboard",
        elements: [{ id: "image-element", type: "image" }],
        files: {
            "image-file": {
                mimeType: "image/png",
                dataURL: `data:image/png;base64,${"a".repeat(120)}`,
            },
        },
    });

    const edit = createDraftPasteEdit(
        "Before\nAfter",
        7,
        7,
        clipboardData({
            "text/plain": excalidrawClipboard,
        }),
        () => {
            throw new Error("should not convert without HTML");
        },
    );

    assert.deepEqual(edit, {
        value: "Before\n[Excalidraw clipboard: 1 image, 1 element]After",
        selectionStart: 49,
        selectionEnd: 49,
    });
});

test("createDraftPasteEdit replaces the selected range with normalized rich Markdown", () => {
    const edit = createDraftPasteEdit(
        "Before OLD After",
        7,
        10,
        clipboardData({
            "text/html": "<p>New&nbsp;line</p>",
            "text/plain": "Different plain text",
        }),
        () => "\r\nNew\u00a0line\r\n",
    );

    assert.deepEqual(edit, {
        value: "Before New line After",
        selectionStart: 15,
        selectionEnd: 15,
    });
});

test("createDraftPasteEdit lets native paste handle equivalent rich and plain text", () => {
    assert.equal(createDraftPasteEdit(
        "Draft",
        5,
        5,
        clipboardData({
            "text/html": "<p>Same&nbsp;text</p>",
            "text/plain": "Same text",
        }),
        () => "Same\u00a0text",
    ), null);
});

test("createDraftPasteEdit lets native paste continue when HTML conversion fails", () => {
    assert.equal(createDraftPasteEdit(
        "Draft",
        5,
        5,
        clipboardData({ "text/html": "<strong>Text</strong>" }),
        () => { throw new Error("conversion failed"); },
    ), null);
});

test("createDraftPasteEdit replaces selected text with compact Excalidraw content", () => {
    const excalidrawClipboard = JSON.stringify({
        type: "excalidraw/clipboard",
        elements: [{ id: "shape", type: "rectangle" }],
        files: {},
    });

    assert.deepEqual(createDraftPasteEdit(
        "Before OLD After",
        7,
        10,
        clipboardData({ "text/plain": excalidrawClipboard }),
        () => { throw new Error("should not convert without HTML"); },
    ), {
        value: "Before [Excalidraw clipboard: 1 element] After",
        selectionStart: 40,
        selectionEnd: 40,
    });
});
