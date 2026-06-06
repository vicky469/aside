# Thought Trail Related Files Source Design

## Context

Thought Trail currently presents related files from side-note `[[wikilinks]]`. There is also partial source support for tag-based related files in the codebase:

- `src/ui/views/sidebarThoughtTrailSource.ts` defines `wikilinks` and `tags`, with `wikilinks` as the default.
- `src/core/derived/thoughtTrail.ts` has helpers for tag-related file grouping and side-note tag collection.
- `src/ui/views/sidebarThoughtTrailRenderer.ts` currently renders a static `Related Files By: Wikilinks` label.

The product direction separates two different tag concepts:

- A primary `Tags` tab is an editing/batch-mutation mode. When available in a normal note sidebar, it is scoped to the current sidebar context and is used for adding or deleting tags from the side notes in that scope.
- The Thought Trail `Tags` source is a related-files source. It is not a batch tag editor and is not scoped to the current sidebar list. It starts from the current Thought Trail root/source file's tags, then searches related markdown files globally across the vault.

The index sidebar should not show `Tags` as a top-level mode. `Tags` should appear only as an alternate source inside Thought Trail.

## Goals

- Add a `Related Files By` selector under Thought Trail.
- Keep `Wikilinks` selected by default for every fresh view.
- Keep the source choice session-only. Do not persist it in view state, settings, notes, sidecars, or generated index content.
- Add `Tags` as a Thought Trail source that relates files globally across the vault using tags from both markdown source files and side-note entries.
- Keep normal note sidebars allowed to use the existing primary Tags mode for current-sidebar batch tag mutation.
- Keep `Aside index.md` from showing a primary Tags tab.

## Non-Goals

- Do not reintroduce a primary Tags tab in the index sidebar.
- Do not change local side-note tag filtering or batch tag mutation behavior.
- Do not treat the primary Tags mode and the Thought Trail `Tags` source as the same feature.
- Do not change existing wikilink graph semantics.
- Do not write tag-source choice into `getState()`.
- Do not make profiling part of this slice.

## User Experience

Thought Trail shows a compact source control above the related-files graph. The source choices use native radio buttons, not a segmented tab/button control:

```text
Related Files By:  (o) Wikilinks  ( ) Tags
```

`Wikilinks` is selected by default. Selecting `Tags` rerenders the current Thought Trail panel for the current session only. Opening a new sidebar instance, switching to a new source file, or reloading the plugin starts from `Wikilinks` again.

Scope is not a user-selectable setting. Local scope is the default assumption for normal sidebar modes, so other tabs should not show a scope label.

Thought Trail gets a passive text note because the whole Thought Trail panel is vault-scoped:

- Show a quiet passive note such as `Scope: Vault` or `Searches vault`.
- Keep the scope note visible for both `Wikilinks` and `Tags`.
- Do not make scope a user-selectable control.
- Place the scope note at the right edge of the source-control row.

The scope note should be text-first and Obsidian-aligned: small, quiet, and built from theme variables. It should read as simple muted text, not a button, chip, tab, segmented option, or other control.

The radio controls should use Obsidian-native form styling as much as possible:

- real `input[type="radio"]` controls
- normal focus behavior
- theme text, border, and muted colors
- no decorative gradients or custom segmented-control styling

The control belongs under Thought Trail, not in the primary sidebar tab row. In the generated index note, the primary tabs remain:

```text
List  Todo  Agent  Thought Trail
```

When the `Related Files By` source control is visible, the active primary mode is `Thought Trail`. `List`, `Todo`, and `Agent` must render inactive.

Primary sidebar tabs are visually grouped by scope with a simple passive `|` divider:

- Normal source note sidebar: `List Tags Todo Agent | Thought Trail`
- Generated index sidebar: `List Agent | Todo Thought Trail`

`Agent` is local in both surfaces. `Todo` remains local for a normal source note, but is global in the generated index because index Todo operates across the index-wide comment set. `Thought Trail` is global in both surfaces. The divider is not focusable and is not a control.

On a normal source note, the primary Tags mode can still appear when enabled.

That primary Tags mode remains an in-sidebar tag management surface: it is for batching tag add/delete operations against the comments in the current sidebar scope.

The Thought Trail `Tags` source is different: it is a vault-wide related-files source. It uses the selected Thought Trail root/source file's combined markdown and side-note tags as the starting point, then finds matching files across the vault. It does not inherit the current sidebar's list/filter scope.

The `Tags` source should not use Mermaid. Tag results are a fast vertical DOM list grouped by shared tag. Each group header is the tag text only, without a leading `#` and without a `Tag:` label. Files under each tag are clickable.

## Source Definitions

### Wikilinks

The `Wikilinks` source preserves existing behavior:

- Scan side-note bodies for `[[wikilinks]]`.
- Resolve links through Obsidian link resolution.
- Render the existing recursive related-file graph.

### Tags

The `Tags` source builds a combined tag set for each file:

- Markdown file tags from Obsidian metadata, using `metadataCache.getFileCache(file)` and the cached inline/frontmatter tag fields.
- Side-note tags extracted from every thread entry for that file, using the existing comment-tag parser.

`Aside index.md` file rows should also display this same combined tag set next to each file link. The generated index is derived output, so this merge should happen while building the index note rather than repeatedly recomputing source markdown tags during sidebar render. Tag-file discovery for Thought Trail can still call Obsidian metadata APIs ad hoc because it is an interactive vault query.

