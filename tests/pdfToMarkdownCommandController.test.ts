import * as assert from "node:assert/strict";
import test from "node:test";
import { PdfToMarkdownCommandController } from "../src/agents/pdfToMarkdownCommandController";
import type { SavedUserEntryEvent } from "../src/core/comments/savedUserEntry";

function event(
    body: string,
    filePath: string,
    entryId = "entry-1",
): SavedUserEntryEvent {
    return {
        threadId: "thread-1",
        entryId,
        filePath,
        body,
    };
}

function createHarness() {
    const replies: string[] = [];
    const dispatchedFilePaths: string[] = [];
    const controller = new PdfToMarkdownCommandController({
        appendReply: async (_event, body) => {
            replies.push(body);
        },
        dispatchRequest: async (savedEvent) => {
            dispatchedFilePaths.push(savedEvent.filePath);
        },
    });

    return {
        controller,
        replies,
        dispatchedFilePaths,
    };
}

test("pdf-to-markdown dispatches one PDF request and claims duplicate saves", async () => {
    const harness = createHarness();
    const saved = event("/pdf-to-markdown", "Books/Guide.PDF");

    assert.equal(await harness.controller.handleSavedUserEntry(saved), true);
    assert.equal(await harness.controller.handleSavedUserEntry(saved), true);
    assert.deepEqual(harness.dispatchedFilePaths, ["Books/Guide.PDF"]);
    assert.deepEqual(harness.replies, []);
});

test("pdf-to-markdown rejects non-PDF and malformed requests before dispatch", async () => {
    const harness = createHarness();

    await harness.controller.handleSavedUserEntry(event(
        "/pdf-to-markdown",
        "Books/Guide.md",
    ));
    await harness.controller.handleSavedUserEntry(event(
        "/pdf-to-markdown please",
        "Books/Guide.pdf",
        "entry-2",
    ));

    assert.deepEqual(harness.dispatchedFilePaths, []);
    assert.deepEqual(harness.replies, [
        "Open a PDF and use /pdf-to-markdown.",
        "Use /pdf-to-markdown by itself on a PDF.",
    ]);
});

test("pdf-to-markdown ignores unrelated entries and resets idempotency on disposal", async () => {
    const harness = createHarness();
    assert.equal(await harness.controller.handleSavedUserEntry(event(
        "ordinary note",
        "Books/Guide.pdf",
    )), false);

    const saved = event("/pdf-to-markdown", "Books/Guide.pdf");
    await harness.controller.handleSavedUserEntry(saved);
    harness.controller.dispose();
    await harness.controller.handleSavedUserEntry(saved);
    assert.deepEqual(harness.dispatchedFilePaths, ["Books/Guide.pdf", "Books/Guide.pdf"]);
});
