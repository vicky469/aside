# Index Tag Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an instant, vault-wide, read-only Tags tab to the Aside index that fuzzy-matches Obsidian tags and returns deduplicated source-note cards.

**Architecture:** Extend `VaultCapabilityIndex` with reverse tag membership, move existing-tag relevance ranking into one shared text-domain helper, and build a pure index-tag result model from those two sources. `AsideView` owns debouncing and lifecycle state while focused rendering helpers reuse the established tag-filter and related-file presentation without receiving mutation callbacks.

**Tech Stack:** TypeScript, Obsidian metadata cache and `TFile`, native DOM APIs, Node test runner, existing Aside toolbar/render helpers, CSS scoped to `.aside-index-tag-search`.

---

## File Structure

- Create `src/core/text/tagSearch.ts`: normalize and rank existing tag usage records.
- Modify `src/ui/editor/commentTagSuggestions.ts`: keep create-tag policy as a thin editor-only adapter over shared ranking.
- Modify `src/core/vault/vaultCapabilityIndex.ts`: maintain reverse tag membership and return immutable sorted file snapshots.
- Modify `src/main.ts`: expose read-only tag-file lookup to sidebar views.
- Create `src/ui/views/indexTagSearch.ts`: build complete ranked results, exact filters, deduplicated unions, ordering, and windows.
- Create `src/ui/views/sidebarTagFileList.ts`: shared filter-chip and compact file-row DOM primitives.
- Modify `src/ui/views/sidebarThoughtTrailRenderer.ts`: consume the shared tag/file primitives.
- Modify `src/ui/views/sidebarModeTabs.ts`: include Tags in the vault-wide index tab group.
- Modify `src/ui/views/indexSidebarState.ts`: represent the global Tags scope and keep side-note search policy separate.
- Modify `src/ui/views/sidebarToolbarState.ts`: give index Tags only the shared search row.
- Modify `src/ui/views/AsideView.ts`: own tag-search state, debounce, focus restoration, model refresh, rendering, pagination, and navigation.
- Modify `styles.css`: scope compact result layout and `Show more` treatment while reusing existing theme tokens.
- Add or modify focused tests under `tests/` for every behavior before production edits.

### Task 1: Share existing-tag fuzzy ranking

**Files:**
- Create: `src/core/text/tagSearch.ts`
- Create: `tests/tagSearch.test.ts`
- Modify: `src/ui/editor/commentTagSuggestions.ts`
- Modify: `tests/commentTagSuggestions.test.ts`

- [x] **Step 1: Write the failing shared-ranking tests**

Create `tests/tagSearch.test.ts` with real tag usage records and assertions for empty-query suppression, exact/prefix/segment/substring ordering, bounded typo recovery, usage tie-breaking, canonical deduplication, and a 40-result default limit:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import { rankExistingTags } from "../src/core/text/tagSearch";

test("rankExistingTags returns no suggestions before typing", () => {
    assert.deepEqual(rankExistingTags({ query: "", tags: [{ tag: "#project", usageCount: 2 }] }), []);
});

test("rankExistingTags ranks exact prefix segment substring and typo matches", () => {
    const result = rankExistingTags({
        query: "project",
        tags: [
            { tag: "#my-project-notes", usageCount: 9 },
            { tag: "#beta/project", usageCount: 2 },
            { tag: "#project/alpha", usageCount: 1 },
            { tag: "#project", usageCount: 1 },
            { tag: "#projcet", usageCount: 1 },
        ],
    });
    assert.deepEqual(result.map((entry) => entry.tag), [
        "#project",
        "#project/alpha",
        "#beta/project",
        "#my-project-notes",
        "#projcet",
    ]);
});

