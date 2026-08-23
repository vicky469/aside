import * as assert from "node:assert/strict";
import test from "node:test";
import {
    PDF_TO_MARKDOWN_USAGE,
    derivePdfToMarkdownDestinationPath,
    parsePdfToMarkdownDirective,
} from "../src/core/text/pdfToMarkdownDirective";

test("pdf-to-markdown parser accepts only one standalone command", () => {
    assert.deepEqual(parsePdfToMarkdownDirective(" /pdf-to-markdown \n"), { kind: "request" });
    assert.deepEqual(parsePdfToMarkdownDirective("ordinary note"), { kind: "none" });
    assert.deepEqual(parsePdfToMarkdownDirective("docs/pdf-to-markdown"), { kind: "none" });
    assert.deepEqual(parsePdfToMarkdownDirective("/pdf-to-markdown-extra"), { kind: "none" });
});

test("pdf-to-markdown derives one case-insensitive sibling Markdown path", () => {
    assert.equal(
        derivePdfToMarkdownDestinationPath("Books/Guide.PDF"),
        "Books/Guide.md",
    );
    assert.equal(derivePdfToMarkdownDestinationPath("Books/Guide.md"), null);
});

test("pdf-to-markdown parser rejects arguments and repeated commands", () => {
    assert.deepEqual(parsePdfToMarkdownDirective("/pdf-to-markdown please"), {
        kind: "rejected",
        message: PDF_TO_MARKDOWN_USAGE,
    });
    assert.deepEqual(parsePdfToMarkdownDirective("/pdf-to-markdown /pdf-to-markdown"), {
        kind: "rejected",
        message: "Use /pdf-to-markdown only once per side note.",
    });
});
