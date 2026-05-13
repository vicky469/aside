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
            "See obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1 next.",
        ),
        "See [obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1](obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1) next.",
    );
});

test("normalizeCommentMarkdownForRenderWithOptions uses custom side note link labels", () => {
    assert.equal(
        normalizeCommentMarkdownForRenderWithOptions(
            "See obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1 next.",
            {
                resolveSideNoteReferenceLabel: () => "alpha: selected text",
            },
        ),
        "See [alpha: selected text](obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1) next.",
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

test("normalizeCommentMarkdownForRender leaves blank-line paragraphs outside the previous bullet", () => {
    assert.equal(
        normalizeCommentMarkdownForRender(
            "- The Innovator's Solution (Clayton Christensen, with Michael Raynor): This explains why strong companies still get disrupted, and what to do about it.\n\nShort version: Drucker teaches how to operate effectively; Christensen teaches how to avoid being outflanked while scaling.",
        ),
        "- The Innovator's Solution (Clayton Christensen, with Michael Raynor): This explains why strong companies still get disrupted, and what to do about it.\n\nShort version: Drucker teaches how to operate effectively; Christensen teaches how to avoid being outflanked while scaling.",
    );
});

test("normalizeCommentMarkdownForRender leaves top-level headings outside a list after a blank line", () => {
    assert.equal(
        normalizeCommentMarkdownForRender("- item\n\n## next section"),
        "- item\n\n## next section",
    );
});

test("normalizeCommentMarkdownForRender preserves explicitly indented continuation paragraphs inside bullet items", () => {
    assert.equal(
        normalizeCommentMarkdownForRender("- item\n\n  Continued detail"),
        "- item\n\n  Continued detail",
    );
});

test("normalizeCommentMarkdownForRender makes multiline bold list blocks renderable", () => {
    assert.equal(
        normalizeCommentMarkdownForRender([
            "**When evaluating opportunities, ask:",
            "- Is a real customer using this weekly?",
            "- Does it reduce labor, defects, downtime, or cost?",
            "- Can it survive outside a staged demo?",
            "- Does the team care about deployment and maintenance?",
            "- Will I build skills that compound across many hardware products?**",
        ].join("\n")),
        [
            "**When evaluating opportunities, ask:**",
            "- **Is a real customer using this weekly?**",
            "- **Does it reduce labor, defects, downtime, or cost?**",
            "- **Can it survive outside a staged demo?**",
            "- **Does the team care about deployment and maintenance?**",
            "- **Will I build skills that compound across many hardware products?**",
        ].join("\n"),
    );
});
