# File Sidebar Thought Trail Spec

## Status

Draft implementation spec for adding `List | Thought Trail` tabs to normal file sidebars.

Related docs:

- [file-sidebar-modes-and-bookmarks-plan.md](file-sidebar-modes-and-bookmarks-plan.md)
- [bookmark-and-sidebar-filters-spec.md](bookmark-and-sidebar-filters-spec.md)

## Objective

Add the same top-level `List` and `Thought Trail` tabs to individual file sidebars that the index sidebar already uses, while reusing the existing Thought Trail graph logic instead of building a second feature path.

This spec is specifically about:

- normal file sidebars
- shared tab UI between index and file views
- reusing the existing Thought Trail graph builder and Mermaid renderer
- implicit current-file scoping for note-sidebars
- keeping list mode fast and lightweight unless the user explicitly switches to `Thought Trail`

## Decision Summary

### Decision 1: Normal File Sidebars Get `List | Thought Trail`

Normal file sidebars should render the same two tabs as the index sidebar:

- `List`
- `Thought Trail`

`List` remains the default mode for normal files.

### Decision 2: File-Level Thought Trail Uses The Current File As The Root

The normal file sidebar `Thought Trail` tab should not mean "show only links directly mentioned in this file."

It should mean:

- treat the current file as the implicit root
- compute the graph from the current file's rooted scope only
- render only the current file and files actually connected to that current file

It must not:

- expose a file filter UI in the note sidebar
- render disconnected files from elsewhere in the vault
- behave like a mini index view

This keeps the concept aligned with the index version instead of creating a weaker note-only variant.

### Decision 3: Reuse Existing Thought Trail Logic

The implementation should reuse:

- `buildIndexFileFilterGraph(...)` in [src/core/derived/indexFileFilterGraph.ts](../../src/core/derived/indexFileFilterGraph.ts)
- `deriveIndexSidebarScopedFilePaths(...)` in [src/ui/views/indexFileFilter.ts](../../src/ui/views/indexFileFilter.ts)
- `buildThoughtTrailLines(...)` in [src/core/derived/thoughtTrail.ts](../../src/core/derived/thoughtTrail.ts)
- `renderThoughtTrailMermaid(...)` and `bindThoughtTrailNodeLinks(...)` in [src/ui/views/AsideView.ts](../../src/ui/views/AsideView.ts)

The goal is shared behavior, not a second graph implementation.

### Decision 4: Normal List Mode Must Stay Cheap

Do not make ordinary file sidebars pay the aggregate-graph cost by default.

Rule:

- `List` mode keeps the current file-local loading path
- `Thought Trail` mode may lazily ensure indexed comments are loaded and build the rooted graph

This preserves current list responsiveness.

## In Scope

- add `List | Thought Trail` tabs to normal file sidebars
- add note-level mode state to the sidebar view
- reuse shared tab rendering between index and note sidebars
- reuse existing rooted Thought Trail graph logic for note sidebars
- define toolbar behavior while note `Thought Trail` is active
- define draft-save behavior when switching note modes
- define empty states for note `Thought Trail`
- tests for note mode state, shared tab behavior, and rooted graph scoping

## Out Of Scope

- adding an `Agent` tab back anywhere
- changing bookmark storage or bookmark creation flows
- redesigning Thought Trail graph visuals
- adding a separate note-only Thought Trail algorithm
- changing the underlying Mermaid graph format
- per-file persisted mode preferences in plugin data

## Product Rules

### Rule 1: Index And Note Surfaces Share UI, Not State

The tab control should be shared, but index mode and note mode must remain separate state values.

Do not reuse `indexSidebarMode` directly for normal file sidebars.

Recommended state model:

- `indexSidebarMode: "list" | "thought-trail"`
- `noteSidebarMode: "list" | "thought-trail"`

Reason:

- the index and a normal note are different surfaces
- a user may want index to stay in `Thought Trail` while normal notes still default to `List`
- this keeps behavior predictable

### Rule 2: Normal File Sidebar Defaults To `List`

For normal files:

- initial mode is `List`
- restored mode may come from view state for that leaf
- if no valid persisted note mode exists, fall back to `List`

### Rule 3: File Thought Trail Is Rooted On The Current File

