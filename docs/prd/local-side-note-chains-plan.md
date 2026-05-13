# Local Side Note Chains Plan

## Status

Partially implemented

Already landed:

- `Link side note` is available on the active persisted card, to the left of `Move to another file`
- the active-card link flow reuses the existing draft write path
- inline edit no longer shows the bottom bookmark button
- the old draft-surface `Link side note` button has been removed in favor of the active-card action

Still pending:

- same-file notes are still excluded from the side-note picker
- local same-file chains are not yet rendered in Thought Trail
- Thought Trail is still a single cross-file graph, not a stacked local-plus-file view

Related docs:

- [side-note-references-spec.md](side-note-references-spec.md)
- [file-sidebar-thought-trail-spec.md](file-sidebar-thought-trail-spec.md)

Relevant current code:

- [src/ui/views/sidebarDraftComment.ts](../../src/ui/views/sidebarDraftComment.ts)
- [src/ui/views/sidebarDraftEditor.ts](../../src/ui/views/sidebarDraftEditor.ts)
- [src/ui/views/sidebarPersistedComment.ts](../../src/ui/views/sidebarPersistedComment.ts)
- [src/ui/views/AsideView.ts](../../src/ui/views/AsideView.ts)
- [src/index/SideNoteReferenceSearchIndex.ts](../../src/index/SideNoteReferenceSearchIndex.ts)
- [src/core/derived/sideNoteReferenceIndex.ts](../../src/core/derived/sideNoteReferenceIndex.ts)
- [src/core/derived/thoughtTrail.ts](../../src/core/derived/thoughtTrail.ts)

## Summary

Aside should support local side-note chaining inside the same markdown file, not only cross-file linking.

This PRD now tracks the remaining work after the first action-surface cleanup already landed in code.

This plan combines four product changes into one coherent feature:

- let users create local chains between side notes in the same file
- surface `Link side note` in the active persisted card, to the left of `Move to another file`
- let the side-note picker include notes from the current file
- split Thought Trail into two stacked sections:
  - upper: local note-level chain
  - lower: existing cross-file file-level trail

The important product direction is:

- local chaining is still a side-note reference
- it stays stored in canonical note markdown
- it should feel lightweight and local
- it should not create a second relationship system

## Problem

Today the linking and trail experience is incomplete for local note chains.

Remaining gaps:

- the reference picker excludes same-file notes, so users cannot easily chain anchored notes within one book or chapter note
- Thought Trail only renders the cross-file file graph, so same-file chains are invisible there

This creates a mismatch between the user model and the product model.

The user model is:

- “these notes in this file are related to each other”
- “I should be able to chain them directly”
- “that local chain should show up in Thought Trail”

The current product model is stronger for cross-file linking than for local chaining.

## Goals

- support chaining side notes within the same file
- keep the canonical storage model in note markdown
- make `Link side note` available from the active persisted view
- include current-file notes in the link picker
- make local chains visible in Thought Trail without replacing the current cross-file graph
- keep the feature local and lightweight

## Non-Goals

- introducing a new relationship type beyond normal side-note references
- creating a separate local-chain storage block or global relationship store
- changing the existing `Move to another file` behavior
- replacing the current cross-file Thought Trail
- redesigning Mermaid visuals beyond stacking the two sections
- turning child-entry drag/reparenting into the chaining model

## Current System

### Link Authoring

The current authoring flow is now split into two layers:

- persisted-card entry point in `openCommentSideNoteReferenceSuggest(...)` in [AsideView.ts](../../src/ui/views/AsideView.ts)
- shared insertion logic in `appendMentionedReference(...)` in [sidebarDraftEditor.ts](../../src/ui/views/sidebarDraftEditor.ts)
- picker opening in `openSideNoteReferenceSuggestModal(...)` in [AsideView.ts](../../src/ui/views/AsideView.ts)

But the picker currently filters out same-file results in [SideNoteReferenceSearchIndex.ts](../../src/index/SideNoteReferenceSearchIndex.ts).

### Persisted Card Actions

The active persisted card now renders both `Link side note` and `Move to another file` in [sidebarPersistedComment.ts](../../src/ui/views/sidebarPersistedComment.ts).

Current behavior:

