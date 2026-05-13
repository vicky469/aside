# Threaded Side Notes PRD

## Status

Draft PRD

Implementation spec:

- [threaded-side-notes-spec.md](threaded-side-notes-spec.md)

## Summary

Aside should evolve from:

- one anchor or page note = one comment body

to:

- one anchor or page note = one parent thread
- one parent thread can have 0 or many child entries

The target interaction is closer to Slack than to independent standalone comments:

- one thread header anchored to a source location or page
- 0 or many child entries inside it
- newest entries appended to the same thread
- no nested reply trees

The intended shape is:

- Slack-like data model
- one-level threaded visual presentation in the sidebar
- not true Reddit-style reply trees

This must preserve both existing note types:

- page note
- anchored note

## Problem

The current model is too flat.

Today, every side note is stored and rendered as a single comment object:

- one `id`
- one `selectedText` / anchor
- one `comment` body
- one `timestamp`
- one `resolved` flag

That creates product and UX limits:

1. Follow-up discussion becomes awkward.
   Users must edit the original note instead of replying under it.

2. Repeated thoughts on the same anchor create fragmentation.
   Users either overwrite old content or create separate comments that conceptually belong together.

3. The UI does not reflect conversation flow.
   The product feels like isolated sticky notes, not an evolving review thread.

4. Resolution semantics are too coarse.
   We currently resolve one comment body, not a full conversation.

## Product Goal

Make Aside threads feel like:

- one discussion per anchor or page note
- many short entries over time
- clear chronological flow
- lightweight enough to remain useful inside a sidebar
- bounded enough to stay readable at card level

## Non-Goals

Not in phase 1:

- nested replies
- branching conversations
- multi-author identity model
- reactions, emoji, mentions metadata beyond existing text handling
- per-entry resolved state
- partial thread resolution
- live collaborative presence

## Users and Scenarios

### Primary users

- solo note-takers reviewing a document over time
- people iterating with AI agents on a note
- users adding follow-up entries to the same anchor or page note

### Key scenarios

1. Anchored discussion
   User highlights text, creates a side note, then adds more entries later under the same anchor.

2. Page-level discussion
   User creates a page note and keeps a running thread for overall file-level observations.

3. Review loop
   User reopens a previous note and adds another entry instead of editing history away.

4. Index review
   In `Aside index.md`, each row still corresponds to a thread anchor, but the sidebar card shows thread context and multiple entries.

## Product Principles

1. Anchor or page first
   A thread belongs to one page-note target or one anchored target.

2. Flat thread, not tree
   Slack-like thread, not Reddit-like nesting.

3. One visual level only
   Child entries may be visually indented under the parent, but there is no reply-to-reply nesting.

4. Preserve history
   Adding another entry should not rewrite earlier entries.

5. Thread-level identity
   The anchor identity belongs to the thread, not to each entry.

6. Parent owns resolution
   Resolve / reopen belongs only to the parent thread header, never to child entries.

7. Lightweight in sidebar
   The sidebar must remain fast and readable.

8. Short by default
   Every side comment body should stay concise enough to scan in the sidebar.

## Desired UX

### Thread creation

For both page notes and anchored notes:

- creating a new note creates a new thread
- the first message becomes the first thread entry

### Thread display

Each sidebar card becomes a thread card:

- thread header:
  - page note or anchored label
  - source file context where applicable
  - thread metadata
  - resolve / reopen action
- thread body:
  - ordered list of child entries
  - child entries visually grouped under the parent with one level of indentation
  - oldest to newest, or collapsed summary with expansion depending on density

### Add-entry flow

Inside a thread card:

- user can add another entry from the parent card
- that entry may function as a reply or simply as a continuation
- the new entry is appended to the same thread
- thread stays associated with the same source anchor or page note

### Entry length

For readability, every side comment body should use the same cap:

- 500 words maximum per entry
- applies to the first thread entry and every later child entry
- composer should show a live word count
- save action should be blocked when the draft exceeds the cap

### Resolution

Phase 1:

- resolve at thread level
- resolve / reopen shown only on the parent thread header
- child entries have no resolve icon
- reopening restores the whole thread

### Index behavior

`Aside index.md` and index sidebar still organize by thread anchor:

- page note thread = one page-note thread
- anchored thread = one anchored thread

The index does not need to list every entry as a separate target in phase 1.

## Current Model

Current canonical model:

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

Current storage assumption:

- one stored object = one displayed note

That assumption must change.

## Proposed Data Model

### Canonical thread model

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

### Ownership rules

- thread owns anchor identity
- entries do not own independent anchors
- thread resolution is a thread property
- child entries do not carry independent resolved state
- orphaned is a thread property

### Why this model

This preserves current anchor behavior while adding conversational history.

It avoids:

- duplicating anchor metadata across replies
- pretending replies are separate anchored comments
- breaking page-note semantics
- letting one card turn into an unreadable wall of text

## Migration Strategy

Every existing `Comment` becomes one `CommentThread`:

- thread id = old comment id
- thread anchor fields = old comment anchor fields
- thread `entries = [{ id: oldComment.id, body: oldComment.comment, timestamp: oldComment.timestamp }]`
- `createdAt = old comment.timestamp`
- `updatedAt = old comment.timestamp`

This gives a deterministic one-time migration path.

## Scope

### In scope

- canonical thread data model
- storage migration from comment to thread
- sidebar thread rendering
- add-entry flow
- thread-level resolve / reopen
- index note and index sidebar adapting to threads
- thread-aware draft flow

### Out of scope

- nested replies
- author identity
- per-entry delete history UI
- undo/redo redesign
- collaborative merge semantics

