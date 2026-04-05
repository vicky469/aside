# Index Sidebar File Filter Plan

## Goal

Redesign the `Files` filter in the index sidebar so it behaves like a single-root graph filter instead of a manual multi-select list.

Required behavior:

1. Selecting one file auto-selects all wiki-linked files connected to it.
   This includes outgoing links, incoming links, and the full transitive closure.
2. Only one user-selected root file is allowed.
   Selecting it applies immediately and closes the modal.
3. The same filter applies to both index sidebar modes:
   `List` and `Thought Trail`.
4. Reopening the modal shows the current selected result set and allows searching for a replacement root.
   Clearing returns to the default unfiltered state from the active root chip in the sidebar.
5. State transitions must be clean and deterministic.
   Performance should feel instant at modal-open and near-instant at selection time.

## Current System

Current index sidebar state is file-path-set based:

- `SideNote2View` stores `filteredIndexFilePaths: string[]`
- `CustomViewState` persists `indexFileFilterPaths?: string[]`
- `SideNoteFileFilterModal` is a multi-select toggle modal
- `List` and `Thought Trail` both consume the same filtered file path array

Current mismatches against the new requirement:

- The modal is multi-select, but the new model is single-root select.
- The saved state is the expanded set, not the root cause of the expansion.
- Auto-including linked files is not modeled anywhere.
- The active filter UI assumes many independently removable files.
- `buildThoughtTrailLines()` has a depth concept for rendering, but the new filter semantics require full graph closure for membership.

## Recommended Model

The filter must be modeled as:

- `selectedRootFilePath: string | null`
- `expandedLinkedFilePaths: string[]`

Only `selectedRootFilePath` is source-of-truth state.
`expandedLinkedFilePaths` is always derived from cached graph data.

This is the cleanest way to preserve:

- single-root selection
- auto-expansion
- stable modal reopen behavior
- easy replacement of the current root
- no partial or conflicting user state

## B-Method Style Machine

### Abstract Variables

- `AvailableFiles`
  Files with side notes in the index universe.
- `VisibleComments`
  Comments currently in scope for the index universe.
  Recommended: this respects the current resolved/unresolved mode.
- `LinkGraph`
  File-to-file wiki-link graph derived from `VisibleComments`.
- `Root`
  `null` or one file in `AvailableFiles`.
- `Closure`
  Derived connected file set for `Root`.
- `Mode`
  `list | thought-trail`
- `ModalOpen`
  Boolean
- `ModalQuery`
  Current search text

### Invariants

- `Root = null OR Root ∈ AvailableFiles`
- `|Root| <= 1`
- `Root = null => Closure = {}`
- `Root != null => Closure = ConnectedComponent(LinkGraph, Root)`
- `Closure ⊆ AvailableFiles`
- `Mode ∈ {list, thought-trail}`
- `ListViewFiles = Closure`
- `ThoughtTrailFiles = Closure`
- The modal never commits a partial closure.
  It commits only `Root`, then `Closure` is recomputed atomically.

### Operations

#### `RefreshGraphCache`

Input:

- latest visible index comments

Post-condition:

- rebuild `AvailableFiles`
- rebuild `LinkGraph`
- rebuild `ConnectedComponentByFile`

#### `OpenFilterModal`

Pre-condition:

- cache is available

Post-condition:

- `ModalOpen = true`
- `ModalQuery = ""`
- modal shows:
  - current root, if any
  - derived closure summary
  - search box focused

#### `ChooseRoot(filePath)`

Pre-condition:

- `filePath ∈ AvailableFiles`

Post-condition:

- `Root := filePath`
- `Closure := ConnectedComponentByFile[filePath]`
- persist root state
- rerender active surface
- close modal

#### `ClearRoot`

Post-condition:

- `Root := null`
- `Closure := {}`
- close modal

#### `SwitchMode(nextMode)`

Post-condition:

- `Mode := nextMode`
- `Root` unchanged
- `Closure` unchanged
- both modes see the same filtered file universe

#### `VisibleCommentsChanged`

Post-condition:

- refresh graph cache
- if old `Root` is no longer in `AvailableFiles`, clear it
- otherwise recompute `Closure` from the new cache

## Subway Lines Method

Think of the feature as five lines crossing the same station set.

### Blue Line: Data

Stations:

1. indexed comments loaded
2. comments grouped by file
3. wiki links extracted
4. undirected file graph built
5. connected components cached

Rule:

- this line runs before user interaction, not inside the modal click path

### Green Line: State

Stations:

1. no root selected
2. root selected
3. closure derived
4. persisted view state updated
5. view rerendered

Rule:

- only `Root` is persisted
- closure is never user-mutated directly

### Yellow Line: Modal UX

Stations:

1. modal opens instantly
2. current root summary shown
3. current expanded file set shown
4. user types to search
5. user chooses replacement root
6. modal closes immediately

Rule:

- modal is replace-only, not multi-toggle

### Red Line: Rendering

Stations:

1. `List` consumes closure-filtered comments
2. `Thought Trail` consumes the same closure-filtered comments
3. active filter summary reflects root + linked set

Rule:

- list and thought trail must never diverge on membership

### Gray Line: Invalidation

Stations:

1. resolved filter changes
2. comments added/edited/deleted
3. note rename/path change
4. root becomes invalid

Rule:

- all these events refresh cache first, then reconcile `Root`

## Graph Semantics

The required semantics are not directional traversal at selection time.
They are connected-component membership over the wiki-link graph.

