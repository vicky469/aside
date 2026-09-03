# Agent Regenerate And Viewport Isolation Design

**Objective:** Keep regeneration to one replacement reply while guaranteeing that background agent work cannot move the source editor away from another active anchored-note draft.

## Implementation Tracking

### Already Done

- [x] Inspect the reported Aside thread, persisted sidecar, agent-run records, mutation events, and runtime logs.
- [x] Confirm that the duplicate is persisted rather than a presentation-only duplicate.
- [x] Confirm that the incident contained two overlapping runs for one prompt and two distinct output entry IDs.
- [x] Confirm that source-editor movement is emitted through explicit comment reveal navigation.

### To Implement

- [ ] Preserve locally active agent runs when external plugin-data refreshes arrive.
- [ ] Prevent Generate from starting a second run while the first run is executing or persisting its reply.
- [ ] Reuse and immediately clear the prior output card when a valid stored run is regenerated.
- [ ] Keep the active draft, source selection, editor focus, active anchor, and source viewport unchanged while another card regenerates or completes.
- [ ] Apply the regenerate and viewport rules through shared agent paths for every supported agent.

### Verification

- [ ] A store regression reproduces an external settings refresh during an active run and proves the run remains available.
- [ ] A controller regression proves the preserved run blocks overlapping Generate and keeps one output entry.
- [ ] UI regressions prove regeneration does not save or focus an unrelated draft and background completion does not reveal an anchor.
- [ ] Focused tests, the complete build, code review, and release artifact inspection pass.
- [ ] The verified build is installed in `lean-startup` and the three shipped assets match byte-for-byte.

## Evidence And Root Cause

The reported thread `6d3845ef-6249-4fad-abf0-c7af4f2a9f28` contains the prompt plus two output entries:

- `3326f283-3a22-42cc-8f4e-46afbd741647`, the completed original response;
- `811b1cd9-9efa-4ed8-b5cd-1e20f2b769fa`, a second empty response created by Generate.

Logs show the original run `a226a2a1-5716-479a-8497-99eeabf06955` starting first. External plugin-data refreshes then reloaded the run store while that run was still active. The first run disappeared from the store even though its runtime and stream remained alive. Generate therefore fell back to a metadata-free prompt retry, allocated the second output ID, and started run `2e798f04-5702-4263-b164-d5931ae17eca`. Both runs later reached reply persistence: the second could not update its empty output and the first could not finalize its missing run record.

The same incident logs contain `navigation.reveal.requested` for the original response and then its parent anchor while a different anchored-note draft was active. `revealComment` changes the Markdown editor selection, scrolls the source editor, and focuses it. Regardless of whether the reveal originated from an incidental card click during reconciliation or the Generate interaction, an unrelated active draft must make that navigation ineligible.

## Chosen Experience

Regenerate is a replacement operation, not an append operation.

- A prompt may have only one active agent run at a time, including the interval after the runtime returns but before reply persistence and handoff finish.
- Generate reuses the valid prior output entry and immediately presents that card as the one empty, spinning replacement card.
- It does not show the old response beside a new placeholder.
- If the prior output was actually deleted, Generate creates one fresh output entry, preserving the existing deleted-output recovery behavior.
- If generation or reply persistence fails, the same replacement card remains visible with its failure status.

Working on another side-note draft creates a viewport lock for source navigation:

- agent streaming, completion, persistence, retries, card reconciliation, and metadata refreshes do not reveal any source anchor;
- clicking or activating another persisted card while the different draft is active does not change source selection, editor focus, active anchor, or source scroll;
- Generate does not auto-save, close, or focus the unrelated draft;
- the draft remains editable while the other card continues in the background.

## Architecture

### Active-run preservation

`AgentRunStore` remains the source of truth for local run lifecycle. External plugin-data refresh must merge persisted records into the store without deleting locally queued, running, or persistence-pending runs. Startup loading may still replace the empty initial state. The external-settings adapter uses the preserving reload path.

This fixes the source of the duplicate: retry lookup continues to resolve the exact active or completed run and its output entry ID. The existing controller busy checks then reject overlapping Generate, and normal regeneration reuses the existing output card.

### Regenerate action isolation

The shared Generate action no longer calls the generic “save visible draft first” hook. Generate reads its already-persisted prompt and mutates only its own run/output lifecycle, so saving an unrelated draft is unnecessary and violates viewport isolation. Other destructive or content-editing actions keep their existing save-first behavior.

### Source-navigation guard

One shared policy function decides whether a persisted card may reveal its source. When a different draft is active in the current sidebar scope, the policy returns false. `AsideView` applies the guard before any `openCommentInEditor` or index reveal call and does not update the active comment when navigation is blocked.

The guard belongs at the navigation adapter rather than in Markdown rendering, streamed-card reconciliation, or individual providers. This keeps every agent and every persisted card on the same rule while leaving explicit navigation unchanged when no unrelated draft is active.

## Data Flow

1. A user starts an agent run for prompt A.
2. The run store persists the queued/running record and retains it across external settings refreshes.
3. The user creates or edits anchored-note draft B; its source viewport and editor focus become protected.
4. Agent A streams and completes without invoking source navigation or draft persistence.
5. If Generate is invoked for A while A is still active or persisting, the controller rejects the overlap and leaves both A and draft B unchanged.
6. If Generate is invoked after A is terminal, the controller resolves A's exact stored output ID, clears that one visible card into its spinner state, and runs the replacement.
7. Completion or failure updates that same card. Draft B and the source editor remain untouched throughout.

## Failure Handling

- A stale external snapshot cannot remove an active local run.
- A conflicting active run causes Generate to return unavailable without allocating an output ID.
- A missing or soft-deleted prior output receives one fresh output ID; it never revives a deleted card.
- A failed runtime or failed reply save remains visible in the single replacement card.
- A blocked source reveal is silent because preserving an active draft is expected behavior, not an error.

## Testing

- `AgentRunStore` tests load persisted data, add an active local run, simulate older external data, invoke preserving reload, and assert the active run and its output mapping remain.
- `CommentAgentController` tests simulate the same refresh boundary, attempt Generate during runtime and persistence, and assert no second run or appended output is created.
- Regenerate tests assert one card/output ID is reused and its visible stream body clears immediately.
- Sidebar action tests assert Generate does not call `saveVisibleDraftIfPresent` for a different draft.
- Navigation policy tests assert a different active draft blocks reveal and active-comment changes, while no draft or the same target preserves normal explicit navigation.
- Provider-neutral fixtures cover the shared path rather than adding provider-specific branches.

## Scope

Included: active agent-run preservation across external settings refresh, one-output regeneration, overlap prevention, unrelated-draft viewport isolation, and provider-neutral regression coverage.

Excluded: automatically deleting ambiguous legacy/user-authored thread entries, changing ordinary card navigation when no draft is active, changing non-agent action save semantics, or changing script-run regeneration.
