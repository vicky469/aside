import * as assert from "node:assert/strict";
import test from "node:test";
import { shortenBareUrlsInMarkdown, stripMarkdownLinksForPreview } from "../src/core/text/commentUrls";

test("shortenBareUrlsInMarkdown converts long tracking urls into markdown links", () => {
    const input = "Reference https://www.shipmonk.com/resources/content-hub/dropshipping-with-a-fulfillment-company?utm_source=google&utm_medium=cpc&utm_campaign=summer";

    assert.equal(
        shortenBareUrlsInMarkdown(input),
        "Reference [shipmonk.com/resources/.../dropshipping-with-a-fulfillment-company](https://www.shipmonk.com/resources/content-hub/dropshipping-with-a-fulfillment-company?utm_source=google&utm_medium=cpc&utm_campaign=summer)",
    );
});

test("shortenBareUrlsInMarkdown leaves markdown links and inline code untouched", () => {
    const input = [
        "Keep [docs](https://example.com/guide) as-is.",
        "Use `https://example.com/inside-code?utm_source=test` in code.",
    ].join("\n");

    assert.equal(shortenBareUrlsInMarkdown(input), input);
});

test("shortenBareUrlsInMarkdown leaves fenced code blocks untouched", () => {
    const input = [
        "```md",
        "https://example.com/articles/very-long-path-name?utm_source=test&utm_medium=email",
        "```",
    ].join("\n");

    assert.equal(shortenBareUrlsInMarkdown(input), input);
});

test("stripMarkdownLinksForPreview keeps only the link label text", () => {
    assert.equal(
        stripMarkdownLinksForPreview("See [shipmonk.com/resources/.../dropshipping](https://www.shipmonk.com/abc?utm_source=google) next."),
        "See shipmonk.com/resources/.../dropshipping next.",
    );
});
