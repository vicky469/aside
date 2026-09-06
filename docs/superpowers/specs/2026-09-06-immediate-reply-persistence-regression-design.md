# Immediate Reply Persistence Regression Design

**Objective:** Restore the existing Aside contract that a saved agent or vault-script prompt is followed immediately by one pending reply card with a turning icon, while durable comment writes remain safe and aggregate index work stays off the interaction path.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Inspect the reported thread, canonical sidecars, persisted run, and runtime log without modifying user data.
- [x] Confirm the vault script eventually succeeded and the reply persisted.
- [x] Trace the initial delay to appended prompt persistence forcing two synchronous aggregate refreshes.
- [x] Trace the pending and terminal reply delays to script writes forcing additional synchronous aggregate refreshes.
- [x] Trace `Destination file already exists!` to Markdown modification synchronization bypassing the existing per-note persistence queue.
- [x] Confirm the shared queued/running renderer already displays the required turning icon.

### To Implement

- [x] Give appended draft saves the same default deferred aggregate refresh and lightweight persisted-view behavior as new draft saves.
- [x] Let internal appended reply entries and script result edits explicitly defer aggregate, editor-decoration, and Markdown-preview refresh work.
- [x] Keep the pending script reply durable before execution while rendering it before that persistence settles.
- [x] Route Markdown modification synchronization through the existing canonical per-note persistence queue.
- [x] Preserve concurrent agent execution and cross-note persistence.

### Verification

- [x] Mutation tests prove appended prompts and pending script entries request non-blocking persistence.
- [x] Script-controller tests prove pending and terminal script writes use the non-blocking options.
- [x] Persistence tests prove a Markdown modification waits behind an in-flight save for the same note.
- [x] Focused tests pass.
- [x] The complete test, lint, typecheck, compliance, bundle-size, build, and release-artifact checks pass.
- [x] The built plugin is installed in `lean-startup`, reloaded, and the three shipped assets match byte-for-byte.

## Existing Contracts

This repair preserves the approved behavior in the optimistic agent-card save, async vault-script feedback, immediate agent-start status, and same-note persistence serialization designs. It adds no new card state or provider-specific path.

The user-facing sequence is:

1. Render the submitted prompt as the existing one-card optimistic save state.
2. Persist the prompt's canonical sidecar without waiting for aggregate index regeneration.
3. Store the run receipt, append the empty reply entry, and refresh the current sidebar so the turning icon is visible.
4. Persist that pending entry without aggregate index regeneration.
5. Execute the selected agent or vault script.
6. Replace the same reply entry with the result and defer derived refresh work.

Agent and vault-script dispatch still begins only after the prompt is durable. The pending reply still becomes durable before vault-script execution begins. Only derived work moves out of the critical path.

## Shared Ownership

`CommentMutationController` owns persistence intent for user and internal comment mutations. New and appended draft saves share the same default non-blocking options. `appendThreadEntry` and `editComment` expose the existing provider-neutral persistence controls rather than embedding vault-script behavior.

`CommentScriptController` remains a thin workflow adapter. It requests a pre-persist sidebar refresh for the empty pending entry and passes the non-blocking options for pending and terminal writes.

`CommentPersistenceController` remains the single owner of same-note serialization. `handleMarkdownFileModified` must join the same keyed queue as ordinary persistence because a vault script can modify the source Markdown while a reply entry is being saved.

## Failure Handling

Prompt persistence failures continue to restore the editable draft and prevent dispatch. Pending reply persistence failures continue to terminalize the stored run without executing the script. Terminal reply persistence failures remain explicit through the existing failed run and notice behavior.

The queue continues after a rejected operation, and writes for different notes remain concurrent. No blind rename retry is added because it could overwrite newer canonical state.

## Scope

Included: append-save options, script pending/result options, same-note external-sync serialization, regression tests, build, and live installation.

Excluded: renderer redesign, new loading copy, provider-specific handling, global persistence locking, multi-process synchronization, release version changes, and historical run repair.
