import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/ui/views/sidebarTagFileList.ts", "utf8");

test("shared tag file filters are native and accessible", () => {
    assert.match(source, /export function renderSidebarTagFilterBar/);
    assert.match(source, /cls:\s*"aside-tag-related-filter-bar"/);
    assert.match(source, /role:\s*"group"/);
    assert.match(source, /createEl\("button"/);
    assert.match(source, /type:\s*"button"/);
    assert.match(source, /"aria-pressed"/);
    assert.match(source, /filter\.fileCount/);
    assert.match(source, /onChange\(filter\.tagKey\)/);
});

test("shared tag file rows keep paths tags and injected navigation", () => {
    assert.match(source, /export function renderSidebarTagFileRows/);
    assert.match(source, /createEl\("ul",\s*\{\s*cls:\s*"aside-tag-related-files"/);
    assert.match(source, /cls:\s*"aside-tag-related-file-row"/);
    assert.match(source, /"data-file-path":\s*file\.filePath/);
    assert.match(source, /cls:\s*"aside-tag-related-file-link"/);
    assert.match(source, /setTooltip\(buttonEl,\s*file\.filePath\)/);
    assert.match(source, /options\.onOpenFile\(file\.filePath\)/);
    assert.match(source, /aside-tag-related-file-path/);
    assert.match(source, /aside-tag-related-file-tags/);
    assert.match(source, /aside-tag-related-file-tag/);
});

test("shared tag file rendering has no mutation surface", () => {
    assert.doesNotMatch(
        source,
        /applyTag|removeTag|createTag|checkbox|BatchTag|selectedThread|commentMutation/,
    );
});
