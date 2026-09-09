# Index Todo and Agent Search Parity

## Summary

Give the Index Todo and Agent tabs the same side-note search experience as the individual-file sidebar and Index List. Todo search is vault-wide when no file is selected. List and Agent remain unavailable until a file is selected, and their search is file-scoped. The Index Tags tab keeps its separate fuzzy tag-search experience.

This design supersedes the List-only search policy in `2026-08-09-index-sidebar-list-search-design.md` while preserving the mode scopes established by `2026-08-11-index-mode-scope-gate-design.md`.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] The note sidebar and Index List use the shared secondary-toolbar search renderer.
- [x] Index card search already shares debouncing, ranked matching, keyed reconciliation, highlighting, and stale-request cancellation.
- [x] Index Todo is vault-wide without a selected file; Index List and Agent require a selected file.
- [x] Index Tags owns independent fuzzy-search state and rendering.

### To Implement

- [x] Make one policy owner identify Index List, Todo, and Agent as generic side-note-search modes.
- [x] Make the shared toolbar plan consume that policy instead of maintaining a second mode list.
- [x] Preserve the generic search query when switching among List, Todo, and Agent, and clear it when entering Tags or Thought Trail.
- [x] Reuse the existing Index search options, debounce, ranking, reconciliation, highlighting, and focus-restoration paths for Todo and Agent.
- [x] Use vault-wide search copy for unscoped Todo and selected-file copy for file-scoped List, Todo, and Agent.
- [x] Bound unscoped Todo search to the existing 100-result global window and retain the existing refinement notice.
- [x] Keep unscoped Agent gated behind file selection with no inactive toolbar row.

### Verification

- [x] Pure state tests cover searchable modes, query preservation, and query clearing.
- [x] Toolbar tests cover global Todo search, selected-file Agent search, and unscoped Agent gating.
- [x] Search-window tests prove global Todo ranking is bounded and file-scoped Todo and Agent results remain complete.
- [x] Composition tests prove Todo and Agent use the shared renderer rather than duplicate inputs.
- [x] Focused tests, the complete test suite, lint, typecheck, Obsidian compliance, bundle-size check, and release-artifact inspection pass.

## Product Behavior

### Index Todo

Todo continues to show matching Todo threads across the vault when no file is selected. Its search field filters only the Todo cards already eligible for that tab. If a file filter is selected, the same field searches only Todo cards from that file scope.

An unscoped Todo query returns the highest-ranked 100 matches and shows the established refinement notice when more matches exist. This keeps retrieval and rendering bounded without changing match quality.

### Index Agent

Agent continues to require a selected file. Before file selection, the existing select-a-file empty state remains and no secondary toolbar is rendered. Once a file is selected, Agent receives the same search field as Index List and filters only Agent cards in that file scope.

### Mode Changes

The generic side-note query remains transient. Switching among List, Todo, and Agent preserves it, matching the individual sidebar experience. Entering Tags or Thought Trail clears it because those modes use different content models. Tags retains its separate fuzzy tag query.

## Architecture

`indexSidebarState.ts` remains the source of truth for generic Index search-mode policy and transient-state normalization. `sidebarToolbarState.ts` consumes that policy when deciding whether the shared secondary toolbar receives a search model. It does not duplicate the searchable-mode list.

`AsideView` remains a lifecycle adapter. It supplies the existing `SidebarSearchInputOptions`, selects scope-aware placeholder copy, schedules the existing debounce, restores focus, and feeds the current mode-filtered thread set into `buildIndexSidebarSearchWindow`. No new search component, state machine, renderer, or CSS is introduced.

`indexSidebarGlobalSearch.ts` expands its bounded global-result policy from unscoped List to unscoped Todo. Agent never reaches that global path because its mode scope remains unavailable without a file.

## Data Flow

1. Resolve the active Index mode and file scope.
2. Apply the existing Todo or Agent group filter to eligible threads.
3. Rank the resulting cards with the shared sidebar scorer using the transient query.
4. Bound only unscoped Todo results to 100; keep file-scoped results complete.
5. Reconcile cards through the existing keyed renderer and apply shared highlights.

## Non-Goals

- Making Index Agent vault-wide.
- Adding fuzzy matching to side-note body search.
- Combining Tags search state with side-note search state.
- Adding a second search component or new styling.
- Persisting search queries across Obsidian sessions.
