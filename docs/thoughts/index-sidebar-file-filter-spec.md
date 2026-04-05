# Index Sidebar File Filter Spec

## Status

Draft implementation spec based on:

- [index-sidebar-file-filter-plan.md](./index-sidebar-file-filter-plan.md)

## Problem Statement

The current `Files` filter in the index sidebar is modeled as a user-managed array of file paths.
That does not match the desired behavior.

Desired behavior:

1. The user selects one root file only.
2. The system automatically includes all wiki-linked files connected to that root.
3. The connected set must include:
   - outgoing wiki links
   - incoming wiki links
   - full transitive closure
4. The same filtered set must drive both:
   - index sidebar `List`
   - index sidebar `Thought Trail`
5. The modal must feel fast:
   - open instantly
   - show current selected result set
   - allow searching for a new root
   - selecting a new root should apply immediately and close
   - clearing the active root should return to the default unfiltered state

## Scope

In scope:

- index sidebar file filter model
- index file filter modal behavior
- list-mode membership
- thought-trail membership
- persisted view state for the index sidebar
- active filter summary in the sidebar
- graph-derived cache for connected files

Out of scope:

- reverse navigation from sidebar cards back into `index.md`
- source-note redirect behavior
- thought-trail visual design changes unrelated to membership
- non-index file sidebars

## Product Rules

### Rule 1: Single Root Only

The user may choose at most one root file.
There is no multi-select toggle behavior.

### Rule 2: Auto Expansion

Once a root is selected, the system derives the full connected component for that root over the wiki-link graph.

### Rule 3: Shared Membership

The derived connected component must be the only membership source for:

- index sidebar list comments
- index sidebar thought trail comments

### Rule 4: Replace, Don’t Toggle

Reopening the modal is a root replacement flow, not a toggle-more-files flow.

### Rule 5: Persist Root, Not Expansion

Only the selected root is persisted.
The expanded linked set is always derived.

## Data Model

### Current Model

- `filteredIndexFilePaths: string[]`
- `indexFileFilterPaths?: string[]`

### New Model

- `selectedIndexFileFilterRootPath: string | null`
- `expandedIndexFileFilterPaths: string[]`

`selectedIndexFileFilterRootPath` is persistent state.
`expandedIndexFileFilterPaths` is derived state only.

### Required View State

Recommended `CustomViewState` shape:

```ts
export interface CustomViewState extends Record<string, unknown> {
    filePath: string | null;
    indexSidebarMode?: IndexSidebarMode;
    indexFileFilterRootPath?: string | null;
}
```

### Compatibility Migration

If old `indexFileFilterPaths` exists:

1. If `indexFileFilterRootPath` exists, use it.
2. Else if `indexFileFilterPaths` is non-empty, pick the first entry as the compatibility root.
3. Recompute the derived closure from the graph cache.

This is a lossy migration from the old multi-select model, but deterministic and safe.

## Graph Model

### Input Universe

The graph is built from currently visible index comments.

Recommended visibility basis:

- if resolved-only mode is off:
  use unresolved comments only
- if resolved-only mode is on:
  use resolved comments only

This keeps list mode, thought trail, and file graph aligned.

### Edge Definition

For each comment:

- source node = `comment.filePath`
- target nodes = resolved wiki-link destinations found in `comment.comment`

### Membership Semantics

The filter uses undirected connected components.

Meaning:

- if `A -> B`, then `A` and `B` are connected
- if `B -> C`, then selecting `A` includes `C`
- if `D -> A`, then selecting `A` includes `D`

### Cache Outputs

Add a derived cache module, recommended file:

- `src/core/derived/indexFileFilterGraph.ts`

Recommended outputs:

- `availableFiles: string[]`
- `fileCommentCounts: Map<string, number>`
- `outgoingAdjacency: Map<string, Set<string>>`
- `undirectedAdjacency: Map<string, Set<string>>`
- `connectedComponentByFile: Map<string, string[]>`

Optional:

- `componentSizeByFile: Map<string, number>`

## Modal Spec

### Open Behavior

When the modal opens:

1. do not compute the graph in the modal
2. read from the prebuilt graph cache
3. show:
   - current root, if any
   - derived linked file set summary
   - search input focused
4. do not show the entire file list by default when the query is empty

### Search Behavior

Typing filters root candidates from `availableFiles`.

Suggestion ordering should continue to prioritize:

- selected root first, if it matches
- exact file-name match
- prefix match
- contains match
- higher comment counts

### Selection Behavior

Selecting a suggestion:

1. replaces the current root
2. applies immediately
3. closes the modal

There is no multi-toggle state and no explicit Apply button required.

### Reopen Behavior

When reopening:

- show the current root and linked set summary
- allow searching for a replacement root
- keep clearing on the active root chip in the sidebar, not in the modal

## Sidebar UI Spec

### Toolbar Chip

The existing `Files` chip remains the entry point.

Recommended chip behavior:

- inactive when no root
- active when root exists
- count displays derived linked set size

### Active Filter Summary

The summary should represent:

- selected root
- total linked files included

Recommended form:

- root label
- compact linked-count note

Do not represent derived linked files as independently removable chips.
They are not user-selected state.

## Rendering Spec

### List Mode

The rendered comment universe must be:

