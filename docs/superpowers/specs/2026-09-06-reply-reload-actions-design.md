# Reply Reload And Actions Design

**Objective:** Keep agent reply state visible and non-silent across plugin reload boundaries, and make the shared `+` reply action available on every active thread entry, including vault-script replies.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Inspect the reported canonical thread, run record, and timestamped runtime log without modifying vault data.
- [x] Confirm the plugin unloaded while prompt persistence was still in flight.
- [x] Confirm the unloaded controller later queued a run whose live reply belonged to the discarded view and whose terminal commit failed.
- [x] Confirm script-authored replies are explicitly excluded from the shared add-to-thread action.
- [x] Confirm child-targeted insertion placed the new prompt after the clicked prompt and before its existing script reply.

### To Implement

- [ ] Prevent saved-entry callbacks, retry preparation, and queue processing from starting agent work after the controller is disposed.
- [ ] Convert persisted queued or running runs from a previous session into visible failed reply cards without overwriting an existing reply body.
- [ ] Show the shared `+` action on active script reply cards so the next prompt can be added after the latest visible reply.
- [ ] Preserve provider-neutral routing, same-thread concurrency for distinct prompts, and existing targeted insertion semantics.

### Verification

- [ ] A lifecycle regression test proves a late `/update-script` callback cannot queue or launch after disposal.
- [ ] A restart regression test proves an interrupted run with no output card receives one persistent failed reply.
- [ ] A restart regression test proves an existing non-empty output is not overwritten.
- [ ] A sidebar regression test proves a script reply renders `+` and targets that reply entry.
- [ ] Focused tests, complete build, lint, typecheck, Obsidian compliance, bundle-size, and release-artifact checks pass.
- [ ] The built plugin is installed in `lean-startup`, reloaded, and the three shipped assets match byte-for-byte.

## Evidence And Root Cause

The reported prompt save began before a plugin reload and completed after the old controller had been disposed. That controller did not retain a disposed state, so its late saved-entry callback still selected an agent, persisted a run, and launched the CLI. The new sidebar session never owned the old controller's transient stream card. When the runtime later returned, the disposed persistence host rejected the canonical reply commit, leaving a failed run record without a visible output entry.

This is a lifecycle-boundary defect, not runtime startup latency or spinner rendering. The run reached `running` promptly, but it belonged to an unloaded controller.

The ordering complaint has a separate confirmed cause in the same reply surface. Script-authored entries suppress the shared add-to-thread action. The user therefore had to add from an earlier prompt card, and the existing targeted-insertion rule correctly placed the new entry after that clicked prompt instead of after the latest script reply.

## Selected Behavior

`CommentAgentController` owns a monotonic lifecycle flag. Once disposed, it accepts no new saved-entry dispatch, retry preparation, queue work, or runtime launch. A run already persisted as queued or running is left for the next controller instance to reconcile.

On startup, reconciliation loads each persisted in-flight run's current thread. If the reserved output entry is absent, it commits one provider-owned failure reply at the original trigger position before marking the run failed. If a non-deleted output entry already has content, reconciliation preserves that content and only terminalizes the run record. This keeps failures visible without reviving deleted cards or overwriting a response that reached storage before interruption.

Every non-deleted thread entry uses the same add-to-thread action policy regardless of whether its author is the user, an agent, or a vault script. Clicking `+` continues to target that exact entry; no global reordering or historical migration is introduced.

## Failure Handling

- A callback arriving after disposal returns without creating a run or launching a process.
- If interrupted-reply persistence fails, the run still becomes failed and the existing warning path records the persistence failure; reconciliation does not loop indefinitely.
- Deleted output entries stay deleted.
- Existing non-empty output bodies are never replaced with interruption copy.
- The change is shared across every supported agent and does not reduce concurrency for distinct prompts.

## Scope

Included: agent controller lifecycle gating, startup interruption-card recovery, script reply `+` parity, ordering regression coverage, build, and live installation.

Excluded: automatic migration of historical entry order, changing the targeted insert model, changing agent runtime limits, changing provider adapters, or releasing a new version.
