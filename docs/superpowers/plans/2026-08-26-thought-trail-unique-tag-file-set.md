# Thought Trail Unique Tag File Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace repeated tag-owned Thought Trail rows with one normalized related-file set that shows every shared tag and supports transient single-tag filtering.

**Architecture:** `src/core/derived/thoughtTrail.ts` will be the only owner of file identity, shared-tag membership, counts, and ordering through a new `buildTagRelatedFileSetModel` planner. The sidebar renderer will consume that complete model, keep only ephemeral selected-filter state in its render closure, and hide or show rows without recalculating relationships. `AsideView` will use the same planner for tag-source availability so rendering and enablement cannot disagree.

**Tech Stack:** TypeScript 5.9, Obsidian DOM APIs, Node's built-in test runner, source-contract `.mjs` tests, CSS using Obsidian theme variables, Obsidian CLI for installed-vault verification.

---

## File Structure

- Modify `src/core/derived/thoughtTrail.ts`: replace group-oriented tag result types/functions and the unused tag-Mermaid planner with the normalized unique-file-set model and planner.
- Modify `tests/thoughtTrail.test.ts`: replace group assertions with table-driven model tests for identity, tags, counts, ordering, normalization, exclusions, and empty states.
- Modify `src/ui/views/sidebarThoughtTrailRenderer.ts`: render the current file, filters, and one semantic list; own transient selected-filter state only.
- Modify `src/ui/views/AsideView.ts`: derive Tags-source availability from `model.files.length` through one local helper.
- Modify `tests/sidebarThoughtTrailRendererSource.test.mjs`: enforce the unique-list DOM contract, native button accessibility, local filter updates, and shared availability planner.
- Modify `styles.css`: remove group/nested-list rules and add compact filters, rows, and shared-tag labels.
- Modify `tests/toolbarDisabledStyles.test.mjs`: replace group-centric CSS assertions with the unique-set presentation contract.
- Modify `docs/superpowers/specs/2026-08-26-thought-trail-unique-tag-file-set-design.md`: mark tracking items complete only after automated and installed-vault evidence passes.

### Task 1: Build the normalized unique-file-set model

**Files:**
- Modify: `tests/thoughtTrail.test.ts:1-8,270-388`
- Modify: `src/core/derived/thoughtTrail.ts:389-498`

- [ ] **Step 1: Replace grouped-model imports and tests with failing unique-set tests**

Change the import block in `tests/thoughtTrail.test.ts` to import `buildTagRelatedFileSetModel` and remove `buildTagRelatedFileLines`, `buildTagGroupedRelatedFiles`, and `buildTagRelatedFileListModel`. Delete the three obsolete `buildTagRelatedFileLines` Mermaid tests, then replace the three group/list-model tests with these complete cases:

