# Reply Reload And Actions Design

**Objective:** Keep agent reply state visible and non-silent across plugin reload boundaries, make the shared `+` reply action available on every active thread entry, and keep manual thread continuations chronological.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Inspect the reported canonical thread, run record, and timestamped runtime log without modifying vault data.
- [x] Confirm the plugin unloaded while prompt persistence was still in flight.
- [x] Confirm the unloaded controller later queued a run whose live reply belonged to the discarded view and whose terminal commit failed.
- [x] Confirm script-authored replies are explicitly excluded from the shared add-to-thread action.
- [x] Confirm child-targeted insertion placed the new prompt after the clicked prompt and before its existing script reply.

### To Implement

- [x] Prevent saved-entry callbacks, retry preparation, and queue processing from starting agent work after the controller is disposed.
- [x] Convert persisted queued or running runs from a previous session into visible failed reply cards without overwriting an existing reply body.
- [x] Show the shared `+` action on active script reply cards.
- [x] Append every manually added continuation at the end of its thread, regardless of which card supplied the `+` action.
- [x] Preserve provider-neutral routing, same-thread concurrency for distinct prompts, and direct-after-trigger placement for automatic reply cards.

### Verification

- [x] A lifecycle regression test proves a late `/update-script` callback cannot queue or launch after disposal.
- [x] A restart regression test proves an interrupted run with no output card receives one persistent failed reply.
- [x] A restart regression test proves an existing non-empty output is not overwritten.
- [x] A sidebar regression test proves a script reply renders `+` and selects the same thread.
- [x] Mutation and render regressions prove a manual continuation stays at the end of the thread.
- [x] Focused tests, complete build, lint, typecheck, Obsidian compliance, bundle-size, and release-artifact checks pass.
- [x] The built plugin is installed in the configured test vault, reloaded, and the three shipped assets match byte-for-byte.

## Evidence And Root Cause

The reported prompt save began before a plugin reload and completed after the old controller had been disposed. That controller did not retain a disposed state, so its late saved-entry callback still selected an agent, persisted a run, and launched the CLI. The new sidebar session never owned the old controller's transient stream card. When the runtime later returned, the disposed persistence host rejected the canonical reply commit, leaving a failed run record without a visible output entry.

This is a lifecycle-boundary defect, not runtime startup latency or spinner rendering. The run reached `running` promptly, but it belonged to an unloaded controller.

The ordering complaint has a separate confirmed cause in the same reply surface. Script-authored entries suppress the shared add-to-thread action, and manual continuations inherit the clicked entry as a persistence insertion point. Adding from any older card therefore splits the visible chronology and can separate an existing prompt/reply pair.

## Selected Behavior

`CommentAgentController` owns a monotonic lifecycle flag. Once disposed, it accepts no new saved-entry dispatch, retry preparation, queue work, or runtime launch. A run already persisted as queued or running is left for the next controller instance to reconcile.

On startup, reconciliation loads each persisted in-flight run's current thread. It rechecks that the run is still active before writing anything. If the reserved output entry is absent, it conditionally commits one provider-owned failure reply at the original trigger position before marking the run failed. The condition is rechecked inside the serialized persistence transaction: any non-empty or deleted reply found there wins. The controller rechecks the run status again before terminalizing it. This keeps failures visible without reviving deleted cards, overwriting a response that reached storage before interruption, or downgrading a concurrently completed run.

Every non-deleted thread entry uses the same add-to-thread action policy regardless of whether its author is the user, an agent, or a vault script. Clicking `+` selects that card's thread, but the draft renders at the end and persistence appends it at the end. Automatic agent and script reply cards—including script error fallbacks—still appear immediately after their own newly saved prompts. No historical migration is introduced.

## Failure Handling

- A callback arriving after disposal returns without creating a run or launching a process.
- If interrupted-reply persistence fails, the run still becomes failed and the existing warning path records the persistence failure; reconciliation does not loop indefinitely.
- Deleted output entries stay deleted.
- Existing non-empty output bodies are never replaced with interruption copy.
- The change is shared across every supported agent and does not reduce concurrency for distinct prompts.

## Scope

Included: agent and persistence lifecycle gating, conditional startup interruption-card recovery, script reply `+` parity, chronological manual continuation, ordering regression coverage, build, and live installation.

Excluded: automatic migration of historical entry order, changing automatic reply placement, changing agent runtime limits, changing provider adapters, or releasing a new version.