test("rankExistingTags deduplicates canonical variants and returns snapshots", () => {
    const result = rankExistingTags({
        query: "anapple",
        tags: [
            { tag: "#an-apple", usageCount: 2 },
            { tag: "#An-Apple", usageCount: 3 },
        ],
    });
    assert.deepEqual(result, [{ tag: "#an-apple", tagKey: "anapple", usageCount: 5 }]);
    result[0].tag = "#changed";
    assert.equal(rankExistingTags({ query: "anapple", tags: [{ tag: "#an-apple", usageCount: 2 }] })[0].tag, "#an-apple");
});
```

- [x] **Step 2: Run the new test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/tagSearch.test.js
```

Expected: TypeScript fails because `src/core/text/tagSearch.ts` does not exist.

- [x] **Step 3: Implement the shared ranker**

Move normalization, canonicalization, fuzzy threshold, bounded Damerau-Levenshtein distance, and scoring from `commentTagSuggestions.ts` into `src/core/text/tagSearch.ts`. Export these stable contracts:

```ts
export interface ExistingTagUsage {
    tag: string;
    usageCount: number;
}

export interface RankedExistingTag extends ExistingTagUsage {
    tagKey: string;
}

export function canonicalizeTagSearchText(value: string): string;

export function rankExistingTags(options: {
    query: string;
    tags: readonly ExistingTagUsage[];
    limit?: number;
}): RankedExistingTag[];
```

Return `[]` for an empty canonical query. Preserve current matching tiers and deterministic sorting. Deduplicate canonical variants, sum their usage, default to 40 results, and return new objects.

- [x] **Step 4: Convert editor suggestions to a thin adapter**

In `commentTagSuggestions.ts`, normalize `vaultTags` and `extraTags` into `ExistingTagUsage[]`, call `rankExistingTags`, map results to `{ type: "existing", tag }`, and retain only the editor-specific create check:

```ts
const rankedExisting = rankExistingTags({
    query: normalizedQuery,
    tags: [
        ...options.vaultTags,
        ...(options.extraTags ?? []).map((tag) => ({ tag, usageCount: 1 })),
    ],
    limit: options.limit,
}).map<SideNoteTagSuggestion>((entry) => ({ type: "existing", tag: entry.tag }));

const canCreate = normalizedQuery.length > 0
    && Array.from(normalizedQuery).every(isTagCharacter)
    && !rankExistingTags({ query: normalizedQuery, tags: options.vaultTags, limit: 1 })
        .some((entry) => entry.tagKey === canonicalizeTagSearchText(normalizedQuery));
```

Keep creation unavailable outside this function.

- [x] **Step 5: Run shared and editor tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/tagSearch.test.js .test-dist/tests/commentTagSuggestions.test.js
```

Expected: all tag-search and editor-suggestion tests pass with no warnings.

- [x] **Step 6: Commit the slice**

```bash
git add src/core/text/tagSearch.ts src/ui/editor/commentTagSuggestions.ts tests/tagSearch.test.ts tests/commentTagSuggestions.test.ts
git commit -m "refactor(tags): share fuzzy ranking"
```

### Task 2: Add reverse tag membership to the vault index

**Files:**
- Modify: `src/core/vault/vaultCapabilityIndex.ts`
- Modify: `tests/vaultCapabilityIndex.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write failing reverse-index lifecycle tests**

Extend `tests/vaultCapabilityIndex.test.ts`:

```ts
test("vault capability index returns exact immutable tag membership", () => {
    const index = new VaultCapabilityIndex();
    index.seed([
        createFile("docs/Alpha.md"),
        createFile("other/Alpha.md"),
        createFile("Beta.md"),
    ], (file) => file.path === "Beta.md" ? ["#other"] : ["#Project", "#shared"]);

    const projectFiles = index.listMarkdownFilesForTag(" #project ");
    assert.deepEqual(projectFiles.map((file) => file.path), ["docs/Alpha.md", "other/Alpha.md"]);
    projectFiles.pop();
    assert.deepEqual(index.listMarkdownFilesForTag("#PROJECT").map((file) => file.path), [
        "docs/Alpha.md",
        "other/Alpha.md",
    ]);
});

test("reverse tag membership follows metadata update rename and delete", () => {
    const index = new VaultCapabilityIndex();
    const alpha = createFile("Alpha.md");
    index.seed([alpha], () => ["#old"]);
    index.upsert(alpha, ["#new"]);
    assert.deepEqual(index.listMarkdownFilesForTag("#old"), []);
    assert.deepEqual(index.listMarkdownFilesForTag("#new").map((file) => file.path), ["Alpha.md"]);

    const renamed = createFile("Archive/Alpha.md");
    index.rename(renamed, "Alpha.md", ["#new"]);
    index.remove("Archive");
    assert.deepEqual(index.listMarkdownFilesForTag("#new"), []);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/vaultCapabilityIndex.test.js
```