```ts
test("buildTagRelatedFileSetModel deduplicates paths and accumulates every shared tag", () => {
    const tagsByPath = new Map<string, string[]>([
        ["docs/source.md", ["#Status", "#Finance", "#FINANCE"]],
        ["docs/a.md", ["#finance", "#status", "#extra"]],
        ["docs/b.md", ["#FINANCE"]],
        ["docs/c.md", ["#status"]],
        ["docs/no-match.md", ["#other"]],
    ]);

    assert.deepEqual(
        buildTagRelatedFileSetModel(
            "docs/./source.md",
            [
                "docs/source.md",
                "./docs/a.md",
                "docs/../docs/a.md",
                "docs/c.md",
                "docs/b.md",
                "docs/no-match.md",
                "",
            ],
            (filePath: string) => tagsByPath.get(filePath) ?? [],
        ),
        {
            currentFile: {
                filePath: "docs/source.md",
                label: "source (current)",
            },
            tags: [
                { tagKey: "finance", tagDisplay: "Finance", fileCount: 2 },
                { tagKey: "status", tagDisplay: "Status", fileCount: 2 },
            ],
            files: [
                {
                    filePath: "docs/a.md",
                    label: "a",
                    tags: [
                        { tagKey: "finance", tagDisplay: "Finance" },
                        { tagKey: "status", tagDisplay: "Status" },
                    ],
                },
                {
                    filePath: "docs/b.md",
                    label: "b",
                    tags: [{ tagKey: "finance", tagDisplay: "Finance" }],
                },
                {
                    filePath: "docs/c.md",
                    label: "c",
                    tags: [{ tagKey: "status", tagDisplay: "Status" }],
                },
            ],
        },
    );
});

test("buildTagRelatedFileSetModel preserves distinct full paths with the same basename", () => {
    const tagsByPath = new Map<string, string[]>([
        ["docs/source.md", ["#project"]],
        ["folder-a/index.md", ["#project"]],
        ["folder-b/index.md", ["#PROJECT"]],
        ["Custom Aside Index.md", ["#project"]],
    ]);

    const model = buildTagRelatedFileSetModel(
        "docs/source.md",
        [
            "folder-b/index.md",
            "Custom Aside Index.md",
            "folder-a/./index.md",
            "docs/source.md",
        ],
        (filePath: string) => tagsByPath.get(filePath) ?? [],
        { allCommentsNotePath: "Custom Aside Index.md" },
    );

    assert.deepEqual(model.tags, [
        { tagKey: "project", tagDisplay: "project", fileCount: 2 },
    ]);
    assert.deepEqual(model.files.map(({ filePath, label }) => ({ filePath, label })), [
        { filePath: "folder-a/index.md", label: "index" },
        { filePath: "folder-b/index.md", label: "index" },
    ]);
});

test("buildTagRelatedFileSetModel uses side-comment tags and excludes the generated index", () => {
    const tagsByPath = buildThoughtTrailCommentTagsByFilePath([
        createThread({
            id: "source-thread",
            filePath: "docs/source.md",
            entries: [{ id: "source-entry", body: "Source side comment #project", timestamp: 100 }],
        }),
        createThread({
            id: "target-thread",
            filePath: "docs/a.md",
            entries: [{ id: "target-entry", body: "Target side comment #project", timestamp: 100 }],
        }),
        createThread({
            id: "index-thread",
            filePath: "Custom Aside Index.md",
            entries: [{ id: "index-entry", body: "Generated index mention #project", timestamp: 100 }],
        }),
    ]);

    const model = buildTagRelatedFileSetModel(
        "docs/source.md",
        ["docs/a.md", "Custom Aside Index.md"],
        (filePath: string) => tagsByPath.get(filePath) ?? [],
        { allCommentsNotePath: "Custom Aside Index.md" },
    );

    assert.deepEqual(model.files.map((file) => file.filePath), ["docs/a.md"]);
    assert.deepEqual(model.tags, [
        { tagKey: "project", tagDisplay: "project", fileCount: 1 },
    ]);
});

test("buildTagRelatedFileSetModel returns empty membership for invalid or untagged sources", () => {
    const untagged = buildTagRelatedFileSetModel(
        "docs/source.md",
        ["docs/a.md"],
        () => [],
    );
    assert.deepEqual(untagged, {
        currentFile: { filePath: "docs/source.md", label: "source (current)" },
        tags: [],
        files: [],
    });

    assert.deepEqual(
        buildTagRelatedFileSetModel(
            "Custom Aside Index.md",
            ["docs/a.md"],
            () => ["#project"],
            { allCommentsNotePath: "Custom Aside Index.md" },
        ),
        { currentFile: null, tags: [], files: [] },
    );
});
```

- [ ] **Step 2: Compile and run the model test to verify the red state**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
```

Expected: FAIL with TypeScript reporting that `buildTagRelatedFileSetModel` is not exported by `src/core/derived/thoughtTrail.ts`.

- [ ] **Step 3: Replace the grouped types and planners with the unique-set planner**

In `src/core/derived/thoughtTrail.ts`, delete `hasEveryTagKey`, `hasAnyTagKey`, `buildTagRelatedFileLines`, `TagRelatedFileGroup`, `TagRelatedFileListItem`, `TagRelatedFileListGroup`, `TagRelatedFileListModel`, `buildTagGroupedRelatedFiles`, and `buildTagRelatedFileListModel`. The Mermaid tag-line builder has no production caller and retaining it would leave a second owner for tag matching and path deduplication. Keep `ThoughtTrailTagRelatedOptions`, then add this model and planner:

```ts
export interface TagRelatedFileTag {
    tagKey: string;
    tagDisplay: string;
    fileCount: number;
}

export interface TagRelatedUniqueFileTag {
    tagKey: string;
    tagDisplay: string;
}

export interface TagRelatedUniqueFile {
    filePath: string;
    label: string;
    tags: TagRelatedUniqueFileTag[];
}

export interface TagRelatedCurrentFile {
    filePath: string;
    label: string;
}

