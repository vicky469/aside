# Immediate Agent Start Status Design

Aside will show a useful agent reply state immediately after a saved `@agent` request is queued. A slow full-sidebar refresh must neither delay the visible status nor delay launching the selected agent runtime.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Agent runs have provider-neutral queued/running stream state and a single-line grey status presentation.
- [x] Live runtime progress replaces the status hint without adding progress text to the reply body.
- [x] Persisted output cards and transient streamed cards can reconcile by output entry and run identifiers.

### To Implement

- [ ] Publish a queued stream immediately with a provider-specific `Starting <agent>…` hint.
- [ ] Start queue processing without waiting for a full comment-view refresh.
- [ ] Transition the same stream and card from queued to running, then replace the starting hint with real runtime progress.
- [ ] Keep background refresh failures contained by the existing refresh warning path.

### Verification

- [ ] A controller regression test proves a deliberately blocked refresh cannot delay the initial queued stream or runtime launch.
- [ ] Stream rendering tests prove the grey line initially reads `Starting <agent>…` and later shows the latest real progress step.
- [ ] The focused agent-controller and streamed-card suites pass.
- [ ] The complete repository build passes.

## Problem

The controller currently awaits sidebar refreshes on the critical path between queuing a run, publishing its live stream state, and launching the local runtime. During a slow refresh, the persisted empty output can appear as a blank white card. The user receives no meaningful feedback even though the request was accepted, and runtime launch can also be unnecessarily delayed.

## User Experience

Immediately after save, the reply position shows one compact grey line with a turning spinner and a provider-specific label such as `Starting Codex…`, `Starting Claude…`, or `Starting Gemini…`. It is the normal reply card, not a toast or a second placeholder card.

When the runtime emits genuine progress, the latest progress line replaces `Starting <agent>…` in place. Partial answer text streams into the same card. Completion or failure keeps the existing `✅` or `❌` terminal presentation.

At no point should an accepted agent request be represented only by an empty white card.

## Data Flow

After the queued run is durably stored, `CommentAgentController` creates and emits queued stream state immediately. The stream has no reply text, carries the selected agent identity, and uses `Starting <agent>…` as its temporary status hint. `StreamedAgentReplyController` can therefore create the visible transient card even before the persisted output entry is present in the current DOM.

Queue processing begins immediately. Full comment-view refresh is requested as background reconciliation and is not awaited before queue processing, context construction, or runtime launch. When persistence and refresh later produce the stored output card, the existing run/output identifiers let the stream controller borrow that card rather than create a duplicate.

The transition to `running` preserves the starting hint until the runtime supplies its first real progress event. Subsequent progress events continue to replace the single visible hint with the latest line.

## Error Handling

Background refresh remains wrapped by `refreshStatusViews`, so rejection is logged and contained. Run execution and terminal persistence continue independently. Existing runtime failure policy and persistent failed-card behavior remain unchanged.

## Scope

This change is provider-neutral and applies to every supported agent. It does not change agent concurrency, prompt construction, stored run schemas, final reply formatting, retry policy, or sidebar-wide rendering architecture.
