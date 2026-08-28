# Cancelled Agent Card Actions Design

## Summary

Cancelled agent reply cards will keep their terminal `Cancelled` status visible for the existing 30-second retention period while immediately restoring the persisted card's normal edit, delete, and footer actions. When retention expires, the agent stream controller will emit a clear update so the view releases the borrowed card and removes all transient stream state.

The persisted comment renderer remains the sole owner of action eligibility and event handlers. The stream renderer will restore the action nodes it already snapshots instead of rebuilding or duplicating those controls.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Cancelled agent streams retain their terminal presentation for 30 seconds.
- [x] Borrowed persisted cards snapshot their original header actions, footer nodes, content, author, and status before streaming begins.
- [x] The persisted comment renderer centrally owns edit and delete eligibility and creates the corresponding handlers.
- [x] The bug is reproducible: a cancelled borrowed card has no header actions, no footer actions, and receives no UI clear update when its retained stream is pruned.

### To Implement

- [x] Restore a borrowed card's snapshotted header and footer actions immediately when its stream reaches a terminal state.
- [x] Keep the streamed terminal author and status presentation visible during the 30-second retention period.
- [x] Preserve the existing running behavior in which the stream controller shows only the Cancel action.
- [x] Emit a `null` stream update when retained terminal stream state expires so the view clears the stream controller and fully restores the persisted card.
- [x] Keep action construction, permission checks, and click handlers owned by the persisted renderer.

### Verification

- [x] A fail-first stream-renderer regression test proves cancelled borrowed cards immediately regain their original header and footer actions while retaining `Cancelled` status.
- [x] Existing and focused tests prove queued and running cards still suppress persisted actions and show only Cancel.
- [x] A fail-first lifecycle regression test proves retention expiry removes the stream and emits one `null` update for the correct thread.
- [x] Focused persisted-card tests prove note cards remain editable and deletable under existing permission rules.
- [x] The full test suite, lint, typecheck, Obsidian compliance check, production bundle, and release-artifact guard pass.

## Goals

- Let users edit or remove a cancelled agent output card immediately.
- Preserve the visible `Cancelled` result for 30 seconds.
- Ensure terminal stream cleanup reaches the DOM without waiting for an unrelated sidebar rerender.
- Reuse the persisted renderer's existing actions and handlers.

## Non-Goals

- Removing the 30-second terminal-status retention period.
- Automatically deleting an empty cancelled output entry.
- Changing cancellation semantics, agent run persistence, retry behavior, or soft-delete policy.
- Adding new card actions or rebuilding existing actions inside the stream controller.
- Redesigning agent status styling or card layout.

## Current Failure

While an agent runs, `StreamedAgentReplyController` borrows the persisted output card. It snapshots the card's action nodes, then replaces the header actions with a stream-only Cancel button and replaces the footer with the stream author and status.

When the run becomes cancelled, the controller first clears the header action container and then returns because Cancel is only valid for queued or running streams. The footer continues to contain only the author and cancelled status. The original edit, delete, and footer actions remain detached in the borrowed snapshot.

After 30 seconds, `CommentAgentController` deletes the retained stream from its internal map without emitting a `null` stream update. `AsideView` therefore does not call `StreamedAgentReplyController.clear()`, so the borrowed card can remain marked as a stream item with its actions suppressed until another render happens to reconcile it.

## Selected Approach

The stream controller will distinguish busy states (`queued` and `running`) from terminal states (`succeeded`, `failed`, and `cancelled`).

For a borrowed card in a busy state, behavior remains unchanged: persisted header and footer actions stay hidden and the header contains only Cancel when cancellation is available.

For a borrowed card in a terminal state, the controller will reattach the original header action nodes and original footer nodes from `borrowedSnapshot`. The author and status elements in that snapshot are the same node instances already controlled by the stream renderer, so their contents can continue to show the terminal agent label and `Cancelled` status while the original action handlers work immediately.

An owned transient stream card has no persisted actions to restore and will continue to show only its terminal status.

## Retention Cleanup

Terminal stream pruning will no longer be silent. When the 30-second timer fires, the controller will:

1. Resolve the retained stream and its thread id.
2. Remove the prune timer and stream state.
3. Emit one stream update with `stream: null` for that thread.

`AsideView` already handles a null update by clearing and removing the thread's stream renderer. For borrowed cards, `clear()` restores the complete snapshot and removes transient stream classes and data attributes. No full comment-view refresh is required.

If the stream was already cleared or replaced before the timer fires, the callback will do nothing and emit no stale update.

## Testing Strategy

Testing follows red-green-refactor.

The stream-renderer test will construct a borrowed card snapshot containing representative edit/delete and footer action nodes. It will sync a cancelled stream and assert that those exact nodes are reattached, the terminal status remains present, and no Cancel button is created. A companion assertion will preserve the existing running behavior.

The lifecycle test will use a controlled timer window and a real `CommentAgentController` instance. It will retain a terminal stream, fire the prune callback, and assert that the stream is absent and subscribers receive exactly one null update for the correct thread. This directly locks down the missing controller-to-view boundary that caused the stale DOM.

Focused tests are followed by the complete repository build. Because the build regenerates the shipped plugin bundle, the exact `main.js`, `manifest.json`, and `styles.css` artifacts will receive the required source-exposure and secret-bearing-file inspection.

## Compatibility and Risk

The change affects only transient presentation and notification of stream expiry. Stored comments and agent run records do not change. Reusing snapshotted nodes preserves existing listeners and avoids discrepancies between stream and persisted permission logic.

The main regression risk is restoring actions during a busy run. Explicit busy-versus-terminal tests guard that boundary. The second risk is a stale timer clearing a newer stream; resolving the current stream by run id at callback time and doing nothing when absent prevents that outcome.
