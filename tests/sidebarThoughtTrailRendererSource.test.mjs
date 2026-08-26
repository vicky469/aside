import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/ui/views/sidebarThoughtTrailRenderer.ts", "utf8");
const asideViewSource = readFileSync("src/ui/views/AsideView.ts", "utf8");
const obsoleteGroupedPlannerName = ["buildTagGrouped", "RelatedFiles"].join("");

test("tag related files render one semantic unique-file list", () => {
    assert.match(source, /createDiv\(\{\s*cls:\s*"aside-tag-related-current-file"/);
    assert.match(source, /setTooltip\(currentFileEl,\s*model\.currentFile\.filePath\)/);
    const rootLists = source.match(/createEl\("ul",\s*\{\s*cls:\s*"aside-tag-related-files"/g) ?? [];
    assert.equal(rootLists.length, 1, "related files should use exactly one semantic list");
    assert.match(source, /createEl\("li",\s*\{[\s\S]*?cls:\s*"aside-tag-related-file-row"/);
    assert.match(source, /createEl\("button",\s*\{\s*cls:\s*"aside-tag-related-file-link"/);
    assert.match(source, /data-file-path/);
    assert.match(source, /aside-tag-related-file-tags/);
    assert.match(source, /aside-tag-related-file-tag/);
    assert.match(source, /setTooltip\(btn,\s*filePath\)/);
    assert.doesNotMatch(source, /aside-tag-related-files-group/);
    assert.doesNotMatch(source, /aside-tag-related-files-tag-header/);
    assert.doesNotMatch(source, /aside-tag-related-files-list/);
});

test("tag filters are accessible, single-select, and hide rows from the existing set", () => {
    assert.match(source, /cls:\s*"aside-tag-related-filter-bar"/);
    assert.match(source, /aria-label["']?:\s*"Filter related files by tag"/);
    assert.match(source, /label:\s*`All · \$\{model\.files\.length\}`/);
    assert.match(source, /"aria-pressed":\s*String\(definition\.tagKey\s*===\s*null\)/);
    assert.match(source, /addEventListener\("click",\s*\(\)\s*=>\s*\{\s*applyFilter\(definition\.tagKey\)/);
    assert.match(source, /button\.setAttribute\("aria-pressed",\s*String\(isSelected\)\)/);
    assert.match(source, /button\.classList\.toggle\("is-selected",\s*isSelected\)/);
    assert.match(source, /rowEl\.hidden\s*=\s*selectedTagKey\s*!==\s*null/);
    assert.match(source, /file\.tags\.some\(\(tag\)\s*=>\s*tag\.tagKey\s*===\s*selectedTagKey\)/);
    assert.match(source, /applyFilter\(null\);/);
});

test("AsideView uses the unique file-set planner for tag-source availability", () => {
    assert.match(asideViewSource, /buildTagRelatedFileSetModel/);
    assert.match(
        asideViewSource,
        /buildTagRelatedFileSetModel\([\s\S]*?\)\.files\.length\s*>\s*0/,
    );
    const availabilityCalls = asideViewSource.match(/this\.hasThoughtTrailTagRelatedFiles\(/g) ?? [];
    assert.equal(availabilityCalls.length, 3, "index and both note availability paths should share one helper");
    assert.match(
        asideViewSource,
        /private resolveThoughtTrailSource\(hasTagRelatedFiles:\s*boolean\):\s*SidebarThoughtTrailSource/,
    );
    assert.match(asideViewSource, /this\.resolveThoughtTrailSource\(hasIndexThoughtTrailTagSource\)/);
    assert.match(asideViewSource, /this\.resolveThoughtTrailSource\(hasThoughtTrailTagSource\)/);
    assert.equal(asideViewSource.includes(obsoleteGroupedPlannerName), false);
});

test("clickable thought trail nodes receive native full-path tooltips", () => {
    assert.match(
        source,
        /import\s*\{[\s\S]*?setTooltip,[\s\S]*?\}\s*from\s*"obsidian";/,
        "renderer should use Obsidian's native tooltip API",
    );
    assert.match(
        source,
        /const filePath = resolveThoughtTrailNodeFilePath\([\s\S]*?element\.getAttribute\("data-id"\),[\s\S]*?element\.getAttribute\("id"\),[\s\S]*?clickTargets,[\s\S]*?\);/,
        "renderer should resolve each node through the shared click-target owner",
    );
    assert.match(
        source,
        /if \(filePath\) \{\s*setTooltip\(element as HTMLElement, filePath\);\s*\}/,
        "renderer should attach the complete resolved path to the clickable node",
    );
});
