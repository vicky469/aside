# Event-Driven Index And Sidebar Refresh

## Question

Why does Aside poll `pollFocusedSyncedSideNoteEvents()` every 750ms, and can index/sidebar refreshes be driven by Obsidian events instead?

## Current Poll

`pollFocusedSyncedSideNoteEvents()` only looks at focused files:

- current sidebar target file
- files visible in Aside sidebar leaves

For each file it calls `replaySyncedSideNoteEvents(file.path)`. The poll exists to catch side-note mutation events that arrive through synced plugin data while the note is already open.

That is the wrong default shape for normal desktop work. Most refreshes have a concrete cause: a file was opened, the active leaf changed, a note was modified, a comment was mutated, a setting changed, or synced plugin data changed. Those should be events, not a timer.

## Existing Event Sources

Registered through `src/app/pluginEventRouter.ts`:

- `workspace.on("file-open")`
- `workspace.on("active-leaf-change")`
- `vault.on("rename")`
- `vault.on("delete")`
- `vault.on("modify")`
- `workspace.on("editor-change")`

Routed through `src/app/refreshCoordinator.ts`:

- `Plugin.onExternalSettingsChange()`
- direct mutation paths through `afterCommentsChanged()`

Existing mutation flow already has the right shape: write sidecar/plugin-data state, refresh sidebar/editor/preview, then schedule or run aggregate index refresh.

## Desired Model

Use one event-driven refresh pipeline:

```text
event -> classify affected files -> replay synced events if needed -> load/cache comments
      -> refresh affected sidebar views -> refresh editor/preview state
      -> refresh or schedule Aside index.md
```

The pipeline should be file-scoped by default and aggregate-scoped only when needed.

## Trigger Matrix

| Trigger | Replay synced events | Sidebar | Index note |
| --- | --- | --- | --- |
| Plugin load/layout ready | visible files + aggregate | all open Aside views | scheduled |
| `file-open` | opened sidebar-supported file | active/sidebar target only | only if index is open or pending |
| `active-leaf-change` | active sidebar-supported file | active/sidebar target only | only if index is open or pending |
| `vault.modify` for markdown | modified file | views for that file | scheduled if comments changed |
| Comment create/update/delete/resolve/move | mutated file | views for that file | scheduled or immediate per operation |
| Index settings change | aggregate | index sidebar views | immediate |
| `onExternalSettingsChange()` | changed/visible files, or aggregate if unknown | affected open views | scheduled |
| Open Aside index | aggregate before open | index sidebar view | immediate before open |

## Synced Plugin Data

The hard part is plugin-data sync. Source markdown changes produce vault events, but synced `data.json` changes may not map cleanly to a source note event. The right replacement for the 750ms poll is:

1. Trust `onExternalSettingsChange()` when Obsidian fires it.
2. On that event, replay synced side-note events once.
3. If the changed file set is known, refresh only those sidebar/index surfaces.
4. If the changed file set is unknown, refresh open Aside views and schedule the aggregate index.
5. Also replay on demand before rendering a sidebar for a file or opening the index.

This still catches remote updates when the user interacts with the note or index, without doing constant background work.

## Proposed Refresh Scheduler

Add or grow the current `RefreshCoordinator` with explicit reasons:

```ts
type RefreshReason =
  | "startup"
  | "file-open"
  | "active-leaf-change"
  | "vault-modify"
  | "comment-mutation"
  | "external-plugin-data"
  | "index-open"
  | "settings-change";
```

Scheduler state:

- dirty file paths
- whether aggregate index is dirty
- whether a sidebar render is already queued
- whether an aggregate refresh is already queued

Rules:

- debounce aggregate writes, as now
- do not debounce direct index open
- never refresh every open file when one file changed
- replay synced events at event boundaries, not on an interval
- keep `renderComments({ skipDataRefresh: true })` for mutation paths where the caller already updated data

## Removal Plan

Implemented first slice:

1. Added `PluginEventRouter` so Obsidian event registration is visible in one module.
2. Added `RefreshCoordinator` so external plugin-data replay refreshes open views and schedules the aggregate index when synced side-note events were applied.
3. Removed `FOCUSED_SYNC_POLL_INTERVAL_MS`, `focusedSyncPollInFlight`, `getFocusedSyncFiles()`, and `pollFocusedSyncedSideNoteEvents()`.

Next slices:

1. Move more refresh decisions behind `RefreshCoordinator`:
   - `file-open`
   - `active-leaf-change`
   - sidebar `renderComments`
   - `openIndexNote`
   - settings changes
2. Teach the coordinator to track dirty file paths and aggregate dirty state.
3. Keep an escape hatch only if Obsidian plugin-data sync does not reliably fire `onExternalSettingsChange()`. If needed, make it opt-in or visibility-scoped, not always-on.

## Success Criteria

- Opening a note updates its sidebar from current note/comment state.
- Switching back to `Aside index.md` updates index sidebar state without polling.
- Creating, editing, resolving, deleting, or moving a comment refreshes only affected surfaces plus the aggregate index.
- Remote synced side-note changes appear after `onExternalSettingsChange()` or the next relevant user event.
- No periodic 750ms focused sync poll is needed during idle use.