- `Link side note` appears to the left of `Move to another file`
- clicking it starts inline edit for that comment, opens the picker, and appends into the `Mentioned:` section
- this action currently applies to the parent/root persisted card, not child entries

### Thought Trail

Thought Trail currently uses one graph:

- file-level edges
- recursive cross-file expansion
- same-file references are not represented as graph edges

That is implemented through:

- derived references in [sideNoteReferenceIndex.ts](../../src/core/derived/sideNoteReferenceIndex.ts)
- file-level graph lines in [thoughtTrail.ts](../../src/core/derived/thoughtTrail.ts)
- rendering in `renderThoughtTrail(...)` in [AsideView.ts](../../src/ui/views/AsideView.ts)

## Product Decisions

### Decision 1: Local Chains Reuse Side-Note References

Local chaining should not introduce a second local-only link type.

The canonical form remains the existing side-note reference markdown link stored in the entry body.

That means:

- same-file links and cross-file links share one authoring model
- same-file links are still one-way in storage
- incoming local backlinks stay derived, not stored

### Decision 2: `Link side note` Becomes A Persisted Card Action

This has already been implemented and should remain the product direction.

Placement rule:

- show it in the active persisted card footer actions
- place it immediately to the left of `Move to another file`

This keeps related structural actions together:

- `Link side note`
- `Move to another file`

### Decision 3: Active-View Linking Uses The Existing Draft Write Path

This has already been implemented and should remain the write model.

Recommended behavior:

1. start inline edit for that entry if needed
2. open the existing side-note picker
3. insert the chosen reference into the `Mentioned:` section
4. keep the user in the visible edit state

This reuses the existing safe write model and avoids a hidden direct-write path.

### Decision 4: Same-File Notes Must Appear In The Picker

The picker should include notes from the current file as well as other files.

Rules:

- exclude the current thread itself
- exclude child-entry targets from the same thread
- include other threads from the same file
- rank same-file matches above other-file matches when the query quality is otherwise similar

This is the core product unlock for local chaining.

### Decision 5: Remove The Bottom Bookmark Button From Inline Edit View

This has already been implemented and should remain the edit-surface cleanup.

This plan only removes the noisy bottom-row bookmark affordance in edit view.
It does not require removing every bookmark control everywhere else.

Reason:

- the lower edit row is for edit actions, not card-state toggles
- local chaining is more important than duplicating bookmark affordances there
- the edit surface should get simpler, not denser

### Decision 6: Thought Trail Becomes Two Stacked Sections

Thought Trail should render two separate stacked sections instead of one graph block.

Upper section:

- `Local Chain`
- note-level graph
- same-file side notes only
- same-file side-note references only

Lower section:

- existing recursive file-level trail
- cross-file file graph
- current Thought Trail behavior

This preserves the current graph while making local note relationships visible.

### Decision 7: The Two Graphs Use Different Node Models

The upper and lower sections must not share the same node abstraction.

Local Chain:

- node = side note thread in the current file

File Trail:

- node = markdown file

This is important because same-file thread links cannot be expressed cleanly as file nodes.

### Decision 8: Index And Note Thought Trail Should Stay Conceptually Aligned

For normal note sidebars:

- the local chain section uses the current file
- the file trail section uses the current file as the rooted file graph source

For index thought trail:

- if the index trail is rooted to a file, the local chain section should use that root file
- the lower section remains the existing rooted cross-file trail

This keeps the same mental model across both surfaces:

- upper = local note-level chain for the root file
- lower = cross-file recursive trail for the root file

## UX Shape

### Active Card Actions

Active persisted card footer order should become:

- `Link side note`
- `Move to another file`
- existing share / add / retry actions after that

`Move to another file` itself does not change behavior.

### Edit View

Inline edit cleanup:

- remove the bottom bookmark icon from the edit action row
- do not keep a separate `Link side note` button in the draft edit surface
- use the active persisted card action as the entry point into linking

This reduces visual duplication while keeping the write path explicit.

### Link Picker

Picker behavior should become:

- search current-file notes and other-file notes together
- keep the current note thread excluded
- rank strongest matches first
- prefer current-file matches before cross-file matches when relevance is comparable

Recommended suggestion grouping:

- same-file matches first
- other-file matches second

The grouping can be visual or purely ranking-based in V1.

### Thought Trail Layout

Thought Trail should render:

1. `Local Chain`
2. `Thought Trail`

Each section should own its own empty state.

Examples:

- no local chain yet, but cross-file trail exists
- local chain exists, but no cross-file trail yet
- neither exists

The user should not lose one graph just because the other one is empty.

## Data And Architecture Direction

### Reference Search

Extend side-note reference search to allow same-file inclusion.

Likely change:

- add an option such as `includeSameFile`
- keep the self-thread exclusion rule
- prefer same-file matches when enabled

### Local Chain Graph

Add a dedicated local-chain builder instead of forcing same-file links into the file graph.

Recommended source:

- reuse [sideNoteReferenceIndex.ts](../../src/core/derived/sideNoteReferenceIndex.ts)
- derive same-file outgoing edges from the existing reference index

Recommended output:

- Mermaid lines for thread-level nodes
- click targets that open the target side note directly

### File Trail Graph

Keep the current cross-file file graph builder unchanged in principle.

Same-file references should remain excluded from the file graph, because they are already represented in the local chain section.

### Rendering

`renderThoughtTrail(...)` in [AsideView.ts](../../src/ui/views/AsideView.ts) should become a stacked section renderer rather than a single-graph renderer.

Recommended refactor:

- one helper for local-chain rendering
- one helper for existing file-trail rendering
- one wrapper that lays out the two sections and their independent empty states

## Delivery Plan

### Stage 1: Action-Surface Cleanup

Status: complete

- remove the bottom bookmark button from inline edit view
- add `Link side note` to the active persisted card
- place it left of `Move to another file`
- reuse the current draft insertion path

### Stage 2: Same-File Picker Support

- allow same-file notes in the side-note picker
- keep self-thread exclusion
- add ranking that prefers current-file matches
- add tests for same-file inclusion and ranking behavior

### Stage 3: Local Chain Graph

- add a local-chain graph builder for same-file note-level edges
- add note-level click navigation to target side notes
- add tests for same-file chain derivation

### Stage 4: Stacked Thought Trail

- split Thought Trail into `Local Chain` and existing recursive file trail
- support note sidebar rooted rendering
- support index rooted rendering
- add section-specific empty states

### Stage 5: Optional Chain Pinning And Consolidation

For the book-level workflow, a later extension could add a persistent local-chain collection:

- allow pinning notes from the `Local Chain` view
- show pinned local-chain notes as readable cards, not only Mermaid nodes
- support creating or appending to one consolidated page note from that pinned set

Important scope note:

- this is intentionally phase 2 or later
- this is likely not part of the near-term implementation
- the first shipped slice should focus on local chaining, picker support, and the stacked Thought Trail itself

### Stage 6: Polish And Performance

- verify search and graph rendering stay lightweight on large files
- keep list mode unaffected unless the user explicitly opens Thought Trail
- avoid duplicate parsing by reusing the derived reference index

## Acceptance Criteria

- [x] `Link side note` appears in the active persisted card, to the left of `Move to another file`
- [x] inline edit no longer shows the noisy bottom bookmark button
- [x] active-card linking reuses the existing draft insertion path instead of introducing a hidden direct-write path
- [ ] users can link one side note to another within the same file
- [ ] picker results include same-file notes while excluding the current thread
- [ ] same-file links rank ahead of other-file links when relevance is similar
- [ ] Thought Trail renders two stacked sections
- [ ] the upper section shows same-file note-level chains
- [ ] the lower section shows the existing recursive cross-file file trail
- [ ] local-chain clicks open the target side note
- [ ] current cross-file Thought Trail behavior remains intact
- [ ] optional chain pinning and consolidated-note workflows are explicitly deferred from the first implementation

## Open Questions

- final section label copy:
  - `Local Chain` / `Thought Trail`
  - `Local Chain` / `File Trail`
  - `Local Notes` / `Related Files`
- whether the picker should visually separate same-file and cross-file matches or only rank them
   sections like “This note” and “Other notes”
- whether `Link side note` should be shown for child entries as well as parent thread cards in V1
  no. it should be thread level.
