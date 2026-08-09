# Index Search Tooltip Removal Design

## Summary

Keep the existing search field in the Aside Index List toolbar, including its search icon, placeholder, keyboard behavior, filtering, and layout. Remove only the explicit accessible label that Obsidian currently presents as the redundant black hover tooltip, `Search index side notes`.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] The shared toolbar renderer accepts search options with an optional `ariaLabel`.
- [x] The note-sidebar search already renders without an explicit `ariaLabel` and does not show this tooltip.
- [x] The index search behavior and its `Search side notes in index` placeholder are already implemented and verified by the index shared-controls work.

### To Implement

- [x] Stop supplying `ariaLabel: "Search index side notes"` from the index search options.
- [x] Keep the index search placeholder, field, icon, filtering state, and event handling unchanged.
- [x] Add a regression assertion that distinguishes the retained placeholder from the removed tooltip-producing label.

### Verification

- [x] Run the focused toolbar composition regression test and observe the new assertion fail before the production edit, then pass afterward.
- [x] Run the relevant index sidebar and toolbar test suites.
- [x] Run the repository build and release-artifact security guard.
- [x] Install the verified build and confirm the index search field remains usable without the black hover tooltip.

## Context

The Index List toolbar supplies a shared search input through `getIndexSearchInputOptions()`. Unlike the note-sidebar search options, the index options add an explicit `ariaLabel`. Obsidian uses that attribute as hover-tooltip copy, creating a black label over a control whose purpose is already evident from its search icon and placeholder.

The user wants the search control to remain and only the redundant black hover label removed.

## Considered Approaches

### Remove the index-only `ariaLabel` (selected)

Delete the one index search option that produces the tooltip. This is the smallest change, matches the note-sidebar search, and leaves the shared renderer and all search behavior untouched.

### Hide the tooltip with CSS

A CSS override would depend on Obsidian's internal tooltip DOM and could suppress unrelated tooltips. It would also leave the tooltip-producing attribute in place. This approach is rejected as brittle.

### Replace search labels with a new hidden-label system

A renderer-wide hidden-label design could separate accessible naming from hover tooltips, but it changes every shared search surface and exceeds this request. It can be considered separately if the plugin adopts a broader accessibility pass.

## Design

`getIndexSearchInputOptions()` remains the sole index-specific adapter. It will continue to return the current value, placeholder, focus ownership handler, clear behavior, and input scheduling callback, but it will no longer return `ariaLabel`.

`renderSidebarSearchInput()` remains unchanged. Its optional-label behavior is still available to callers that intentionally want an explicit label and Obsidian tooltip.

No CSS, layout, state, filtering, persistence, or rendering changes are required.

## Testing

Extend the existing shared-toolbar composition contract to assert both sides of the requirement:

- the index search options still contain `placeholder: "Search side notes in index"`; and
- the index search options do not contain `ariaLabel: "Search index side notes"`.

The assertion must fail against the current implementation before the production line is removed. Existing index sidebar state and toolbar layout tests cover visibility, mode transitions, and geometry and should remain green.

## Out of Scope

- Removing or hiding the index search field.
- Changing placeholder copy.
- Changing note-sidebar search behavior.
- Reworking search accessibility across the plugin.
- Changing search filtering, ranking, debounce, or keyboard behavior.
