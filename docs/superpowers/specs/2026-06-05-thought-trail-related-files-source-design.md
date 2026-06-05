# Thought Trail Related Files Source Design

## Context

Thought Trail currently renders `Related Files` from side-note `[[wikilinks]]`. Users can see the resulting graph, but the view does not make the source logic explicit and cannot switch to tag-based relationships.

## Goals

- Show a clear source selector under Thought Trail so users know how related files are derived.
- Keep `Wikilinks` selected by default every time a file/sidebar view starts fresh.
- Add a session-only `Tags` source that uses Obsidian's built-in metadata APIs.
- Render tag results as a deduped set of related files, not duplicate edges per shared tag.

## Non-Goals

- Do not persist the selected source across plugin reloads, app restarts, or fresh file/sidebar opens.
- Do not change existing side-note local tag workflows.
- Do not parse source markdown tags manually when Obsidian metadata is available.
- Do not change current wikilink Thought Trail behavior.

## User Experience

Thought Trail shows a compact radio group above the `Related Files` graph:

`Related Files By: Wikilinks | Tags`

`Wikilinks` is checked by default. Selecting `Tags` updates the graph for the current session only. Opening a fresh file view or recreating the sidebar returns to `Wikilinks` and clears the previous tag-source view.

The control should match Obsidian's native UI style. It should use compact radio inputs or equivalent Obsidian-native form styling, existing sidebar spacing, and Obsidian CSS variables for text, borders, backgrounds, focus states, and muted labels. It should not introduce a branded visual treatment, decorative colors, or a custom segmented-control look that feels separate from Obsidian.

## Wikilinks Source

The `Wikilinks` source preserves the existing behavior:

- Side-note bodies are scanned for `[[wikilinks]]`.
- Obsidian link resolution maps each link to a markdown file.
- The current recursive file graph is rendered without semantic changes.

## Tags Source

The `Tags` source uses Obsidian metadata:

- Read the current source markdown file's tags with `metadataCache.getFileCache(file)` and `getAllTags(cache)`.
- Normalize tags before comparison.
- Candidate files come from the current sidebar scope:
  - note sidebar: files represented in the rooted Thought Trail scope around the current file
  - index sidebar: files in the selected index file-filter scope
- A candidate file matches only when it contains the same required source tag set.
- The current source file is excluded from the related-file results.
- Matching files are deduped by file path.

The tag graph renders one source node and one node for each matching file. Each matching file appears once even when several tags match.

## Empty States

Tag mode shows an empty state when:

- the current source markdown file has no Obsidian tags
- no files in the current sidebar scope match the source tag set
- there is no root/source file available

Wikilink empty states remain unchanged.

## State

The source selector is view-local, session-only state. It is not written into plugin settings, persisted view state, markdown files, sidecar JSON, or the generated index.

When the active source file changes or the sidebar is recreated, the source resets to `Wikilinks`.

## Testing

Add focused tests for:

- tag-source graph construction dedupes files and excludes the source file
- tag-source matching requires the full source tag set
- tag-source matching uses normalized tags
- source selection resolves to `Wikilinks` by default for fresh state
- existing wikilink Thought Trail tests remain unchanged

