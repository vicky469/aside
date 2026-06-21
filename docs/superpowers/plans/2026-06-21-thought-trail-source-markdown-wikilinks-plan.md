# Thought Trail Source Markdown Wikilinks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Thought Trail `Wikilinks` use both side-note wikilinks and source markdown note links/embeds without expanding index comment-list membership.

**Architecture:** Add a Thought Trail-specific note-link graph builder under `src/core/derived/` that combines side-note edges with source-markdown metadata-cache edges. Keep the existing index file filter graph unchanged, and wire Thought Trail availability/rendering to the richer graph only.

**Tech Stack:** TypeScript, Obsidian metadata cache APIs, Node test runner, existing Mermaid line renderer.

---

### Task 1: Core Graph Red Tests

**Files:**
- Create: `tests/thoughtTrailNoteLinkGraph.test.ts`
- Modify: none

- [ ] **Step 1: Write failing tests**

Cover source markdown normal links, markdown-only embeds, commentless related nodes, duplicate source-edge suppression when a side-note edge exists, exclusions for `Aside index.md`, self-links, unresolved links, and non-markdown targets.

- [ ] **Step 2: Run tests to verify red**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json`

Expected: FAIL because `src/core/derived/thoughtTrailNoteLinkGraph.ts` does not exist yet.

### Task 2: Core Graph Implementation

**Files:**
- Create: `src/core/derived/thoughtTrailNoteLinkGraph.ts`
- Modify: `src/core/derived/thoughtTrail.ts`
- Test: `tests/thoughtTrailNoteLinkGraph.test.ts`, `tests/thoughtTrail.test.ts`

- [ ] **Step 1: Implement the reusable renderer entrypoint**

Export `ThoughtTrailRenderableEdge` and `buildThoughtTrailLinesFromEdges(...)` from `thoughtTrail.ts`, then make existing `buildThoughtTrailLines(...)` delegate to it without changing current output.

- [ ] **Step 2: Implement the note-link graph builder**

Build side-note edges from thread/comment `[[wikilinks]]`, build source-markdown edges from cached link/embed link paths, resolve both through caller-provided resolvers, derive undirected connected components, and expose `buildThoughtTrailNoteLinkLines(...)` for rooted Mermaid rendering.

- [ ] **Step 3: Run focused tests**

Run: `./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/thoughtTrail.test.js .test-dist/tests/thoughtTrailNoteLinkGraph.test.js`

Expected: PASS.

### Task 3: Sidebar Wiring

**Files:**
- Create: `src/ui/views/sidebarThoughtTrailGraph.ts`
- Modify: `src/ui/views/sidebarThoughtTrailRenderer.ts`
- Modify: `src/ui/views/sidebarThoughtTrailState.ts`
- Modify: `src/ui/views/sidebarThoughtTrailScope.ts`
- Modify: `src/ui/views/AsideView.ts`
- Test: existing sidebar Thought Trail tests plus new or updated focused tests if required

- [ ] **Step 1: Add Obsidian metadata-cache adapter**

Create a UI helper that reads `metadataCache.getFileCache(file).links` and `.embeds`, resolves references with `metadataCache.getFirstLinkpathDest`, and returns only markdown `TFile` targets.

- [ ] **Step 2: Use richer graph for Thought Trail**

Use the note-link graph for normal note scope, index Thought Trail availability, note Thought Trail availability, and `Wikilinks` rendering. Pass all vault markdown files except `Aside index.md` as source-markdown candidates.

- [ ] **Step 3: Preserve index list boundaries**

Leave `buildIndexFileFilterGraph(...)`, `deriveIndexSidebarScopedFilePaths(...)`, Files filter options, and List tab comment scoping on the existing comment-index graph.

- [ ] **Step 4: Update empty-state copy**

Change `Wikilinks` empty states to mention source notes and side notes per the spec.

### Task 4: Verification And Tracking

**Files:**
- Modify: `docs/superpowers/specs/2026-06-21-thought-trail-source-markdown-wikilinks-design.md`

- [ ] **Step 1: Run full verification**

Run: `npm test`, `npm run lint`, and `tsc -noEmit -skipLibCheck`.

Expected: all commands exit 0.

- [ ] **Step 2: Update spec tracking**

Mark implementation and verification checkboxes complete only after the relevant tests/builds pass.
