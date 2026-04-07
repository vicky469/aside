# Vault Sidebar Storage PRD

## Status

Draft PRD

## Summary

SideNote2 should move canonical side-note storage out of source notes and into a managed folder at the vault root:

- create a vault-root `SideNote2/` folder
- store `SideNote2/index.md` there
- store one flat `.sidenote.md` file per source note that has at least one side note thread
- keep sidebar-file storage similar to today's hidden managed-block approach

This PRD does not replace the thread model from `threaded-side-notes-prd.md`.
It defines where thread data should live so threading remains simple without rewriting the original note.

## Problem

If thread data is stored inside the same Markdown file that the user is annotating, scale and correctness get worse as notes grow:

1. Every reply rewrites the original note.
   Large files become hot write targets.

2. Anchor stability gets harder.
   Side-note writes should not move the text they anchor to.

3. One heavily annotated note becomes harder to parse and sync.
   The note mixes user content with machine-managed discussion state.

4. Threading amplifies the problem.
   A flat single comment may be tolerable inline.
   A growing thread history is not.

## Product Goal

Keep phase 1 storage simple and predictable:

- original notes stay original notes
- side-note data lives in a dedicated managed area
- one source note maps to one sidebar file
- index remains derived and thread-oriented
- Markdown remains inspectable by users in source mode

## Non-Goals

Not in phase 1:

- one file per thread
- database storage
- lazy-loading thread entries
- collapse thresholds for long threads
- collaborative merge resolution redesign
- attachment storage redesign

## Storage Layout

Inside the user vault root:

```text
<vault>/
  SideNote2/
    index.md
    Roadmap.sidenote.md
    2026-04-06.sidenote.md
```

### Rules

- `SideNote2/` is owned by the plugin
- `index.md` is a derived index note
- sidebar files live directly inside `SideNote2/` in phase 1
- each sidebar file stores its canonical payload in a hidden managed block similar to today's note-backed storage
- that payload should stay hidden in normal reading view and remain available in raw markdown / source mode
- if a source note has no threads, it has no sidebar file

## Source-To-Sidebar Mapping

Sidebar files should not mirror the full source note path inside a nested tree.

Phase 1 should prefer a flat layout directly under `SideNote2/`.

Examples:

- source: `Projects/Roadmap.md`
- sidebar: `SideNote2/Roadmap.sidenote.md`

- source: `Daily/2026-04-06.md`
- sidebar: `SideNote2/2026-04-06.sidenote.md`

The sidebar file itself must still store the full source-note path in its managed payload.

If two source notes would otherwise produce the same sidebar filename, the plugin can add a deterministic disambiguation suffix.
The exact suffix scheme can remain an implementation detail for phase 1.

### Why flat files

This better matches the intended user-facing layout:

- `SideNote2/index.md`
- `SideNote2/<note>.sidenote.md`

It also keeps the storage area closer to today's model:

- sidebar data is still markdown-backed
- canonical payload can remain in a hidden managed block
- raw storage is still available in source mode when needed

## Canonical Ownership

For phase 1:

- the source note owns the user content
- the sidebar file owns the side-note threads for that source note
- the index note is derived from sidebar files

The source note must not be rewritten when:

- creating a thread
- replying to a thread
- resolving or reopening a thread
- editing a thread entry

## Data Model Boundary

