# Threaded Side Notes Spec

## Status

Draft implementation spec based on:

- [threaded-side-notes-prd.md](threaded-side-notes-prd.md)
- [architecture.md](../architecture.md)

## Objective

Implement the threaded side-notes model as one thread per anchor or page target, with one parent card and zero or more appended child entries inside that card.

This spec turns the PRD into concrete implementation requirements for:

- storage
- migration
- in-memory models
- draft state
- sidebar rendering
- index derivation
- tests

## Scope

In scope:

- canonical `CommentThread` and `CommentThreadEntry` model
- migration from legacy flat comments
- one active draft that can target either:
  - new thread
  - append entry
- one card per thread in the sidebar
- 500-word validation for every saved body
- thread-aware index summaries
- thread-level resolve / reopen

Out of scope:

- nested reply trees
- per-entry resolve state
- per-entry author model
- live collaboration
- per-entry delete UI
- collapse/expand policy beyond simple always-expanded rendering

## Product Rules

### Rule 1: One Anchor Or Page Target Maps To One Thread

New capture creates one new thread.
Appending later content reuses that same thread identity.

### Rule 2: Entries Are Append-Only In Phase 1

The first saved body becomes `entries[0]`.
Every later body is appended as a new `CommentThreadEntry`.

### Rule 3: Thread Identity Owns The Anchor

Anchor coordinates, `selectedText`, `selectedTextHash`, `anchorKind`, `orphaned`, and `resolved` belong to the thread, not to each entry.

### Rule 4: Validation Is Shared

Every saved entry body must be at most 500 words, whether it is:

- the first thread entry
- an appended child entry

### Rule 5: Resolve Is Thread-Level Only

Resolve / reopen acts on the thread container only.
Child entries never own independent resolved state.

## Canonical Data Model

```ts
interface CommentThread {
  id: string;
  filePath: string;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  selectedText: string;
  selectedTextHash: string;
  anchorKind?: "selection" | "page";
  orphaned?: boolean;
  resolved?: boolean;
  entries: CommentThreadEntry[];
  createdAt: number;
  updatedAt: number;
}

interface CommentThreadEntry {
  id: string;
  body: string;
  timestamp: number;
}
```

### Draft Model

Recommended draft-session shape:

```ts
type DraftMode =
  | { kind: "new-thread" }
  | { kind: "append-entry"; threadId: string };

interface CommentDraftSession {
  hostFilePath: string;
  mode: DraftMode;
  body: string;
}
```

`DraftSessionStore` must preserve one active draft only.

## Storage Model

Phase 1 should store thread data per source note in one managed file:

- `Aside/index.md`
- `Aside/<note>.sidenote.md`

Each `.sidenote.md` file should keep a minimal markdown shell plus a hidden managed block that contains the canonical thread payload for that source note.

The storage layer must hide the exact file format behind one read/write API.
Callers outside storage should operate on `CommentThread[]`, not raw markdown payloads.

### Storage Requirements

1. Loading a source note's side-note state returns all threads for that note.
2. Writing a mutation rewrites only that source note's `.sidenote.md` file.
3. The source note body must not be rewritten by thread mutations.
4. The hidden managed block must round-trip deterministically.

## Compatibility And Migration

Legacy flat comments must migrate to threads deterministically.

### Legacy Shape

```ts
interface Comment {
  id: string;
  filePath: string;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  selectedText: string;
  selectedTextHash: string;
  comment: string;
  timestamp: number;
  anchorKind?: "selection" | "page";
  orphaned?: boolean;
  resolved?: boolean;
}
```

### Migration Rule

Each legacy `Comment` becomes:

- one `CommentThread`
- with one `entries[0]`
- where `entries[0].id = oldComment.id`
- where `entries[0].body = oldComment.comment`
- where `entries[0].timestamp = oldComment.timestamp`
- where `thread.id = oldComment.id`
- where `createdAt = oldComment.timestamp`
- where `updatedAt = oldComment.timestamp`

### Compatibility Strategy

Use read-compat / write-new behavior:

1. On read, storage accepts both:
   - legacy flat comments
   - threaded payloads
2. In memory, normalize immediately to `CommentThread[]`.
3. On next write, persist only the threaded shape.

This keeps migration incremental and avoids a vault-wide one-shot rewrite.

## Module Ownership

This spec assumes the module boundaries documented in `architecture.md`.

### `src/core/storage/*`

Owns:

- reading `.sidenote.md` managed blocks
- legacy comment compatibility reads
- deterministic threaded writes
- migration normalization

Recommended changes:

- evolve `noteCommentStorage.ts` into thread-aware storage, or
- add a dedicated thread storage module and keep the public storage API thread-first

### `src/commentManager.ts`

Owns:

- in-memory `CommentThread[]`
- grouping threads by file
- mutation helpers for:
  - create thread
  - append entry
  - edit selected entry or latest entry once that policy is chosen
  - resolve thread
  - reopen thread
  - delete thread

Manager invariants:

- every thread has at least one entry
- thread ids stay stable
- appending an entry updates `updatedAt`
- resolving never removes entries

