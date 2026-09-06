# Index Tag Search Design

**Date:** 2026-09-06
**Status:** Approved for implementation planning

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside maintains an in-memory index of Markdown files and their Obsidian metadata-cache tags.
- [x] Aside has tested fuzzy tag-ranking behavior with exact, prefix, segment, substring, and bounded typo matching.
- [x] The sidebar has reusable mode-tab, search-field, filter-chip, and compact file-row visual patterns.
- [x] Existing file navigation can open Markdown notes that have no Aside comments.

### To Implement

- [ ] Add a vault-wide, read-only `Tags` tab to the index sidebar.
- [ ] Extend the vault capability index with one normalized tag-to-file reverse index and immutable query results.
- [ ] Extract shared existing-tag ranking so editor suggestions and index search consume one source of truth while only the editor can offer tag creation.
- [ ] Add isolated index-tag query and selected-filter state with the existing 120 ms search debounce.
- [ ] Render ranked exact and similar tags above a deduplicated file result set.
- [ ] Make `All matches` a union keyed by normalized full file path and make individual tag filters use exact reverse-index membership.
- [ ] Render compact file cards with filename, disambiguating path, and matched tags; open the source Markdown note on activation.
- [ ] Exclude every tag mutation affordance from the index surface.
- [ ] Limit the initial DOM result window to 100 unique files and expose the complete result set through incremental `Show more` pagination.

### Verification

- [ ] Fail-first tests cover reverse-index seed, update, rename, delete, normalization, and immutable query behavior.
- [ ] Fail-first tests cover shared fuzzy ranking and the index-only exclusion of create suggestions.
- [ ] Fail-first tests cover empty queries, no matches, exact/similar ordering, union deduplication, exact tag filtering, same-basename paths, and pagination.
- [ ] Fail-first source or renderer tests confirm the index tab is present and no add, remove, create, checkbox, or batch-tag controls are wired into it.
- [ ] Navigation tests confirm every result opens its source note, including notes with no Aside comments.
- [ ] A synthetic 10,000-file benchmark confirms query-time work stays in memory, performs no vault reads, and remains comfortably interactive.
- [ ] Full tests, lint, typecheck, Obsidian compliance, production bundle, bundle-size guard, and release-artifact inspection pass.

## Problem

The generated `🐰 Aside Index.md` sidebar can browse side-note modes, but it cannot search the vault's normal Markdown tags. The note-local Tags tab is not an appropriate direct fit because it indexes tags inside Aside comment text and includes batch mutation controls. The index needs a vault-wide discovery surface that recognizes both inline and frontmatter tags from Obsidian's metadata cache, includes tagged notes that have no Aside comments, and never edits tags.

## Goals

- Search every tag recognized by Obsidian in every indexed Markdown file.
- Return unique Markdown files as compact, navigable cards.
- Make exact and similar tag discovery forgiving without adding perceptible input latency.
- Reuse Aside's established sidebar controls and file-result presentation.
- Keep retrieval and filter changes entirely in memory.
- Preserve correct results across file creation, metadata changes, rename, and deletion.

## Non-Goals

- Creating, applying, removing, renaming, or otherwise modifying tags.
- Searching tags written only inside Aside comments unless Obsidian also recognizes them as tags in the Markdown note itself.
- Restricting results to notes that have Aside comments or generated-index sections.
- Scrolling to a generated index position; result activation opens the source Markdown note directly.
- Adding compound AND/OR tag expressions, multi-select semantics, or persistent saved searches.

## User Experience

### Tab placement

The index sidebar includes `Tags` immediately after `List`. It belongs to the index's vault-wide group because its scope is the complete Markdown vault. The tab is available whenever the capability index contains at least one recognized vault tag.

### Empty state

Opening the tab shows a focused read-only search field with the placeholder `Search tags across your vault`. No tags or files are rendered until the user enters a non-empty query.

### Search and filtering

Input uses Aside's existing 120 ms trailing debounce. Once the user pauses:

1. Existing tags are ranked by exact, prefix, path-segment prefix, substring, and bounded Damerau-Levenshtein similarity.
2. Ranked tags render as compact filter chips above the results. Exact matches appear before similar matches.
3. `All matches` is active initially and shows the deduplicated union of files attached to every ranked tag.
4. Selecting one tag chip filters the existing result model to the exact membership set for that tag without another vault lookup.
5. Selecting `All matches` restores the union.

A non-empty query with no matches renders `No matching tags` and no file cards.

### File results

Each result is a compact, keyboard-accessible file card based on the existing related-file row presentation:

- The basename is the primary label.
- The vault-relative path is shown as secondary text when it is useful for location or basename disambiguation.
- The matching ranked tags associated with that file are shown as passive metadata.
- The native tooltip exposes the full vault-relative path.
- Click or keyboard activation opens the source Markdown note through the existing preferred-leaf navigation path.

Files with the same basename but different full paths remain distinct. Files without Aside comments remain eligible and open normally.

### Large result sets

The result model always contains the complete set. The renderer mounts the first 100 unique files and exposes additional results in 100-file increments through `Show more`, with visible and total counts. Filtering resets the visible window. This bounds DOM work without making any associated file unreachable.

## Architecture

### Shared data owner

`VaultCapabilityIndex` remains the source of truth for Markdown-file capabilities. Alongside its existing per-file tags, it owns a reverse `tag key -> files by normalized path` index. Seed, upsert, rename, and remove update both directions atomically.

The public query API returns snapshots rather than internal maps or mutable arrays. It supports:

- listing existing tag usage for fuzzy ranking;
- resolving the exact file membership for a normalized tag key;
- resolving ranked tag matches into a complete, deduplicated file result model.

Queries do not call `Vault`, `MetadataCache`, the adapter, or Markdown parsers.

### Shared fuzzy ranking

The match scorer currently embedded in `commentTagSuggestions` moves behind a shared existing-tag ranking function. The editor adapter may prepend its existing `create` suggestion after shared ranking. The index adapter consumes only ranked existing tags and therefore cannot produce a create action.

This keeps one definition of normalization and relevance while preserving different product permissions at thin adapters.

### Index tag browser

A focused index-tag module owns pure state/model operations:

- normalized query;
- ranked matching tags;
- active filter key or `all`;
- deduplicated file models;
- visible pagination count.

The `AsideView` adapter owns lifecycle concerns: the 120 ms timer, focus restoration, mode changes, rendering, and workspace navigation. Tag-search state is separate from index side-note search and note-local tag state.

### Rendering reuse

The index surface reuses the established primary mode tabs, secondary search control, filter-chip styling, and compact related-file presentation. Shared visual primitives may be extracted where needed, but the read-only renderer does not call or receive note-local batch-tag mutation callbacks.

## Data Rules

- Obsidian's `getAllTags` metadata result defines recognized inline and frontmatter tags.
- Tag identity is case-insensitive and normalized through the existing tag normalization rules.
- File identity is the normalized full vault-relative path.
- `All matches` is a set union across ranked tag memberships.
- A single-tag filter resolves only the exact selected tag key; fuzzy similarity affects tag discovery, not membership.
- Result ordering is deterministic: best matching-tag rank, then basename, then full path.
- Per-tag counts and total counts count unique files.

## Lifecycle and Failure Handling

- Startup seeding builds both index directions once from the existing metadata cache.
- Metadata changes update only the affected file.
- Create, rename, and delete reuse existing capability-index event routing.
- A file that disappears between model creation and activation is ignored safely and the next metadata-driven render removes it.
- Switching away from Tags cancels the pending debounce timer and retains no mutation state.
- Empty or stale selected filters fall back to `All matches` for the current query.

## Performance Contract

- No Markdown text reads or vault scans occur on tab render, input debounce, chip selection, or pagination.
- The 120 ms debounce matches Aside's current sidebar-search timing.
- Fuzzy ranking operates over the existing unique tag list, capped at 40 ranked tags as in current suggestions.
- Reverse membership makes selected-tag filtering proportional to that tag's files.
- Union construction deduplicates with a path-keyed map.
- DOM mounting is bounded to 100 result cards per page.

The implementation records a synthetic 10,000-file benchmark result during verification. The benchmark is diagnostic rather than a fragile wall-clock CI gate; deterministic tests enforce the more important no-I/O and bounded-render contracts.

## Accessibility

- The search field has a visible or accessible label and native search semantics.
- Filter chips are native buttons with `aria-pressed` state and unique-file counts.
- File cards are native buttons or links with full-path tooltips and keyboard activation.
- Empty and result-count messages use readable text rather than color alone.
- Focus remains in the search field across debounced rerenders.

## Change Surface

Expected implementation areas:

- `src/core/vault/vaultCapabilityIndex.ts` for shared membership ownership.
- The shared tag-ranking module and its editor adapter.
- A focused index-tag browser model/renderer under `src/ui/views/`.
- `src/ui/views/sidebarModeTabs.ts`, `indexSidebarState.ts`, and `AsideView.ts` for mode/state wiring.
- `styles.css` only for narrowly scoped file-card or result-layout additions not already covered by shared classes.
- Unit, source-composition, renderer, navigation, and performance tests under `tests/`.

No release version or manifest change is part of this feature.
