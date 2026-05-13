# Source Note Rename Sidebar Recovery

## User-facing Problem

Aside sidebars can appear lost after a source markdown file is renamed, especially when the rename happens outside the exact local Obsidian runtime that owns the current sidecar cache.

Observed examples:

- old book note path:
  `books/The Goal_ A Process of Ongoing Improvement - Revised 3rd -- Eliyahu M_ Goldratt, Jeff Cox, Ensemble cast, Dwight Jon -- Revised 3rd Edition, 2006 -- isbn13 9781598870640 -- 95f4f3be72ed3c91ea065d8eb808b566 -- Anna's Archive.md`
- new book note path:
  `books/The Goal.md`

The sidebar for `books/The Goal.md` initially appeared empty even though the old local cache still contained the correct 111 threads.

A separate note also existed:

`Notes/The Goal - A Process of Ongoing Improvement.md`

That separate note had only 3 threads and different content. A title-based recovery heuristic incorrectly attached those 3 threads to `books/The Goal.md` before we repaired it.

A later false recovery attached the 111 `The Goal` threads to unrelated books including:

- `books/The Effective Executive.md`
- `books/Shipping greatness.md`
- `books/Modeling in Event-B.md`
- `Aside index.md`

The false match happened because generic anchors such as `## Chapter 1` and `## Chapter 2` appeared in multiple books and were counted as proof that the files were the same source.

## Root Cause

The current sync/cache identity is still path-first.

Sidecar storage is keyed by the hash of the markdown path:

```text
.obsidian/plugins/aside/sidenotes/by-note/<shard>/<pathHash>.json
```

Synced snapshots are also keyed by note path hash:

```ts
interface SideNoteSyncNoteSnapshot {
  notePath: string;
  noteHash: string;
  updatedAt: number;
  coveredWatermarks: Record<string, number>;
  threads: CommentThread[];
}
```

When a source note is renamed, the logical comment surface is the same, but the storage key changes. If the rename event is not observed locally or is not represented in synced plugin data, the new path can no longer find the old sidecar by direct lookup.

The data is not necessarily lost. It can be orphaned under:

- old path-hash sidecar files
- old path-hash synced snapshots
- old cache files

## Why Title Matching Is Unsafe

Title or basename matching is not a stable identity mechanism.

In the incident above, both of these notes were plausible title matches:

- `books/The Goal.md`
- `Notes/The Goal - A Process of Ongoing Improvement.md`

But they are different notes with different content and different sidebars.

The rule must be:

- never auto-recover from another markdown file that still exists
- never treat same title or similar basename as proof of identity
- only use title/basename as a last-resort legacy signal after stronger checks pass

## Partial Solution Already Implemented

### Focused Sync Polling

The plugin now polls focused/sidebar-visible files more frequently and replays synced side-note events only for those active files.

Files involved:

- [main.ts](/Users/wenqingli/Obsidian/dev/Aside/src/main.ts)
- [workspaceViewController.ts](/Users/wenqingli/Obsidian/dev/Aside/src/app/workspaceViewController.ts)
- [commentPersistenceController.ts](/Users/wenqingli/Obsidian/dev/Aside/src/comments/commentPersistenceController.ts)

This improves perceived mobile-to-desktop latency because the open note does not wait for a broad full replay.

### Refresh Latest Plugin Data Before Sidebar Load

Sidebar load now refreshes the latest persisted plugin data before replaying sync state for the active file.

This reduces stale desktop cache behavior when mobile has already written newer plugin data.

Files involved:

- [sideNoteSyncEventStore.ts](/Users/wenqingli/Obsidian/dev/Aside/src/sync/sideNoteSyncEventStore.ts)
- [commentPersistenceController.ts](/Users/wenqingli/Obsidian/dev/Aside/src/comments/commentPersistenceController.ts)

### No-op Watermark Writes

`markWatermarksProcessed()` now skips writing when no watermark advances.

This avoids unnecessary `data.json` churn during frequent focused polling.

File involved:

- [sideNoteSyncEventStore.ts](/Users/wenqingli/Obsidian/dev/Aside/src/sync/sideNoteSyncEventStore.ts)

### Rename Event Handling For Normal Obsidian Renames

The plugin already listens to Obsidian vault rename events and moves sidecar storage from the old path hash to the new path hash when the rename is observed locally.

Files involved:

