# Drag-Nest Anchored Comments Design

## Goal

Let users connect multiple selected-text notes into one thread by dragging an anchored top-level thread under another thread, then reorder the nested points inside that thread.

The intended workflow is:

1. Select text and create a normal anchored side note for the main point.
2. Select more text and create normal anchored side notes for point 1, point 2, point 3.
3. Drag those anchored side notes onto the main thread.
4. Aside converts them into nested entries that keep their own anchors and can be reordered.

## Current Model

`CommentThread` owns the anchor today. `CommentThreadEntry` stores only `id`, `body`, `timestamp`, and optional `deletedAt`.

This means nested entries currently inherit the parent thread anchor. They can be moved between threads, but they cannot preserve their own selected source text after becoming nested entries.

The UI already has a partial drag system:

- page-note threads can reorder;
- nested child entries can move to a different thread;
- `CommentManager.reorderThreadEntries` already supports reordering children within the same thread.

The feature extends these existing paths instead of adding a separate organizer.

## Data Model

Add optional anchor fields to `CommentThreadEntry`.

Recommended shape:

```ts
interface CommentThreadEntryAnchor {
    filePath: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    selectedText: string;
    selectedTextHash: string;
    anchorKind: "selection";
    orphaned?: boolean;
}

interface CommentThreadEntry {
    id: string;
    body: string;
    timestamp: number;
    deletedAt?: number;
    anchor?: CommentThreadEntryAnchor;
}
```

The child anchor is optional. Existing nested replies remain plain replies. Anchored child entries are selection-only for the first version; page-note nesting is out of scope.

## Drag Behavior

Support three drag moves in the current file/sidebar scope:

- Drag an anchored top-level selection thread onto another thread: convert the dragged thread into a nested entry under the target thread.
- Drag a nested child within the same thread: reorder it before or after the target child.
- Drag a nested child onto a different thread in the same file: move it there, preserving any child anchor.

Drop placement is deterministic:

- dropping onto a parent card appends the moved item to the end of that parent thread;
- dropping onto a child card targets that child's parent thread and inserts after that child;
- dragging a child within its current parent uses before/after placement from the child card midpoint.

This keeps nesting one level deep while still allowing precise ordering.

Reject these moves:

- dragging a page-note thread into another thread;
- dragging a thread or child across files;
- dragging into a deleted thread;
- dragging a thread into itself;
- creating deeper nested threads.

When a top-level thread is nested, the original top-level thread disappears and becomes only a child entry under the target thread at the resolved drop position.

## Conversion Rules

When converting a top-level anchored thread into a child entry:

- Use the root entry body as the child body.
- Preserve the dragged thread id as the child entry id.
- Preserve timestamp and deletion metadata from the root entry.
- Copy the dragged thread anchor into `entry.anchor`.
- Move later entries from the dragged thread after the converted root entry, preserving order.
- If later entries already have anchors, preserve them.
- Update the target thread `updatedAt`.
- Remove the source thread from the top-level thread list.

This handles the common case where a user created a point, added a follow-up, then later nests the whole point under a main thread.

## Rendering And Navigation

Parent thread cards keep using the parent thread anchor.

Anchored child entries show a muted selected-text preview so users can distinguish point anchors from plain replies. Clicking an anchored child opens the child anchor in the editor. Plain children keep current behavior and inherit the parent thread context.

Editor highlights include anchored child entries. Active highlighting works by child entry id, just like existing sidebar active-state handling.

The index/sidebar source labels use the child anchor for anchored children and the parent anchor for plain children.

## Persistence And Sync

Sidecar storage and sync event normalization must preserve the optional child anchor. Old records without `entry.anchor` remain valid.

Migration is passive: no rewrite is required until a file is saved. When saved, entries without anchors stay unchanged.

Conflict handling compares child anchor fields when deciding whether entries are equal.

## Testing

Add focused coverage for:

- normalizing and cloning child entry anchors;
- persisting and reading anchored child entries;
- converting a top-level anchored thread into a child entry;
- moving anchored children between same-file threads;
- reordering children within a thread through the UI drop path;
- rejecting page-note, cross-file, deleted-target, self, and deeper-nesting moves;
- rendering child selected-text previews;
- opening an anchored child jumps to the child anchor;
- editor highlight ranges include anchored children.

## Non-Goals

- Multi-level nested threads.
- Nesting page notes.
- Dragging threads across files.
- Creating anchored nested drafts directly from current editor selection.
- Changing the agent reply threading model.
