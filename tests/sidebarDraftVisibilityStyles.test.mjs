import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/ui/views/sidebarDraftComment.ts", "utf8");
const styles = readFileSync("styles.css", "utf8");

function cssRuleBody(selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(
        `(?:^|\\n\\n)${escapedSelector}\\s*\\{(?<body>[\\s\\S]*?)\\n\\}`,
        "u",
    ).exec(styles);
    return match?.groups?.body ?? "";
}

test("draft editor resynchronizes preview when the textarea blurs", () => {
    assert.match(source, /textarea\.addEventListener\("blur", syncPreview\);/u);
    assert.match(
        source,
        /editorShell\.toggleClass\(\s*"is-preview-ready",\s*isDraftPreviewReady\(textarea\.value, preview\.textContent \?\? ""\),?\s*\)/u,
    );
});

test("draft editor hides textarea text only behind a ready visible preview", () => {
    const preview = cssRuleBody(".aside-inline-editor-preview");
    const textarea = cssRuleBody(".aside-inline-textarea");
    const readyPreview = cssRuleBody(
        ".aside-inline-editor-shell.is-preview-ready:not(:focus-within) .aside-inline-editor-preview",
    );
    const readyTextarea = cssRuleBody(
        ".aside-inline-editor-shell.is-preview-ready:not(:focus-within) .aside-inline-textarea",
    );

    assert.match(preview, /visibility:\s*hidden\s*;/u);
    assert.match(textarea, /color:\s*var\(--text-normal\)\s*;/u);
    assert.match(textarea, /-webkit-text-fill-color:\s*var\(--text-normal\)\s*;/u);
    assert.match(readyPreview, /visibility:\s*visible\s*;/u);
    assert.match(readyTextarea, /color:\s*transparent\s*;/u);
    assert.match(readyTextarea, /-webkit-text-fill-color:\s*transparent\s*;/u);
});