For the root/source file, the required tag set is the union of its markdown tags and side-note tags.

A candidate file is related when its combined tag set shares at least one normalized tag with the root/source file. This is intentionally an overlap match, not an all-tags-required match, because source files often carry broad metadata and strict all-tag matching hides useful related files.

Matching files are deduped by normalized file path. The root/source file is excluded from results.

The rendered tag-source shape is:

```text
project/alpha
- File 1
- File 2

status
- File 3
```

## Candidate Scope

For a normal note Thought Trail:

- Root/source file: the current note.
- Candidate files: existing markdown files in the vault, excluding the generated index note and the root/source file.
- Candidate tag data: markdown metadata tags plus side-note tags from indexed comment state.

For `Aside index.md` Thought Trail:

- Root/source file: the file selected through the existing Files filter.
- Do not auto-select a source file when opening the generated index note. If no source file is selected, keep the existing prompt to choose a file.
- Keep the no-selected-file default index sidebar cheap by caching the derived default toolbar/filter state. The cache is invalidated by generated index note changes and aggregate comment index version changes.
- Candidate files: existing markdown files in the vault, excluding the generated index note and the root/source file.
- Candidate tag data: markdown metadata tags plus side-note tags from indexed comment state.

This means the index sidebar's primary list/filter scope is used only to choose the Thought Trail root/source file. Once that root/source file is selected, the Thought Trail `Tags` source searches globally across the vault.

## Availability And Empty States

Thought Trail should be available when a root/source file exists and either:

- the Wikilinks source has renderable related-file lines, or
- the Tags source has at least one root/source tag.

Because `Wikilinks` is the default source, it can show an empty wikilink-specific state while still allowing the user to switch to `Tags`.

Tag-source empty states:

- No root/source file: use the existing source-file prompt.
- Root/source file has no markdown or side-note tags: `No tags found for this file yet.`
- Root/source file has tags, but no candidate file shares them: `No related files share this file's tags.`

Wikilink empty states remain unchanged.

## Data Flow

1. `AsideView` determines whether the sidebar is rendering a normal source note or the generated index note.
2. `AsideView` builds the Thought Trail root/source file path.
3. `AsideView` provides `renderSidebarThoughtTrail(...)` with:
   - current source selection
   - source change callback
   - candidate file paths
   - combined tag lookup for a file path
4. `sidebarThoughtTrailRenderer.ts` renders the source control, the passive vault-scope note, and selects the renderer:
   - `buildThoughtTrailLines(...)` for `wikilinks`
   - a tag-grouped related-file helper for `tags`, rendered as a direct DOM list
5. Selecting a different source updates view-local state and rerenders without data refresh.

## State

The source selection is a private `AsideView` field, not serialized state.

Rules:

- Default is always `wikilinks`.
- Reset to `wikilinks` when the active source file changes.
- Reset to `wikilinks` when the sidebar instance is recreated.
- Do not include the source selection in `CustomViewState`.
- If `tags` is selected and the root/source file loses all tags, fall back to `wikilinks`.

## Testing

Do not modify tests unless the implementation session explicitly allows it. If tests are allowed in a later session, add focused coverage for:

- Combined tag lookup includes both markdown metadata tags and side-note tags.
- Tag related files match when they share at least one normalized tag with the root/source file.
- Tag related files exclude the root/source file and dedupe candidates.
- Wikilinks remains the default source.
- Source selection is not serialized in `getState()`.
- Index sidebar hides primary Tags mode while Thought Trail can still show the internal Tags source.
- Index sidebar Thought Trail `Tags` source searches globally across the vault after a root/source file is selected, rather than inheriting the current index sidebar filter scope.
- Thought Trail source controls render as native radio buttons.
- Scope is not rendered in primary tabs or normal local modes.
- Thought Trail shows a passive `Scope: Vault` note for the panel, regardless of the selected source.
- Tag-source output renders as a direct vertical DOM list grouped by bare tag text.

## Acceptance Criteria

- Normal note Thought Trail shows `Related Files By` with `Wikilinks` selected by default.
- The `Thought Trail` primary tab is active whenever the source selector is visible.
- Primary sidebar tabs are divided by a passive `|` between local and global scope groups.
- Normal source note tabs render as `List Tags Todo Agent | Thought Trail` when Tags is enabled.
- Generated index tabs render as `List Agent | Todo Thought Trail`.
- Thought Trail source choices are rendered as native radio controls.
- Thought Trail shows no scope control. It shows a passive `Scope: Vault` note for the panel, regardless of the selected source.
- Switching to `Tags` shows related files that share tags from the current note's markdown metadata or side notes.
- Tags source does not use Mermaid.
- Tags source group headers show bare tag text without `#` or `Tag:`.
- Tags source file rows are clickable.
- `Aside index.md` file rows show source markdown tags and side-note tags together, deduped case-insensitively and sorted by normalized tag text.
- The index sidebar can render file-row tags from the generated index metadata without recomputing source markdown tags.
- `Aside index.md` does not show a primary Tags tab.
- `Aside index.md` Thought Trail can still switch between `Wikilinks` and `Tags` after a source file is selected.
- `Aside index.md` Thought Trail `Tags` results search globally across the vault and are not limited by the current index sidebar filter scope.
- Source choice resets to `Wikilinks` on fresh view/session and is not persisted.
- Existing wikilink Thought Trail behavior is unchanged.