Expected: TypeScript fails because `listMarkdownFilesForTag` is missing.

- [ ] **Step 3: Implement atomic forward/reverse updates**

Add `filePathsByTagKey = new Map<string, Set<string>>()`. Before overwriting a file, remove its old forward tags from reverse sets and delete empty sets. After storing normalized tags, add the path to every reverse set. Reuse this removal from `remove`, including folder-prefix deletion. Implement:

```ts
public listMarkdownFilesForTag(tagText: string): TFile[] {
    const tagKey = normalizeTagText(tagText).slice(1).toLowerCase();
    if (!tagKey) {
        return [];
    }
    return Array.from(this.filePathsByTagKey.get(tagKey) ?? [])
        .map((path) => this.markdownFilesByPath.get(path))
        .filter((file): file is TFile => !!file)
        .sort((left, right) => left.path.localeCompare(right.path));
}
```

Ensure `seed` clears all three maps.

- [ ] **Step 4: Expose the read-only adapter from `src/main.ts`**

Add:

```ts
public getIndexedMarkdownFilesForTag(tagText: string): TFile[] {
    return this.vaultCapabilityIndex.listMarkdownFilesForTag(tagText);
}
```

No Vault or metadata-cache call belongs in this adapter.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/vaultCapabilityIndex.test.js
```

Expected: all vault capability index tests pass.

- [ ] **Step 6: Commit the slice**

```bash
git add src/core/vault/vaultCapabilityIndex.ts src/main.ts tests/vaultCapabilityIndex.test.ts
git commit -m "feat(tags): index files by tag"
```

### Task 3: Build the pure index tag result model

**Files:**
- Create: `src/ui/views/indexTagSearch.ts`
- Create: `tests/indexTagSearch.test.ts`

- [ ] **Step 1: Write failing model tests**

Create real `TFile` fixtures and cover empty query, no match, fuzzy ordering, union deduplication, exact filtering, duplicate basenames, deterministic sorting, stale filter fallback, and pagination:

```ts
test("all matches deduplicates files and exact filters keep complete membership", () => {
    const shared = createFile("docs/Shared.md");
    const model = buildIndexTagSearchResult({
        query: "proj",
        tags: [
            { tag: "#project", usageCount: 2 },
            { tag: "#project/alpha", usageCount: 2 },
        ],
        getFilesForTag: (tag) => tag === "#project"
            ? [createFile("docs/A.md"), shared]
            : [shared, createFile("other/A.md")],
    });

    assert.deepEqual(selectIndexTagSearchFiles(model, null).map((file) => file.filePath), [
        "docs/A.md",
        "other/A.md",
        "docs/Shared.md",
    ]);
    assert.deepEqual(selectIndexTagSearchFiles(model, "project/alpha").map((file) => file.filePath), [
        "other/A.md",
        "docs/Shared.md",
    ]);
});

