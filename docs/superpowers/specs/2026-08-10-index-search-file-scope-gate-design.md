# Index Search File-Scope Gate Design

## Summary

The Aside Index List will no longer offer interactive global search across every indexed file. The search field remains visible to preserve toolbar stability, but it is disabled until the user selects a file through the adjacent file-filter control. File-scoped exact search remains unchanged.

This specification is the product-policy source of truth for Index search availability. It supersedes the unscoped global-search behavior described in `2026-08-09-index-sidebar-bounded-global-search-performance-design.md` without removing the shared reconciliation and bounded-ranking infrastructure delivered by that work.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] The Index List already renders a shared compact search field beside its file-filter control.
- [x] File-scoped Index search already uses the shared exact matcher, nested-entry reveal, highlighting, empty states, and incremental card reconciliation.
- [x] Index search state already has one cancellation path that clears the debounce timer, invalidates pending requests, and clears visible and applied query values.
- [x] Leaving Index List already clears its transient search state.

### To Implement

- [x] Add one pure Index search-availability policy that derives disabled state and placeholder copy from List mode and the selected file scope.
- [x] Render the unscoped Index List search as disabled with `Select a file to search side notes` and no tooltip-producing label.
- [x] Enable the search after a file is selected and show `Search side notes in selected file`.
- [x] Clear visible and applied search state, cancel pending debounce work, and invalidate stale requests whenever the selected file scope becomes empty or an invalid selected file is removed.
- [x] Preserve the current query when switching directly from one selected file to another and apply it within the new file scope.
- [x] Extend the shared search renderer with generic disabled-input support without changing note-sidebar search behavior.
- [x] Extract the dormant unscoped global-search limit and notice policy into `indexSidebarGlobalSearch.ts` with a top-level `@todo` explaining that a dedicated global-search experience may be restored later.
- [x] Keep the existing bounded-ranking and keyed-reconciliation infrastructure as defensive implementation detail, but make unscoped global queries unreachable from the Index UI.

### Verification

- [x] Fail-first policy tests cover unscoped List, scoped List, non-List modes, scope clearing, invalid-scope recovery, and direct file-to-file switching.
- [x] Renderer and wiring tests prove the disabled attribute and guidance copy reach only the unscoped Index search while note search remains enabled.
- [x] Extraction tests prove the dormant global-search module retains the exact top-100 limit and notice behavior without leaking that policy into active file-scoped search state.
- [x] Existing exact search, filtering, highlighting, nested-entry, toolbar, reconciliation, and cancellation tests remain green.
- [x] The full test, lint, typecheck, Obsidian-compliance, production-bundle, and release-artifact guard pipeline passes.
- [x] The verified build is installed into `lean-startup` and live-smoke-tested for disabled unscoped search, enabled file-scoped search, query preservation across file switches, and clearing when scope is removed.

## Context

The recently optimized global Index search is bounded to the top 100 matches and incrementally reconciles cards, but its interaction model is still poor: a small sidebar field appears to search the entire vault, broad terms produce a large heterogeneous result set, and the user must refine or scope after initiating the search.

The file filter already provides a precise, understandable scope. Search should become the second operation: select one file, then search that file's side notes.

## Considered Approaches

### Visible but disabled until scoped (selected)

Keep the search field in the stable List toolbar layout. When no file is selected, its disabled placeholder explains the prerequisite. This preserves discoverability without inviting an expensive or confusing global action.

### Hide search until scoped

This is visually cleaner but makes the capability disappear and shifts toolbar controls when a scope is selected. It is rejected because the user explicitly prefers a disabled affordance.

### Let the search field open the file filter

Treating a search input as a button violates the control's expected behavior and complicates keyboard and accessibility semantics. It is rejected.

## User Experience

The Index List toolbar has two search states:

| File scope | Search control | Placeholder | Query state |
| --- | --- | --- | --- |
| No selected file | Disabled | `Select a file to search side notes` | Empty |
| Selected file | Enabled | `Search side notes in selected file` | Transient exact query |

