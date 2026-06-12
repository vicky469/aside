# Aside Storage

Aside side notes use a two-layer storage model: synced plugin state for cross-device durability, and local sidecar files for fast reads and repair-friendly materialized views.

## Source Of Truth

For synced Aside side notes, the cross-device source of truth is the Aside plugin data file for the current vault:

```text
.obsidian/plugins/aside/data.json
  sideNoteSyncEventState
```

`sideNoteSyncEventState` stores the synced event model:

- per-device event logs
- logical clocks
- processed watermarks
- compacted watermarks
- materialized note snapshots for compacted log prefixes

This is the state Obsidian Sync or another vault sync system must copy between devices. If a backup contains a good version of this file from after comments were written, restoring it should recover the synced side-note state for that vault.

The boundary is the vault. Do not make multiple vaults share one physical Aside plugin folder or one shared `data.json`. Plugin settings are not a global account database; they are vault-local data. Sharing the same plugin data directory across unrelated vaults can overwrite or erase vault-specific side-note state.

## Device Sync

Each device writes its own side-note mutations into that device's log in `sideNoteSyncEventState`. Other devices catch up by receiving the changed `data.json`, replaying retained events, and hydrating from snapshots when older events were compacted.

Typical flow:

1. Desktop writes a side note.
2. Aside updates desktop local sidecars and desktop `.obsidian/plugins/aside/data.json`.
3. Obsidian Sync uploads that plugin `data.json`.
4. Mobile downloads the changed `data.json`.
5. Aside on mobile replays or hydrates the synced state into mobile local sidecars.

The same applies in reverse for mobile writes. If mobile writes while offline, or before its updated plugin `data.json` reaches desktop, then a desktop backup does not yet contain that mobile data. The mobile device should still have its own local plugin `data.json` and sidecar cache until they are deleted or overwritten.

What can be known from synced state:

- which devices have published logs
- the latest logical clock each device has written
- which retained events a device has not processed
- whether compacted clocks require snapshot hydration

What cannot be known from synced state alone:

- whether another device is currently online
- whether Obsidian Sync has finished uploading or downloading
- whether another device has unsynced local sidecar changes that never reached its local plugin `data.json`

## Local Caches

Aside also stores local sidecar cache files under the plugin directory:

```text
.obsidian/plugins/aside/sidenotes/by-note/...
.obsidian/plugins/aside/sidenotes/by-source/...
```

These files are fast local materialized views, not the cross-device source of truth.

- `by-note/` is keyed by note path hash and supports normal sidebar reads.
- `by-source/` is keyed by stable source id and helps with rename/source recovery.

If these caches are stale or missing, Aside should rebuild them from `sideNoteSyncEventState` by hydrating snapshots and replaying retained events. If `data.json` is missing or older than the cache, sidecars may still be useful for local recovery on that device, but they should not be treated as the canonical synced backup.

`Aside index.md` is derived output. Use it for discovery only, not as storage.