# Optimistic Agent Completion Design

**Objective:** Show a completed agent reply as `✅ <agent>` as soon as the runtime returns a valid answer, while canonical reply persistence continues in the background. A persistence failure must keep the answer visible and change the same card to `❌ <agent> · Couldn’t save reply`.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Agent runs publish provider-neutral queued and running stream state.
- [x] The reply position immediately shows one streamed card with a turning spinner and `Starting <agent>…`.
- [x] Streamed and persisted cards reconcile through stable run and output-entry identifiers.
- [x] Runtime launch no longer waits for a retry clear to finish persisting.

### To Implement

- [x] Publish the valid final reply and `succeeded` presentation to the existing stream immediately when the runtime finishes.
- [x] Retain optimistic terminal streams until their canonical reply write and persisted-card handoff succeed.
- [x] Stop persisting an empty replacement before a retry; keep the previous durable reply as rollback protection.
- [x] Replace the previous retry reply with the final reply in one canonical background mutation.
- [x] Keep durable run status non-terminal until the reply write succeeds, while preventing regenerate or cancellation from starting an overlapping replacement.
- [x] On reply persistence failure, retain the new reply text and change the same card to `❌ <agent> · Couldn’t save reply`.
- [x] Apply the shared completion policy to every supported agent without provider-specific copies.
- [ ] Treat a soft-deleted prior output entry as unavailable when regenerating an agent reply.
- [ ] Allocate and persist a fresh visible output entry without restoring or overwriting the deleted reply.

### Verification

- [x] A blocked-persistence controller test proves `✅ Codex` appears immediately after runtime completion.
- [x] A retry test proves no empty reply mutation occurs and only one final replacement is attempted.
- [x] A persistence-rejection test proves the same card retains its answer and changes to `❌ Codex · Couldn’t save reply`.
- [x] A stream-lifetime test proves the optimistic card cannot expire before persistence and persisted-card handoff.
- [x] Card reconciliation coverage proves no duplicate or replacement jump occurs during optimistic completion.
- [x] Representative non-Codex coverage proves the policy is provider-neutral.
- [x] Focused controller and rendering suites, the complete build, and release artifact inspection pass.
- [x] The verified build is installed in `lean-startup` and all three shipped assets match byte-for-byte.
- [ ] A regression test proves `deleted output → Regenerate → successful persisted handoff` creates one new visible reply.
- [ ] The complete build and release artifact inspection pass after the regression fix.
- [ ] The verified fix is installed in `lean-startup` and its shipped assets match byte-for-byte.

## Confirmed Problem

The live run for `clippings/Omarchy Quattro.md` started at `08:20:36.476`. Its retry-clear write completed at `08:21:10.577`, and its final reply write completed at `08:21:39.246`. The run did not publish success until `08:21:40.033`. The reply text was already visible through streaming, so the grey spinner incorrectly communicated another 63.6 seconds of agent work while storage was finishing.

The immediate-start work removed storage from the runtime launch path, but completion still couples the visible terminal state to durable persistence. A retry also performs two canonical writes: empty the old reply, then write the new reply.

### Deleted-output retry regression

The output entry `7a826548-c3fd-4748-a461-572f68075ee3` was soft-deleted at `2026-09-03T09:03:06.788Z`. Retry run `a1892ea7-219f-47aa-a455-e05770470979` reused that entry and was marked succeeded at `2026-09-03T09:03:34.507Z`. Because the entry retained `deletedAt`, persisted rendering filtered it out when the optimistic stream handed off, making the completed reply disappear.

A retry may reuse a prior output entry only when the entry exists and is not soft-deleted. A deleted output remains deleted. The retry instead receives a fresh output ID, appends one new visible placeholder through the canonical mutation path, and replaces that placeholder with the final answer. This rule is provider-neutral.

## Chosen Experience

The status line has only these visible phases:

- active runtime: grey turning spinner plus the latest real progress line;
- valid runtime result: `✅ <agent>` immediately, with no saving label;
- persistence failure: `❌ <agent> · Couldn’t save reply`.

