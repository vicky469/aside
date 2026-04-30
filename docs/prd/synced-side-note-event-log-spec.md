# Synced Side Note Event Log Spec

## Status

- Proposed, revised after deciding that event logs are temporary conflict journals.
- Goal: make side comments sync reliably across desktop and mobile without treating event logs as durable storage.

## Problem

Side-note data needs to survive normal Obsidian Sync without requiring users to enable community-plugin data sync. The source markdown note syncs reliably, including on mobile, but repeatedly rewriting the full note for every sidebar operation is expensive and can cause conflicts when two devices edit at the same time.

Plugin JSON sidecars are fast for local UI, but they are not a reliable cross-device source of truth. Long-lived markdown event logs would sync well, but they would add unbounded vault clutter and require replay work that mobile should not pay during normal note use.

## Decision

Use a three-layer model:

1. **Canonical source:** the trailing `<!-- SideNote2 comments -->` block in the source markdown note stores the materialized side-note state for that note.
2. **Hot local cache:** plugin JSON cache stores the same materialized state for fast sidebar startup and note switching.
3. **Temporary per-note event journal:** small markdown journal files in the vault carry unmerged local mutations across devices until the canonical block has absorbed them.

The event journal is not durable storage. After its events are replayed into the canonical block and covered by that block's applied-event watermark, the journal segment is deleted or compacted away.

## Product Rules

- The canonical side-note state for a note lives with that note, in its managed SideNote2 block.
- SideNote2 must never edit source note text outside the managed comments block.
- Normal sidebar reads should use the local JSON cache first.
- Event journals are temporary outbox/conflict files, not the source of truth.
- Prefer one journal namespace per source note. Do not use one global log and do not create one log per thread.
- Each device writes only its own journal segment files.
- Sync data must live in a non-hidden vault folder so Obsidian Sync includes it by default, including on mobile.
- The format must be repairable from the source note plus any remaining journal files.

## Non-Goals

- Real-time collaborative editing.
- Perfect CRDT semantics for simultaneous edits to the same entry body.
- Depending on `data.json` or arbitrary plugin sidecar files as the sync source of truth.
- Keeping permanent event history after conflicts are resolved.
- Making temporary journal files pleasant for humans to edit directly.

## Storage Layout

Canonical source per note:

```text
<source-note>.md
  ...
  <!-- SideNote2 comments -->
  <encoded materialized side-note state, including revision metadata>
```

Local hot cache:

```text
.obsidian/plugins/side-note2/cache/<noteHash>.json
.obsidian/plugins/side-note2/outbox/<noteHash>.json
.obsidian/plugins/side-note2/processed/<noteHash>.json
```

Temporary synced journal:

```text
SideNote2/journal/<noteHash>/<deviceId>-000001.md
SideNote2/journal/<noteHash>/<deviceId>-000002.md
```

Rules:

- `noteHash` is the existing normalized note-path hash.
- `deviceId` is a stable UUID stored in plugin settings.
- Do not add a `by-note` level; every child of the journal root is already a source-note namespace.
- Do not nest local cache under `sidenotes`; the plugin id already scopes these files to SideNote2.
- The journal root name is configurable, default `SideNote2/journal`.
- The journal root must not start with `.`.
- Segment files rotate before they exceed a configured limit, initially `64 KB`.
- A segment can be deleted when all of its events are included in the canonical block watermark.
- Orphaned processed segments are harmless and may be cleaned up later.

## Canonical Block Metadata

The SideNote2 block stores materialized threads plus sync metadata:

```ts
interface SideNoteCanonicalBlock {
  schemaVersion: 1;
  noteHash: string;
  notePath: string;
  revisionId: string; // ULID changed on each canonical write
  updatedAt: number;
  appliedWatermark: Record<string, number>; // deviceId -> contiguous logicalClock
  threads: SideNoteThread[];
}
```

Rules:

- `appliedWatermark` is the durable acknowledgement that temporary journal events have been merged.
- A device advances another device's watermark only after applying contiguous events for that device.
- The canonical block can be rebuilt from current block state plus remaining journals; if no journals remain, the block alone is sufficient.

## Event Format

Each event is one markdown line:

```md
%% side-note2-event eyJzY2hlbWFWZXJzaW9uIjoxLCJldmVudElkIjoiMDFI... %%
```

The payload is base64url-encoded canonical JSON.