export interface TagRelatedFileSetModel {
    currentFile: TagRelatedCurrentFile | null;
    tags: TagRelatedFileTag[];
    files: TagRelatedUniqueFile[];
}

export interface ThoughtTrailTagRelatedOptions {
    allCommentsNotePath?: string;
}

export function buildTagRelatedFileSetModel(
    sourceFilePath: string,
    candidateFilePaths: readonly string[],
    getTagsForFilePath: ThoughtTrailFileTagLookup,
    options: ThoughtTrailTagRelatedOptions = {},
): TagRelatedFileSetModel {
    const normalizedSourcePath = normalizeNotePath(sourceFilePath);
    if (!normalizedSourcePath || isAllCommentsNotePath(normalizedSourcePath, options.allCommentsNotePath)) {
        return { currentFile: null, tags: [], files: [] };
    }

    const currentFile: TagRelatedCurrentFile = {
        filePath: normalizedSourcePath,
        label: formatCurrentRelatedFileLabel(normalizedSourcePath),
    };
    const sourceTagsByKey = new Map<string, string>();
    for (const tag of getTagsForFilePath(normalizedSourcePath) ?? []) {
        const tagKey = normalizeThoughtTrailTagKey(tag);
        if (tagKey && !sourceTagsByKey.has(tagKey)) {
            sourceTagsByKey.set(tagKey, formatThoughtTrailTagDisplay(tag));
        }
    }
    if (!sourceTagsByKey.size) {
        return { currentFile, tags: [], files: [] };
    }

    const tagKeysByFilePath = new Map<string, Set<string>>();
    for (const candidateFilePath of candidateFilePaths) {
        const normalizedCandidatePath = normalizeNotePath(candidateFilePath);
        if (
            !normalizedCandidatePath
            || normalizedCandidatePath === normalizedSourcePath
            || isAllCommentsNotePath(normalizedCandidatePath, options.allCommentsNotePath)
            || tagKeysByFilePath.has(normalizedCandidatePath)
        ) {
            continue;
        }

        const candidateTagKeys = getNormalizedThoughtTrailTagKeys(
            getTagsForFilePath(normalizedCandidatePath),
        );
        const sharedTagKeys = new Set<string>();
        for (const sourceTagKey of sourceTagsByKey.keys()) {
            if (candidateTagKeys.has(sourceTagKey)) {
                sharedTagKeys.add(sourceTagKey);
            }
        }
        if (sharedTagKeys.size) {
            tagKeysByFilePath.set(normalizedCandidatePath, sharedTagKeys);
        }
    }

    const orderedTagKeys = Array.from(sourceTagsByKey.keys()).sort((left, right) => left.localeCompare(right));
    const files = Array.from(tagKeysByFilePath.entries())
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
        .map(([filePath, sharedTagKeys]): TagRelatedUniqueFile => ({
            filePath,
            label: formatRelatedFileListLabel(filePath),
            tags: orderedTagKeys
                .filter((tagKey) => sharedTagKeys.has(tagKey))
                .map((tagKey) => ({
                    tagKey,
                    tagDisplay: sourceTagsByKey.get(tagKey) ?? tagKey,
                })),
        }));
    const tags = orderedTagKeys
        .map((tagKey): TagRelatedFileTag => ({
            tagKey,
            tagDisplay: sourceTagsByKey.get(tagKey) ?? tagKey,
            fileCount: files.filter((file) => file.tags.some((tag) => tag.tagKey === tagKey)).length,
        }))
        .filter((tag) => tag.fileCount > 0);

    return { currentFile, tags, files };
}
```

- [ ] **Step 4: Run the focused model test and verify the green state**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/thoughtTrail.test.js
```

Expected: compilation succeeds and every `thoughtTrail.test.ts` case passes, including all four new unique-set cases.

- [ ] **Step 5: Commit the model slice**

```bash
git add src/core/derived/thoughtTrail.ts tests/thoughtTrail.test.ts
git commit -m "feat: model unique Thought Trail tag files"
```

### Task 2: Render and filter the same unique file set

**Files:**
- Modify: `tests/sidebarThoughtTrailRendererSource.test.mjs`
- Modify: `src/ui/views/sidebarThoughtTrailRenderer.ts:8-16,109-198`
- Modify: `src/ui/views/AsideView.ts:15-19,1802-1812,2038,2390-2397,2471,2565-2573,2618-2625`

- [ ] **Step 1: Replace the grouped renderer source contract with a failing unique-set contract**