- [main.ts](/Users/wenqingli/Obsidian/dev/Aside/src/main.ts)
- [pluginLifecycleController.ts](/Users/wenqingli/Obsidian/dev/Aside/src/app/pluginLifecycleController.ts)
- [commentPersistenceController.ts](/Users/wenqingli/Obsidian/dev/Aside/src/comments/commentPersistenceController.ts)
- [sidecarCommentStorage.ts](/Users/wenqingli/Obsidian/dev/Aside/src/core/storage/sidecarCommentStorage.ts)

This covers the clean case:

1. Aside is active.
2. Obsidian emits a rename event.
3. The old sidecar exists locally.
4. Aside moves it immediately and writes a `renameNote` sync event.

### Safer Legacy Rename Recovery

The recovery heuristic now only considers snapshots whose old `notePath` no longer exists.

This prevents the bad case where `books/The Goal.md` steals comments from `Notes/The Goal - A Process of Ongoing Improvement.md` just because the names are similar.

File involved:

- [commentPersistenceController.ts](/Users/wenqingli/Obsidian/dev/Aside/src/comments/commentPersistenceController.ts)

Regression coverage:

- [commentPersistenceExternalSync.test.ts](/Users/wenqingli/Obsidian/dev/Aside/tests/commentPersistenceExternalSync.test.ts)

The tests now cover both:

- do not recover when the matching old source note still exists
- recover when the old source path is missing
- do not recover from generic chapter headings alone
- do not hydrate incompatible compacted snapshots into an existing source file

## Source Identity Implementation

The current implementation now has a stable source-note identity layer.

Implemented pieces:

- stable `sourceId`
- current-path `path -> sourceId` index
- old-path aliases retained on source records for explicit rename/recovery paths only
- content fingerprint storage for opened notes
- source-ID keyed sidecar files under `sidenotes/by-source`
- compatibility writes to old path-hash sidecars under `sidenotes/by-note`
- cache-only orphan recovery when the old path is missing and anchors match the target note
- `renameSource` sync events that carry `sourceId`, `previousPath`, and `nextPath`

Files involved:

- [sourceIdentityStore.ts](/Users/wenqingli/Obsidian/dev/Aside/src/sync/sourceIdentityStore.ts)
- [sidecarCommentStorage.ts](/Users/wenqingli/Obsidian/dev/Aside/src/core/storage/sidecarCommentStorage.ts)
- [commentPersistenceController.ts](/Users/wenqingli/Obsidian/dev/Aside/src/comments/commentPersistenceController.ts)
- [sideNoteSyncEvents.ts](/Users/wenqingli/Obsidian/dev/Aside/src/core/storage/sideNoteSyncEvents.ts)
- [main.ts](/Users/wenqingli/Obsidian/dev/Aside/src/main.ts)

Regression coverage:

- [sourceIdentityStore.test.ts](/Users/wenqingli/Obsidian/dev/Aside/tests/sourceIdentityStore.test.ts)
- [sidecarCommentStorage.test.ts](/Users/wenqingli/Obsidian/dev/Aside/tests/sidecarCommentStorage.test.ts)
- [commentPersistenceExternalSync.test.ts](/Users/wenqingli/Obsidian/dev/Aside/tests/commentPersistenceExternalSync.test.ts)

Remaining hardening:

- use the stored content fingerprint as a stronger recovery signal once enough migrated records have it
- add richer ambiguous-recovery diagnostics in the UI, not just logs
- eventually reduce compatibility dependence on path-hash sidecars after the source-ID storage has been in use for a while

## Implemented Design

Use a stable source identity instead of treating the markdown path as the identity.

Synced model:

```ts
interface SourceIdentityState {
  sources: Record<string, SourceIdentityRecord>;
  pathToSourceId: Record<string, string>;
}

interface SourceIdentityRecord {
  sourceId: string;
  currentPath: string;
  aliases: string[];
  contentFingerprint: string | null;
  createdAt: number;
  updatedAt: number;
}
```

The source ID is the identity of the logical note/comment surface. The path is only the current location.

Example:

```json
{
  "sources": {
    "src_abc123": {
      "sourceId": "src_abc123",
      "currentPath": "books/The Goal.md",
      "aliases": [
        "books/The Goal_ A Process of Ongoing Improvement - Revised 3rd -- ... -- Anna's Archive.md"
      ],
      "contentFingerprint": "fingerprint_...",
      "createdAt": 1777680000000,
      "updatedAt": 1777685333000
    }
  },
  "pathToSourceId": {
    "books/The Goal.md": "src_abc123"
  }
}
```

Aliases are intentionally not normal lookup keys. If an old path is later recreated as a different markdown file, it must get its own source ID instead of inheriting the renamed file's sidebar.