```ts
interface SideNoteSyncEvent {
  schemaVersion: 1;
  eventId: string;        // ULID, globally unique
  deviceId: string;
  notePath: string;
  noteHash: string;
  logicalClock: number;   // monotonically increasing per note per device
  baseRevisionId: string | null;
  createdAt: number;
  op: SideNoteSyncOp;
  payload: unknown;
}

type SideNoteSyncOp =
  | "createThread"
  | "appendEntry"
  | "updateEntry"
  | "deleteEntry"
  | "setThreadResolved"
  | "setThreadDeleted"
  | "setThreadPinned"
  | "updateAnchor"
  | "moveThread"
  | "moveEntry"
  | "renameNote"
  | "deleteNote";
```

Rules:

- Events are immutable while they exist.
- Event application is idempotent by `eventId` and by `(deviceId, logicalClock)`.
- All object IDs remain stable across devices.
- Timestamps are metadata only; conflict ordering uses `(logicalClock, deviceId, eventId)`.
- Events are retained only until covered by the canonical block watermark.

## Write Path

On local mutation:

1. Read the current canonical block revision for the source note if available.
2. Build a `SideNoteSyncEvent` with the next per-note device `logicalClock`.
3. Persist it to the local outbox.
4. Apply it to the in-memory state and local JSON cache.
5. Flush it to the current device's temporary journal segment for that source note.
6. Re-read the source note, merge the canonical block plus any known journal events, and rewrite only the managed SideNote2 block.
7. Advance the canonical block watermark for every contiguous applied event.
8. Mark outbox events flushed once both journal append and canonical merge have succeeded locally.
9. Delete or compact journal segments whose events are now covered by the canonical watermark.

Crash behavior:

- If Obsidian exits before journal flush or canonical merge, the outbox is retried on next startup.
- The user-visible sidebar remains fast because the cache was already updated.
- If the source note changed outside the SideNote2 block, retry from a fresh read instead of overwriting note content.

Flush behavior:

- Flush immediately for single events.
- Coalesce bursts for up to `250 ms`.
- Rotate segment when the next append would exceed the segment size limit.
- Never rewrite another device's journal segment.

## Read And Replay Path

Startup:

1. Load local JSON caches for fast sidebar startup.
2. Lazily validate the opened note's canonical block against the cache.
3. Scan the opened or changed note's journal folder for unseen segment files or changed active segments.
4. Replay unseen events into the local cache and canonical block reducer.
5. Persist updated cache and processed-event index.

Runtime:

- Watch source markdown changes and journal changes under the sync-journal root.
- For source note changes, parse only the managed SideNote2 block.
- For journal changes, parse only the changed segment files.
- Ignore local events already applied by `eventId` or covered by the canonical watermark.
- Refresh sidebars after canonical block or remote journal replay updates visible threads.

Mobile behavior:

- Mobile should not run a full-vault journal scan on every startup.
- Mobile may lazily scan the journal folder for the currently opened note and perform a low-priority background scan when idle.
- Per-note journals keep mobile work bounded: changing one note does not require parsing unrelated side-note history.
- If mobile edits while offline or before remote changes arrive, its device-specific journal preserves the mutation until merge.

Repair:

- Add command: `SideNote2: Rebuild side-note cache from notes and sync journals`.
- It rebuilds local cache from canonical SideNote2 blocks, then applies any remaining journal events.
- It does not modify source note prose outside the managed block.

## Conflict Model

Primary conflict avoidance:

- Each source note has its own journal namespace.
- Each device writes only its own segment files inside that namespace.
- This avoids ordinary same-file journal conflicts and prevents unrelated notes from blocking each other.

Two devices open at the same time:

- Both devices may update the same source note's SideNote2 block concurrently.
- Each device also writes its mutation to its own journal segment first, so no mutation depends solely on winning the source-note write race.
- When either device later sees the other's block or journal, it replays missing events, rewrites the canonical block, and advances watermarks.
- Once the canonical block contains both devices' events, processed journal segments are removed.

Operation rules:

- `appendEntry` is commutative if entry IDs differ.
- `updateEntry` is last-writer-wins by `(logicalClock, deviceId, eventId)`.
- `deleteEntry` wins over stale `updateEntry`.
- `setThreadDeleted` hides the thread unless a later restore-style event is added.
- Duplicate events are ignored.

V1 limitation:

- Simultaneous edits to the same entry body may lose one edit in the materialized body.
- The losing edit must remain recoverable until compaction; before deleting the journal, surface it as a conflict/recovery entry or keep a compact conflict note in the canonical block.

## Rename And Delete

Rename:

- On local note rename, update the canonical block `notePath` and write a `renameNote` journal event under the old note hash.
- Move the local cache to the new note hash.
- Remote devices reconcile old and new paths when both the note rename and journal event arrive.
- After the new canonical block is written, the old journal namespace may be deleted when covered by watermarks.

Delete:

- On source note delete, write `deleteNote` if possible before the note disappears locally.
- Local cache may be removed after `deleteNote` is applied.
- Temporary journals for deleted notes may be retained for recovery until the user runs a clear/delete-data command.

## Migration

Migration source order:

1. Current plugin JSON sidecar.
2. Existing inline `<!-- SideNote2 comments -->` block.

Migration steps:

1. Generate or load stable `deviceId`.
2. For each existing note sidecar, write or update that note's canonical SideNote2 block with the materialized state.
3. Set the canonical block watermark to include the migration device's snapshot clock.
4. Build the local cache from the canonical block.
5. Record migration completion in plugin settings.
6. Keep old sidecar files as backup for one release.
7. After migration, new writes go through cache, temporary journal, and canonical block merge.

Safety:

- If writing a canonical block fails, leave the old sidecar as canonical for that note and retry later.
- Do not delete old sidecars during the first migration release.
- Do not create permanent migration event logs.

## Performance Targets

- Opening a note with existing side notes should use the local cache and only lazily validate the canonical block.
- Local mutation latency should stay close to current JSON sidecar latency; canonical block merge can complete asynchronously when needed.
- A single journal append should be under `10 ms` on desktop for normal vaults.
- Mobile should only parse journals for opened/changed notes during foreground use.
- A note with no new remote events should not replay any journal.
- Resolved journals should be removed quickly enough that vault clutter remains temporary.

## Implementation Order

1. Add device ID, sync-journal root setting, and per-note logical clocks.
2. Add canonical block revision/watermark metadata.
3. Add event model, parser, encoder, and idempotent reducer.
4. Add outbox and temporary per-note journal writer.
5. Add canonical block merge/write path that preserves source note text outside the block.
6. Add lazy replay scanner and processed-event index.
7. Switch mutation persistence to cache plus journal plus canonical merge.
8. Add journal cleanup for watermark-covered segments.
9. Add migration from current JSON sidecars to canonical blocks.
10. Add repair command.
11. Add diagnostics in support modal: device ID, sync-journal root, pending outbox count, last replay time, and journal cleanup count.

## Acceptance Criteria

- New comments created on device A appear on device B through normal Obsidian Sync without enabling community-plugin sync.
- Existing side-note JSON sidecars migrate into canonical SideNote2 blocks automatically.
- Source note prose is not rewritten for side-note-only operations; only the managed block changes.
- Sidebar load remains cache-backed and does not parse markdown journals on every note open.
- Two devices adding comments to the same note do not overwrite each other.
- Two devices updating the same entry resolve deterministically and preserve the losing body until conflict recovery is available.
- Batch tag changes stay compact and sync through the same event pipeline.
- Temporary journals are deleted or compacted after their events are covered by the canonical block watermark.
- Rebuild command can recreate local cache from canonical blocks plus remaining journals after deleting plugin cache.
- Export feature stash remains unrelated and is not part of this storage migration.

## Tests Required

1. Event encoder/decoder round-trips payloads and rejects malformed lines.
2. Reducer applies events idempotently.
3. Canonical block writer preserves source note text outside the managed block.
4. Per-device append writes only the current device segment for the current source note.
5. Outbox retries unflushed events after restart.
6. Replay imports remote device events into local cache and canonical block.
7. Simultaneous append events from two devices both survive.
8. Same-entry simultaneous updates resolve deterministically and keep the losing body recoverable before cleanup.
9. Stale update after delete does not resurrect deleted content.
10. Migration writes canonical blocks from existing JSON sidecars.
11. Journal cleanup deletes only events covered by canonical watermarks.
12. Repair rebuilds cache from canonical blocks and remaining journals.

## Source Assumptions

- Obsidian Sync syncs markdown notes by default and treats extra file types as selective sync.
- Obsidian Sync handles markdown conflicts differently from other file types; other file types use last-modified-wins.
- Hidden folders are excluded from Sync except the configured Obsidian config folder.
- `Plugin.onExternalSettingsChange` is for `data.json`, not arbitrary plugin sidecar files.

References:

- https://obsidian.md/help/sync/settings
- https://obsidian.md/help/sync/troubleshoot
- https://obsidian-developer-docs.pages.dev/Reference/TypeScript-API/Plugin/onExternalSettingsChange
