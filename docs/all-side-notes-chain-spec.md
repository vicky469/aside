# SideNote2 Index Sidebar Modes Spec

## Summary

Add a mode toggle to the SideNote2 sidebar when the active file is the managed `SideNote2 index` note:

- `All side notes`
- `Chain`

`All side notes` keeps the current behavior.

`Chain` is a scoped exploration mode rooted at one selected file. It starts from that file, shows all SideNote2 notes attached to it, extracts wiki links from those note bodies, and recursively continues into linked files that also have SideNote2 notes.

This spec is for discussion and implementation planning only.

## Goals

- Preserve the current vault-wide browsing experience.
- Add a second mode for following connected thinking starting from one file.
- Keep the UI inside the existing SideNote2 sidebar for the managed index note.
- Make the chain readable as a nested sequence instead of a full graph visualization.

## Non-Goals

- Do not change the normal per-file SideNote2 sidebar behavior.
- Do not build a free-form graph canvas.
- Do not infer links from plain text mentions.
- Do not traverse the entire vault by default.
- Do not implement slash commands in v1.

## Scope

The mode toggle is shown only when the active file is the managed `SideNote2 index` note.

Implementation should key off the managed index note identity or path, not a literal filename string match, even though the user-facing label is `SideNote2 index`.

For all other files, the current SideNote2 sidebar remains unchanged.

## Terminology

- Root file: the starting markdown file for `Chain` mode.
- Side note: a persisted SideNote2 note attached to a file.
- Linked file: a markdown file referenced by a wiki link inside a side note body.
- Chain node: either a file node or a side note node in the rendered traversal.

## Mode Definitions

### All side notes

This is the current global indexed view.

- Show all indexed side notes across the vault.
- Keep current grouping, filtering, and interaction behavior.
- No traversal logic is applied.

### Chain

This is a file-scoped traversal view.

- Requires one root file.
- Shows the root file first.
- Shows all SideNote2 notes attached to the root file.
- Reads wiki links from those side note bodies.
- For each linked file that has SideNote2 notes, shows that file as the next step in the chain.
- Repeats recursively within configured limits.

Conceptually:

`Root file -> side note -> linked file -> side note -> linked file`

## Root Selection

`Chain` must be rooted to exactly one selected file.

### v1 root sources

Preferred v1 sources:

1. From `All side notes`, invoke `Open chain` on a file group or file header.
2. If `Chain` mode is selected with no current root, show an empty state that prompts the user to choose a file from `All side notes`.

### Future root sources

Possible later additions:

- Command palette action: `Open chain from current note`
- Context menu action on file entries
- Editor-triggered command such as `/chainofthought`

These are out of scope for v1.

## Traversal Rules

### Link source

Only explicit Obsidian wiki links inside side note bodies are followed in v1.

Included:

- `[[Note]]`
- `[[Note|Alias]]`

Excluded in v1:

- Plain text mentions
- External URLs
- Tags
- Links inferred from selected text

Markdown links to vault files may be added later, but they are not required for v1.

### Traversal targets

A linked file is eligible for expansion only if:

- it resolves to a markdown file in the vault
- it is not the generated `SideNote2 index` note
- it has at least one SideNote2 note after current filters are applied

### Depth and expansion

Recommended v1 defaults:

- maximum depth: `2`
- first level expanded
- deeper levels collapsed by default

Depth counts file-to-file hops, not raw row count.

### Cycle handling

Cycles must be detected and stopped.

Example:

`A -> note -> B -> note -> A`

When a cycle is encountered:

- render the repeated file node once as a stopped node
- do not recurse further

## Rendering Model

`Chain` should render as a nested outline, not as a graph.

### Structure

- File node
- Child side note nodes
- Child linked file nodes
- Repeat

### UI behavior

- Each file node is collapsible.
- Each side note card reuses the existing card UI as much as possible.
- Navigation from cards should continue to work.
- Internal note links inside rendered side note content should continue to work.
- Empty branches should not render placeholder containers unless needed for explanation.

### Empty state

If `Chain` has no root file:

- show an instructional empty state
- example: `Select a file to explore its side-note chain.`

If a root file has side notes but no eligible outgoing links:

- show the root file and its side notes only
- no error state

## Filtering Behavior

`Chain` should respect the same resolved-note visibility setting used by the existing sidebar view.

Recommended v1 behavior:

- if resolved notes are hidden, they are excluded both from display and from traversal
- if resolved notes are shown, they may appear and participate in traversal

Open question:

- whether orphaned notes should participate in traversal when their body contains wiki links

Recommended answer:

- yes, orphaned notes may still participate because chain traversal depends on note body links, not anchor validity

## Data Requirements

No new persisted note format is required for v1.

The feature can be derived from existing data:

- indexed comments grouped by file
- side note body text
- parsed wiki links from side note text

Implementation may need:

- a chain root file path in plugin or view state
- a mode state for the managed index sidebar
- a traversal result model for rendering

## Suggested Internal Model

### Sidebar mode

- `all-side-notes`
- `chain`

### Chain root state

- `rootFilePath: string | null`

### Chain node shapes

- `file` node
- `note` node
- optional `cycle` marker state

This should remain a view model, not a persisted vault structure.

## Interaction Summary

### All side notes mode

- behaves exactly as today

### Chain mode

- if no root is selected, show empty state
- if root exists, render nested chain from that file
- clicking a file node may navigate to that file
- clicking a side note card may navigate to the anchored location as usual
- collapse state should be local to the view session

## Performance Expectations

`Chain` must stay bounded.

Recommended safeguards:

- depth limit
- cycle detection
- lazy branch expansion where possible
- avoid recomputing the full vault traversal on every small interaction

The traversal should be built from already indexed SideNote2 data when possible.

## Rollout Plan

### Phase 1

- Add `All side notes | Chain` toggle in the managed index sidebar
- Keep `All side notes` unchanged
- Add root selection from the `All side notes` view
- Implement file-scoped chain traversal using wiki links only
- Add depth limit and cycle protection
- Reuse existing side note card UI

### Phase 2

- Add command palette entry to open chain from current note
- Optionally support markdown links to vault files
- Improve ranking or ordering of outgoing linked files

### Phase 3

- Additional traversal controls
- User-configurable depth
- Better branch summaries or breadcrumbs

## Open Questions

1. How should the user choose the root file from `All side notes`:
   file header click, context menu action, or dedicated button?
2. Should `Chain` mode remember the last root file between sessions?
3. Should page notes and anchored notes be rendered differently inside `Chain`, or should they share the same card presentation?
4. Should multiple side notes linking to the same target file create duplicate file nodes, or should they merge into one file node with multiple inbound note references?

## Recommendation

For v1:

- show the toggle only in the managed `SideNote2 index` sidebar
- keep `All side notes` exactly as-is
- make `Chain` root to one selected file
- follow wiki links only
- cap depth at `2`
- stop cycles
- prefer merged target file nodes over noisy duplication if multiple notes point to the same file
