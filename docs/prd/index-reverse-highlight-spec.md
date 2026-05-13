# Index Reverse Highlight Spec

## Objective

When the sidebar is showing `Aside index.md`, clicking a persisted sidebar list card must highlight the matching row in `index.md` using the same pairing state as clicking a ref inside `index.md`.

This spec is for highlight synchronization only.

Out of scope for this phase:

- scrolling the index note
- jumping to the index row
- opening the source note from card-body click

The redirect icon remains the only source-note navigation action.

## Product Rules

### Rule 1

If the sidebar current file is `Aside index.md`, card-body click must:

- mark that sidebar card active
- mark the matching rendered row in `index.md` active
- keep revealed state keyed to `index.md`

### Rule 2

If the sidebar current file is not `Aside index.md`, card-body click keeps the current source-note redirect behavior.

### Rule 3

In index mode, the redirect icon continues to open the source note.

### Rule 4

If a sidebar card becomes active programmatically while the sidebar current file is `Aside index.md`, the matching rendered row in `index.md` must also become active.

### Rule 5

This phase must not add scroll, jump, or file-open behavior to the reverse path.

## Existing System To Reuse

The system already has a correct pairing path for clicks inside `index.md`:

1. set revealed state on `index.md`
2. sync rendered row highlight in the index preview
3. sync sidebar active card

This existing path is centered on:

- `main.activateIndexComment(commentId, indexFilePath)`

The reverse highlight feature must reuse this model instead of introducing a second pairing owner.

## State Model

### Source of truth

`revealed = { filePath, commentId } | null`

For reverse highlight in index mode:

- `filePath` must be the current index file path
- `commentId` must be the selected sidebar card id

### Derived UI state

- sidebar active card derives from the active comment id in the sidebar interaction controller
- index row active state derives from the revealed comment id for `index.md`

## Implementation Requirements

### Requirement 1: shared pair sync method

Introduce or expose one method that does only this:

- set revealed state on `index.md`
- sync rendered index highlight

It must not:

- sync the sidebar again
- navigate to the source note
- scroll the index note

### Requirement 2: index-mode card-body routing

In `AsideView.renderPersistedComment(...)`:

- when current sidebar file is `index.md`, card-body click must:
  - mark that card active in the sidebar
  - call the shared pair sync method for `index.md`
- otherwise, keep the existing source-note redirect behavior

### Requirement 3: programmatic sidebar highlight sync

When the sidebar highlights a persisted comment while current file is `index.md`, it must also call the shared pair sync method.

This ensures the pairing stays correct whether the highlight came from:

- clicking an index ref
- clicking a sidebar card
- another existing sidebar-selection path

### Requirement 4: redirect icon split

The redirect icon must remain independent from card-body reverse highlight.

## Non-Requirements

Do not implement in this phase:

- row registry for fast reverse scroll
- metadata line mapping
- native block-jump
- preview rerender forcing

## Acceptance Criteria

### AC1

Open `Aside index.md`, click a ref in the note:

- matching sidebar card is active
- matching row in `index.md` is active

### AC2

With `Aside index.md` still active in the sidebar, click a sidebar card body:

- matching sidebar card is active
- matching row in `index.md` is active
- source note does not open

### AC3

Click the redirect icon on that same card:

- source note opens

### AC4

No scroll or jump occurs in the reverse highlight path added by this spec.

## Test Requirements

Minimum coverage:

1. index-mode card-body routing chooses reverse highlight instead of source redirect
2. non-index card-body routing still chooses source redirect
3. redirect icon path remains source redirect
4. the shared index pair sync method can be called repeatedly without introducing a second owner or loop

## Safest Delivery Order

1. Add a pure routing helper for card-body behavior.
2. Add the shared index pair sync method.
3. Route index-mode card-body click to reverse highlight.
4. Sync programmatic sidebar highlight in index mode through the same shared method.
