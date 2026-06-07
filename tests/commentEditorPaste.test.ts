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
