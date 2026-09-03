# Pending Agent Reply Card Placement Design

Aside will render the optimistic `Starting <agent>…` state as a reply card beneath the question card. The pending reply must never be nested inside the question card itself.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is committed and the listed verification passes.

### Already Done

- [x] Agent saves render the submitted question immediately as a read-only pending card.
- [x] Supported agent directives show an immediate provider-specific spinner while the draft save completes.
- [x] Persisted and live agent replies use a reply card beneath their question.

### To Implement

- [ ] Render a temporary thread wrapper for a pending new agent question.
- [ ] Keep the pending question card and its agent reply container as siblings inside that wrapper.
- [ ] Preserve existing pending-card behavior for non-agent saves, append drafts, and edit drafts.
- [ ] Leave agent runtime launch, run identity, concurrency, and persistence unchanged.

### Verification

- [ ] A DOM regression test proves the pending agent reply is not a descendant of the question card.
- [ ] A DOM regression test proves the question and reply container share one temporary thread wrapper.
- [ ] Existing draft, agent-stream, and concurrent-run tests pass.
- [ ] The complete repository build and artifact inspection pass.
- [ ] The built plugin is synced to `lean-startup`, reloaded, and its shipped files match the repository build.

## Problem

The optimistic save renderer currently creates `.aside-thread-replies` with `commentEl.createDiv(...)`. That makes the temporary reply spinner a descendant of the pending question card. The later persisted render uses the correct structure, but users can see the incorrect nesting while the draft save is in progress.

The reported thread confirms the data model is not the cause: its run has distinct `triggerEntryId` and `outputEntryId` values. The misplaced state exists only in the pending draft DOM.

## Approaches Considered

### Temporary thread wrapper — selected

Create the same structural boundary used by persisted threads: one temporary thread stack containing the pending question card followed by its reply container. This gives the spinner the correct ownership immediately and matches the DOM that replaces it.

### Move the reply after rendering

Render the current nested structure, then move the reply element into the parent container. This adds a visible intermediate layout and makes append ordering harder to reason about.

### Wait for persistence

Do not show the reply spinner until the saved thread is available. This avoids incorrect nesting but restores the blank delay that immediate feedback was designed to remove.

## DOM Ownership

For a pending new agent request, the optimistic structure will be:

```text
.aside-thread-stack
├── .aside-comment-draft.is-saving       question
└── .aside-thread-replies
    └── .aside-agent-stream-item          starting reply
```

The reply container is a sibling of the question card. It is not created inside `.aside-comment-draft`.

The temporary wrapper is presentation state only. It does not create a second persisted thread, agent run, or output entry. Once normal persistence and stream reconciliation run, the existing render pipeline continues to own the canonical thread and reply card.

## Behavior Boundaries

- Apply the wrapper only to pending new drafts that contain one valid supported agent directive.
- Keep a pending non-agent draft as its existing single card.
- Keep append-draft placement within its existing persisted thread; do not introduce a nested thread stack.
- Keep edit drafts on the editable path.
- Do not change duplicate-run prevention or multi-agent concurrency.
- Do not change the visible spinner, status copy, or terminal reply presentation.

## Error Handling

Save and runtime failures continue through the existing paths. The temporary reply remains purely visual until controller-owned run state takes over. If a save fails before a run is queued, the draft renderer returns to its existing editable/error behavior without creating durable agent state.

## Testing

The regression test will exercise the real renderer with a saving new `@agent` draft. It will assert both the absence of a reply descendant under the question card and the presence of a shared temporary thread wrapper. Existing tests cover provider detection, pending-state eligibility, stream-card reconciliation, cancellation, retries, and concurrent runs.

## Scope

This correction is provider-neutral and applies to every supported agent. It changes only optimistic pending-card DOM placement and the minimal CSS or render-order support needed for that structure.
