# Thought Trail Related Files Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit in the Aside repository unless the user explicitly asks.

**Goal:** Add a Thought Trail `Related Files By` selector that defaults to wikilinks and can switch to a session-only tag-based deduped related-file graph.

**Architecture:** Keep existing wikilink graph behavior unchanged. Add a focused derived helper for tag-based file-set graph lines, a small source-state helper for default/session behavior, and a renderer-level radio control that calls back into `AsideView` without persisting view state.

**Tech Stack:** TypeScript, Obsidian plugin APIs, Obsidian `metadataCache.getFileCache`, Obsidian `getAllTags`, Mermaid, Node test runner.

---

### Task 1: Tag-Based Related File Graph Helper

**Files:**
- Modify: `src/core/derived/thoughtTrail.ts`
- Test: `tests/thoughtTrail.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that call `buildTagRelatedFileLines("dev", "docs/source.md", ["docs/source.md", "docs/a.md", "docs/b.md"], getTags)` and assert:

- files must contain every normalized source tag
- source file is excluded
- duplicate candidate paths are rendered once
- matching files get clickable Mermaid nodes

- [ ] **Step 2: Run tests to verify red**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/thoughtTrail.test.js`

Expected: TypeScript fails because `buildTagRelatedFileLines` does not exist.

- [ ] **Step 3: Implement helper**

Add `buildTagRelatedFileLines(vaultName, sourceFilePath, candidateFilePaths, getTagsForFilePath)` to `thoughtTrail.ts`. Reuse existing node labels/open URLs and Mermaid init. Normalize tags by trimming, ensuring a single leading `#`, and lowercasing for comparison. Candidate files match when they contain all source tag keys.

- [ ] **Step 4: Run tests to verify green**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/thoughtTrail.test.js`

Expected: PASS.

### Task 2: Session-Only Source State

**Files:**
- Create: `src/ui/views/sidebarThoughtTrailSource.ts`
- Test: `tests/sidebarThoughtTrailSource.test.ts`

- [ ] **Step 1: Write failing tests**

Test `getDefaultThoughtTrailSource()` returns `"wikilinks"` and `normalizeThoughtTrailSource` accepts only `"wikilinks"` and `"tags"`.

- [ ] **Step 2: Run tests to verify red**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarThoughtTrailSource.test.js`

Expected: TypeScript fails because the module does not exist.

- [ ] **Step 3: Implement helper**

Create `SidebarThoughtTrailSource = "wikilinks" | "tags"`, `getDefaultThoughtTrailSource()`, and `normalizeThoughtTrailSource(value)`.

- [ ] **Step 4: Run tests to verify green**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/sidebarThoughtTrailSource.test.js`

Expected: PASS.

### Task 3: Renderer Selector And Tag Graph

**Files:**
- Modify: `src/ui/views/sidebarThoughtTrailRenderer.ts`
- Modify: `styles.css`

- [ ] **Step 1: Extend renderer options**

Add source options to `SidebarThoughtTrailOptions`: current source, source change callback, candidate file paths, and a function that returns Obsidian tags for a file path.

- [ ] **Step 2: Render native-style radio controls**

Render `Related Files By` with two compact radio labels before the graph. Use normal radio inputs, Obsidian CSS variables, and existing Thought Trail spacing.

- [ ] **Step 3: Switch graph source**

Use existing `buildThoughtTrailLines` for `wikilinks`; use `buildTagRelatedFileLines` for `tags`. Keep the section title `Related Files`. Add tag-specific empty-state text for no source tags or no matching files.

### Task 4: AsideView Wiring

**Files:**
- Modify: `src/ui/views/AsideView.ts`

- [ ] **Step 1: Add view-local source state**

Add `thoughtTrailSource` initialized with `getDefaultThoughtTrailSource()`. Reset it when `setCurrentFile` sees a file-path change.

- [ ] **Step 2: Provide Obsidian tag lookup**

Add a private `getThoughtTrailTagsForFilePath(filePath)` that gets a `TFile`, calls `metadataCache.getFileCache(file)`, and passes that cache to Obsidian `getAllTags`.

- [ ] **Step 3: Pass candidate paths**

For note Thought Trail, pass `scopedFilePaths`. For index Thought Trail, pass `filteredIndexFilePaths`. On source change, update session state and rerender without data refresh.

### Task 5: Verification

**Files:**
- All changed source and tests

- [ ] **Step 1: Run focused tests**

Run the focused test files touched by this change.

- [ ] **Step 2: Run full build**

Run: `npm run build`

Expected: tests, lint, TypeScript, and production bundle pass.

