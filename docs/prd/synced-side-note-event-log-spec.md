# Synced Side Note Event Log Spec

## Status

- Active first-pass implementation.
- Goal: sync SideNote2 comments across desktop and mobile without adding visible vault folders or rewriting source note prose for every sidebar operation.

## Product Decision

Use Obsidian-synced plugin `data.json` as the first sync transport.

Do not create any extra visible vault folder for V1. Also do not create one markdown file per side note or per source note.

The only persisted local comment files remain the existing plugin-sidecar cache under the plugin directory. That cache is local implementation detail, not product-facing synced source of truth.

## Problem

Moving side notes out of markdown improved performance, but local plugin sidecars do not reliably move across devices unless plugin data sync is available and used correctly.

Writing every side-note mutation back into the source markdown note would be slower and would increase note-content conflicts. Creating visible sync storage would also clutter the vault and add a second user-visible storage surface.

## Decision

Use a two-layer model:

1. **Synced event state:** plugin `data.json` stores compact per-device side-note mutation logs and per-device processed watermarks.
2. **Hot local cache:** existing sidecar JSON stores materialized threads for fast sidebar startup and note switching.

The local cache can be rebuilt by replaying synced events. The event log is the cross-device transport for V1.

## Storage Layout

Synced plugin data:

```ts
interface SideNoteSyncEventState {
  schemaVersion: 1;
  deviceLogs: Record<string, {
    lastClock: number;
    events: SideNoteSyncEvent[];
  }>;
  processedWatermarks: Record<string, Record<string, number>>;
  compactedWatermarks: Record<string, number>;
  noteSnapshots: Record<string, SideNoteSyncNoteSnapshot>;
}

interface SideNoteSyncNoteSnapshot {
  notePath: string;
  noteHash: string;
  updatedAt: number;
  coveredWatermarks: Record<string, number>;
  threads: CommentThread[];
}
```

Stored under:

```text
.obsidian/plugins/side-note2/data.json
  sideNoteSyncEventState
```

Local cache:

```text
.obsidian/plugins/side-note2/sidenotes/by-note/<shard>/<noteHash>.json
```

The local cache path is not a user-facing vault folder and is not required as the sync source of truth.

## Product Rules

- Do not create visible sync folders in V1.
- Do not store side-note sync events inside source markdown notes.
- Do not require a hidden `<!-- SideNote2 comments -->` block for the current design.
- Keep event payloads compact; `data.json` must not become an unbounded database.
- Use one device log per device to reduce JSON merge conflicts.
- Store processed watermarks per processing device.
- Store compacted watermarks globally per event device.
- Keep materialized note snapshots for compacted log prefixes so a device with no sidecar cache can rebuild.
- Keep device IDs stable per local device and outside the synced event log where possible.
- Local sidecar files are cache only. If they are stale or missing, replay synced events.

## Event Format

