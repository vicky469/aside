# Index Sidebar Shared List Controls Design

## Goal

Bring the note sidebar's compact toolbar and card controls into the generated index sidebar through shared capability-driven components. Search remains exclusive to List, while valid card actions work consistently in List, Todo, and Agent without inventing cross-file reorder semantics.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Index rendering already filters and ranks threads through the shared sidebar search matcher.
- [x] Index search results already reveal matching nested entries, highlight matching text, render search-specific empty states, and bypass the default unscoped list cap.
- [x] The note sidebar already owns a reusable compact search input renderer and styling.
- [x] Pin, edit, delete, and reorder mutations already write through canonical thread storage rather than editing generated index content.
- [x] Drag state already resolves a thread's source file and rejects cross-file nesting and child-entry moves.

### To Implement

- [x] Render the shared compact search input in the generated index sidebar only when the effective tab is List.
- [x] Keep a transient index search input value and apply it through the existing index search query pipeline.
- [x] Clear the index search value and applied query when the user presses Escape or leaves List.
- [x] Keep file scoping ahead of search so the query filters only the current index file scope.
- [x] Ensure Todo, Agent, and Thought Trail never inherit a hidden List search query.
- [x] Replace separate note/index toolbar composition with one shared capability-driven secondary toolbar component.
- [x] Show the valid index toolbar actions for each effective mode: file filter, List search, pinned-only filter, nested visibility, and deleted visibility; keep Add page note hidden because an unscoped index has no single write target.
- [x] Render Pin, Edit, Delete, and top-level Drag actions on cards in the index List, Todo, and Agent tabs through the existing shared card renderer.
- [x] Make index card pinning and the pinned-only filter consume canonical `isPinned` state across files.
- [x] Make index card editing and deletion use the existing source-thread mutation paths and refresh the aggregate index after completion.
- [x] Allow index drag reorder only when source and target threads belong to the same source file, and reject cross-file drops without mutating either file.
- [x] Preserve canonical per-file thread order when rendering each file's index cards so a same-file reorder remains visible after refresh.
- [x] Keep child-entry drag/move behavior note-sidebar-only in this change.

### Verification

- [x] Fail-first tests prove the search field is visible only for the effective index List mode.
- [x] Tests prove input, clear, mode-switch, filtering, ranking, nested matching, highlighting, empty-state, and list-cap behavior remain connected.
- [x] Tests prove shared toolbar capabilities render the correct action set in note, List, Todo, Agent, and Thought Trail contexts without duplicated markup.
- [x] Tests prove index cards expose Pin, Edit, Delete, and top-level Drag in List, Todo, and Agent while keeping child move handles and all card actions out of Thought Trail.
- [x] Tests prove pin state is global to the canonical thread, edit/delete refresh index results, same-file drag persists visible order, and cross-file drag is rejected.
- [x] The full test suite, lint, typecheck, Obsidian compliance check, production bundle, and release-artifact guard pass.
- [x] The built `main.js`, `manifest.json`, and `styles.css` contain no source map, embedded source, local path, or obvious secret exposure.
- [x] The verified build is installed into `lean-startup`, matches byte-for-byte, and List-only search plus shared toolbar/card actions are smoke-checked.

Verification on 2026-08-09 used the production build in `lean-startup`. The live smoke check covered List-only input visibility, debounced matching and highlighting, Escape clearing, tab-exit clearing, the toolbar capability differences, the pinned-only filter, and the complete top-level card action set. Edit/delete/drag were verified without mutating vault data through canonical mutation and eligibility tests, including same-file persistence and cross-file rejection.

## Current State

`AsideView` retains `indexSidebarSearchQuery` and already passes it through `rankThreadsBySidebarSearchQuery`, nested-entry presentation, search highlighting, index empty-state copy, and `shouldLimitIndexSidebarList`. The state is cleared in a few lifecycle and tag-filter paths, but current code has no input that can assign a nonempty index query. Release notes for version 2.0.48 record that index-sidebar search previously existed, so this work restores a missing control rather than introducing a second search engine.

The index toolbar currently renders the primary mode tabs followed by a secondary row containing the file-filter button. The note sidebar separately composes search, pinned-only, nested, deleted, and Add page note actions into a compact secondary row. The low-level input and icon-button renderers are shared, but the row composition is not.

