# Synced Side Note Event Log Spec
status: ignore

## Status

- V1 first-pass implementation exists.
- Goal: sync Aside comments across desktop and mobile without adding visible vault folders or rewriting source note prose for every sidebar operation.
- V1 is not yet a fully observable reliability product surface. It has the sync primitives, but users and support logs still need clearer answers for device backlog, last replay, last hydration, and repair status.

## Implementation Tracking

Use this section as the Kiro-style working checklist. Mark an item done only after the code is merged and the listed verification passes. Keep the explanatory sections below as the design reference, not the task tracker.

### V1 Core Sync

- [x] Store side-note sync state in plugin `data.json` under `sideNoteSyncEventState`.
- [x] Keep local sidecar JSON as the hot cache under `.obsidian/plugins/aside/sidenotes/...`.
- [x] Use one event log per device with logical clocks.
- [x] Track processed watermarks per processing device.
- [x] Track compacted watermarks per event device.
- [x] Store materialized note snapshots for compacted log prefixes.
- [x] Generate compact event inputs from local thread diffs.
- [x] Append local mutation events into the current device log.
- [x] Mark the current device's own local events processed after writing them.
- [x] Replay retained remote events into local sidecar cache.
- [x] Hydrate missing or stale local sidecars from compacted snapshots.
- [x] Refresh from latest plugin data before sidebar and index comment loads.
- [x] React to `Plugin.onExternalSettingsChange()` by replaying synced side-note data.
- [x] Migrate existing local sidecars into synced plugin data per device.
- [x] Support rename and delete events across synced devices.
- [x] Preserve overwritten same-entry concurrent edits as recovery entries.
- [x] Verify V1 with `sideNoteSyncEvents.test.ts`, `commentPersistenceExternalSync.test.ts`, `refreshCoordinator.test.ts`, and `pluginStartupOrder.test.ts`.

### Reliability Hardening

#### Device Status and Backlog

- [ ] Add a synced device-status state object separate from the event log.
- [ ] Compute per-device retained-event backlog from device logs, processed watermarks, and compacted watermarks.
- [ ] Detect compacted prefixes that require snapshot hydration before they can be considered processed.

#### Status Write Cadence

- [ ] Write device status on plugin load after reading latest plugin data.
- [ ] Write device status after local mutation events are persisted.
- [ ] Write device status after remote replay, snapshot hydration, and replay errors.
- [ ] Add low-churn active refresh: while Aside is active, refresh status every 2-5 minutes only when computed status changed.
- [ ] Pause heartbeat-only status writes while the app is idle and no sync state changed.
- [ ] Refresh latest plugin data, replay/hydrate, recompute backlog, and write status on the next Aside activity after idle.

#### Diagnostics

- [ ] Add user-facing sync diagnostics showing known devices, last status time, latest written clocks, processed watermarks, backlog counts, hydration status, and last replay error.
- [ ] Add support-report sync diagnostics with the same fields.

#### Repair

- [ ] Add a repair command that rebuilds local sidecars from synced snapshots and retained events.
- [ ] Make repair recompute the aggregate index from rebuilt sidecars.
- [ ] Make repair report skipped notes when source files are missing or snapshot anchors are incompatible.
- [ ] Require explicit confirmation before repair deletes or prunes synced plugin data.

#### Product Guidance

- [ ] Add settings/help copy that explains cross-device sync depends on plugin `data.json` being synced by Obsidian Sync or another vault sync system.
- [ ] Decide on a fallback only if plugin `data.json` sync is proven unreliable enough to need one.

## Product Decision

Use Obsidian-synced plugin `data.json` as the first sync transport.

Do not create any extra visible vault folder for V1. Also do not create one markdown file per side note or per source note.

The only persisted local comment files remain the existing plugin-sidecar cache under the plugin directory. That cache is local implementation detail, not product-facing synced source of truth.

## V1 Implementation Notes

V1 already has the core durability model:

- Local sidecar JSON files are the hot cache and helper-script write surface.
- Synced plugin `data.json` stores `sideNoteSyncEventState`, including per-device logs, processed watermarks, compacted watermarks, and snapshots.
- Startup migration is per device, so one device's migration marker does not prevent another device from publishing its own local sidecar cache into synced plugin data.
- Local mutations write compact events into the current device log, mark the current device's own events processed, update local sidecars, and write snapshots for compaction/hydration.
- `Plugin.onExternalSettingsChange()` reloads synced plugin data and replays remote side-note events when Obsidian Sync or another external process changes `data.json`.
- Sidebar and index loading paths also refresh latest plugin data before reading comments, so a device can catch up on demand even if the settings-change event was missed.
- A device with no local sidecar cache can hydrate from compacted synced snapshots, then replay retained events.

This is how mobile sees side comments when Obsidian Sync is syncing plugin data: mobile receives the plugin `data.json`, hydrates or replays the side-note state into its own local sidecar cache, then renders from the local cache and in-memory index.

V1 does not use Postgres, SQLite, MongoDB, or a custom Aside server. It is local-first and remote-optional through Obsidian Sync. Unpaid users keep local functionality, but cross-device sync depends on their chosen vault sync system syncing plugin `data.json`.

## V1 Reliability Notes

The current sync state can answer what each known device has written and what the current device has processed:

