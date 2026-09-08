import * as assert from "node:assert/strict";
import test from "node:test";
import { isActionableMention } from "../src/core/text/actionableMentions";
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

test("toggleMarkdownBold wraps multiline list selections per content line", () => {
    const value = [
        "When evaluating opportunities, ask:",
        "- Is a real customer using this weekly?",
        "- Does it reduce labor, defects, downtime, or cost?",
        "- Can it survive outside a staged demo?",
        "- Does the team care about deployment and maintenance?",
        "- Will I build skills that compound across many hardware products?",
    ].join("\n");
    const edit = toggleMarkdownBold(value, 0, value.length);

    assert.equal(edit.value, [
        "**When evaluating opportunities, ask:**",
        "- **Is a real customer using this weekly?**",
        "- **Does it reduce labor, defects, downtime, or cost?**",
        "- **Can it survive outside a staged demo?**",
        "- **Does the team care about deployment and maintenance?**",
        "- **Will I build skills that compound across many hardware products?**",
    ].join("\n"));
});

const registeredScripts = new Set(["/clean-youtube-transcript"]);
const isRecognizedMention = (mention: string) => isActionableMention(mention, {
    scriptsEnabled: true,
    isRunnableVaultScriptMention: (candidate) => registeredScripts.has(candidate.toLowerCase()),
});

test("renderStyledDraftCommentHtml highlights only actionable at mentions", () => {
	assert.equal(
		renderStyledDraftCommentHtml("Hi **@todo** and @codex and @hi", isRecognizedMention),
		"Hi **<span class=\"aside-editor-token-bold\"><span class=\"aside-editor-token-mention\">@todo</span></span>** and <span class=\"aside-editor-token-mention\">@codex</span> and @hi",
	);
});

test("renderStyledDraftCommentHtml does not treat emails as mentions", () => {
    assert.equal(
        renderStyledDraftCommentHtml("ping foo@example.com and @teammate", isRecognizedMention),
        "ping foo@example.com and @teammate",
    );
});

test("renderStyledDraftCommentHtml keeps html-like input inert", () => {
    const html = renderStyledDraftCommentHtml(
        "<script>alert(1)</script> <img src=x onerror=alert(1)> @safe",
        isRecognizedMention,
    );

    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /&gt; @safe$/u);
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("<img "));
});

test("renderStyledDraftCommentHtml highlights registered standalone slash mentions", () => {
    assert.equal(
        renderStyledDraftCommentHtml("Run /CLEAN-YOUTUBE-TRANSCRIPT now", isRecognizedMention),
        "Run <span class=\"aside-editor-token-mention\">/CLEAN-YOUTUBE-TRANSCRIPT</span> now",
    );
});

test("renderStyledDraftCommentHtml highlights enabled script-authoring commands", () => {
    assert.equal(
        renderStyledDraftCommentHtml("Use /create-script, /update-script, or /pdf-to-markdown", isRecognizedMention),
        "Use <span class=\"aside-editor-token-mention\">/create-script</span>, <span class=\"aside-editor-token-mention\">/update-script</span>, or <span class=\"aside-editor-token-mention\">/pdf-to-markdown</span>",
    );
});

test("renderStyledDraftCommentHtml hides script mentions when Scripts is disabled", () => {
    const disabledScriptsMention = (mention: string) => isActionableMention(mention, {
        scriptsEnabled: false,
        isRunnableVaultScriptMention: (candidate) => candidate.toLowerCase() === "/clean",
    });

    assert.equal(
        renderStyledDraftCommentHtml(
            "@todo @codex @claude @cursor @gemini @deepseek /create-script /update-script /pdf-to-markdown /clean",
            disabledScriptsMention,
        ),
        [
            "<span class=\"aside-editor-token-mention\">@todo</span>",
            "<span class=\"aside-editor-token-mention\">@codex</span>",
            "<span class=\"aside-editor-token-mention\">@claude</span>",
            "<span class=\"aside-editor-token-mention\">@cursor</span>",
            "<span class=\"aside-editor-token-mention\">@gemini</span>",
            "<span class=\"aside-editor-token-mention\">@deepseek</span>",
            "/create-script",
            "/update-script",
            "/pdf-to-markdown",
            "/clean",
        ].join(" "),
    );
});

test("renderStyledDraftCommentHtml leaves unregistered slash mentions plain", () => {
    assert.equal(
        renderStyledDraftCommentHtml("Run /missing now", isRecognizedMention),
        "Run /missing now",
    );
});

test("renderStyledDraftCommentHtml rejects slash mentions without a registry predicate", () => {
    assert.equal(renderStyledDraftCommentHtml("Run /clean now"), "Run /clean now");
});

test("renderStyledDraftCommentHtml does not partially highlight paths or urls", () => {
    const acceptEveryCandidate = () => true;
    const value = [
        "/Users/example/note.md",
        "folder/clean",
        "https://example.com/path",
        "C:/Users/name",
        "./clean",
        "../clean",
        "~/clean",
        "C:/clean",
    ].join(" ");

    assert.equal(renderStyledDraftCommentHtml(value, acceptEveryCandidate), value);
});

test("renderStyledDraftCommentHtml leaves unsupported at mentions plain", () => {
    assert.equal(
        renderStyledDraftCommentHtml("@todo @hi /missing", isRecognizedMention),
        "<span class=\"aside-editor-token-mention\">@todo</span> @hi /missing",
    );
});
