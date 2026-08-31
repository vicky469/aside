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

test("related file rows render every shared model tag", () => {
    assert.match(
        source,
        /for \(const tag of file\.tags\) \{[\s\S]*?text:\s*`#\$\{tag\.tagDisplay\}`[\s\S]*?attr:\s*\{\s*"data-tag-key":\s*tag\.tagKey\s*\}/,
    );
});

test("per-tag filters use model tag displays and unique counts", () => {
    assert.match(
        source,
        /\.\.\.model\.tags\.map\(\(tag\)\s*=>\s*\(\{[\s\S]*?tagKey:\s*tag\.tagKey[\s\S]*?label:\s*`#\$\{tag\.tagDisplay\} · \$\{tag\.fileCount\}`/,
    );
});

test("tag filter bar exposes an explicit accessible group role", () => {
    assert.match(
        source,
        /cls:\s*"aside-tag-related-filter-bar"[\s\S]*?attr:\s*\{[\s\S]*?role:\s*"group"[\s\S]*?"aria-label":\s*"Filter related files by tag"/,
    );
});

test("tag filters are native non-submit buttons", () => {
    assert.match(
        source,
        /filterBarEl\.createEl\("button",\s*\{[\s\S]*?cls:\s*"aside-tag-related-filter"[\s\S]*?attr:\s*\{[\s\S]*?type:\s*"button"/,
    );
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
    assert.equal(asideViewSource.includes(obsoleteGroupedPlannerName), false);
});

test("AsideView discovers direct attachments and wires them into thought trail rendering", () => {
    assert.match(asideViewSource, /getDirectThoughtTrailAttachments/);
    assert.match(asideViewSource, /resolveThoughtTrailPresentationState/);
    const attachmentCalls = asideViewSource.match(/getDirectThoughtTrailAttachments\(/g) ?? [];
    assert.equal(attachmentCalls.length, 2, "index and note availability should each discover direct attachments exactly once");
    assert.match(
        asideViewSource,
        /thoughtTrailAttachments:\s*noteThoughtTrailAvailability\.thoughtTrailAttachments/,
        "note rendering should receive the retained availability snapshot",
    );
    assert.match(
        asideViewSource,
        /const thoughtTrailAttachments = options\.thoughtTrailAttachments/,
        "note rendering should consume the retained availability snapshot",
    );
    assert.match(asideViewSource, /attachments:\s*indexThoughtTrailAttachments/);
    assert.match(asideViewSource, /attachments:\s*thoughtTrailAttachments/);
});

test("AsideView resolves note and index presentation before thought-trail render branching", () => {
    const presentationCalls = asideViewSource.match(/resolveThoughtTrailPresentationState\(/g) ?? [];
    assert.equal(presentationCalls.length, 2, "note and index availability should share one presentation planner");

    const indexAvailabilityIndex = asideViewSource.indexOf("const isIndexThoughtTrailEnabled");
    const indexModeCaptureIndex = asideViewSource.indexOf(
        "const indexSidebarModeBeforeAvailability = effectiveIndexSidebarMode",
        indexAvailabilityIndex,
    );
    const indexPlannerIndex = asideViewSource.indexOf("resolveThoughtTrailPresentationState(", indexAvailabilityIndex);
    const indexRenderBranchIndex = asideViewSource.indexOf(
        'if (isAllCommentsView && effectiveIndexSidebarMode === "thought-trail")',
        indexPlannerIndex,
    );
    assert.ok(indexAvailabilityIndex >= 0 && indexAvailabilityIndex < indexModeCaptureIndex);
    assert.ok(indexModeCaptureIndex < indexPlannerIndex);
    assert.ok(indexPlannerIndex < indexRenderBranchIndex);
    assert.match(
        asideViewSource.slice(indexAvailabilityIndex, indexRenderBranchIndex),
        /if \(isAllCommentsView\) \{[\s\S]*?this\.thoughtTrailSource\s*=\s*indexThoughtTrailPresentationState\.source/,
        "index facts should update source only on the all-comments surface",
    );
    assert.match(
        asideViewSource.slice(indexModeCaptureIndex, indexRenderBranchIndex),
        /modeBefore:\s*indexSidebarModeBeforeAvailability/,
        "index availability telemetry should retain the mode from before presentation fallback",
    );
    assert.match(
        asideViewSource.slice(indexModeCaptureIndex, indexRenderBranchIndex),
        /if \(indexSidebarModeBeforeAvailability === "thought-trail" && effectiveIndexSidebarMode !== "thought-trail"\)/,
        "index fallback detection should compare the captured pre-plan mode",
    );

    const noteAvailabilityIndex = asideViewSource.indexOf("const noteThoughtTrailAvailability");
    const notePlannerIndex = asideViewSource.indexOf("resolveThoughtTrailPresentationState(", noteAvailabilityIndex);
    const noteRenderBranchIndex = asideViewSource.indexOf(
        'if (this.noteSidebarMode === "thought-trail")',
        notePlannerIndex,
    );
    assert.ok(noteAvailabilityIndex >= 0 && noteAvailabilityIndex < notePlannerIndex);
    assert.ok(notePlannerIndex < noteRenderBranchIndex);
    assert.match(
        asideViewSource.slice(noteAvailabilityIndex, noteRenderBranchIndex),
        /this\.thoughtTrailSource\s*=\s*noteThoughtTrailPresentationState\.source/,
    );
});

test("source control renders shared definitions with shared availability and dynamic scope", () => {
    assert.match(
        source,
        /import\s*\{[\s\S]*?SIDEBAR_THOUGHT_TRAIL_SOURCES,[\s\S]*?getThoughtTrailSourceDefinition,[\s\S]*?isThoughtTrailSourceAvailable,[\s\S]*?type SidebarThoughtTrailSourceAvailability,[\s\S]*?\}\s*from\s*"\.\/sidebarThoughtTrailSource";/,
    );
    assert.match(source, /sourceAvailability:\s*SidebarThoughtTrailSourceAvailability/);
    assert.match(source, /for \(const definition of SIDEBAR_THOUGHT_TRAIL_SOURCES\)/);
    assert.match(
        source,
        /const isDisabled\s*=\s*!isThoughtTrailSourceAvailable\(definition\.id,\s*options\.sourceAvailability\)/,
    );
    assert.match(source, /value:\s*definition\.id/);
    assert.match(source, /inputEl\.checked\s*=\s*options\.source\s*===\s*definition\.id/);
    assert.match(source, /inputEl\.disabled\s*=\s*isDisabled/);
    assert.match(source, /isDisabled\s*\?\s*" is-disabled"\s*:\s*""/);
    assert.match(source, /options\.onSourceChange\(definition\.id\)/);
    assert.match(source, /text:\s*definition\.label/);
    assert.match(
        source,
        /text:\s*`Scope: \$\{getThoughtTrailSourceDefinition\(options\.source\)\.scope\}`/,
    );
    assert.match(
        source,
        /const sourceAvailability:\s*SidebarThoughtTrailSourceAvailability\s*=\s*\{\s*tags:\s*tagRelatedFileSet\.files\.length\s*>\s*0,\s*attachments:\s*options\.attachments\.length\s*>\s*0,\s*\}/,
    );
    assert.match(source, /sourceAvailability,/);
    assert.doesNotMatch(source, /\["wikilinks",\s*"tags"\]/);
    assert.doesNotMatch(source, /source\s*===\s*"wikilinks"\s*\?\s*"Wikilinks"\s*:\s*"Tags"/);
});

test("attachment source renders a compact semantic file list", () => {
    assert.match(source, /if \(options\.source\s*===\s*"attachments"\)\s*\{/);
    const attachmentLists = source.match(/createEl\("ul",\s*\{\s*cls:\s*"aside-thought-trail-attachments"/g) ?? [];
    assert.equal(attachmentLists.length, 1, "attachments should use exactly one semantic list");
    assert.match(
        source,
        /for \(const attachment of options\.attachments\)\s*\{[\s\S]*?createEl\("li",\s*\{[\s\S]*?cls:\s*"aside-thought-trail-attachment-row"[\s\S]*?"data-file-path":\s*attachment\.filePath/,
    );
    assert.match(
        source,
        /createEl\("button",\s*\{[\s\S]*?cls:\s*"aside-thought-trail-attachment-link"[\s\S]*?text:\s*attachment\.label[\s\S]*?attr:\s*\{\s*type:\s*"button"\s*\}/,
    );
    assert.match(source, /setTooltip\(buttonEl,\s*attachment\.filePath\)/);
    assert.match(
        source,
        /createSpan\(\{\s*cls:\s*"aside-thought-trail-attachment-type",\s*text:\s*attachment\.typeLabel,?\s*\}\)/,
    );
    assert.match(
        source,
        /buttonEl\.addEventListener\("click",\s*\(\)\s*=>\s*\{\s*void openThoughtTrailFile\(attachment\.filePath,\s*context\)/,
    );
});

test("tag and attachment file links share the preferred-leaf path wrapper", () => {
    assert.match(
        source,
        /function openThoughtTrailFile\(\s*filePath:\s*string,\s*context:\s*SidebarThoughtTrailRenderContext,?\s*\):\s*void\s*\{[\s\S]*?const targetUrl\s*=\s*`obsidian:\/\/open\?vault=\$\{encodeURIComponent\(context\.app\.vault\.getName\(\)\)\}&file=\$\{encodeURIComponent\(filePath\)\}`;[\s\S]*?void openThoughtTrailTarget\(targetUrl,\s*context\)/,
    );
    assert.match(
        source,
        /cls:\s*"aside-tag-related-file-link"[\s\S]*?attr:\s*\{\s*type:\s*"button"\s*\}[\s\S]*?addEventListener\("click",\s*\(\)\s*=>\s*\{\s*openThoughtTrailFile\(filePath,\s*context\)/,
    );
    assert.match(source, /openThoughtTrailFile\(attachment\.filePath,\s*context\)/);
    assert.match(
        source,
        /async function openThoughtTrailTarget\([\s\S]*?getAbstractFileByPath\(filePath\)[\s\S]*?context\.getPreferredFileLeaf\(filePath\)\s*\?\?\s*context\.app\.workspace\.getLeaf\(false\)[\s\S]*?await targetLeaf\.openFile\(targetFile\)[\s\S]*?setActiveLeaf\(targetLeaf,\s*\{\s*focus:\s*true\s*\}\)/,
    );
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