This PRD assumes the thread model from `threaded-side-notes-prd.md` remains valid:

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
```

The main storage change is:

- many `CommentThread`s for one source note live together in that source note's sidebar file

## Sidebar File Requirements

Each sidebar file should contain:

- a minimal markdown shell
- a hidden managed storage block similar to today's `<!-- SideNote2 comments -->` block
- the source note path it belongs to
- enough metadata to validate format version
- all threads for that source note
- updated timestamp for the file-level payload

Phase 1 requirement:

- exact hidden-block serialization can remain an implementation detail
- but it must round-trip deterministically
- it should follow the same general hidden-storage pattern users already have today
- it should stay out of the normal reading experience
- and it should remain inspectable in source mode
- and it must be safe to rewrite the sidebar file without touching the source note

## Read And Write Model

Keep phase 1 simple:

- when a source note's side notes are needed, load that source note's entire sidebar file
- render all thread entries by default
- write back the same sidebar file on thread mutations
- regenerate or refresh `SideNote2/index.md` from sidebar state

Phase 1 explicitly does not require:

- thread summary loading separate from full entry loading
- thread collapse after a reply-count threshold

## Lifecycle Rules

### Rule 1: First thread creates the sidebar file

If a source note receives its first thread:

- create the corresponding sidebar file
- persist the new thread there
- add the thread to `SideNote2/index.md`

### Rule 2: Entries stay in the same sidebar file

Appending to a thread updates only:

- that source note's sidebar file
- the derived index if summary text or counts changed

### Rule 3: One source note maps to one sidebar file

All threads for a single source note live together in one file in phase 1.

### Rule 4: Rename or move should keep sidebar linkage correct

If the source note moves folders without changing its note name, the plugin should not need to mirror that folder move inside `SideNote2/`.

The important update is the source-path metadata inside the sidebar file.

If the source note renames from:

- `Roadmap.md`

to:

- `Product Roadmap.md`

then the sidebar file may rename from:

- `SideNote2/Roadmap.sidenote.md`

to:

- `SideNote2/Product Roadmap.sidenote.md`

If the source note moves from:

- `Projects/Roadmap.md`

to:

- `Archive/Roadmap.md`

then the sidebar file can remain:

- `SideNote2/Roadmap.sidenote.md`

while its stored source-note path is updated.

### Rule 5: Source deletion does not silently delete discussion

If the source note is deleted:

- keep the sidebar file
- mark affected threads orphaned as needed
- keep them visible in index or orphan workflows until the user resolves or retargets them

### Rule 6: Last thread deletion removes the sidebar file

If the last thread for a source note is deleted:

- delete that source note's sidebar file
- remove the related index content

## Why This Is Better Than Inline Storage

This design improves scale without adding much complexity:

1. Replies no longer rewrite the original note.

2. Anchor offsets in the source note are not shifted by side-note writes.

3. Storage is sharded by source note rather than collapsed into one global file.

4. A heavily annotated note stays isolated to its own sidebar file.

5. The index can stay lightweight and derived.

6. Sidebar-file internals remain similar to today's hidden source-mode storage pattern.

## Tradeoffs

This is not perfect:

- one very active source note can still accumulate a large sidebar file
- rename/move metadata handling must be correct
- filename collision handling must be deterministic

These are acceptable phase 1 tradeoffs because they are materially safer than inline thread storage.

## Future Escape Hatch

If a single source note eventually accumulates too many threads, a future migration can split that one sidebar file further into per-thread files.

That is explicitly not required for this phase.

The important decision now is:

- do not store growing thread history inside the original source note

## Scope

### In scope

- vault-root `SideNote2/` managed folder
- `SideNote2/index.md`
- one sidebar file per source note with side notes
- flat sidebar file layout under `SideNote2/`
- hidden managed-block storage inside sidebar files
- thread persistence in sidebar files
- rename, delete, and orphan lifecycle rules

### Out of scope

- changing the thread UX itself
- nested replies
- virtualization or lazy loading
- collapsing long threads
- per-thread sharding

## Acceptance Criteria

1. SideNote2 creates a vault-root `SideNote2/` folder when needed.
2. `SideNote2/index.md` is stored there.
3. Creating the first thread for a source note creates exactly one sidebar file for that source note directly under `SideNote2/`.
4. Appending to a thread rewrites the sidebar file, not the source note.
5. Multiple threads on the same source note are stored in the same sidebar file.
6. Sidebar-file canonical payload uses a hidden managed-block style similar to today's note-backed storage.
7. That managed payload stays hidden in normal reading view and remains accessible in source mode.
8. Moving a source note does not require a mirrored folder tree inside `SideNote2/`.
9. Deleting a source note does not silently delete its thread history.
10. Deleting the last thread for a source note removes that source note's sidebar file.

## Open Questions

1. What exact hidden managed-block serialization should the sidebar file use for deterministic machine parsing?
2. Should `index.md` be regenerated eagerly on every write, or refreshed opportunistically from in-memory state?
3. How should the UI surface orphaned sidebar files whose source note no longer exists?
4. What deterministic filename-disambiguation scheme should we use if two source notes share the same basename?
5. Do we want a hard safety threshold later for sidebar file size or thread count?

## Recommendation

Adopt this storage design for phase 1:

- vault-root `SideNote2/`
- derived `index.md`
- one flat sidebar file per source note
- hidden managed-block storage inside each sidebar file
- no inline thread storage in the original note
- no lazy-loading or collapse requirements yet

That keeps the implementation simple while avoiding the main scale and correctness problems of storing threaded side notes inside the source Markdown file.

<!-- SideNote2 comments
[
  {
    "id": "4663134d-d808-4261-91bd-e13591588570",
    "startLine": 0,
    "startChar": 0,
    "endLine": 0,
    "endChar": 0,
    "selectedText": "vault-sidebar-storage-prd",
    "selectedTextHash": "30666c851fb87253d7ee6492447dc622fdb935df0180631a7c0e4e7b209229de",
    "anchorKind": "page",
    "entries": [
      {
        "id": "4663134d-d808-4261-91bd-e13591588570",
        "body": "on the original source file, i am expecting this to show on source mode\n```\n\u003c!-- SideNote2 comments\n[\n  {\n    \"id\": \"lg-g01-isolated-c01-n01\",\n    \"startLine\": 0,\n    \"startChar\": 0,\n    \"endLine\": 0,\n    \"endChar\": 0,\n    \"selectedText\": \"g01-isolated-c01-n01\",\n    \"selectedTextHash\": \"3e9bf9289db750359c4bef054a7e95a79ba6c0b3\",\n    \"comment\": \"Synthetic graph fixture for isolated-size-1-component-01.\\nPattern: isolated.\\nConnected component size: 1.\\nNo outgoing wiki links from this note.\",\n    \"timestamp\": 1767226520000,\n    \"anchorKind\": \"page\"\n  }\n]\n--\u003e \n```\nexpect replace the detail to the path",
        "timestamp": 1775506293171
      }
    ],
    "createdAt": 1775506293171,
    "updatedAt": 1775506293171
  }
]
-->
