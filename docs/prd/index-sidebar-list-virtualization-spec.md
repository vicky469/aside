# Index Sidebar List Scope Spec

## Status

Rewritten after simplifying the first scoped-list implementation.

Main conclusion:

- do not raise the default limit from `100`
- do not build virtualization first
- do not keep separate scope behavior for `Files` vs index-ref clicks
- use one root-file scope model everywhere

## Problem

Current default index list behavior is still a sample:

1. `List` mode shows only the first `100` cards
2. clicking a ref in `Aside index.md` may target a comment outside that first `100`
3. if the sidebar stays in sample mode, the correct card may not be visible

That feels broken.

## Simpler Product Direction

Keep two states only:

1. no root file selected
   - show the default first `100` cards

2. root file selected
   - show the full connected component for that file

This applies no matter how the root file was selected:

- manual `Files` filter
- clicking a ref inside `Aside index.md`

## Why This Is Simpler

The code already has the right reusable behavior:

- one persisted root path:
  - `indexFileFilterRootPath`
- one connected-component expansion:
  - `getIndexFileFilterConnectedComponent(...)`
- one reusable file scoping helper:
  - `filterCommentsByFilePaths(...)`

So there is no reason to maintain a second variable that says where the root came from.

The root file is enough.

## Desired Behavior

### Rule 1: default list stays capped

When no root file is selected:

- index `List` mode shows the first `100` comments

### Rule 2: any selected root disables the cap

When a root file is selected:

- expand to the full connected component for that root
- do not apply the `100` item cap

### Rule 3: Files filter and index-ref clicks behave the same

When the user chooses a file in the modal:

- set that file as the root
- show the full connected component

When the user clicks a ref in `Aside index.md`:

- set that ref’s source file as the root
- show the full connected component

### Rule 4: clearing returns to default sample mode

When the root is cleared:

- go back to the first `100` comments

## State Model

Use only:

```ts
indexFileFilterRootPath: string | null
```

Meaning:

- `null` => default sampled list
- `some-file.md` => connected-component scoped list

No extra source variable is needed.

## Rendering Rules

### No root selected

```ts
filteredIndexFilePaths = []
applyListLimit = true
```

### Root selected

```ts
filteredIndexFilePaths = getIndexFileFilterConnectedComponent(graph, rootFilePath)
applyListLimit = false
```

## Implementation Notes

### AsideView

- keep `selectedIndexFileFilterRootPath`
- derive filtered file paths from the graph and root path only
- apply list cap only when root path is `null`

### Files modal

- selecting a file sets `indexFileFilterRootPath`
- selected chip summary continues to show linked file count

### Index ref click

- ref click already knows the source file path
- pass that source file path into the sidebar sync path
- set `indexFileFilterRootPath` to that file before highlighting the card

## Acceptance Criteria

1. With no root selected, index `List` shows `100` cards.
2. Clicking an index ref outside the default `100` still makes the right card visible in the sidebar.
3. After that click, the sidebar shows the clicked file plus its connected files.
4. Manual `Files` filtering behaves the same as before.
5. Clearing the filter returns to the default sampled list.

## Non-Goals

- virtualization
- infinite scrolling
- source-specific scope expansion rules

Those can be reconsidered later only if the default sampled list still feels insufficient.
