# Immediate Agent Start Status Design

Aside will show a useful agent reply state immediately after a saved `@agent` request is queued. A slow full-sidebar refresh must neither delay the visible status nor delay launching the selected agent runtime.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Agent runs have provider-neutral queued/running stream state and a single-line grey status presentation.
- [x] Live runtime progress replaces the status hint without adding progress text to the reply body.
- [x] Persisted output cards and transient streamed cards can reconcile by output entry and run identifiers.

### To Implement

- [x] Publish a queued stream immediately with a provider-specific `Starting <agent>…` hint.
- [x] Start queue processing without waiting for a full comment-view refresh.
- [x] Transition the same stream and card from queued to running, then replace the starting hint with real runtime progress.
- [x] Keep background refresh failures contained by the existing refresh warning path.
- [ ] Use the same turning spinner presentation for both queued and running agent states.
- [ ] Reconcile status marker and hint elements in place so progress updates do not restart the spinner animation.
- [ ] Let a transient stream card adopt its persisted output entry id without removing and recreating the card.

### Verification

- [x] A controller regression test proves a deliberately blocked refresh cannot delay the initial queued stream or runtime launch.
- [x] Stream rendering tests prove the grey line initially reads `Starting <agent>…` and later shows the latest real progress step.
- [x] The focused agent-controller and streamed-card suites pass.
- [x] The complete repository build passes.
- [ ] A presentation-policy test proves queued and running agent states share the spinner marker.
- [ ] A streamed-card identity test proves queued-to-running updates reuse the same spinner DOM node.
- [ ] A card identity test proves assigning the persisted output entry id reuses the same card DOM node.
- [ ] The focused suites and complete repository build pass after the smoothness changes.

## Problem

The controller currently awaits sidebar refreshes on the critical path between queuing a run, publishing its live stream state, and launching the local runtime. During a slow refresh, the persisted empty output can appear as a blank white card. The user receives no meaningful feedback even though the request was accepted, and runtime launch can also be unnecessarily delayed.

## User Experience

Immediately after save, the reply position shows one compact grey line with a turning spinner and a provider-specific label such as `Starting Codex…`, `Starting Claude…`, or `Starting Gemini…`. The queued state must never show a text ellipsis in place of the spinner. It is the normal reply card, not a toast or a second placeholder card.

When the runtime emits genuine progress, the latest progress line replaces `Starting <agent>…` in place. The status line reuses its existing spinner and hint elements, so the animation remains continuous rather than restarting on each update. Partial answer text streams into the same card. Completion or failure keeps the existing `✅` or `❌` terminal presentation.

At no point should an accepted agent request be represented only by an empty white card.

## Data Flow

After the queued run is durably stored, `CommentAgentController` creates and emits queued stream state immediately. The stream has no reply text, carries the selected agent identity, and uses `Starting <agent>…` as its temporary status hint. `StreamedAgentReplyController` can therefore create the visible transient card even before the persisted output entry is present in the current DOM.

Queue processing begins immediately. Full comment-view refresh is requested as background reconciliation and is not awaited before queue processing, context construction, or runtime launch. When persistence and refresh later produce the stored output card, the existing run/output identifiers let the stream controller borrow that card rather than create a duplicate.

The transition to `running` preserves the starting hint until the runtime supplies its first real progress event. `getAgentRunStatusPresentation` remains the shared marker-policy owner for persisted and streaming agent cards, and both active states resolve to the same spinner presentation. `StreamedAgentReplyController` reconciles the marker and hint children instead of replacing the entire status subtree. Subsequent progress events update only the hint text.

When the run first gains an `outputEntryId`, an owned transient stream card with the same run id adopts that identifier in place. It is replaced only when the full sidebar refresh has actually supplied the canonical persisted card, preventing the queued-to-running transition itself from removing and reinserting the visible card.

## Error Handling

Background refresh remains wrapped by `refreshStatusViews`, so rejection is logged and contained. Run execution and terminal persistence continue independently. Existing runtime failure policy and persistent failed-card behavior remain unchanged.

## Scope

This change is provider-neutral and applies to every supported agent. It does not change agent concurrency, prompt construction, stored run schemas, final reply formatting, retry policy, or sidebar-wide rendering architecture.
