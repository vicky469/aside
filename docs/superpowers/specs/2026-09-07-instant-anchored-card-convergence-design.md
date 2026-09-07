# Instant Anchored Card Convergence Design

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Anchored drafts capture their selected text before the sidebar card is created.
- [x] New-card saves use a stable draft ID and restore the draft after a persistence failure.
- [x] Same-note writes use a keyed persistence queue.
- [x] Thread nesting emits an append-entry event followed by a remove-thread event.

### To Implement

- [x] Render an anchored draft's selected-text preview immediately, including while the draft is saving.
- [x] Render a successful in-memory thread nest or entry move before awaiting persistence.
- [x] Keep the persisted mutation serialized while avoiding a second data refresh or forced smooth scroll.
- [x] Roll back the exact optimistic move and show a save notice if persistence fails.
- [x] Hydrate only snapshots whose covered watermarks advance beyond the current device's processed watermarks.
- [x] Reconcile duplicate entry IDs so an anchored entry cannot remain both nested and top-level.
- [x] Repair existing sidecar and snapshot duplicates through the canonical persistence path.

### Verification

- [x] Draft-renderer tests prove selected text is present before persistence starts and remains stable while saving.
- [x] Sidebar interaction tests prove a drop rerenders before persistence settles and does not force a delayed smooth scroll.
- [x] Mutation tests prove successful background persistence and exact rollback on failure.
- [x] Sync tests reproduce the observed stale-snapshot resurrection and prove it cannot recur.
- [x] Reconciliation tests prove existing nested/root duplicates converge to one entry without losing the nested anchor.
- [x] Focused tests, the complete test suite, production build, and installed `lean-startup` artifact comparison pass.

## Problem

Anchored cards currently expose storage latency as rendering latency. The draft card does not render the selected-text preview, so the preview appears only after persistence replaces the draft with a stored card. Drag nesting mutates the in-memory model immediately but waits for the entire sidecar, sync-event, snapshot, and refresh transaction before rerendering the sidebar.

A separate convergence bug can undo a successful move. Snapshot hydration unions every missing snapshot thread into an existing sidecar. If an older snapshot still contains a thread that the sidecar has already converted into a nested entry, hydration recreates the top-level thread. Because locally appended events are already marked processed, replay does not apply the remove event again. A later compaction then preserves the duplicate as a new snapshot.

## Chosen Approach

Keep one in-memory comment model as the immediate UI source and one keyed persistence queue as the durability owner.

The sidebar renders the selected-text preview directly from the existing draft. A drag mutation snapshots the affected file's threads, applies the existing manager mutation, and immediately performs a lightweight render with `skipDataRefresh: true`. Persistence continues through the same per-note queue. Success leaves the already-rendered card in place. Failure restores the captured threads, rerenders once, and displays the existing concise save-failure treatment.

Snapshot hydration becomes coverage-aware. A snapshot is eligible only when at least one covered device watermark is ahead of the current processor device's watermark, or when the local sidecar is missing and the snapshot is required for recovery. Snapshots already processed by this device cannot be merged back into newer local sidecars.

At the reconciliation boundary, comment entry IDs are unique across the file. If an ID exists as an anchored nested entry and as a top-level root, retain the nested placement and remove the redundant root. This invariant both repairs affected data and prevents an imported stale snapshot from displaying two cards.

## Alternatives Considered

### Wait for persistence and add a spinner

This would describe the delay without removing it. It also leaves drag interactions feeling blocked and does nothing about snapshot corruption. Rejected.

### Deduplicate only during rendering

Hiding one DOM node would make the immediate symptom less visible, but both sidecars and future snapshots would remain corrupt. Navigation, sync, and later mutations could still target the wrong copy. Rejected.

### Make snapshots wholesale authoritative

Replacing sidecars with the newest timestamped snapshot would represent deletion, but it can discard local changes when clocks or synchronized plugin-data writes arrive out of order. Coverage-aware hydration plus the unique-entry invariant is narrower and preserves legitimate remote additions. Rejected.

## UI Flow

### Anchored draft

1. The selection is captured and the draft is created.
2. The draft card renders its muted selected-text preview immediately.
3. Saving swaps editor controls for the existing read-only pending presentation without changing the preview.
4. The stable-ID render rule hands the same visual position to the persisted card.

### Drag move

1. Validate the source, destination, and placement.
2. Capture the current file threads for rollback.
3. Apply the manager mutation.
4. Expand the destination and rerender locally without reloading storage.
5. Persist through the keyed per-note queue.
6. On failure, restore the captured threads, rerender, and notify the user.

The drop path must not call the general highlight helper that centers the card with smooth scrolling. The user's current sidebar viewport remains authoritative unless the moved card would otherwise be completely unavailable.

## Persistence And Sync

The event log remains unchanged: nesting appends the anchored entry to the destination and removes the source thread. The fix changes when snapshots may influence a sidecar, not the event schema.

The sync event store exposes a focused coverage query rather than duplicating watermark comparison in the controller. Missing-sidecar recovery remains available for a fresh device. Existing-sidecar hydration occurs only for unseen remote coverage. Once hydrated, current watermarks are marked processed as today.

Reconciliation runs on normalized threads before sidecar writes and snapshot compaction. It preserves entry order and bodies, prefers an anchored nested occurrence over a redundant root occurrence, and is idempotent. It must not silently merge two genuinely different entries that merely have similar content; stable IDs are the only deduplication key.

## Error Handling

An optimistic move is not reported as durable until persistence resolves. If persistence fails, only that mutation's captured file state is restored. Other notes and agent runs remain untouched. The failure path logs the underlying error and shows a concise message that the move could not be saved.

Snapshot incompatibility checks against source content remain in place. Coverage filtering happens before expensive note reads and normalization, reducing unnecessary work during ordinary sidebar refreshes.

## Testing

Use red-green regression tests at three boundaries:

- Pure draft presentation and DOM rendering for immediate selected-text preview.
- Sidebar/mutation integration with a deferred persistence promise for immediate render, background completion, no forced scroll, and rollback.
- Sync hydration with a current sidecar containing a nested entry and a stale already-processed snapshot containing its former root. Assert that replay performs no hydration and leaves one occurrence. Add a fresh-device counterpart proving unseen remote snapshot content still hydrates.

The affected real data is private test evidence only. Tests use synthetic paths, IDs, selections, and bodies.

## Relationship To Existing Designs

This design corrects the latency and convergence behavior of `2026-06-06-drag-nest-anchored-comments-design.md` and extends the immediate-card transition established by `2026-09-02-optimistic-agent-card-save-design.md`. It does not change agent dispatch ordering, nesting depth, cross-file drag rules, or the persisted comment schema.

## Self-Review

- Placeholder scan: no placeholders remain.
- Tracking scan: completed items describe verified existing behavior; all new work and verification remain unchecked.
- Plan alignment: the design derives the existing drag-nesting and optimistic-save boundaries and adds only the diagnosed regression work.
- Consistency: immediate rendering uses the manager; durability stays in the keyed persistence queue; sync convergence remains stable-ID based.
- Scope: limited to anchored draft rendering, drag responsiveness, snapshot hydration, and duplicate repair.
- Privacy: no vault path, real comment ID, selected note content, or log payload is included.