The file-filter button remains enabled and adjacent to the search field. The disabled field uses native disabled semantics and a muted treatment. It does not add an `aria-label`, `title`, Obsidian tooltip, banner, or extra helper row.

Selecting the first file enables search. Switching directly from file A to file B preserves the current query and re-evaluates it against file B. Clearing the file filter removes the visible input value and applied query immediately, cancels pending debounce work, invalidates any in-flight search rendering, and disables the control.

Search remains visible only in Index List. Todo, Agent, Tags, and Thought Trail continue to omit it and clear hidden List search state through the existing mode policy.

## Architecture

### Policy owner

`indexSidebarState.ts` owns the rule that Index search requires a normalized selected file path. A pure policy result supplies:

- whether the List search control is disabled;
- the correct placeholder copy; and
- whether existing search state must be cleared after a scope transition.

The policy distinguishes `file A → file B`, which preserves search, from `file A → no scope`, which clears search. Restored or stale state with a query and no valid file scope is normalized to empty before rendering.

### Shared renderer

`SidebarSearchInputOptions` gains an optional `disabled` property. `renderSidebarSearchInput()` applies it to the native input and a field-level disabled class used only for muted presentation and suppression of focus styling. Note-sidebar callers omit the property and retain their current behavior.

### Index adapter

`AsideView` asks the policy owner for the current Index search presentation and passes it to the shared renderer. File-filter mutations use the same scope-transition policy before rendering:

- selecting the first file enables the empty search;
- switching files preserves the query;
- clearing or invalidating the selected file routes through the existing full search-state cancellation method.

No search event handler runs while the input is disabled. The bounded global-search window remains a defensive guard for stale or programmatically injected state, not a user-facing capability.

### Dormant global-search seam

The unscoped-only limit decision and `N matches shown` notice move out of active Index state and ordinary list-limit modules into `indexSidebarGlobalSearch.ts`. The module starts with:

```typescript
// @todo Revisit unscoped global Index search after designing a dedicated global-search experience.
// The active product path requires a selected file; this module is a defensive fallback only.
```

The existing `indexSidebarSearchWindow.ts` may call this isolated policy when guarding stale or programmatically injected unscoped queries. File-scoped search receives no global result limit or global notice. The generic bounded ranker and shared DOM reconciler remain in their current shared owners because they are reusable infrastructure rather than dormant product policy.

## Error and Edge Handling

- If no files are available to filter, both the file-filter button and search remain disabled; the search guidance still explains the missing prerequisite.
- If a selected file is deleted or no longer resolves, Aside clears the scope and search together before rendering the unscoped List.
- If a pending debounced query exists when scope is cleared, request-version invalidation prevents it from committing results or highlights.
- A restored view containing a stale query without a valid scope is sanitized to empty.
- Disabled search never receives focus, keyboard input, Escape handling, or input callbacks.

## Testing Strategy

Development follows red-green-refactor:

1. Add pure fail-first tests for search availability and scope transitions.
2. Add a renderer contract test for native disabled semantics and field styling.
3. Add representative `AsideView` wiring tests for disabled copy, selected-scope copy, clear-on-empty-scope, and preserve-on-file-switch.
4. Add fail-first extraction tests around the new dormant global-search module, including the required top-level `@todo` contract.
5. Implement the smallest policy, extraction, and renderer changes.
6. Re-run the existing bounded-ranking, Index search-window, toolbar, highlighting, reconciliation, and cancellation suites to prove the defensive infrastructure and scoped behavior remain intact.
7. Run the complete build and exact three-file artifact-security checks.
8. Install and smoke-test the verified build in the real Index sidebar without persisting note or comment mutations.

## Out of Scope

- Removing the Index search field.
- Searching multiple selected files or folders.
- Fuzzy, semantic, typo-tolerant, or approximate matching.
- Changing exact-match scoring or result-card presentation.
- Removing the recently added shared reconciler or bounded-ranking utility.
- Designing or exposing the future dedicated global-search surface.
- Persisting search queries across sessions.
- Changing note-sidebar search.