Read both renderer and view source at the top of `tests/sidebarThoughtTrailRendererSource.test.mjs`:

```js
const source = readFileSync("src/ui/views/sidebarThoughtTrailRenderer.ts", "utf8");
const asideViewSource = readFileSync("src/ui/views/AsideView.ts", "utf8");
```

Replace the first test with these tests, leaving the Mermaid tooltip test intact:

```js
test("tag related files render one semantic unique-file list", () => {
    assert.match(source, /createDiv\(\{\s*cls:\s*"aside-tag-related-current-file"/);
    assert.match(source, /createEl\("ul",\s*\{\s*cls:\s*"aside-tag-related-files"/);
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
    assert.match(source, /text:\s*`All · \$\{model\.files\.length\}`/);
    assert.match(source, /"aria-pressed":\s*String\(definition\.tagKey\s*===\s*null\)/);
    assert.match(source, /addEventListener\("click",\s*\(\)\s*=>\s*\{\s*applyFilter\(definition\.tagKey\)/);
    assert.match(source, /button\.setAttribute\("aria-pressed",\s*String\(isSelected\)\)/);
    assert.match(source, /button\.classList\.toggle\("is-selected",\s*isSelected\)/);
    assert.match(source, /rowEl\.hidden\s*=\s*selectedTagKey\s*!==\s*null/);
    assert.match(source, /applyFilter\(null\);/);
});

test("AsideView uses the unique file-set planner for tag-source availability", () => {
    assert.match(asideViewSource, /buildTagRelatedFileSetModel/);
    assert.match(
        asideViewSource,
        /buildTagRelatedFileSetModel\([\s\S]*?\)\.files\.length\s*>\s*0/,
    );
    assert.doesNotMatch(asideViewSource, /buildTagGroupedRelatedFiles/);
});
```

- [ ] **Step 2: Run the source-contract test to verify the red state**

Run:

```bash
node --test tests/sidebarThoughtTrailRendererSource.test.mjs
```

Expected: FAIL because the renderer still emits tag groups/nested lists and `AsideView` still imports the grouped planner.

- [ ] **Step 3: Make the renderer a thin consumer with transient local filter state**

In `src/ui/views/sidebarThoughtTrailRenderer.ts`, replace the group-oriented imports with:

```ts
import {
    buildTagRelatedFileSetModel,
    extractThoughtTrailMermaidSource,
    getThoughtTrailMermaidRenderConfig,
    type TagRelatedFileSetModel,
    type ThoughtTrailFileTagLookup,
} from "../../core/derived/thoughtTrail";
```

Replace `renderTagRelatedFilesList` with this implementation; retain the existing `renderTagRelatedFileLink` navigation helper and change its tooltip assignment from `btn.title = filePath` to `setTooltip(btn, filePath)`:

```ts
function renderTagRelatedFilesList(
    container: HTMLDivElement,
    model: TagRelatedFileSetModel,
    context: SidebarThoughtTrailRenderContext,
): void {
    if (model.currentFile) {
        const currentFileEl = container.createDiv({
            cls: "aside-tag-related-current-file",
            text: model.currentFile.label,
        });
        setTooltip(currentFileEl, model.currentFile.filePath);
    }

    const filterBarEl = container.createDiv({
        cls: "aside-tag-related-filter-bar",
        attr: {
            role: "group",
            "aria-label": "Filter related files by tag",
        },
    });
    const listEl = container.createEl("ul", { cls: "aside-tag-related-files" });
    const renderedRows = model.files.map((file) => {
        const rowEl = listEl.createEl("li", {
            cls: "aside-tag-related-file-row",
            attr: { "data-file-path": file.filePath },
        });
        renderTagRelatedFileLink(rowEl, file.filePath, file.label, context);
        const tagsEl = rowEl.createDiv("aside-tag-related-file-tags");
        for (const tag of file.tags) {
            tagsEl.createSpan({
                cls: "aside-tag-related-file-tag",
                text: `#${tag.tagDisplay}`,
                attr: { "data-tag-key": tag.tagKey },
            });
        }
        return { file, rowEl };
    });

    const filterDefinitions = [
        { tagKey: null, label: `All · ${model.files.length}` },
        ...model.tags.map((tag) => ({
            tagKey: tag.tagKey,
            label: `#${tag.tagDisplay} · ${tag.fileCount}`,
        })),
    ];
    const filterButtons: Array<{ tagKey: string | null; button: HTMLButtonElement }> = [];
    const applyFilter = (selectedTagKey: string | null): void => {
        for (const { tagKey, button } of filterButtons) {
            const isSelected = tagKey === selectedTagKey;
            button.setAttribute("aria-pressed", String(isSelected));
            button.classList.toggle("is-selected", isSelected);
        }
        for (const { file, rowEl } of renderedRows) {
            rowEl.hidden = selectedTagKey !== null
                && !file.tags.some((tag) => tag.tagKey === selectedTagKey);
        }
    };

    for (const definition of filterDefinitions) {
        const button = filterBarEl.createEl("button", {
            cls: "aside-tag-related-filter",
            text: definition.label,
            attr: {
                type: "button",
                "aria-pressed": String(definition.tagKey === null),
                "data-tag-key": definition.tagKey ?? "",
            },
        });
        button.addEventListener("click", () => {
            applyFilter(definition.tagKey);
        });
        filterButtons.push({ tagKey: definition.tagKey, button });
    }
    applyFilter(null);
}
```

In `renderSidebarThoughtTrail`, build the model once and use it for both enablement and rendering:

```ts
const tagRelatedFileSet = buildTagRelatedFileSetModel(
    rootFilePath,
    options.candidateFilePaths,
    options.getTagsForFilePath,
    { allCommentsNotePath: context.allCommentsNotePath },
);
renderThoughtTrailSourceControl(thoughtTrailEl, {
    source: options.source,
    radioGroupName: `aside-thought-trail-source-${context.renderVersion}-${options.surface}-${encodeURIComponent(rootFilePath)}`,
    tagsDisabled: tagRelatedFileSet.files.length === 0,
    onSourceChange: (source) => {
        options.onSourceChange(source);
    },
});
if (options.source === "tags") {
    const sectionEl = thoughtTrailEl.createDiv("aside-thought-trail-section");
    renderTagRelatedFilesList(sectionEl, tagRelatedFileSet, context);
    return;
}
```

- [ ] **Step 4: Route every `AsideView` availability decision through the same planner**

Replace the `buildTagGroupedRelatedFiles` import with `buildTagRelatedFileSetModel`. Add this private helper beside `resolveThoughtTrailSource`:

```ts
private hasThoughtTrailTagRelatedFiles(
    rootFilePath: string,
    getTagsForFilePath: ThoughtTrailFileTagLookup,
): boolean {
    return buildTagRelatedFileSetModel(
        rootFilePath,
        this.getThoughtTrailVaultCandidateFilePaths(rootFilePath),
        getTagsForFilePath,
        { allCommentsNotePath: this.plugin.getAllCommentsNotePath() },
    ).files.length > 0;
}
```

Use `this.hasThoughtTrailTagRelatedFiles(...)` for `hasIndexThoughtTrailTagSource` and both `hasThoughtTrailTagSource` calculations. Change the resolver to consume the already-derived availability boolean:

```ts
private resolveThoughtTrailSource(hasTagRelatedFiles: boolean): SidebarThoughtTrailSource {
    if (this.thoughtTrailSource === "tags" && !hasTagRelatedFiles) {
        this.thoughtTrailSource = getDefaultThoughtTrailSource();
    }

    return this.thoughtTrailSource;
}
```

Update the index and note render callers to pass `hasIndexThoughtTrailTagSource` and `hasThoughtTrailTagSource`, respectively. This also makes an untagged source or a tagged source with zero related files unavailable instead of leaving a stale Tags selection.

- [ ] **Step 5: Run focused renderer, model, type, and lint checks**

Run:

```bash
node --test tests/sidebarThoughtTrailRendererSource.test.mjs
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/thoughtTrail.test.js
npm run typecheck
npm run lint
```

Expected: all commands exit 0; the source contract sees no grouped planner/classes, and TypeScript accepts the new model at both production call sites.

- [ ] **Step 6: Commit the renderer and availability slice**

```bash
git add src/ui/views/sidebarThoughtTrailRenderer.ts src/ui/views/AsideView.ts tests/sidebarThoughtTrailRendererSource.test.mjs
git commit -m "feat: filter unique Thought Trail tag files"
```

### Task 3: Replace group styling with compact filters and shared-tag labels

**Files:**
- Modify: `tests/toolbarDisabledStyles.test.mjs:174-239`
- Modify: `styles.css:1176-1268`

- [ ] **Step 1: Replace the group-style assertions with a failing unique-set style contract**

Replace `test("thought trail tag related files stay compact", ...)` with:

```js
test("thought trail unique tag file set stays compact and theme-native", () => {
    const filterBarRule = css.match(
        /\.aside-tag-related-filter-bar\s*\{(?<body>[\s\S]*?)\}/,
    );
    const filterRule = css.match(
        /\.aside-thought-trail button\.aside-tag-related-filter\s*\{(?<body>[\s\S]*?)\}/,
    );
    const selectedFilterRule = css.match(
        /\.aside-thought-trail button\.aside-tag-related-filter\[aria-pressed="true"\]\s*\{(?<body>[\s\S]*?)\}/,
    );
    const listRule = css.match(
        /\.aside-thought-trail \.aside-tag-related-files\s*\{(?<body>[\s\S]*?)\}/,
    );
    const rowRule = css.match(
        /\.aside-tag-related-file-row\s*\{(?<body>[\s\S]*?)\}/,
    );
    const tagsRule = css.match(
        /\.aside-tag-related-file-tags\s*\{(?<body>[\s\S]*?)\}/,
    );
    const tagRule = css.match(
        /\.aside-tag-related-file-tag\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.ok(filterBarRule?.groups?.body, "missing compact tag filter bar");
    assert.ok(filterRule?.groups?.body, "missing tag filter button rule");
    assert.ok(selectedFilterRule?.groups?.body, "missing selected tag filter rule");
    assert.ok(listRule?.groups?.body, "missing unique related-file list rule");
    assert.ok(rowRule?.groups?.body, "missing related-file row rule");
    assert.ok(tagsRule?.groups?.body, "missing shared-tag container rule");
    assert.ok(tagRule?.groups?.body, "missing shared-tag label rule");
    assert.match(filterBarRule.groups.body, /display:\s*flex\s*;/);
    assert.match(filterBarRule.groups.body, /flex-wrap:\s*wrap\s*;/);
    assert.match(filterRule.groups.body, /font-size:\s*var\(--font-ui-smaller\)\s*;/);
    assert.match(filterRule.groups.body, /border:\s*1px solid var\(--background-modifier-border\)\s*;/);
    assert.match(selectedFilterRule.groups.body, /color:\s*var\(--text-normal\)\s*;/);
    assert.match(selectedFilterRule.groups.body, /border-color:\s*var\(--interactive-accent\)\s*;/);
    assert.match(listRule.groups.body, /list-style:\s*none\s*;/);
    assert.match(rowRule.groups.body, /display:\s*flex\s*;/);
    assert.match(rowRule.groups.body, /flex-direction:\s*column\s*;/);
    assert.match(tagsRule.groups.body, /flex-wrap:\s*wrap\s*;/);
    assert.match(tagRule.groups.body, /color:\s*var\(--text-faint\)\s*;/);
    assert.doesNotMatch(css, /\.aside-tag-related-files-group/);
    assert.doesNotMatch(css, /\.aside-tag-related-files-tag-header/);
    assert.doesNotMatch(css, /\.aside-tag-related-files-list/);
});
```

- [ ] **Step 2: Run the CSS contract to verify the red state**

Run:

```bash
node --test tests/toolbarDisabledStyles.test.mjs
```

Expected: FAIL because the stylesheet still contains group headers/nested lists and has no filter or file-tag rules.

- [ ] **Step 3: Replace the old tag-group CSS block with compact unique-set styles**

Delete `.aside-tag-related-files-group`, `.aside-tag-related-files-tag-header`, and `.aside-tag-related-files-list`. Keep the existing text-like file link states and current-file ellipsis behavior, and replace the surrounding block with:

```css
.aside-tag-related-current-file {
    display: block;
    padding: 1px 0;
    color: var(--text-muted);
    cursor: default;
    font-size: var(--font-ui-smaller);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.aside-tag-related-filter-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin: 2px 0 4px;
}

.aside-thought-trail button.aside-tag-related-filter {
    -webkit-appearance: none;
    appearance: none;
    width: auto;
    min-height: 0;
    height: auto;
    padding: 1px 5px;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    background: transparent;
    box-shadow: none;
    color: var(--text-muted);
    font-family: inherit;
    font-size: var(--font-ui-smaller);
    line-height: 1.3;
}

.aside-thought-trail button.aside-tag-related-filter:hover,
.aside-thought-trail button.aside-tag-related-filter:focus-visible {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
}

.aside-thought-trail button.aside-tag-related-filter:focus-visible {
    outline: 1px solid var(--interactive-accent);
    outline-offset: 1px;
}

.aside-thought-trail button.aside-tag-related-filter[aria-pressed="true"] {
    border-color: var(--interactive-accent);
    background: var(--background-modifier-hover);
    color: var(--text-normal);
}

.aside-thought-trail .aside-tag-related-files {
    display: flex;
    flex-direction: column;
    gap: 3px;
    list-style: none;
    margin: 0;
    padding: 0;
}

.aside-tag-related-file-row {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin: 0;
    min-width: 0;
    padding: 0;
}

.aside-tag-related-file-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 5px;
    min-width: 0;
}