## Product Rules

### Rule 1: One anchor or page target creates one thread

A new note on a new anchor/page creates a new thread.

### Rule 2: Entries append to existing thread

Appending another entry never creates a second anchor identity.

The UI can label this action as `+`, `Add entry`, or `Reply`, but the model is the same:

- append another entry inside the existing parent card
- keep one thread identity for the anchor or page

### Rule 3: Page notes stay page notes

A page note thread is still page-scoped, not text-anchored.

### Rule 4: Anchored notes stay anchored notes

An anchored thread keeps its original anchor semantics and orphaning behavior.

### Rule 5: Resolution is thread-level in phase 1

If a thread is resolved, all its entries are hidden under resolved-only mode.

Resolve / reopen exists only on the parent thread header.
Child entries never expose their own resolve controls.

### Rule 6: Index identity is thread-level

Index rows map to threads, not to individual entries.

### Rule 7: All side comment bodies share one readability cap

Every side comment body is capped at 500 words.

This applies to:

- the initial body that creates a new card/thread
- every later child entry appended inside that card/thread

## UI Requirements

### Sidebar card

Each persisted card should show:

- thread header
- child entries
- add-entry action
- edit latest or thread-level actions as defined later
- resolve / reopen only in the thread header

### Entry rendering

Entries should be visually lighter than independent cards:

- shared card container
- each entry separated by spacing or divider
- timestamps per entry
- no resolve icon on child entries
- no reply-to-reply indentation levels beyond the single parent -> child presentation

Composer behavior should reinforce readability:

- live word count
- visible 500-word maximum
- disabled save once over limit

### Draft behavior

We likely need two draft modes:

- new thread draft
- add-entry draft

Phase 1 requirement:

- only one active draft at a time is acceptable
- but the draft must know whether it is creating a new thread or appending to an existing one

## Index Requirements

### Generated note

`Aside index.md` should continue to be thread-oriented:

- one row block per thread
- thread row still highlights correctly
- thread preview may show:
  - first entry only
  - or last entry plus count

Recommended phase 1 summary:

- show latest entry preview
- show thread count, e.g. `3 notes`

### Index sidebar list

The list should show threads, not individual entries as separate cards.

### Thought Trail

Thought trail graph should remain thread/file scoped.
Entry count should not multiply graph edges.

## Event Model

### Main events

1. `CreateThread`
2. `ReplyToThread`
3. `EditThreadEntry`
4. `ResolveThread`
5. `ReopenThread`
6. `DeleteThread`
7. `RetargetThreadAnchor`
8. `MigrateCommentToThread`

### Event discipline

- `ReplyToThread` must not change anchor identity
- `ResolveThread` must not delete entries
- `ResolveThread` changes only the parent thread resolved state
- `RetargetThreadAnchor` updates only thread anchor fields
- `DeleteThread` removes the full thread

## Invariants

These should guide implementation and tests.

1. Every thread has at least one entry.
2. Every thread belongs to exactly one file.
3. Every thread is exactly one of:
   - page note
   - anchored note
4. Entries do not create new anchor identities.
5. Child entries do not carry independent resolved state.
6. Resolve / reopen control exists only on the parent thread header.
7. Thread resolution hides or shows the entire thread as one unit.
8. Index row identity maps to thread id, not entry id.
9. A migrated old comment produces exactly one thread with one entry.
10. No saved side comment body exceeds 500 words.

## Risks

### 1. Model churn

This is a foundational data-model change.
It touches:

- storage
- in-memory manager
- mutation logic
- derived index generation
- sidebar rendering
- draft session state

### 2. Migration correctness

If migration is sloppy, users could lose history or duplicate notes.

### 3. UI density

Threaded cards can become too tall in the sidebar.

The 500-word cap reduces this risk, but threads may still need collapse rules later if many short entries accumulate.

### 4. Reverse navigation assumptions

Current index highlight and reveal paths assume one row maps to one comment body.
They will need thread-level reinterpretation.

## Recommended rollout

### Phase 1: Model and migration

- introduce thread types
- migrate storage
- keep simple thread rendering
- allow add-entry append

### Phase 2: Sidebar UX

- polish thread card layout
- add-entry draft flow
- latest-entry preview and counts

### Phase 3: Index adaptation

- thread-aware index summaries
- thread-aware index/sidebar highlight pairing

### Phase 4: Optional enhancements

- collapse long threads
- per-entry edit/delete
- richer metadata

## Acceptance Criteria

1. Existing users’ comments migrate to threads without data loss.
2. User can create both:
   - page-note thread
   - anchored thread
3. User can add another entry to either thread type.
4. Sidebar renders one card per thread, not one card per entry.
5. Resolving hides a whole thread.
6. Reopening restores the whole thread.
7. `Aside index.md` remains usable and thread-oriented.
8. Index/sidebar pairing still works at thread level.
9. Every saved side comment body is at or under 500 words.
10. The composer exposes word-count feedback before save.

## Open Questions

1. Should the sidebar show all entries by default, or collapse older ones after a threshold?
2. Should edit operate on:
   - latest entry only
   - selected entry
   - full thread composer
3. Should thread preview in the index show:
   - first entry
   - latest entry
   - first + latest
4. Do we want per-entry delete in phase 1, or only thread delete?

## Recommendation

Build this as:

- flat Slack-like threads
- one-level threaded visual presentation
- thread-level anchor identity
- thread-level resolve
- parent-header resolve only
- append-only add-entry model first
- 500-word cap for every side comment body

That gives the product a much better conversation model without forcing nested discussion complexity too early.