Persisted cards also share one renderer, but index hosts deliberately suppress most mutation actions. Canonical pin, edit, delete, and reorder entrypoints already exist. Index rendering currently replaces stored per-file order with a file-path/anchor-position sort, so invoking the existing reorder mutation from the index would not produce a durable visible result without correcting that presentation rule.

## User Experience

The note and index sidebars use one secondary-toolbar component supplied with explicit capabilities and callbacks. This shares structure and responsive behavior while avoiding disabled or meaningless actions.

For the generated index sidebar:

- **List:** file filter, search, pinned-only filter, nested visibility, and deleted visibility.
- **Todo and Agent:** file filter, pinned-only filter, nested visibility, and deleted visibility; no search field.
- **Thought Trail:** only controls owned by Thought Trail and index file scope; no list-card actions.
- **Add page note:** hidden because the unscoped index has no unambiguous source file. Selecting a file filter does not expand this feature's write scope.

When the effective mode is List, the compact inline search field appears beside the file-filter button and before the action buttons. Its placeholder describes the index scope, such as `Search side notes in index`.

Typing updates the search after the same short debounce used by note-sidebar search. Search is case-insensitive and uses the existing ranking and token behavior. It matches the thread anchor text and parent or nested entry bodies, reveals matching nested entries, and highlights rendered matches.

The current file filter remains independent and precedes search:

1. The file filter selects the index thread scope.
2. The search query filters and ranks threads inside that scope.
3. Rendering and search highlighting consume the ranked result.

Pressing Escape while the field is nonempty clears both the visible value and the applied query. Switching from List to Todo, Agent, or Thought Trail also clears both values before rendering the new tab. Returning to List therefore starts without a stale query. Search remains view-local and is not written to plugin settings or persisted sidebar state.

Cards in List, Todo, and Agent expose the same valid top-level actions as note-sidebar cards:

- **Pin** toggles the canonical thread's `isPinned` state. The index pinned-only toolbar action filters the current file/group scope to those canonical pinned threads.
- **Edit** opens the existing inline edit draft for the source entry and persists through the normal source-thread mutation path.
- **Delete** uses the existing confirmation and soft-delete flow. The index deleted-visibility action exposes deleted cards across the current index scope so they can use existing restore/permanent-delete behavior.
- **Drag** reorders a top-level thread only relative to another top-level thread from the same source file. Cross-file targets are not eligible and never mutate data.

Search ranking and Todo/Agent filtering may show a subset of a file's cards. A valid same-file drop still stores the moved thread relative to the visible same-file target in the file's complete canonical order. Hidden siblings retain their relative order.

## Architecture

The existing sidebar search matcher remains the source of truth. No index-specific text matching, ranking, nested-entry, highlighting, or empty-state implementation is added.

Toolbar composition moves behind one shared planner/renderer pair. The planner receives the sidebar surface, effective mode, available state, and supported callbacks, and returns an explicit control model. The renderer consumes that model to produce the existing compact row. Surface adapters remain responsible for domain data such as index file-filter options or note-local Add page note targeting.

`AsideView` adds only the input-side state and lifecycle needed to drive the existing index query:

- a visible input value, separate from the applied debounced query;
- the same request-version and timer protection used by note-sidebar search;
- a small List-only visibility decision derived from the effective index mode;
- a shared clearing path used by Escape, file changes, and tab changes away from List.

The index toolbar calls the existing search and icon-button renderers through that shared row component. Any layout differences are expressed by surface classes and narrow CSS adjustments; controls retain shared theme variables and interaction guards.

Search visibility, valid toolbar actions, and valid card actions live in small pure capability planners beside the existing sidebar planners so they can be tested without rendering the full Obsidian view. `AsideView` remains the adapter that owns DOM events, canonical mutation callbacks, and rerender scheduling.

The shared persisted-card renderer receives capability decisions rather than an `isIndexView` collection of special cases. List, Todo, and Agent authorize top-level Pin, Edit, Delete, and Drag. Thought Trail renders no cards. Child entry drag/move remains unauthorized in index contexts.

## State and Lifecycle

The index search maintains two transient strings:

- `indexSidebarSearchInputValue`: the current visible input text;
- `indexSidebarSearchQuery`: the last debounced value used by filtering and rendering.

Input changes capture the selection range, schedule a short debounce, and rerender with data refresh skipped. After rerender, focus and selection are restored only when the request remains current. This mirrors the note-sidebar behavior and avoids cursor jumps while typing.