.aside-tag-related-file-tag {
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
    line-height: 1.25;
}
```

- [ ] **Step 4: Run focused CSS, source, lint, and type checks**

Run:

```bash
node --test tests/toolbarDisabledStyles.test.mjs
node --test tests/sidebarThoughtTrailRendererSource.test.mjs
npm run lint
npm run typecheck
```

Expected: all commands exit 0; no old grouped selectors remain in source or CSS.

- [ ] **Step 5: Commit the presentation slice**

```bash
git add styles.css tests/toolbarDisabledStyles.test.mjs
git commit -m "style: present unique Thought Trail tag files"
```

### Task 4: Verify, install, and close implementation tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-08-26-thought-trail-unique-tag-file-set-design.md`
- Verify: `main.js`, `manifest.json`, `styles.css`
- Install: `/Users/example/Obsidian/lean-startup/.obsidian/plugins/aside/`

- [ ] **Step 1: Run the complete automated build gate**

Run:

```bash
npm run build
```

Expected: tests, ESLint, TypeScript, Obsidian compliance, the production bundle, and `release:artifacts:check` all pass. The release-artifact guard must confirm there is no shipped `main.js.map`, `sourceMappingURL`, embedded `sourcesContent`, raw TypeScript/JSX-family source, or obvious secret-bearing file in the exact Aside artifacts.