### `src/comments/commentEntryController.ts`

Owns:

- starting a new-thread draft from page or selection capture
- starting an append-entry draft from a thread card
- passing draft mode into `DraftSessionStore`

### `src/comments/commentMutationController.ts`

Owns:

- validating draft body
- choosing create-thread vs append-entry mutation
- enforcing the 500-word rule before persistence
- forwarding successful mutations to persistence and manager

Recommended pure helper:

```ts
interface DraftValidationResult {
  ok: boolean;
  wordCount: number;
  exceedsWordLimit: boolean;
}
```

### `src/comments/commentPersistenceController.ts`

Owns:

- persisting normalized thread state
- refreshing derived index state after mutations
- keeping write ordering safe during migration

### `src/domain/DraftSessionStore.ts`

Owns:

- active draft mode
- current draft body
- current append target thread id when applicable
- saving / pending flags already used by the sidebar

### `src/ui/views/sidebarDraftEditor.ts`

Owns:

- textarea input
- live word count
- visible 500-word limit
- disabled save state when over limit

### `src/ui/views/sidebarDraftComment.ts`

Owns:

- draft-card shell
- mode-aware labels:
  - new thread
  - add entry

### `src/ui/views/sidebarPersistedComment.ts`

Owns:

- rendering one persisted thread card
- rendering ordered entries inside that card
- parent-header actions
- add-entry button placement

### `src/ui/views/AsideView.ts`

Owns:

- section composition
- draft insertion location
- thread-card list rendering
- current file / index-mode branching already handled at view level

### `src/core/derived/allCommentsNote.ts`

Owns:

- `Aside index.md` generation for threads
- latest-entry preview text
- thread count summaries

Recommended phase 1 summary:

- preview from latest entry
- count badge or text such as `3 notes`

### `src/index/AggregateCommentIndex.ts`

Owns:

- aggregate thread indexing across the vault
- index sidebar list input data
- thread-level identity for reveal/highlight pairing

### `src/core/anchors/anchorResolver.ts`

Anchor semantics remain thread-level.
Appending entries must not mutate thread anchor identity.

## UI Behavior

### New Thread Flow

1. User captures page or selection context.
2. `commentEntryController` opens a `new-thread` draft.
3. Saving creates:
   - one thread
   - one initial entry

### Add-Entry Flow

1. User clicks `+` or `Add entry` inside an existing thread card.
2. `commentEntryController` opens an `append-entry` draft for that thread id.
3. Saving appends one new `CommentThreadEntry`.

### Sidebar Card Requirements

Each thread card must show:

- anchor or page-note context
- thread metadata
- ordered entries
- add-entry action
- resolve / reopen at thread header only

Each child entry must show:

- body
- timestamp

Child entries must not show:

- anchor metadata
- resolve control
- nested reply controls

## Index Behavior

Threads, not entries, are the identity unit for:

- `Aside index.md`
- index sidebar list
- reverse highlight / reveal pairing

Index generation should summarize one thread as:

- one row block per thread
- latest-entry preview
- thread entry count

## Validation

### Word Limit

Use a shared helper for both create-thread and append-entry saves.

Requirements:

1. Count words from the current draft body.
2. Save is blocked when count exceeds 500.
3. UI shows live count before save.
4. Persistence layer does not accept invalid drafts even if UI guards fail.

### Minimum Validity

- empty or whitespace-only bodies must not save
- thread must never persist with zero entries

## Test Requirements

Minimum coverage once the source tree is available:

1. legacy flat comment read normalizes to one-thread-one-entry
2. threaded payload round-trips deterministically through storage
3. create-thread save persists one thread with one entry
4. append-entry save updates only the target thread
5. append-entry does not alter thread anchor identity
6. resolve / reopen affects only thread-level state
7. draft validation blocks bodies over 500 words
8. draft UI exposes live word count and disabled save state
9. index generation uses thread identity, latest preview, and count
10. sidebar renders one card per thread, not one card per entry

Recommended existing test files to extend:

- `commentEntryController.test.ts`
- `commentMutationController.test.ts`
- `noteCommentStorage.test.ts`
- `commentLifecycle.test.ts`
- `allCommentsNote.test.ts`
- `sidebarDraftEditor.test.ts`

## Safest Delivery Order

1. Add thread types plus normalization helpers.
2. Make storage read both legacy and threaded payloads.
3. Convert manager state to `CommentThread[]`.
4. Add draft-mode support for `new-thread` vs `append-entry`.
5. Add mutation validation and append-entry persistence.
6. Render thread cards and entry lists in the sidebar.
7. Update index derivation to thread-level summaries.
8. Add migration and regression tests.

## Acceptance Criteria

1. Existing flat comments load as one-entry threads without data loss.
2. New captures save as threads with one initial entry.
3. Existing threads accept appended entries without changing anchor identity.
4. Sidebar shows one card per thread with ordered child entries.
5. Resolve / reopen remains thread-level only.
6. Every saved entry body is at or under 500 words.
7. `Aside index.md` stays usable and thread-oriented.