Clearing cancels the pending debounce, increments the request version, clears both strings, and rerenders. File changes continue to clear search. A mode change away from List calls the same clear-state helper before rendering the selected tab. Search does not reset merely because the user changes the file-filter scope; the same query is applied to the newly selected scope while List remains active.

Pin state remains canonical on each thread. The index does not introduce a second pin registry. Pinned-only is transient view state for the generated index, composed with file scope and Todo/Agent grouping before rendering.

Deleted visibility uses the existing soft-delete lifecycle and remains a view filter, not a second deleted-thread store. Edit and delete completion request aggregate refresh so the generated index reflects source storage immediately.

## Reorder Semantics

Index list rendering continues to group files in deterministic folder/file order. Within each source file, it preserves canonical stored thread order rather than re-sorting every card by anchor position after each render. Existing data is already initially stored in natural source order, so the default view remains stable while manual same-file reorders become visible.

The drag handle records the canonical source file from the moved thread. Drop-target resolution authorizes only a top-level target whose canonical `filePath` equals that source file. Cross-file cards do not show a drop indicator and a drop on them is a no-op. Reordering does not change `filePath`, anchor coordinates, selected text, thread nesting, or entry order.

When the visible list is filtered by search, pinned-only, Todo, or Agent, moving one visible thread relative to another same-file visible thread uses the existing full-file reorder operation. Threads omitted by the filter retain their relative order. Child entry reorder, cross-thread child moves, and thread nesting remain note-sidebar-only.

## Empty, Limited, and Nested Results

Existing behavior remains authoritative:

- A nonempty query disables the default cap on an unscoped index list.
- When no results match, the index empty state includes the active query and current file scope.
- A match in a nested reply keeps its parent thread in the result and reveals the matching nested content.
- Highlighting runs only against the rendered result container and is cleared before each refresh.

No search field is rendered in Todo, Agent, or Thought Trail. Because the query is cleared when leaving List, those tabs continue using only their own group or graph rules. Pinned-only and deleted visibility compose with List, Todo, and Agent without becoming part of search matching.

## Accessibility and Layout

The input uses `type="search"`, an explicit index-search accessible label, the existing search icon, and Escape-to-clear behavior. Keyboard focus remains in the field across debounced renders.

The shared secondary row stays single-line where space permits: fixed compact action buttons keep their current dimensions and the search group flexes into the remaining space. At very narrow widths, capability-aware responsive rules may hide the search before hiding valid action buttons, matching the existing note-toolbar priority without widening the sidebar or introducing horizontal scrolling.

Card actions retain existing accessible labels, pressed states, focus handling, confirmation flows, and pending-action guards. Invalid cross-file drag targets receive no visual drop affordance.

## Testing

Fail-first unit tests cover the pure List-only search decision, shared toolbar capability matrix, card-action matrix, query clearing on a transition away from List, and same-file drop eligibility. Renderer or view-level tests prove that note and index toolbars consume the shared row, that the index wires search only in List, and that typing and Escape update the correct transient state.

Existing search matcher tests remain the behavioral proof for case-insensitive ranking and nested entry matching. Representative index integration tests confirm file-scope composition, search-specific empty states, highlight invocation, uncapped search results, canonical pin filtering, edit/delete refresh, and same-file reorder persistence. Negative tests prove cross-file drops, child move handles, and Add page note remain unavailable in the index. CSS contract tests confirm the shared secondary row gives the search group flexible remaining width without adding a full-width or overflow regression.

After focused tests pass, run the complete repository build and the release-artifact inspection. Install only the verified `main.js`, `manifest.json`, and `styles.css` into `lean-startup`, compare them byte-for-byte, reload Aside, and smoke-check List visibility, typing, Escape, file-filter composition, tab exit clearing, toolbar capability differences, pin/edit/delete, same-file drag persistence, and cross-file drag rejection.

## Out of Scope

- Search fields in Todo, Agent, or Thought Trail.
- Persisting index search across Obsidian sessions, file changes, or tab changes.
- New fuzzy-search rules or changes to search ranking.
- Search history, keyboard shortcuts, or a modal search surface.
- Changes to note-sidebar search behavior.
- Add page note from the generated index.
- A global manual order spanning multiple source files.
- Cross-file drag reorder, file moves, thread nesting, or child-entry drag/move from the index.