```ts
interface SideNoteSyncEvent {
  schemaVersion: 1;
  eventId: string;
  deviceId: string;
  notePath: string;
  noteHash: string;
  logicalClock: number;
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

- Events are immutable after writing.
- Event application is idempotent by `eventId` and `(deviceId, logicalClock)`.
- All object IDs remain stable across devices.
- Timestamps are metadata only; replay ordering uses `(logicalClock, deviceId, eventId)`.
- `updateEntry` events include the previous entry snapshot so simultaneous edits to the same body can preserve the overwritten version.

## Write Path

On local mutation:

1. Read the local sidecar state for the source note.
2. Apply the mutation to in-memory state.
3. Diff previous sidecar threads against next threads.
4. Append compact mutation events to the current device log in plugin `data.json`.
5. Mark the current device's own events processed locally.
6. Write the materialized local sidecar cache.
7. Write or refresh a materialized snapshot for the note.
8. Compact processed event-log prefixes when every known device has processed them and snapshots cover every event in the prefix.
9. Refresh sidebar, editor decorations, previews, and aggregate index as needed.

## Remote Replay Path

On startup and `Plugin.onExternalSettingsChange()`:

1. Reload plugin data.
2. Hydrate missing local sidecar cache files from compacted snapshots.
3. Mark compacted log prefixes processed only after snapshot hydration succeeds.
4. Read events whose clocks are above this device's processed watermarks.
5. Group events by source note path.
6. Replay them through the reducer over the local sidecar base.
7. Write the updated local sidecar cache.
8. Refresh loaded note comments and aggregate index.
9. Advance this device's processed watermarks only after replay succeeds.
10. Refresh snapshots and compact any newly covered log prefix.

Rename handling:

- `renameNote` events retarget the materialized sidecar to the new note path.
- The old sidecar namespace is removed locally after the new one is written.

Delete handling:

- `deleteNote` removes local materialized sidecar state for that note.
- Deleted-note events compact only after an empty snapshot covers the deleted note's event-log prefix.

## Compaction

Compaction is prefix-based per event device, not per arbitrary note event.

For each device log:

1. Compute the highest clock every known device has processed.
2. Walk forward from the current compacted watermark.
3. Stop at the first event whose note snapshot does not cover that event clock.
4. Advance the global compacted watermark to the last fully covered clock.
5. Remove only events at or below that compacted watermark.

This avoids the unsafe case where one note snapshot would make a new device skip retained events from a different note.

Snapshots are keyed by the event note hash they cover. For rename replay, a snapshot may cover the old note hash while materializing the threads under the new note path.

## Conflict Recovery

Concurrent updates to the same entry are deterministic:

- Events still apply in `(logicalClock, deviceId, eventId)` order.
- If an `updateEntry` event's `previousEntry` no longer matches the current entry, and both versions changed the body, the later event wins in place.
- The overwritten body is preserved as a stable `sync-conflict-<eventId>` recovery entry in the same thread.
- Existing events without `previousEntry` continue to replay without conflict recovery.

## Migration

Startup migration is per device, not global.

For each device:

1. Scan existing local sidecars.
2. Emit `createThread` events into that device's log for existing materialized threads.
3. Record migration completion under a per-device migration version.

This avoids one device's migration marker causing another device to skip migration of its own local cache.

## Limits And Follow-Up

Follow-ups before calling the sync layer fully mature:

- diagnostics for device ID, event counts, watermarks, and last replay
- repair command to rebuild sidecars from synced plugin data
- explicit fallback decision if plugin data sync is not reliable enough on mobile

Any fallback must be explicitly chosen later. Do not pre-create visible vault storage.

## Acceptance Criteria

- No visible vault folder is created for side-note sync.
- New comments created on device A appear on device B through synced plugin data.
- Existing local sidecars migrate into the synced event log per device.
- Sidebar load remains cache-backed.
- Remote events replay into the local sidecar cache without source-note rewrites.
- Rename and delete events update local cache paths correctly.
- Batch tag changes remain compact and sync through the same event pipeline.
- Event compaction never removes an event unless a snapshot covers every prior event in that device log prefix.
- A device with no sidecar cache can hydrate compacted snapshots and then replay remaining events.
- Same-entry simultaneous body edits keep the deterministic winner and preserve the overwritten body as a recovery entry.

## Tests Required

1. Event normalization rejects malformed events.
2. Reducer applies events idempotently.
3. Local event store appends events under the current device log.
4. Local event store marks current-device events processed.
5. Remote events stay unprocessed until replay succeeds.
6. Replay imports remote device events into local sidecar cache.
7. Rename replay writes the new sidecar path and removes the old one.
8. Delete replay removes local materialized state.
9. Startup migration emits sync events per device.
10. Same-entry simultaneous updates resolve deterministically.
11. Compaction removes only globally covered prefixes.
12. Snapshot hydration rebuilds a missing sidecar cache.
