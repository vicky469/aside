import * as assert from "node:assert/strict";
import test from "node:test";
import {
    normalizeCommentMarkdownForRender,
    normalizeCommentMarkdownForRenderWithOptions,
} from "../src/ui/editor/commentMarkdownRendering";

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

test("normalizeCommentMarkdownForRender converts raw side note urls into clickable markdown links", () => {
    assert.equal(
        normalizeCommentMarkdownForRender(
            "See obsidian://side-note2-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1 next.",
        ),
        "See [obsidian://side-note2-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1](obsidian://side-note2-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1) next.",
    );
});

test("normalizeCommentMarkdownForRenderWithOptions uses custom side note link labels", () => {
    assert.equal(
        normalizeCommentMarkdownForRenderWithOptions(
            "See obsidian://side-note2-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1 next.",
            {
                resolveSideNoteReferenceLabel: () => "alpha: selected text",
            },
        ),
        "See [alpha: selected text](obsidian://side-note2-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1) next.",
    );
});

test("normalizeCommentMarkdownForRender converts LaTeX delimiters into Obsidian math syntax", () => {
    assert.equal(
        normalizeCommentMarkdownForRender(
            "Inline: \\(a+b\\)\n\n\\[\n\\mathrm{Var}(X+Y)=\\mathrm{Var}(X)+\\mathrm{Var}(Y)\n\\]",
        ),
        "Inline: $a+b$\n\n$$\n\\mathrm{Var}(X+Y)=\\mathrm{Var}(X)+\\mathrm{Var}(Y)\n$$",
    );
});

test("normalizeCommentMarkdownForRender leaves LaTeX delimiters alone inside code", () => {
    assert.equal(
        normalizeCommentMarkdownForRender("Code `\\(a+b\\)` stays literal.\n\n```tex\n\\[\na+b\n\\]\n```"),
        "Code `\\(a+b\\)` stays literal.\n\n```tex\n\\[\na+b\n\\]\n```",
    );
});

test("normalizeCommentMarkdownForRender keeps follow-up paragraphs inside bullet items", () => {
    assert.equal(
        normalizeCommentMarkdownForRender(
            "- cost-effective purchasing? ❌\nA seven-month inventory of stainless steel sheet? All kinds of stuff.\n\nNo, put it that way, and economical purchasing is definitely not the goal of this plant.\n\n- supplying jobs to people? ❌\nthe plant wasn't built for the purpose of paying wages and giving people something to do.\n\n- produce products？❌ \n   quality products? ❌ \n\n- low-cost production? efficiency + quality products? ❌\nBut can that goal keep the plant working?",
        ),
        "- cost-effective purchasing? ❌\nA seven-month inventory of stainless steel sheet? All kinds of stuff.\n\n  No, put it that way, and economical purchasing is definitely not the goal of this plant.\n\n- supplying jobs to people? ❌\nthe plant wasn't built for the purpose of paying wages and giving people something to do.\n\n- produce products？❌ \n   quality products? ❌ \n\n- low-cost production? efficiency + quality products? ❌\nBut can that goal keep the plant working?",
    );
});

test("normalizeCommentMarkdownForRender leaves top-level headings outside a list after a blank line", () => {
    assert.equal(
        normalizeCommentMarkdownForRender("- item\n\n## next section"),
        "- item\n\n## next section",
    );
});
