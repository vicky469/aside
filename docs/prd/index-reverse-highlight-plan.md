# Index Reverse Highlight Plan

## Goal

When the sidebar is showing `Aside index.md`:

- clicking a sidebar list card should highlight the matching row in `index.md`
- the sidebar card and the index row should stay paired
- this should behave like clicking the ref inside `index.md`, but in reverse
- do **not** scroll or jump yet
- the redirect icon remains the only source-note navigation action

This is a highlight-pairing feature only, not a navigation feature.

## Problem Summary

Current behavior is asymmetric:

- `index.md` ref click -> works
  - sets revealed state on `index.md`
  - highlights the matching row in preview
  - highlights the matching sidebar card
- sidebar card click in index mode -> does **not** work this way
  - currently redirects to the source note
  - does not reuse the same index highlight path

So the left-to-right pairing exists, but right-to-left pairing does not.

## Current System

### Existing working path

`index.md` rendered ref click:

1. `commentHighlightController.bindIndexPreviewLinkClicks(...)`
2. `main.activateIndexComment(commentId, indexFilePath)`
3. `commentSessionController.setRevealedCommentState(indexFilePath, commentId, { refreshMarkdownPreviews: false })`
4. `commentHighlightController.syncIndexPreviewSelection(indexFilePath, commentId)`
5. `commentNavigationController.syncSidebarSelection(commentId, indexFile)`

This is already the correct reference behavior.

### Existing missing path

Sidebar card click while sidebar is showing `index.md`:

- `AsideView.renderPersistedComment(...)`
- `activateComment: (persistedComment) => this.interactionController.openCommentInEditor(persistedComment)`

This is temporary. It uses source-note redirect instead of reverse index pairing.

## Root Cause

The system has one good pairing owner already:

- revealed state keyed by `{ filePath, commentId }`

But sidebar card clicks in index mode do not route into that owner. They bypass it and go to source navigation.

So the missing piece is not a new concept. It is a missing route:

- sidebar card click in index mode must set revealed state on `index.md`, not on the source note

## B-Method Style Model

### State

Let:

- `INDEX_PATH` be the current all-comments note path
- `activeSidebarCommentId ∈ COMMENT_ID ∪ {null}`
- `revealed = null ∪ { filePath: PATH, commentId: COMMENT_ID }`
- `renderedIndexRows: COMMENT_ID -> ROW_EL` be a partial map of currently rendered rows in the open index preview

### Invariants

`INV1`
If `revealed.filePath = INDEX_PATH`, then at most one sidebar card is active for `revealed.commentId`.

`INV2`
If `revealed.filePath = INDEX_PATH` and `revealed.commentId` is currently rendered in preview, exactly one rendered row has `aside-index-active-row`.

`INV3`
Clicking the sidebar card body in index mode must not navigate to the source note.

`INV4`
Clicking the redirect icon in index mode may navigate to the source note, but it is not the pairing path.

`INV5`
V1 reverse highlight must not trigger scroll, jump, or preview rerender.

### Operations

`IndexRefClick(commentId)`

- precondition: `commentId` exists in index content
- effect:
  - `revealed := { filePath: INDEX_PATH, commentId }`
  - sidebar active card becomes `commentId`
  - rendered index row becomes active if present

`SidebarCardClickInIndexMode(commentId)`

- precondition: sidebar current file is `INDEX_PATH`
- effect:
  - same state result as `IndexRefClick(commentId)`
  - no source navigation
  - no scroll

`RedirectIconClick(commentId)`

- effect:
  - keep current source-note redirect behavior
  - not part of V1 reverse highlight contract

`PreviewChunkRender(indexPath, rows)`

- effect:
  - register/update `renderedIndexRows`
  - if `revealed.filePath = indexPath`, apply active class to the matching row if it exists

## Subway Lines Model

### Purple Line: index preview ownership

Owned by `commentHighlightController`.

Responsibility:

- normalize index links
- bind index preview clicks
- mark/unmark rendered index rows as active
- eventually keep a lightweight rendered-row registry

### Blue Line: sidebar ownership

Owned by `sidebarInteractionController` and `AsideView`.

Responsibility:

- active card state
- card click routing
- no knowledge of source scrolling for this feature

### Red Line: source redirect ownership

Owned by `commentNavigationController`.

