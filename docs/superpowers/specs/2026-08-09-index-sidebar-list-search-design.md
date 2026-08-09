# Index Sidebar List Search Design

## Goal

Restore a compact search field to the generated index sidebar's List tab so users can filter and rank the currently scoped side notes without exposing a hidden search state in other index tabs.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Index rendering already filters and ranks threads through the shared sidebar search matcher.
- [x] Index search results already reveal matching nested entries, highlight matching text, render search-specific empty states, and bypass the default unscoped list cap.
- [x] The note sidebar already owns a reusable compact search input renderer and styling.

### To Implement

- [ ] Render the shared compact search input in the generated index sidebar only when the effective tab is List.
- [ ] Keep a transient index search input value and apply it through the existing index search query pipeline.
- [ ] Clear the index search value and applied query when the user presses Escape or leaves List.
- [ ] Keep file scoping ahead of search so the query filters only the current index file scope.
- [ ] Ensure Todo, Agent, and Thought Trail never inherit a hidden List search query.

### Verification

- [ ] Fail-first tests prove the search field is visible only for the effective index List mode.
- [ ] Tests prove input, clear, mode-switch, filtering, ranking, nested matching, highlighting, empty-state, and list-cap behavior remain connected.
- [ ] The full test suite, lint, typecheck, Obsidian compliance check, production bundle, and release-artifact guard pass.
- [ ] The built `main.js`, `manifest.json`, and `styles.css` contain no source map, embedded source, local path, or obvious secret exposure.
- [ ] The verified build is installed into `lean-startup`, matches byte-for-byte, and the List-only search behavior is smoke-checked.

## Current State

`AsideView` retains `indexSidebarSearchQuery` and already passes it through `rankThreadsBySidebarSearchQuery`, nested-entry presentation, search highlighting, index empty-state copy, and `shouldLimitIndexSidebarList`. The state is cleared in a few lifecycle and tag-filter paths, but current code has no input that can assign a nonempty index query. Release notes for version 2.0.48 record that index-sidebar search previously existed, so this work restores a missing control rather than introducing a second search engine.

The index toolbar currently renders the primary mode tabs followed by a secondary row containing the file-filter button and mode-specific actions. The note sidebar separately renders the shared `renderSidebarSearchInput` control with compact Obsidian-themed styling.

## User Experience

When the generated index sidebar's effective mode is List, its secondary toolbar row shows the existing file-filter button and a compact inline search field. The placeholder describes the index scope, such as `Search side notes in index`.

Typing updates the search after the same short debounce used by note-sidebar search. Search is case-insensitive and uses the existing ranking and token behavior. It matches the thread anchor text and parent or nested entry bodies, reveals matching nested entries, and highlights rendered matches.

The current file filter remains independent and precedes search:

1. The file filter selects the index thread scope.
2. The search query filters and ranks threads inside that scope.
3. Rendering and search highlighting consume the ranked result.

Pressing Escape while the field is nonempty clears both the visible value and the applied query. Switching from List to Todo, Agent, or Thought Trail also clears both values before rendering the new tab. Returning to List therefore starts without a stale query. Search remains view-local and is not written to plugin settings or persisted sidebar state.

## Architecture

The existing sidebar search matcher remains the source of truth. No index-specific text matching, ranking, nested-entry, highlighting, or empty-state implementation is added.

`AsideView` adds only the input-side state and lifecycle needed to drive the existing index query:

- a visible input value, separate from the applied debounced query;
- the same request-version and timer protection used by note-sidebar search;
- a small List-only visibility decision derived from the effective index mode;
- a shared clearing path used by Escape, file changes, and tab changes away from List.

The index toolbar calls the existing search renderer. Any layout differences are expressed by index-toolbar row classes and narrow CSS adjustments; the search field itself retains the shared component and theme variables.

The mode-visibility decision should live in a small pure planner beside the existing index sidebar toolbar planners so it can be tested without rendering the full Obsidian view. `AsideView` remains the adapter that owns DOM events and rerender scheduling.

## State and Lifecycle

The index search maintains two transient strings:

- `indexSidebarSearchInputValue`: the current visible input text;
- `indexSidebarSearchQuery`: the last debounced value used by filtering and rendering.

Input changes capture the selection range, schedule a short debounce, and rerender with data refresh skipped. After rerender, focus and selection are restored only when the request remains current. This mirrors the note-sidebar behavior and avoids cursor jumps while typing.

Clearing cancels the pending debounce, increments the request version, clears both strings, and rerenders. File changes continue to clear search. A mode change away from List calls the same clear-state helper before rendering the selected tab. Search does not reset merely because the user changes the file-filter scope; the same query is applied to the newly selected scope while List remains active.

## Empty, Limited, and Nested Results

Existing behavior remains authoritative:

- A nonempty query disables the default cap on an unscoped index list.
- When no results match, the index empty state includes the active query and current file scope.
- A match in a nested reply keeps its parent thread in the result and reveals the matching nested content.
- Highlighting runs only against the rendered result container and is cleared before each refresh.

No search field is rendered in Todo, Agent, or Thought Trail. Because the query is cleared when leaving List, those tabs continue using only their own group or graph rules.

## Accessibility and Layout

The input uses `type="search"`, an explicit index-search accessible label, the existing search icon, and Escape-to-clear behavior. Keyboard focus remains in the field across debounced renders.

The secondary index row stays single-line where space permits: the file-filter button has fixed compact width and the search group flexes into the remaining space. At very narrow widths, the search field may shrink to its existing minimum behavior without widening the sidebar or introducing horizontal scrolling.

## Testing

Fail-first unit tests cover the pure List-only visibility decision and query clearing on a transition away from List. Renderer or view-level tests prove that the index toolbar wires the shared input only in List and that typing and Escape update the correct transient state.

Existing search matcher tests remain the behavioral proof for case-insensitive ranking and nested entry matching. Representative index integration tests confirm file-scope composition, search-specific empty states, highlight invocation, and uncapped search results. CSS contract tests confirm the index secondary row gives the search group flexible remaining width without adding a full-width or overflow regression.

After focused tests pass, run the complete repository build and the release-artifact inspection. Install only the verified `main.js`, `manifest.json`, and `styles.css` into `lean-startup`, compare them byte-for-byte, reload Aside, and smoke-check List visibility, typing, Escape, file-filter composition, and tab exit clearing.

## Out of Scope

- Search fields in Todo, Agent, or Thought Trail.
- Persisting index search across Obsidian sessions, file changes, or tab changes.
- New fuzzy-search rules or changes to search ranking.
- Search history, keyboard shortcuts, or a modal search surface.
- Changes to note-sidebar search behavior.