## Sidebar Lookup

Normal sidebar lookup is now:

```text
current markdown path -> sourceId -> threads
```

Lookup order:

1. Resolve `sourceId` by exact current path.
2. Read sidecar/snapshot by `sourceId`.
3. Fall back to the old path-hash sidecar for compatibility.
4. If still missing, run bounded legacy recovery.

The normal source-ID sidecar path is O(1). Legacy snapshot/cache scanning only runs when the current note has no source sidecar, no path sidecar, and no inline Aside threads.

Old aliases are used for explicit rename handling and recovery decisions, not as a normal sidebar lookup path for an existing markdown file.

## Rename Sync

Rename events are now source-ID based:

```ts
interface RenameSourceEvent {
  op: "renameSource";
  sourceId: string;
  previousPath: string;
  nextPath: string;
}
```

When desktop receives a mobile rename, it should not guess by title. It should simply update:

```text
sourceId src_abc123 currentPath = books/The Goal.md
aliases += previousPath
```

## Legacy Self-heal Rules

Legacy recovery is still needed for data created before `sourceId` exists.

It should be safe and bounded:

1. Exact path sidecar wins.
2. Existing `pathToSourceId` wins.
3. Old aliases are considered only inside explicit rename/recovery paths.
4. Legacy snapshot/cache recovery may attach orphaned threads only when:
   - old source path no longer exists
   - candidate has non-empty threads
   - distinctive selected-text anchors match the target file
   - generic headings such as `## Chapter 1` do not count as distinctive anchors
   - content fingerprint matches the target file, or the candidate is otherwise uniquely tied by explicit rename event/history
   - there is exactly one candidate
5. If multiple candidates match, do not recover automatically. Log an ambiguous recovery warning and leave the sidebar unchanged.
6. If the old source path still exists, do not recover automatically.

## Content Fingerprint

A content fingerprint should be resilient to filename changes but specific enough to avoid same-title collisions.

Candidate approach:

- normalize the first several KB of markdown body
- strip the Aside managed block
- include heading structure and stable text shingles
- ignore path and minor whitespace differences

The fingerprint should be stored with the source identity and refreshed opportunistically when the note is opened or written.

## Performance Expectations

Normal sidebar load:

- exact path/source ID lookup
- read one sidecar
- targeted sync replay for that file/source

Background self-heal:

- debounced
- capped per run
- only scans legacy cache/snapshots when a sidebar path is missing identity or sidecar
- never blocks the main sidebar render for a broad vault scan

## Migration Plan

1. Add source identity state to plugin `data.json`. Done.
2. On startup, create source IDs for existing sidecars and snapshots. Done.
3. Preserve old path hashes as aliases. Done.
4. Change sidecar storage to resolve by source ID while keeping old path-hash reads as fallback. Done.
5. Change sync events to carry `sourceId` in addition to path during a compatibility period. Done for rename via `renameSource`.
6. Add `renameSource` events and map existing `renameNote` events into source identity updates. Done.
7. Add legacy cache/snapshot orphan recovery with strict ambiguity checks. Done.
8. Once migration is stable, make path-hash storage purely compatibility fallback. Future hardening.

## Acceptance Criteria

- Renaming a source note inside Obsidian preserves the sidebar immediately.
- Renaming a source note on mobile syncs to desktop without the sidebar disappearing.
- Renaming a source note outside Obsidian self-heals on first open without stealing comments from another existing same-title note.
- Sidebar load remains fast for large vaults.
- Legacy cache-only data, like the recovered `The Goal` 111-thread cache, can be attached automatically when the old path is gone and the target identity is unambiguous.
- Ambiguous recoveries do not mutate user data automatically.

## Current Status

Current state is source-identity-first with path-hash compatibility fallback.

Implemented:

- focused active-file sync polling
- latest persisted plugin-data refresh before sidebar load
- no-op watermark write guard
- normal Obsidian rename sidecar move
- stable source identity state
- aliases retained for explicit rename/recovery without normal lookup hijacking
- source-ID sidecar storage
- content fingerprint storage for opened notes
- cache-only orphan recovery using missing-old-path plus anchor-content matching
- generic heading anchors ignored during legacy recovery
- incompatible snapshot hydration skipped for existing files
- `renameSource` sync events
- regression tests for ambiguous same-title recovery, generic-heading false recovery, incompatible snapshot hydration, and legacy cache recovery

The next substantial work should be hardening and observability, not more title-based recovery heuristics.