- [ ] **Step 2: Inspect the exact artifacts that will be installed**

Run:

```bash
ls -lh main.js manifest.json styles.css
test ! -e main.js.map
rg -n "sourceMappingURL|sourcesContent" main.js manifest.json styles.css
```

Expected: the three install artifacts exist; `main.js.map` does not; the final `rg` exits 1 with no matches. Stop here and fix packaging if any source map, embedded source, raw source file, secret-bearing file, or local-only fixture would ship.

- [ ] **Step 3: Install the verified build into `lean-startup` and reload Aside**

Run:

```bash
npm run dev:install-built -- --vault "/Users/example/Obsidian/lean-startup"
obsidian plugin:reload id=aside vault=lean-startup
```

Expected: the installer reports that it copied only `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/aside`; Obsidian reports a successful reload.

- [ ] **Step 4: Create an exact overlapping-tag smoke fixture in `lean-startup`**

Run:

```bash
obsidian create vault=lean-startup path="_aside-smoke/thought-trail-source.md" content="---\ntags:\n  - aside-smoke-alpha\n  - aside-smoke-beta\n---\n" overwrite
obsidian create vault=lean-startup path="_aside-smoke/thought-trail-both.md" content="---\ntags:\n  - aside-smoke-alpha\n  - aside-smoke-beta\n---\n" overwrite
obsidian create vault=lean-startup path="_aside-smoke/thought-trail-alpha.md" content="---\ntags:\n  - aside-smoke-alpha\n---\n" overwrite
obsidian create vault=lean-startup path="_aside-smoke/thought-trail-beta.md" content="---\ntags:\n  - aside-smoke-beta\n---\n" overwrite
obsidian open vault=lean-startup path="_aside-smoke/thought-trail-source.md"
obsidian eval vault=lean-startup code='(async () => { let leaf = app.workspace.getLeavesOfType("aside-view")[0]; if (!leaf) { leaf = app.workspace.getRightLeaf(false); await leaf.setViewState({ type: "aside-view", active: true }); } app.workspace.revealLeaf(leaf); return leaf.view.getViewType(); })()'
obsidian eval vault=lean-startup code='(() => { const button = [...document.querySelectorAll("button.aside-tab-button")].find((candidate) => candidate.textContent?.trim() === "Thought Trail"); button?.click(); return button ? "clicked Thought Trail" : "missing Thought Trail"; })()'
sleep 2
obsidian eval vault=lean-startup code='(() => { const input = document.querySelector(".aside-thought-trail-source-option input[value=tags]"); input?.click(); return input ? "clicked Tags" : "missing Tags"; })()'
sleep 2
```