- `deviceLogs[deviceId].lastClock` is the highest logical clock that device has published into synced plugin data.
- `deviceLogs[deviceId].events` are retained, uncompacted events from that device.
- `processedWatermarks[processorDeviceId][eventDeviceId]` is the highest event clock from `eventDeviceId` that `processorDeviceId` has durably processed.
- `compactedWatermarks[eventDeviceId]` is the highest event clock from `eventDeviceId` that has been compacted into snapshots.
- `noteSnapshots[*].coveredWatermarks` records which compacted event clocks are covered by that materialized note snapshot.

For a specific processor device, the retained-event backlog from another device is:

```ts
const processedClock = Math.max(
  processedWatermarks[processorDeviceId]?.[eventDeviceId] ?? 0,
  compactedWatermarks[eventDeviceId] ?? 0,
);

const missingRetainedEvents = deviceLogs[eventDeviceId].events.filter(
  (event) => event.logicalClock > processedClock,
);
```

If `processedWatermarks[processorDeviceId][eventDeviceId]` is behind `compactedWatermarks[eventDeviceId]`, the processor device must hydrate snapshots before treating that compacted prefix as processed. V1 already has that hydration path, but the plugin does not yet surface the status clearly.

What V1 can infer today:

- which devices are known from logs and watermarks
- the latest clock each known device has published
- which retained events this device has not processed
- which compacted clocks should be covered by snapshots
- whether snapshot hydration or event replay advanced this device's watermarks

What V1 cannot reliably infer today:

- whether another device is currently online
- whether another device has unsynced local sidecar changes that have not reached plugin `data.json`
- whether Obsidian Sync itself has finished uploading or downloading `data.json`
- whether a different device is stuck unless it has written fresh status into synced plugin data

Reliability hardening should add a small synced device-status layer, separate from the event log:

```ts
interface SideNoteSyncDeviceStatus {
  schemaVersion: 1;
  deviceId: string;
  deviceLabel: string;
  updatedAt: number;
  pluginVersion: string;
  lastWrittenClock: number;
  lastReplayStartedAt: number | null;
  lastReplayFinishedAt: number | null;
  lastReplayAppliedEventCount: number;
  lastSnapshotHydratedCount: number;
  lastReplayError: string | null;
  processedWatermarks: Record<string, number>;
  backlogByDevice: Record<string, number>;
}
```

Status write policy:

- Write status on plugin load after reading synced plugin data.
- Write status after local mutation writes events.
- Write status after remote replay or snapshot hydration.
- While the plugin is active, refresh status at a low frequency such as every 2-5 minutes only if the computed status changed.
- Do not keep writing heartbeat-only updates while the app is idle and no sync state changed; avoid unnecessary `data.json` churn.
- On the next user activity that touches Aside, refresh latest plugin data, replay/hydrate if needed, recompute backlog, and write fresh status.

The user-facing diagnostics should show:

- this device id and label
- known remote devices
- last status time per device
- latest written clock per device
- this device's processed watermark for each remote device
- missing retained-event count per remote device
- whether snapshot hydration is needed or recently completed
- last replay error, if any

The repair surface should include:

- rebuild local sidecar cache from synced snapshots and retained events
- recompute the aggregate index from rebuilt sidecars
- show which notes were skipped because the source file is missing or snapshot anchors are incompatible
- avoid deleting synced state as part of repair unless the user explicitly confirms it

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
.obsidian/plugins/aside/data.json
  sideNoteSyncEventState
```

Local cache:

```text
.obsidian/plugins/aside/sidenotes/by-note/<shard>/<noteHash>.json
```

The local cache path is not a user-facing vault folder and is not required as the sync source of truth.

## Product Rules

- Do not create visible sync folders in V1.
- Do not store side-note sync events inside source markdown notes.
- Do not require a hidden `<!-- Aside comments -->` block for the current design.
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
  | "removeThread"
  | "setThreadPinned"
  | "updateAnchor"
  | "moveThread"
  | "moveEntry"
  | "renameSource"
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
- Sync diagnostics can report each known device's latest written clock, this device's processed clock, retained-event backlog count, snapshot hydration status, and last replay error.
- A repair command can rebuild local sidecars from synced snapshots and retained events without deleting synced plugin data.

## Verification Checklist

- [x] Event normalization rejects malformed events.
- [x] Reducer applies events idempotently.
- [x] Local event store appends events under the current device log.
- [x] Local event store marks current-device events processed.
- [x] Remote events stay unprocessed until replay succeeds.
- [x] Replay imports remote device events into local sidecar cache.
- [x] Rename replay writes the new sidecar path and removes the old one.
- [x] Delete replay removes local materialized state.
- [x] Startup migration emits sync events per device.
- [x] Same-entry simultaneous updates resolve deterministically.
- [x] Compaction removes only globally covered prefixes.
- [x] Snapshot hydration rebuilds a missing sidecar cache.
- [ ] Device sync status reports backlog counts from device logs and processed watermarks.
- [ ] Device sync status marks compacted-but-not-hydrated prefixes as requiring snapshot hydration.
- [ ] Device sync status updates after local writes, remote replay, snapshot hydration, and replay errors.
- [ ] Repair rebuilds missing sidecars from snapshots plus retained events without removing synced plugin data.
