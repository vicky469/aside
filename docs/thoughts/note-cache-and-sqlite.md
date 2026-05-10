# Note Cache And SQLite

Status: current thinking, 2026-05-09.

This note captures the current answer to a recurring storage question:
what kind of cache does SideNote2 have, and when would SQLite be worth
introducing instead of JSON files?

Related background:

- `docs/reflect/storage-layout-options.md`
- `src/cache/ParsedNoteCache.ts`
- `src/core/storage/sidecarCommentStorage.ts`
- `src/sync/sideNoteSyncEventStore.ts`
- `src/index/AggregateCommentIndex.ts`

## Current Cache Layers

SideNote2 does not have one single note cache. It has several layers with
different jobs.

### In-memory parsed note cache

`ParsedNoteCache` caches parsed note-comment results by `filePath` and exact
`noteContent`.

This is a small LRU-style optimization. It is capped at 20 entries and exists
only to avoid reparsing recently touched note content. It is not durable and is
not a storage source of truth.

### Persistent sidecar JSON cache

`SidecarCommentStorage` stores per-note JSON under:

```text
.obsidian/plugins/side-note2/sidenotes/by-note/<hash-prefix>/<full-hash>.json
```

It also stores source-id keyed sidecars under:

```text
.obsidian/plugins/side-note2/sidenotes/by-source/<hash-prefix>/<full-hash>.json
```

This is the local hot cache and helper-script write surface. The file unit is
one source note: every thread and reply for that source note lives in one JSON
sidecar.

### Synced plugin data event store

`SideNoteSyncEventStore` stores events, snapshots, and watermarks in plugin
data. This is the durable sync surface when Obsidian Sync is syncing plugin
data.

The sidecar cache can be rebuilt from synced plugin data. That is why the
sidecar should stay simple and repairable.

### In-memory aggregate index

`AggregateCommentIndex` maps source file paths to comment threads for sidebar,
index, and thought-trail views.

It is derived state. It is rebuilt from canonical storage and sidecars, and it
should stay cheap to invalidate or rebuild.

## SQLite Decision

Do not move SideNote2's primary side-note storage to SQLite right now.

JSON sidecars are still the better fit for the current product:

- simple to inspect and repair
- portable across desktop and mobile Obsidian environments
- friendly to Obsidian Sync's plugin-data model
- easy for helper scripts and support tooling
- one note maps to one small file, which keeps write blast radius bounded
- no binary database conflict model to explain or repair

SQLite would add migration complexity, runtime/platform questions, and sync
conflict risk. It would also not remove the need for the existing event/snapshot
sync model unless SideNote2 built a completely different sync layer.

## When SQLite Might Make Sense

SQLite might make sense later as a rebuildable local read index, not as the
source of truth.

Consider it only if measured data shows JSON plus in-memory indexes are a real
bottleneck, for example:

- large vaults with tens of thousands of side-note threads
- startup or aggregate-index rebuilds become visibly slow
- tag, search, or thought-trail queries need richer indexing
- plugin data grows too large even after event compaction
- support reports show sidecar scan cost dominating runtime

Even then, SQLite should be treated as disposable derived state. The durable
format should remain synced plugin data plus repairable sidecar JSON unless
there is a stronger sync story.

## Cheaper Steps Before SQLite

Before adding SQLite, exhaust these lower-complexity options:

- add secondary indexes to `AggregateCommentIndex`
- keep a persisted derived aggregate snapshot for startup acceleration
- compact sync events and snapshots more aggressively
- lazy-load or background-build global index surfaces
- add performance counters around sidecar reads, index rebuilds, and search
- shard or split sidecar directories further if filesystem scans become slow

## Current Direction

Keep JSON sidecars as the runtime storage format.

Keep plugin data as the durable sync surface.

Use in-memory indexes for active UI paths.

Only introduce SQLite if there is measured pressure that simpler indexes and
snapshots cannot solve.
