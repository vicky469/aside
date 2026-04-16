import * as assert from "node:assert/strict";
import test from "node:test";
import { normalizeCommentMarkdownForRender } from "../src/ui/editor/commentMarkdownRendering";

test("normalizeCommentMarkdownForRender inserts a blank line before standalone dash rules", () => {
    assert.equal(
        normalizeCommentMarkdownForRender("Section title\n----\nBody"),
        "Section title\n\n----\nBody",
    );
});

test("normalizeCommentMarkdownForRender leaves existing horizontal rules intact", () => {
    assert.equal(
        normalizeCommentMarkdownForRender("Section title\n\n----\nBody"),
        "Section title\n\n----\nBody",
    );
});

test("normalizeCommentMarkdownForRender does not rewrite dash rules inside fenced code blocks", () => {
    assert.equal(
        normalizeCommentMarkdownForRender("```md\nTitle\n----\n```"),
        "```md\nTitle\n----\n```",
    );
});

test("normalizeCommentMarkdownForRender shortens legacy bare urls for rendering", () => {
    assert.equal(
        normalizeCommentMarkdownForRender("Check https://www.shipmonk.com/resources/content-hub/dropshipping-with-a-fulfillment-company?utm_source=google&utm_medium=cpc&utm_campaign=summer"),
        "Check [shipmonk.com/resources/.../dropshipping-with-a-fulfillment-company](https://www.shipmonk.com/resources/content-hub/dropshipping-with-a-fulfillment-company?utm_source=google&utm_medium=cpc&utm_campaign=summer)",
    );
});
