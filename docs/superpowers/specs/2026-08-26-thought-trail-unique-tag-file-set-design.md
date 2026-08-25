# Thought Trail Unique Tag File Set Design

**Date:** 2026-08-26
**Status:** Approved for planning

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Thought Trail can derive tags from note metadata and side-note entries.
- [x] Tag discovery normalizes vault paths, excludes the current file, and excludes the configured generated Aside index.
- [x] The Tags source renders the current file once and opens related files through the existing Thought Trail navigation path.
- [x] The current grouped model exposes every matching source tag for each candidate file, although it renders multi-tag files repeatedly.

### To Implement

- [ ] Replace the group-oriented tag result with one unique related-file model keyed by normalized full file path.
- [ ] Accumulate every shared source tag on each unique file and derive per-tag counts from that file set.
- [ ] Render `All` plus single-select tag filter buttons below the current filename, with `All` selected by default.
- [ ] Render one row per unique file with every shared tag visible on that row, regardless of the selected filter.
- [ ] Keep filter state transient and remove obsolete tag-group rendering, group-only types, group-only styles, and source-contract assertions.
- [ ] Preserve semantic lists, keyboard access, native file tooltips/navigation, compact sidebar layout, current-file exclusion, and generated-index exclusion.

### Verification

- [ ] Pure model tests cover multi-tag deduplication, unique counts, tag and file ordering, path normalization, same-basename files, current-file exclusion, generated-index exclusion, and empty inputs.
- [ ] Renderer and style tests cover one semantic unique-file list, visible shared tag labels, `All`/tag button accessibility, single-selection behavior, and removal of nested tag groups.
- [ ] Existing Thought Trail sources and navigation remain green, and the full test, lint, typecheck, Obsidian compliance, production bundle, and release-artifact guard pass.
- [ ] An installed-vault smoke test confirms the default one-shot list contains no repeated file path and tag filtering narrows the same rows without duplicating them.

## Problem

Thought Trail currently groups related files under every shared tag. A file that shares two or more tags with the current file is rendered once in each matching group. The repeated filename makes the tag view look larger than the actual related-file set and forces the user to mentally deduplicate it.

The Tags source should present file identity first: every related vault file appears once. Tags should remain visible as categories and optional filters, without owning duplicate copies of file rows.

## Goals

- Show the complete related-file set in one glance with no repeated file path.
- Keep every shared tag visible so users can understand why a file is related.
- Let users narrow the same set by one tag without replacing the default one-shot view.
- Make counts, ordering, and filtering derive from one normalized set model.
- Preserve the compact native Aside/Obsidian sidebar experience.

## Non-Goals

- Adding a Dedup setting or on/off toggle.
- Persisting the selected tag across renders, sessions, files, or devices.
- Supporting multi-select, union, or intersection filter modes.
- Hiding distinct files that share the same basename in different folders.
- Changing tag extraction, tag syntax, metadata parsing, side-note tag parsing, Thought Trail Wikilinks, or file navigation.
- Adding tag editing or tag management inside Thought Trail.

## User Experience

The Tags view starts with the current file label. Directly beneath it is a compact row of filter buttons:

- `All · N`, selected by default;
- one button per shared tag, labeled with that tag and its unique-file count.

Below the filters, one semantic list displays every related file exactly once. Each row contains the existing clickable filename and a compact set of all tags that the file shares with the current file. A file matching `#finance` and `#valuation` therefore appears as one row with both tag labels.

Selecting a tag button filters the existing rows to files containing that tag. It does not build or reveal a separate tag group. Selecting `All` restores the complete unique set. Exactly one filter is selected at a time, exposed with `aria-pressed`.

Filter state is local to the rendered view. A normal sidebar rerender resets the view to `All`, keeping behavior predictable and avoiding another persisted setting.

## Unique File-Set Model

`src/core/derived/thoughtTrail.ts` becomes the sole owner of tag-related file identity, membership, counts, and ordering.

The shared planner returns a model shaped around files rather than groups:

```ts
interface TagRelatedFileTag {
    tagKey: string;
    tagDisplay: string;
    fileCount: number;
}

interface TagRelatedUniqueFile {
    filePath: string;
    label: string;
    tags: Array<Pick<TagRelatedFileTag, "tagKey" | "tagDisplay">>;
}

interface TagRelatedFileSetModel {
    currentFile: TagRelatedFileListItem | null;
    tags: TagRelatedFileTag[];
    files: TagRelatedUniqueFile[];
}
```