Expected: the source note opens, the first eval returns `aside-view`, and the next evals report `clicked Thought Trail` and `clicked Tags`. `All · 3` must be selected by default, and the visible rows must be `thought-trail-alpha`, `thought-trail-beta`, and `thought-trail-both` exactly once each. The `thought-trail-both` row must show both `#aside-smoke-alpha` and `#aside-smoke-beta`.

- [ ] **Step 5: Prove that each filter narrows the same row set with exactly one selected button**

Run each command after the Tags view is visible:

```bash
obsidian eval vault=lean-startup code='(() => { const buttons = [...document.querySelectorAll(".aside-tag-related-filter")]; const rows = [...document.querySelectorAll(".aside-tag-related-file-row")]; return JSON.stringify({ selected: buttons.filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.dataset.tagKey), paths: rows.filter((row) => !row.hidden).map((row) => row.dataset.filePath), unique: new Set(rows.map((row) => row.dataset.filePath)).size === rows.length }); })()'
obsidian eval vault=lean-startup code='(() => { document.querySelector(".aside-tag-related-filter[data-tag-key=aside-smoke-alpha]").click(); const buttons = [...document.querySelectorAll(".aside-tag-related-filter")]; const rows = [...document.querySelectorAll(".aside-tag-related-file-row")]; return JSON.stringify({ selected: buttons.filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.dataset.tagKey), paths: rows.filter((row) => !row.hidden).map((row) => row.dataset.filePath) }); })()'
obsidian eval vault=lean-startup code='(() => { document.querySelector(".aside-tag-related-filter[data-tag-key=aside-smoke-beta]").click(); const buttons = [...document.querySelectorAll(".aside-tag-related-filter")]; const rows = [...document.querySelectorAll(".aside-tag-related-file-row")]; return JSON.stringify({ selected: buttons.filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.dataset.tagKey), paths: rows.filter((row) => !row.hidden).map((row) => row.dataset.filePath) }); })()'
obsidian eval vault=lean-startup code='(() => { document.querySelector(".aside-tag-related-filter[data-tag-key=\"\"]").click(); const buttons = [...document.querySelectorAll(".aside-tag-related-filter")]; const rows = [...document.querySelectorAll(".aside-tag-related-file-row")]; return JSON.stringify({ selected: buttons.filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.dataset.tagKey), paths: rows.filter((row) => !row.hidden).map((row) => row.dataset.filePath) }); })()'
```

Expected:

- Initial state: `selected` is `[""]`, `unique` is `true`, and `paths` contains all three candidate paths exactly once.
- Alpha: `selected` is `["aside-smoke-alpha"]`; visible paths are `thought-trail-alpha.md` and `thought-trail-both.md`.
- Beta: `selected` is `["aside-smoke-beta"]`; visible paths are `thought-trail-beta.md` and `thought-trail-both.md`.
- All restored: `selected` is `[""]`; all three original paths are visible again without duplicates.

- [ ] **Step 6: Remove the smoke files through Obsidian's recoverable trash path**

Run:

```bash
obsidian delete vault=lean-startup path="_aside-smoke/thought-trail-source.md"
obsidian delete vault=lean-startup path="_aside-smoke/thought-trail-both.md"
obsidian delete vault=lean-startup path="_aside-smoke/thought-trail-alpha.md"
obsidian delete vault=lean-startup path="_aside-smoke/thought-trail-beta.md"
```

Expected: Obsidian moves the four temporary notes to its configured trash rather than deleting them permanently. Report that cleanup and its recoverability in the implementation handoff.

- [ ] **Step 7: Mark the tracked spec complete only after all evidence exists**

In `docs/superpowers/specs/2026-08-26-thought-trail-unique-tag-file-set-design.md`, change every remaining `- [ ]` under **To Implement** and **Verification** to `- [x]`. Do not check the installed-vault item if the DOM evidence in Steps 4–5 was not collected.

- [ ] **Step 8: Commit the verified tracking update**

```bash
git add docs/superpowers/specs/2026-08-26-thought-trail-unique-tag-file-set-design.md
git commit -m "docs: verify unique Thought Trail tag set"
git status --short --branch
```

Expected: the tracking update is committed and the worktree is clean except for known pre-existing user changes. Do not push or cut a release unless the user separately requests it; a release would also require a matching `docs/releases/<version>.md`.