1. all index comments in current resolved mode
2. filtered to `expandedIndexFileFilterPaths`
3. sorted with existing comment ordering rules
4. then subject to the 100-card safety limit

### Thought Trail Mode

The thought trail input comment universe must be:

1. all index comments in current resolved mode
2. filtered to `expandedIndexFileFilterPaths`

The membership set must match list mode exactly.

### Important Constraint

Do not allow list mode and thought trail mode to compute different file universes from the same root.

## State Machine

### State Variables

- `Mode ∈ {list, thought-trail}`
- `Root ∈ AvailableFiles ∪ {null}`
- `Closure = ConnectedComponent(Root) or {}`
- `ModalOpen ∈ {true, false}`

### Invariants

- at most one root
- closure derived only from cache
- closure recalculated atomically after root changes
- list membership equals thought-trail membership

### Operations

#### `OpenModal`

Effects:

- `ModalOpen := true`
- query reset
- current root summary shown

#### `SelectRoot(filePath)`

Effects:

- `Root := filePath`
- `Closure := cache.connectedComponentByFile[filePath]`
- persist root
- rerender current mode
- `ModalOpen := false`

#### `ClearRoot`

Effects:

- `Root := null`
- `Closure := {}`
- persist cleared root
- rerender current mode
- `ModalOpen := false`

#### `RefreshVisibleUniverse`

Triggered by:

- resolved toggle changes
- index comments change
- note rename/delete affects graph

Effects:

- rebuild cache
- if root invalid, clear it
- else recompute closure from cache

## Performance Spec

### Performance Goal

The modal open path must feel instantaneous.

### Precompute Before Modal Open

Build and cache:

1. file option list
2. graph adjacency
3. connected component lookup
4. file counts

### Forbidden Work On Modal Open

Do not:

- rebuild the graph from raw comments
- traverse the graph from scratch
- rebuild thought trail
- rerender the whole sidebar

### Selection Path Budget

Selecting a root should do:

1. cache lookup for closure
2. root persistence
3. one rerender of the active mode

### Best Cache Placement

Recommended:

- plugin-level derived cache keyed by:
  - current index-comment signature
  - current resolved-mode state

This allows:

- modal reuse
- list reuse
- thought-trail reuse

## Acceptance Criteria

### AC1: Single Root

Given the modal is open,
when the user selects a file,
then only one root exists in state.

### AC2: Full Connected Closure

Given `A -> B`, `C -> A`, and `B -> D`,
when the user selects `A`,
then the filter includes `A`, `B`, `C`, and `D`.

### AC3: Immediate Apply

Given the modal is open,
when the user selects a root,
then the modal closes and the sidebar rerenders without an extra apply action.

### AC4: Shared Membership

Given a selected root,
when the user switches between `List` and `Thought Trail`,
then both modes operate on the same file universe.

### AC5: Reopen Shows Current Selection

Given a root is selected,
when the user reopens the modal,
then the modal shows the current root and linked set summary before searching.

### AC6: Fast Open

Given the index graph cache is already valid,
when the user opens the modal,
then the modal appears without graph traversal on the open path.

### AC7: Root Invalidates Cleanly

Given a selected root file is removed from the available file universe,
when comments or files change,
then the root is cleared without leaving stale derived file paths behind.

## Test Plan

Required tests:

1. graph cache builds the full undirected connected component
2. incoming-only links are included
3. root replacement is atomic
4. old array-based view state migrates deterministically
5. list mode and thought trail mode consume the same closure
6. modal suggestions do not require a full default list
7. resolved-only mode rebuilds cache and closure correctly

## Implementation Order

This is the most important section for safe rollout.

### Priority 1: Pure Derived Graph Cache

Implement first:

- `indexFileFilterGraph.ts`
- pure tests for:
  - graph building
  - connected component lookup
  - resolved visibility handling

Why first:

- no UI risk
- easiest to validate
- creates the foundation for every later step

### Priority 2: Persist Root State + Migration

Implement next:

- `indexFileFilterRootPath` in view state
- migration from old `indexFileFilterPaths`
- derived closure read path in `SideNote2View`

Why second:

- state model becomes correct before UI behavior changes
- avoids building new UX on top of the wrong persistence model

### Priority 3: Modal Rewrite To Single-Root Replace Flow

Implement next:

- modal opens instantly
- shows current root summary
- selecting a file replaces root and closes

Why third:

- by now the underlying cache and state model are already correct
- the modal becomes a thin UI layer over stable logic

### Priority 4: Apply Shared Closure To Both Modes

Implement next:

- list consumes closure
- thought trail consumes the same closure

Why fourth:

- this is where visible behavior changes land
- safest once the model is already proven

### Priority 5: Sidebar Summary Cleanup

Implement last:

- remove misleading removable per-file chips
- replace with root-centric summary

Why last:

- cosmetic/product cleanup
- lowest correctness risk

## Safest First Recommendation

If only one work item is started first, start here:

- Priority 1: pure graph cache + tests

If only one UI-facing work item is started after that, do:

- Priority 2: root-state migration

This is the safest sequence because it front-loads correctness, not UI complexity.

## Ship Rule

Do not ship an intermediate state where:

- list mode uses root closure
- but thought trail still uses a different file universe

The graph cache and root-state migration may land first safely.
But the user-visible filter behavior should only be considered complete when both modes share the same closure.