The exact exported names may follow existing local conventions, but these responsibilities must remain together.

For each candidate path, the planner:

1. normalizes the full vault path;
2. rejects an empty path, the current file, and the configured Aside index;
3. looks up the candidate's normalized tags;
4. intersects them with the current file's normalized tag keys;
5. skips candidates with no shared tags;
6. inserts or merges the candidate in a `Map` keyed by normalized full file path;
7. adds every matching tag to that file's tag map;
8. derives tag counts from the completed unique file map.

A `Set` or `Map` key represents a full normalized path, not the displayed basename. Two candidate references to `docs/a.md` collapse into one item. `folder-a/index.md` and `folder-b/index.md` remain two real files even though their visible labels match; their existing full-path tooltip distinguishes them.

Tags sort by normalized key. Files retain deterministic alphabetical full-path ordering, and each file's tags follow the shared tag ordering. Counts include each file at most once per tag.

## Rendering and Interaction

`src/ui/views/sidebarThoughtTrailRenderer.ts` is a thin consumer of the shared model.

- Render the current file using the existing non-interactive row.
- Render filter controls below it as native buttons with `aria-pressed`, keyboard focus, and unique counts.
- Render one related-files `ul`; do not render nested lists or tag-owned file groups.
- Render the existing file-opening button once per model file.
- Render the file's shared tags as compact secondary labels beneath or beside the filename.
- On filter click, update selected-button state and row visibility from the already-built model; do not rebuild tag relationships or mutate vault data.

The availability check in `AsideView` consumes the same planner and tests `model.files.length`. It must not retain the old grouped planner as a second source of truth.

The renderer may retain a small local helper for DOM updates, but it must not repeat normalization, deduplication, membership, count, or sorting policy.

## Empty and Error States

- Current file has no tags: preserve the existing unavailable Tags source behavior.
- No other file shares a current-file tag: preserve the existing unavailable/empty behavior.
- Candidate path is missing or normalizes empty: ignore it.
- Candidate is the current file or generated Aside index: ignore it.
- Duplicate candidate references or duplicate tag spellings: merge them through normalized keys.
- Selected filter after a rerender: reset to `All`; no stale selection recovery is needed.
- File disappears after model construction: existing open-target handling remains responsible for the navigation failure.

## Testing Strategy

### Shared model

Replace group-centric expectations with table-driven unique-set cases. Prove that one file matching several tags appears once, carries every shared tag, increments each relevant tag count once, and remains filterable by each tag. Cover duplicate candidate paths, tag case/format normalization, deterministic ordering, current/index exclusion, empty input, and distinct full paths with the same basename.

### Renderer contract

Verify the renderer contains one root related-file list and no nested tag-group lists. Assert the current file remains non-interactive, each related file uses the existing file-link control, tag labels are rendered from the model, and filter buttons use `aria-pressed` with exactly one selected state.

### Styles and integration

Replace group-header and nested-list style assertions with compact filter-row, selected-filter, file-tag-label, and unique-list assertions using Obsidian theme variables. Keep existing file tooltip/navigation, Tags source availability, sidebar sizing, and Wikilinks tests green.

### Installed acceptance

Open a file whose related files share overlapping tags. Confirm `All` shows one row per full file path, a multi-tag row displays every shared tag, tag counts reflect unique files, selecting each tag only filters the existing set, and selecting `All` restores the same duplicate-free rows.

## Change-Surface Ownership

- Tag extraction and normalized tag keys: existing helpers in `src/core/derived/thoughtTrail.ts`.
- Unique file identity, tag membership, counts, and ordering: the new file-set planner in `src/core/derived/thoughtTrail.ts`.
- Tag source availability: `src/ui/views/AsideView.ts`, consuming only `model.files.length`.
- DOM rendering and transient filter interaction: `src/ui/views/sidebarThoughtTrailRenderer.ts`.
- Compact presentation: `styles.css` using existing Obsidian theme variables.
- Behavioral regression tests: `tests/thoughtTrail.test.ts`, renderer source tests, and style contract tests.

Production code must not keep both grouped and unique tag-related models. Generated `main.js` and installed plugin files remain build artifacts, not policy owners.