The final reply text appears in the same card before persistence finishes. Successful background persistence causes no visible status change. The card must not jump, duplicate, disappear, or briefly reveal the previous reply during handoff.

`✅` means the agent completed successfully, not that local storage has already finished. A later save failure may therefore change `✅` to `❌`; the answer remains readable so the failure is not silent or destructive.

## Architecture

`CommentAgentController` owns the distinction between runtime completion and reply persistence. This is the shared policy boundary for Codex, Claude, Cursor, Gemini, DeepSeek, and future supported agents.

The durable `AgentRunRecord` remains `running` until the final reply is stored successfully. The controller may publish an optimistic `succeeded` stream while the durable run is still non-terminal. This prevents a reload from claiming a durable success whose reply was never saved. The controller tracks this short-lived persistence phase separately: cancel and regenerate return unavailable once runtime completion begins, so they cannot overlap the pending replacement.

Optimistic terminal streams require explicit persistence-aware retention. They must not use the ordinary timed terminal-stream pruning path until the reply mutation succeeds and the canonical persisted card is ready to take over. The existing streamed-card controller remains a thin renderer and identity reconciler; it does not own save state or provider policy.

`CommentMutationController` remains the canonical mutation adapter. No renderer or agent-specific runtime writes sidecars directly.

## Data Flow

### New run

The existing transient card appears immediately and the runtime launches without waiting for its background output-entry preparation. When the runtime returns a valid answer, the controller publishes the answer with optimistic success. Canonical output preparation and the final reply mutation continue in their required order. The optimistic card remains authoritative until storage and view reconciliation finish.

This design does not remove the initial durable placeholder for a brand-new run because it provides recovery evidence if Obsidian closes during execution. Coalescing new-run placeholder and final writes belongs to a separate persistence optimisation.

### Retry

The controller assigns the previous output entry to the new run but does not edit it to an empty string. The streamed card immediately hides the previous body and presents the new run’s active state. The old stored reply remains rollback protection while the runtime works.

If the previous output is soft-deleted, the controller does not assign it to the retry. The normal new-output path creates a fresh entry after the trigger, while the deleted entry and its deletion timestamp remain unchanged.

When the runtime returns, the controller publishes the new answer and `✅ <agent>` immediately, then performs one canonical edit from the old stored body to the new body. The previous output entry remains excluded from retry prompt context.

After the edit succeeds, the run record becomes durably `succeeded`, the sidebar reconciles, and the persisted card adopts the already-visible result without changing identity.

## Failure Handling

Runtime failures keep the existing shared provider-failure policy and `❌` presentation.

If output preparation or final reply persistence fails after a valid runtime result, the controller preserves the optimistic answer text, changes the same stream to `failed`, and shows `Couldn’t save reply` on its status line. It retains that stream rather than pruning it. For retries, the prior durable reply remains available after reload because it was never cleared. For new runs, the existing fallback persistence path may store the failure when possible.

Persistence errors are logged with run, thread, and output-entry identifiers. User-facing text remains generic and does not expose serialized errors, credentials, or local paths.

## Alternatives Considered

### Keep the spinner and rename it to `Saving reply…`

This is accurate but still makes a finished answer look unfinished for tens of seconds. Rejected because the user selected immediate terminal feedback.

### Show `✅ <agent> · Saving…`

This exposes the two phases explicitly. Rejected because it adds persistent implementation detail to the compact status line and the user selected plain `✅ <agent>`.

### Optimise persistence without changing status semantics

Reducing sidecar latency is worthwhile, but storage duration varies with vault and sync conditions and cannot guarantee prompt completion feedback. Deferred as a separate performance investigation.

## Scope

Included: optimistic success presentation, persistence-aware stream retention, atomic retry replacement, visible save failure, overlap prevention, and provider-neutral tests.

Excluded: changing the sidecar or sync format, removing brand-new-run recovery placeholders, redesigning comment persistence, adding settings, changing runtime protocol parsing, or exposing a saving indicator.
