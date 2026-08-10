# Index Mode Scope Gate Design

## Summary

The Aside Index will use one shared selected-file scope across its card tabs. With no file selected, List and Agent render guidance instead of a toolbar row or cards, while Todo remains a useful global work queue. Selecting a file scopes List, Todo, and Agent to that file; clearing the selection returns Todo to global and gates List and Agent again.

This specification supersedes the disabled unscoped List search affordance in `2026-08-10-index-search-file-scope-gate-design.md` and the earlier always-global Todo behavior.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code change is complete and the listed verification passes.

### Already Done

- [x] The Index stores one normalized selected-file root shared across tab changes.
- [x] File-scoped Index List search, query cancellation, and invalid-scope recovery already exist.
- [x] The existing empty-state copy is `Click a file in the index to see its side notes.`
- [x] Todo grouping can derive matching entries from the aggregate indexed thread set.
- [x] The primary tab row and secondary action row are rendered independently.

### To Implement

- [x] Add one pure mode-and-file scope policy with `unavailable`, `global-todo`, and `file` results.
- [x] Render no List or Agent cards when no valid file is selected and show the existing file-selection guidance.
- [x] Omit the Index secondary toolbar row entirely for unscoped List and Agent.
- [x] Keep unscoped Todo global and render its existing non-search toolbar actions.
- [x] Scope Todo, List, and Agent to the selected source file whenever a valid file is selected.
- [x] Remove the obsolete disabled unscoped Index search presentation while preserving file-scoped search and cancellation.
- [x] Make Index card mutation policy consume the same resolved scope so drag controls appear only for file-scoped cards.

### Verification

- [x] Fail-first pure-policy tests cover every List, Todo, and Agent combination with and without a selected file.
- [x] Toolbar-plan tests prove the secondary row is absent for unscoped List and Agent, present for global Todo, and correctly composed for file-scoped modes.
- [x] Thread-scope tests prove unscoped Todo is global, unscoped List and Agent are empty, and a selected file scopes all three modes.
- [x] Rendering contract tests prove unscoped List and Agent show only the guidance state while file-scoped List restores search.
- [x] Card-action tests prove global Todo disables drag and file-scoped card modes receive individual-file action parity.
- [x] Focused tests, the complete build, and the release-artifact security guard pass.

## Context

The current Index List renders a disabled search input and falls back to all indexed threads when its file scope is empty. This combines a nonfunctional control with a global card list even though the intended workflow is to choose a source file before using List. Agent has the same local-source meaning and should follow the same gate.

Todo has a different purpose: it is the cross-vault work queue when the user has not chosen a file. Once a file is selected, users expect tab switches to preserve that shared context instead of making Todo silently jump back to the whole vault.

## Considered Approaches

### One shared scope with a global Todo fallback (selected)

Keep the selected file as the single scope state. Resolve each mode against it: List and Agent are unavailable without a file, Todo is global without a file, and every card mode is file-scoped with a file.

This gives tab switching a stable mental model, preserves the value of global Todo, and does not add another toggle or persisted state.

### Independent scope per tab

List, Todo, and Agent could each remember a separate file/global choice. This preserves more state but makes tab switches unpredictable and requires additional persistence and UI indicators. It is rejected because the user wants a selected file to scope all tabs.

### A separate Global Todo tab

A dedicated global tab could coexist with a file-scoped Todo tab. The distinction would be explicit, but it adds navigation and duplicates one workflow solely to represent an absent file scope. It is rejected as unnecessary.

## Scope Model

`indexSidebarState.ts` will own a pure resolver with three outcomes:

| Selected file | Mode | Scope result | Cards |
| --- | --- | --- | --- |
| None | List | `unavailable` | None |
| None | Agent | `unavailable` | None |
| None | Todo | `global-todo` | All matching indexed Todo threads |
| Valid file | List | `file` | Threads from that file |
| Valid file | Agent | `file` | Matching Agent threads from that file |
| Valid file | Todo | `file` | Matching Todo threads from that file |

The resolver normalizes the selected path before declaring a file scope. A blank, stale, deleted, or invalid selection follows the no-file row after the existing recovery path clears it.

Tags and Thought Trail retain their existing scope requirements. They do not create a second selected-file state.

## Rendering and Toolbar Behavior

The primary Index tab row always renders so users can reach global Todo or another available mode.

For unscoped List and Agent, the comments body reconciles to zero cards and renders the existing guidance:

```text
Click a file in the index to see its side notes.
```

Their Index secondary row (`.aside-sidebar-toolbar-row.is-index-secondary-row`) is not created, so there is no disabled search field, file-filter button, pin toggle, nested toggle, or deleted toggle in that state. A file can still be selected through the generated Index note's file links.

Unscoped Todo renders its global cards and existing secondary actions, excluding search as it does today. Its file-filter control remains available as an additional way to enter file scope. When a valid file is selected, List restores its enabled file-scoped search and every card mode renders its normal applicable actions.

Clearing the file scope clears any List query through the existing cancellation path. The visible mode then re-resolves immediately: Todo returns to global cards, while List and Agent return to the guidance state.

## Data Flow

`AsideView` resolves the mode scope after normalizing the selected file and effective mode. That one result drives three adapters:

1. Thread selection chooses an empty set, the aggregate Todo set, or the selected file's set.
2. Secondary-toolbar planning decides whether the row exists and which controls it contains.
3. Card-action planning decides whether the current cards are file-scoped or global Todo cards.

The renderer does not infer scope from an empty thread array, and an empty filter-path array does not continue to mean both “all files” and “no available List.” Keeping the resolved scope explicit prevents the global fallback from reappearing accidentally.

## Card Mutation Policy

File-scoped List, Todo, and Agent cards use the action parity specified in `2026-08-11-index-card-action-parity-design.md`: parent and child edit, delete, and drag controls are available, and **Open source** sits at the bottom-right.

Global Todo cards retain edit, delete, pin, and **Open source** because each mutation resolves a canonical entry ID. Top-level and child drag controls remain hidden because a mixed-file result has no meaningful single displayed order. Existing canonical-file persistence and cross-file move validation remain unchanged.

## Error and State Handling

- Removing or invalidating the selected file clears the scope and any List search before the next render.
- Switching directly from file A to file B preserves the List query and applies it to file B through the existing behavior.
- Switching tabs never clears the selected file.
- An empty global Todo result uses the existing Todo empty state rather than the file-selection guidance.
- An empty selected-file List, Todo, or Agent result uses the existing scoped empty-state behavior for that mode.

## Testing

Pure scope-policy tests will define the complete mode/file matrix. Toolbar-plan tests will consume that result and verify row ownership rather than merely checking whether a search option is undefined. Thread-scope tests will use mixed-file fixtures to distinguish empty, global Todo, and selected-file results.

Representative `AsideView` contracts will verify the policy result reaches both toolbar and render adapters. The card renderer and action-state tests remain responsible for footer redirect placement and mutation controls. Existing search cancellation, Todo matching, invalid-file recovery, note-sidebar behavior, and cross-file move rejection tests remain green.

## Out of Scope

- Adding a global List or Agent experience.
- Adding a separate scope toggle or per-tab scope persistence.
- Changing Todo syntax, resolution semantics, or sorting.
- Enabling search in Todo or Agent.
- Permitting cross-file drag operations.
- Cutting or publishing a release.