Recommended graph model:

- build directed edges from comment wiki links:
  `source file -> target file`
- derive an undirected adjacency view for the filter:
  `A connected to B if A links to B or B links to A`

Then:

- `expandedLinkedFilePaths = full undirected connected component of Root`

This directly satisfies:

- outgoing
- incoming
- all the way

## Performance Strategy

### What to compute before the modal opens

Precompute once per visible comment universe:

1. `IndexFileFilterOptionsByFile`
   file -> count
2. `OutgoingAdjacency`
3. `UndirectedAdjacency`
4. `ConnectedComponentByFile`
   file -> sorted `string[]`
5. `ComponentSizeByFile`
6. optional search helpers:
   normalized basename and path strings

### Why this is fast

With the above cache:

- modal open is O(1)
- suggestion lookup is O(number of files), acceptable and already how current search works
- choosing a root is O(1) for closure lookup, plus render cost
- no BFS/DFS is needed during modal open
- no graph recomputation is needed on every keystroke

### What should not happen on modal open

Do not:

- traverse the graph
- compute linked files synchronously from raw comments
- rebuild thought trail data
- rebuild all sidebar cards just to show the modal

### Best cache location

Recommended:

- plugin-level derived cache keyed by:
  - current index comment signature
  - current resolved/unresolved visibility mode

Reason:

- both `List` and `Thought Trail` need the same graph universe
- the modal should reuse the same cache
- recomputing inside `SideNote2View` makes repeated opens more expensive

## UI Plan

### Toolbar

Keep the `Files` chip in the index toolbar.

Behavior:

- inactive when `Root = null`
- active when `Root != null`
- count should reflect expanded closure size, not arbitrary selected path count

### Modal

On open, with empty query:

- show current root if present
- show auto-included linked files under the search box
- do not dump a full list by default

On query:

- show matching root candidates
- selecting one candidate immediately replaces the old root
- apply and close

### Active Filter Summary In Sidebar

Current per-file removable chips do not fit the new model.

Recommended summary:

- root chip
- compact secondary text such as:
  `+ 12 linked files`

Optional expanded chips are acceptable only if they are passive.
They should not imply independent removal, because linked files are derived, not directly selected.

## View-State Migration

Current view state:

- `indexFileFilterPaths?: string[]`

Recommended new view state:

- `indexFileFilterRootPath?: string | null`

Migration rule:

- if `indexFileFilterRootPath` exists, use it
- otherwise, if old `indexFileFilterPaths` exists and is non-empty:
  - pick the first path as a compatibility root
  - recompute closure from cache

This is not perfect for old multi-select sessions, but it gives a deterministic downgrade path.

## Thought Trail Specific Note

Current thought trail rendering uses `buildThoughtTrailLines()` with a depth-oriented branch renderer.

This is separate from file-filter membership.

Required rule:

- filter membership uses full connected component
- thought trail rendering consumes the filtered comment universe

Open decision:

1. keep current render depth for visual compactness
2. remove depth cap when a root filter is active

Recommendation:

- if a root filter is active, do not depth-truncate the filtered component silently
- otherwise the user sees “selected files” in list mode but not the same universe in thought trail

## Clean State Transitions

### Happy Path

1. index sidebar already has graph cache
2. user clicks `Files`
3. modal opens instantly
4. user searches root candidate
5. user selects candidate
6. `Root` updates
7. `Closure` looked up from cache
8. modal closes
9. current mode rerenders from `Closure`

### Replace Root

1. existing `Root = A`
2. modal opens and shows `A + linked files`
3. user searches `B`
4. user selects `B`
5. state changes directly from `A` to `B`
6. no intermediate empty state
7. modal closes

### Comments Change

1. comments mutate
2. graph cache refreshes
3. if `Root` still exists:
   - recompute `Closure`
4. else:
   - clear `Root`

### Resolved Mode Toggle

Recommended:

1. resolved mode changes
2. rebuild visible comment universe
3. rebuild file graph cache
4. reconcile root
5. rerender both surfaces

This keeps list and thought trail aligned.

## Implementation Slices

### Slice 1: Derived graph cache

Add a derived helper, for example:

- `src/core/derived/indexFileFilterGraph.ts`

Outputs:

- available files
- file counts
- connected component by file

### Slice 2: View-state model

Replace array-state ownership with:

- `selectedIndexFileFilterRootPath`

Keep expanded paths derived only.

### Slice 3: Modal rewrite

Convert modal behavior from toggle-multi-select to select-one-and-close.

### Slice 4: Sidebar summary

Replace per-file removable chips with root-centric summary UI.

### Slice 5: Shared application path

Both `List` and `Thought Trail` consume the same derived closure.

### Slice 6: Tests

Required tests:

- selecting root returns full connected component including incoming-only links
- selecting one root replaces previous root atomically
- modal opens with current root summary and no default full list
- thought trail and list use the same membership set
- compatibility migration from old `indexFileFilterPaths`
- resolved toggle invalidates and rebuilds the graph cache correctly

## Recommendation

Do not extend the current multi-select path.
Replace it with a root-and-closure machine.

That gives:

- clearer state
- simpler modal UX
- better persistence semantics
- faster modal open
- no ambiguous chip removal logic
- one shared filter model for both list and thought trail

## Short Version

The fast and clean solution is:

- precompute the file graph once
- save one root file only
- derive linked files from cache
- open modal instantly
- choose root and close immediately
- use the same derived closure for both list and thought trail