For a normal file `X.md`, the file sidebar `Thought Trail` must:

1. build the same file graph used by the index rooted-file filter
2. treat `X.md` as the root file
3. derive the connected component for `X.md`
4. scope visible threads to that connected file set
5. build Thought Trail lines from those scoped threads

This produces a graph around the current note instead of a flat one-hop preview.

Clarification:

- note sidebars do not get a manual file filter control
- the current open file is the only root selector
- files outside that rooted component must not render

### Rule 4: List-Only Toolbar Controls Stay List-Only

When a normal file sidebar is in `Thought Trail` mode, the list-oriented controls should not render.

Hide in note `Thought Trail` mode:

- bookmark filter
- agent filter
- resolved toggle
- nested-comments toggle

Reason:

- this matches the current index behavior, where list-only chips disappear in `Thought Trail`
- it avoids implying that the graph has separate independent filter axes in the first implementation
- it minimizes UI branching while reusing the current rendering pattern

### Rule 5: Add Page Note Action Stays Available

The normal-file add action should remain visible in both note modes.

Reason:

- it is a file-local creation action, not a list-only filter
- hiding it in `Thought Trail` would make the note sidebar feel mode-trapped

### Rule 6: Mode Switching Must Respect Draft Safety

Switching between `List` and `Thought Trail` in a normal file sidebar must go through the same visible-draft save guard used by toolbar icon buttons.

Rules:

- if a visible draft can be auto-saved, switch modes
- if draft save fails validation, remain in the current mode
- do not silently discard the draft

This is more important for note sidebars than the index because note sidebars commonly contain active drafts.

### Rule 7: List Filters Are Preserved, Not Reset

When leaving note `List` mode for note `Thought Trail`:

- preserve `noteSidebarContentFilter`
- preserve current resolved-mode state

While in `Thought Trail`, those controls are hidden, not cleared.

When switching back to `List`, the prior list filters should still apply.

### Rule 8: No Note-Level File Filter UI

Normal file sidebars must not render:

- the index file filter button
- active file-filter pills
- any note-level file picker for Thought Trail

Reason:

- normal note sidebars are already implicitly scoped by the active file
- adding another file filter would blur the line between note view and index view
- the user expectation here is "show this file," not "let me choose a different root from inside this note sidebar"

## State Model

### Shared Mode Type

Introduce a shared type for both surfaces:

```ts
type SidebarPrimaryMode = "list" | "thought-trail";
```

This replaces the need for an index-only mode type name.

Recommended shape:

- keep separate fields for note and index mode
- share the mode type and shared parsing/render helpers

### View State

Extend `CustomViewState` with:

```ts
interface CustomViewState {
  filePath?: string | null;
  indexSidebarMode?: SidebarPrimaryMode;
  noteSidebarMode?: SidebarPrimaryMode;
  indexFileFilterRootPath?: string | null;
}
```

Normalization rules:

- invalid `noteSidebarMode` falls back to `list`
- `noteSidebarMode` is ignored for the index note
- `indexSidebarMode` is ignored for normal notes

## Reuse And Refactor Plan

### Shared Tab Control

Refactor `renderIndexModeControl(...)` in [src/ui/views/AsideView.ts](../../src/ui/views/AsideView.ts) into a shared helper that can render:

- index mode tabs
- note mode tabs

Recommended shape:

```ts
renderSidebarModeControl(container, {
  mode,
  ariaLabel,
  onChange,
});
```

The button labels remain:

- `List`
- `Thought Trail`

### Shared Thought Trail Scope Helper

Do not duplicate the rooted graph derivation inside the note render path.

Extract a helper that can:

- build the file graph from indexed threads
- derive the rooted connected file scope
- return the scoped visible threads for Thought Trail rendering for one explicit root file

Possible placement:

- `src/ui/views/sidebarThoughtTrailScope.ts`
- or a more generic helper adjacent to `indexFileFilter.ts`

The important part is shared logic, not the exact file name.

### Existing Renderer Reuse

Keep reusing the existing Mermaid render and node-link binding methods.

No second renderer is needed.

## Rendering Rules

### Normal File Toolbar Layout

In normal file sidebars:

1. top row: `List | Thought Trail` tabs
2. second row in `List` mode:
   - left: bookmark filter
   - right: agent, resolved, nested, add/delete actions as currently appropriate
3. second row in `Thought Trail` mode:
   - only file-safe actions such as add page note and existing note-level action buttons that are still valid

The visual language should match the existing Obsidian-style tab control already used in the index.

Do not render:

- any active file-filter row
- any selected-file pill set

### Empty State: No Graph For Current File

If the current file has no rooted Thought Trail graph:

- primary text: `No thought trail for this file yet.`
- secondary text: `Add wiki links in side notes for this file or switch back to the list.`

### Empty State: Current File Is Not In The Indexed Graph

If the current file has no indexed thread presence in the graph scope:

- primary text: `No thought trail is available for this file yet.`
- secondary text: `Add side notes in this note to create a rooted trail.`

Implementation note:

- this may collapse into the same empty state as above if the code path is simpler

## Data Flow

### Note List Mode

Keep the current behavior:

- load comments for the current file only
- render file-local threads
- do not require aggregate index data

### Note Thought Trail Mode

When `noteSidebarMode === "thought-trail"`:

1. ensure indexed comments are loaded
2. build the same graph used by the index rooted filter
3. derive scoped file paths for the current file
4. scope visible threads to that connected component
5. call the existing Thought Trail line builder with those scoped threads
6. render Mermaid using the existing renderer

This should happen only on demand.

Important:

- the current file path is always the implicit root
- there is no second file-selection step inside the note sidebar

## Interaction Rules

### Switching Modes

When the user clicks a note sidebar tab:

- save visible draft if possible
- if save succeeds or no draft exists, switch mode
- rerender the sidebar

### Clicking Thought Trail Nodes

Node click behavior stays the same as index Thought Trail:

- open the target file in the preferred file leaf when possible
- focus that leaf

No note-specific navigation fork is required for the first implementation.

### Active Comment State

Do not add special active-comment behavior for Thought Trail in this phase.

Reason:

- the graph is file navigation, not comment-card interaction
- carrying comment-card active state into graph mode adds complexity without clear value

## Performance Rules

### Rule 1: Lazy Aggregate Work

Do not call `ensureIndexedCommentsLoaded()` for normal file sidebars unless note `Thought Trail` is active.

### Rule 2: Reuse Existing Graph Build

Reuse `buildIndexFileFilterGraph(...)` rather than adding a second graph cache or alternate graph builder first.

If a later optimization is needed, optimize the shared builder path instead of splitting logic.

### Rule 3: No Background Precomputation Requirement

This feature does not require always-on graph precomputation for note sidebars.

The first implementation can compute on mode entry.

## Test Plan

Add or update tests for:

- `noteSidebarMode` view-state parsing and serialization
- shared sidebar mode control behavior for note and index surfaces
- note thought trail scoping uses the current file as the rooted graph source
- note sidebars never render index file-filter controls or active file-filter pills
- note list mode does not require indexed comments
- note thought trail mode does require indexed comments
- list-only note toolbar chips hide in note `Thought Trail`
- note mode switch respects visible-draft save blocking
- note `Thought Trail` empty states

## Non-Goals For This Slice

- keeping bookmark, agent, or resolved filters visible inside note `Thought Trail`
- adding graph-specific filters or controls beyond the existing node navigation behavior
- changing the meaning of index `Thought Trail`
- redesigning the graph into a larger canvas or split-pane explorer

## Implementation Order

Recommended order:

1. add note mode state and view-state normalization
2. extract shared tab control rendering
3. extract rooted Thought Trail scope helper
4. wire note render path to switch between list and Thought Trail
5. hide list-only note toolbar controls in Thought Trail
6. add tests for note mode state, graph scope, and draft-safe mode switching

## Acceptance Criteria

This spec is complete when:

- normal file sidebars show `List | Thought Trail`
- `List` remains the default note mode
- `Thought Trail` for a normal file uses the current file as the rooted connected-graph source
- the graph uses the existing Thought Trail builder and Mermaid renderer
- note `List` mode stays on the current lightweight file-local path
- list-only note filters are hidden in note `Thought Trail`
- switching note modes does not silently drop an open draft