Responsibility:

- redirect icon click
- open source note
- highlight source anchor

### Transfer Station

`main.activateIndexComment(...)` is the shared interchange:

- both index ref click and sidebar card click in index mode should arrive here

This is the safest architecture because the system already trusts this path.

## Simplest Safe V1

### Product behavior

When sidebar current file is `Aside index.md`:

- card body click:
  - activate matching sidebar card
  - activate matching rendered row in `index.md`
  - no scroll
  - no jump
  - no source-note open
- redirect icon click:
  - unchanged
  - open source note

### Implementation shape

1. Keep `main.activateIndexComment(commentId, indexFilePath)` as the single pairing entrypoint.
2. In `AsideView.renderPersistedComment(...)`, when `isIndexView === true`, route `activateComment` to `plugin.activateIndexComment(comment.id, currentFilePath)`.
3. Keep `openCommentInEditor(...)` only on the redirect icon.
4. Reuse `commentHighlightController.syncIndexPreviewSelection(...)`.
5. Reuse `commentNavigationController.syncSidebarSelection(...)`.

This is the smallest change because it uses the already-working left-to-right path in reverse.

## Reverse Map Design

### V1

Do **not** build a new heavy mapping layer first.

Reason:

- `syncIndexPreviewSelection(...)` already:
  - prepares index links
  - finds the rendered row for a `commentId`
  - toggles the correct row class

For highlight-only, that is enough.

### V2 optimization

If we see performance issues later, add:

- `renderedIndexRowsByCommentId: Map<string, HTMLElement>`

Built during markdown post-processing, not during click.

Benefits:

- no repeated query scan on every click
- direct row lookup for active-state sync
- becomes the foundation for future reverse scroll/jump

But this is optimization, not the first fix.

## Performance Rules

### What to do before click

Can be computed once during preview render:

- normalize clickable index refs
- parse comment targets from `data-aside-comment-url`
- optionally register `commentId -> rowEl`

### What to do on click

Should stay O(1) or near O(rendered rows), with no vault reads:

- set revealed state
- sync sidebar active card
- sync rendered index highlight

### What not to do in V1

- no file open
- no scroll
- no metadata cache traversal
- no aggregate note regeneration
- no source anchor resolution

## Edge Cases

### Index preview not currently rendered

If the index preview is not open or the row is not rendered:

- still set sidebar active card
- still set revealed state on `INDEX_PATH`
- do not try to force navigation
- when index preview rerenders later, it should pick up the active row through normal post-processing

### Multiple index leaves

For now, follow the same rule as the current index preview path:

- operate on the active/open index preview context already used by `syncIndexPreviewSelection(...)`

Do not solve multi-index-leaf coordination in V1.

### Redirect icon

Must remain separate from card-body reverse highlight.

This is a strict behavior split.

## Test Plan

### Unit / integration tests

1. Index-mode sidebar card click calls `activateIndexComment(...)`, not `openCommentInEditor(...)`.
2. Redirect icon still calls `openCommentInEditor(...)`.
3. `activateIndexComment(...)` keeps revealed state on `INDEX_PATH`.
4. `syncIndexPreviewSelection(...)` activates only the matching row.
5. `syncSidebarSelection(...)` activates only the matching sidebar card.
6. No scroll method is called in the reverse-highlight path.

### Manual acceptance

1. Open `Aside index.md`.
2. Click an index ref:
   - row highlights
   - matching sidebar card highlights
3. Click a different sidebar card:
   - matching row highlights
   - matching sidebar card highlights
   - no source note opens
   - no scrolling happens
4. Click the redirect icon:
   - source note opens

## Phased Delivery

### Phase 1

Highlight-only reverse pairing.

- route index-mode card click into `activateIndexComment(...)`
- keep redirect icon separate
- no scroll/jump

### Phase 2

Add lightweight rendered-row registry.

- improve efficiency
- reduce DOM scanning
- no behavior change

### Phase 3

Future reverse scroll/jump.

- only after Phase 1 is stable
- built on the same pairing owner and optional row registry

## Recommendation

Start with Phase 1 only.

It is the simplest and safest step because:

- it reuses the already-correct index click path
- it does not invent a second state owner
- it avoids scroll complexity entirely
- it keeps source redirect isolated behind the icon