test("result windows expose every file in stable increments", () => {
    const files = Array.from({ length: 205 }, (_, index) => createFile(`docs/${String(index).padStart(3, "0")}.md`));
    const model = buildIndexTagSearchResult({
        query: "bulk",
        tags: [{ tag: "#bulk", usageCount: files.length }],
        getFilesForTag: () => files,
    });
    assert.deepEqual(buildIndexTagSearchWindow(model, null, 100), {
        files: selectIndexTagSearchFiles(model, null).slice(0, 100),
        visibleCount: 100,
        totalCount: 205,
        hasMore: true,
    });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/indexTagSearch.test.js
```

Expected: TypeScript fails because `indexTagSearch.ts` does not exist.

- [ ] **Step 3: Implement complete result construction**

Export focused immutable models:

```ts
export interface IndexTagSearchMatch {
    tag: string;
    tagKey: string;
    fileCount: number;
}

export interface IndexTagSearchFile {
    file: TFile;
    filePath: string;
    label: string;
    matchedTags: Array<{ tag: string; tagKey: string }>;
    bestTagRank: number;
}

export interface IndexTagSearchResult {
    query: string;
    tags: IndexTagSearchMatch[];
    files: IndexTagSearchFile[];
}

export function buildIndexTagSearchResult(options: {
    query: string;
    tags: readonly ExistingTagUsage[];
    getFilesForTag(tag: string): readonly TFile[];
}): IndexTagSearchResult;

export function selectIndexTagSearchFiles(
    result: IndexTagSearchResult,
    selectedTagKey: string | null,
): IndexTagSearchFile[];

export function buildIndexTagSearchWindow(
    result: IndexTagSearchResult,
    selectedTagKey: string | null,
    visibleLimit: number,
): { files: IndexTagSearchFile[]; visibleCount: number; totalCount: number; hasMore: boolean };
```

Build each tag membership once, union by full path, retain all matching tags per file, and sort by best tag rank, basename, then path. Exact selection filters the cached model only. Unknown filters behave as `All matches`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/indexTagSearch.test.js
```

Expected: all index tag model tests pass.

- [ ] **Step 5: Commit the slice**

```bash
git add src/ui/views/indexTagSearch.ts tests/indexTagSearch.test.ts
git commit -m "feat(index): model tag file results"
```

### Task 4: Extract shared read-only tag/file rendering

**Files:**
- Create: `src/ui/views/sidebarTagFileList.ts`
- Modify: `src/ui/views/sidebarThoughtTrailRenderer.ts`
- Create: `tests/sidebarTagFileList.test.mjs`
- Modify: `tests/sidebarThoughtTrailRendererSource.test.mjs`

- [ ] **Step 1: Write failing source-composition tests**

Assert the shared renderer exports tag filters and file rows, uses native buttons, `aria-pressed`, counts, full-path tooltips, and an injected `onOpenFile`. Assert Thought Trail imports these helpers and no longer owns duplicate tag-file link markup:

```js
test("shared tag file list is read only and accessible", () => {
    const source = readFileSync("src/ui/views/sidebarTagFileList.ts", "utf8");
    assert.match(source, /export function renderSidebarTagFilterBar/);
    assert.match(source, /export function renderSidebarTagFileRows/);
    assert.match(source, /aria-pressed/);
    assert.match(source, /setTooltip/);
    assert.match(source, /onOpenFile/);
    assert.doesNotMatch(source, /applyTag|removeTag|createTag|checkbox|BatchTag/);
});
```

- [ ] **Step 2: Run the source test and verify RED**

Run:

```bash
node --test tests/sidebarTagFileList.test.mjs
```

Expected: test fails because `sidebarTagFileList.ts` does not exist.

- [ ] **Step 3: Implement shared primitives**

Create functions with callback-only behavior:

```ts
export interface SidebarTagFilterItem {
    tagKey: string | null;
    label: string;
    fileCount: number;
}

export interface SidebarTagFileItem {
    filePath: string;
    label: string;
    pathLabel?: string;
    tags: Array<{ tagKey: string; tagDisplay: string }>;
}

export function renderSidebarTagFilterBar(
    container: HTMLElement,
    filters: readonly SidebarTagFilterItem[],
    selectedTagKey: string | null,
    onChange: (tagKey: string | null) => void,
): void;

export function renderSidebarTagFileRows(
    container: HTMLElement,
    files: readonly SidebarTagFileItem[],
    onOpenFile: (filePath: string) => void,
): HTMLUListElement;
```

Use existing `aside-tag-related-*` classes, native `button` elements, and `setTooltip`. Render `pathLabel` only when supplied. Do not accept mutation callbacks.

- [ ] **Step 4: Adapt Thought Trail**

Replace its local filter-bar, row, and link construction with the shared helpers. Preserve its current client-side filtering by passing a callback that toggles row visibility, or by rebuilding the shared list from its existing model. Keep `openThoughtTrailFile` as the injected navigation callback.

- [ ] **Step 5: Run source and Thought Trail tests and verify GREEN**

Run:

```bash
node --test tests/sidebarTagFileList.test.mjs tests/sidebarThoughtTrailRendererSource.test.mjs
```

Expected: both source suites pass and existing Thought Trail ownership assertions remain valid.

- [ ] **Step 6: Commit the slice**

```bash
git add src/ui/views/sidebarTagFileList.ts src/ui/views/sidebarThoughtTrailRenderer.ts tests/sidebarTagFileList.test.mjs tests/sidebarThoughtTrailRendererSource.test.mjs
git commit -m "refactor(sidebar): share tag file list"
```

### Task 5: Wire the index Tags mode and renderer

**Files:**
- Modify: `src/ui/views/sidebarModeTabs.ts`
- Modify: `src/ui/views/indexSidebarState.ts`
- Modify: `src/ui/views/sidebarToolbarState.ts`
- Modify: `src/ui/views/AsideView.ts`
- Create: `src/ui/views/sidebarIndexTagSearchRenderer.ts`
- Modify: `tests/sidebarModeTabs.test.ts`
- Modify: `tests/indexSidebarState.test.ts`
- Modify: `tests/sidebarToolbarComposition.test.mjs`
- Create: `tests/sidebarIndexTagSearchRenderer.test.mjs`

- [ ] **Step 1: Write failing tab, scope, and toolbar tests**

Update expected index groups to `[["list"], ["tags", "todo", "agent", "thought-trail"]]`. Add a `global-tags` scope assertion when no file is selected. Assert index Tags shows only a search row, omitting file filter, pin, nested, deleted, and add-page actions. Assert the renderer source imports shared filter/file helpers and contains no mutation terms.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarModeTabs.test.js .test-dist/tests/indexSidebarState.test.js && node --test tests/sidebarToolbarComposition.test.mjs tests/sidebarIndexTagSearchRenderer.test.mjs
```

Expected: group and scope assertions fail because index Tags is still excluded and the renderer is missing.

- [ ] **Step 3: Add index-mode policy**

In `sidebarModeTabs.ts`, put `tags` first in the index global modes. In `indexSidebarState.ts`, add `{ kind: "global-tags"; rootFilePath: null }` and return it for Tags without a selected file. Keep side-note search visible only for List. In `sidebarToolbarState.ts`, make Tags a search-only index mode:

```ts
const isIndexTagsMode = options.surface === "index" && options.mode === "tags";
return {
    showRow: options.surface === "index" || isNoteListLikeMode,
    showFileFilter: options.surface === "index" && !isIndexTagsMode,
    showSearch: options.surface === "index"
        ? options.mode === "list" || isIndexTagsMode
        : isSidebarListLikeMode(options.mode),
    showPinned: !isIndexTagsMode && (isIndexCardMode || isNoteFileMode),
    showNested: !isIndexTagsMode && options.hasNestedComments && (isIndexCardMode || isNoteListLikeMode),
    showDeleted: !isIndexTagsMode && (isIndexCardMode || isNoteFileMode),
    showAddPageComment: !isIndexTagsMode && isNoteFileMode && options.hasAddPageCommentAction,
};
```

Make `scopeIndexThreadsByMode` return empty thread arrays for `global-tags`; the dedicated Tags renderer does not consume comment cards. Make `resolveIndexSidebarEmptyStateTexts` return `null` for this scope so the generic comment empty state cannot leak into Tags.

- [ ] **Step 4: Implement the read-only renderer**

Create `sidebarIndexTagSearchRenderer.ts` with:

```ts
export function renderSidebarIndexTagSearch(
    container: HTMLDivElement,
    options: {
        result: IndexTagSearchResult | null;
        selectedTagKey: string | null;
        visibleLimit: number;
        onFilterChange(tagKey: string | null): void;
        onShowMore(): void;
        onOpenFile(filePath: string): void;
    },
): void;
```

Render the initial guidance when no non-empty result exists, `No matching tags` for an empty ranked set, shared filter chips (`All matches` plus ranked tags and unique file counts), the windowed shared file rows, and a native `Show more` button with visible/total counts. Supply path labels and matching tag metadata from the pure model.

- [ ] **Step 5: Add isolated state and debounce to `AsideView`**

Add tag-specific input/query/result/filter/limit/request/timer fields. Reuse `NOTE_SIDEBAR_SEARCH_DEBOUNCE_MS`, target Tags mode, and call:

```ts
this.indexTagSearchResult = buildIndexTagSearchResult({
    query,
    tags: this.plugin.getIndexedVaultTagUsage(),
    getFilesForTag: (tag) => this.plugin.getIndexedMarkdownFilesForTag(tag),
});
this.indexTagSearchSelectedTagKey = null;
this.indexTagSearchVisibleLimit = INDEX_SIDEBAR_LIST_LIMIT;
```

After the model changes, rerender only the index Tags body through a focused `renderIndexTagSearchBody()` method. Do not call full `renderComments` for typing, chip selection, or pagination; keeping the toolbar DOM mounted also preserves input focus without restoration work. Clear the pending timer on view close and when leaving Tags. Keep the last applied query while switching filters; an empty input clears result/filter state. A metadata-driven full render rebuilds the applied query model from the updated capability index.

- [ ] **Step 6: Route toolbar input and body rendering**

When active index mode is Tags, supply tag-specific search options with placeholder `Search tags across your vault` and aria label `Search vault tags`. Remove the forced Tags-to-List fallback. Calculate tag availability from `getIndexedVaultTagUsage().length > 0`, independent of selected index file and comment tags. Pass the same availability into `renderCachedIndexDefaultSidebar`, so a vault with tags but no Aside comments still exposes Tags.

Add a dedicated index Tags fast path before comment scoping, search-window construction, Thought Trail graph work, comment descriptors, and reconciliation. It ensures the index shell, renders normal shared toolbar chrome, calls the read-only body renderer, renders local support if applicable, and returns. The body call is:

```ts
if (isAllCommentsView && effectiveIndexSidebarMode === "tags") {
    renderSidebarIndexTagSearch(shell.commentsBodyEl, {
        result: this.indexTagSearchResult,
        selectedTagKey: this.indexTagSearchSelectedTagKey,
        visibleLimit: this.indexTagSearchVisibleLimit,
        onFilterChange: (tagKey) => this.setIndexTagSearchFilter(tagKey),
        onShowMore: () => this.showMoreIndexTagSearchFiles(),
        onOpenFile: (filePath) => this.openIndexTagSearchFile(filePath),
    });
    return;
}
```

Open files through `getPreferredFileLeaf(filePath)`, verify the current vault object is a `TFile`, call `openFile`, and focus the target leaf. Do not navigate through generated index headings.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarModeTabs.test.js .test-dist/tests/indexSidebarState.test.js .test-dist/tests/indexTagSearch.test.js && node --test tests/sidebarToolbarComposition.test.mjs tests/sidebarIndexTagSearchRenderer.test.mjs
```

Expected: all index Tags mode, state, renderer, and toolbar tests pass.

- [ ] **Step 8: Commit the slice**

```bash
git add src/ui/views/sidebarModeTabs.ts src/ui/views/indexSidebarState.ts src/ui/views/sidebarToolbarState.ts src/ui/views/AsideView.ts src/ui/views/sidebarIndexTagSearchRenderer.ts tests/sidebarModeTabs.test.ts tests/indexSidebarState.test.ts tests/sidebarToolbarComposition.test.mjs tests/sidebarIndexTagSearchRenderer.test.mjs
git commit -m "feat(index): add read-only tag search"
```

### Task 6: Polish, benchmark, and verify the complete feature

**Files:**
- Modify: `styles.css`
- Create: `tests/indexTagSearchPerformance.test.ts`
- Modify: `tests/toolbarDisabledStyles.test.mjs`
- Modify: `docs/superpowers/specs/2026-09-06-index-tag-search-design.md`
- Modify: `docs/superpowers/plans/2026-09-06-index-tag-search.md`

- [ ] **Step 1: Write failing style and performance-contract tests**

Add CSS source assertions for `.aside-index-tag-search`, bounded result layout, passive tag metadata, keyboard focus, and `Show more`. Add a deterministic 10,000-file model test that counts `getFilesForTag` calls, proves no external reader exists in the query API, verifies 100 visible results initially, and records elapsed model-build milliseconds with `performance.now()` as diagnostics rather than a hard timing assertion.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/indexTagSearchPerformance.test.js && node --test tests/toolbarDisabledStyles.test.mjs
```

Expected: CSS assertions fail because the scoped rules are not present.

- [ ] **Step 3: Add minimal theme-native styles**

Use Obsidian variables and the existing tag-related classes. Add only scoped layout rules for the index wrapper, empty/result count text, full-width compact file rows, secondary path text, passive matched-tag wrapping, and a muted `Show more` button. Include `:focus-visible`; do not add raw light/dark colors or `!important`.

- [ ] **Step 4: Re-run focused tests and inspect the benchmark**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/indexTagSearchPerformance.test.js && node --test tests/toolbarDisabledStyles.test.mjs
```

Expected: tests pass; output reports the 10,000-file in-memory model build duration, one reverse-index read per ranked tag, a 100-card initial window, and no vault-read callback.

- [ ] **Step 5: Re-run the change-surface audit**

Run:

```bash
rg -n "boundedDamerauLevenshtein|function scoreTag|renderTagRelatedFileLink|effectiveIndexSidebarMode === \"tags\"|Tag to apply|removeBatchTag" src tests
```

Expected: one fuzzy scorer owner, shared tag/file renderers, intentional index Tags wiring, and note-only mutation controls. Remove stale duplicates before continuing.

- [ ] **Step 6: Run complete verification**

Run:

```bash
npm run build
```

Expected: TypeScript and `.mjs` tests, ESLint, typecheck, Obsidian compliance, production bundling, bundle-size check, and release-artifact guard all pass.

- [ ] **Step 7: Inspect exact shippable artifacts**

Run:

```bash
test ! -e main.js.map
rg -n "sourceMappingURL|sourcesContent|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}" main.js manifest.json styles.css
find . -maxdepth 1 -type f \( -name '.env*' -o -name '.npmrc' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' \) -print
```

Expected: the map test passes and both searches print nothing. The exact public assets remain `main.js`, `manifest.json`, and `styles.css`.

- [ ] **Step 8: Update tracked documentation**

Mark implementation and verification items `[x]` in the spec only where the preceding command output provides evidence. Record the benchmark file count, elapsed duration, final test counts, and bundle size. Mark completed plan steps `[x]`.

- [ ] **Step 9: Commit the verified feature**

```bash
git add styles.css tests/indexTagSearchPerformance.test.ts tests/toolbarDisabledStyles.test.mjs docs/superpowers/specs/2026-09-06-index-tag-search-design.md
git add -f docs/superpowers/plans/2026-09-06-index-tag-search.md
git commit -m "perf(index): bound tag result rendering"
```

- [ ] **Step 10: Review final branch state**

Run:

```bash
git status --short --branch
git diff main...HEAD --check
git log --oneline --decorate main..HEAD
```

Expected: clean `feature/index-tag-search`, no whitespace errors, and focused commits for the spec, shared ranking, reverse index, result model, shared renderer, index wiring, and verified performance polish.
