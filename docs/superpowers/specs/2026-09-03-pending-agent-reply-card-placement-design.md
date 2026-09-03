# Pending Agent Reply Card Placement Design

Aside will save and show the prompt card first. Immediately after that save succeeds, it will append the separate agent reply card with the turning icon. Agent activity must never appear inside the prompt card.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is committed and the listed verification passes.

### Already Done

- [x] Agent saves render the submitted question immediately as a read-only pending card.
- [x] Supported agent directives start a provider-specific queued stream after the saved entry is routed.
- [x] Persisted and live agent replies use a reply card beneath their question.

### To Implement

- [ ] Remove the agent spinner from the saving draft card.
- [ ] Append the queued reply card immediately after the prompt save succeeds.
- [ ] Preserve existing pending-card behavior for non-agent saves, append drafts, and edit drafts.
- [ ] Leave agent runtime launch, run identity, concurrency, and persistence unchanged.

### Verification

- [ ] A DOM regression test proves a saving prompt card contains no agent reply or spinner.
- [ ] A controller/view regression test proves the separate queued reply appears as soon as the prompt save succeeds.
- [ ] Existing draft, agent-stream, and concurrent-run tests pass.
- [ ] The complete repository build and artifact inspection pass.
- [ ] The built plugin is synced to `lean-startup`, reloaded, and its shipped files match the repository build.

## Problem

The optimistic save renderer currently creates `.aside-thread-replies` with `commentEl.createDiv(...)`. That puts a temporary agent spinner inside the prompt card before the prompt has finished saving. The later persisted render uses the correct separate reply card, but users can see the incorrect ownership during the save.

The reported thread confirms the data model is not the cause: its run has distinct `triggerEntryId` and `outputEntryId` values. The misplaced state exists only in the pending draft DOM.

## Selected Flow

1. The user saves an `@agent` prompt.
2. Aside immediately shows the prompt as its existing read-only saving card.
3. The prompt save succeeds and the canonical thread becomes available.
4. Agent routing queues the run and immediately appends the separate reply card with `Starting <agent>…` and the turning icon.
5. The same reply card continues through running and terminal states.

There is no temporary wrapper and no provisional agent reply inside the saving prompt. The short prompt-save interval shows only the prompt card.

## Approaches Considered

### Save prompt, then append reply — selected

Use the canonical saved thread as the ownership boundary. This is the simplest flow and prevents agent state from appearing on a user-authored card.

### Temporary thread wrapper

Show the prompt and a sibling provisional reply before persistence completes. This provides earlier feedback but introduces extra temporary structure and reconciliation that the user does not want.

### Move the reply after rendering

Render the current nested structure, then move the reply element into the parent container. This adds a visible intermediate layout and makes append ordering harder to reason about.

## DOM Ownership

While the prompt is saving:

```text
.aside-comment-draft.is-saving            prompt only
```

After the prompt is saved and the run is queued:

```text
.aside-thread-stack
├── .aside-comment-item                   saved prompt
└── .aside-thread-replies
    └── .aside-agent-stream-item           starting reply
```

The reply is created only in the canonical thread's reply container. It is never a descendant of the prompt card.

## Behavior Boundaries

- Keep every pending draft as its existing single card, with no agent status inside it.
- Keep append-draft placement within its existing persisted thread.
- Keep edit drafts on the editable path.
- Do not change duplicate-run prevention or multi-agent concurrency.
- Do not change the visible spinner, status copy, or terminal reply presentation.

## Error Handling

Save and runtime failures continue through the existing paths. If a save fails, no agent reply card or durable agent run is created. If the save succeeds but agent startup fails, the separate reply card uses the existing failure presentation.

## Testing

The DOM regression test will exercise the real renderer with a saving new `@agent` draft and assert that the prompt contains no reply container, stream card, or spinner. A controller/view test will verify that successful prompt persistence queues the run and publishes the separate reply immediately. Existing tests cover provider detection, stream-card reconciliation, cancellation, retries, and concurrent runs.

## Scope

This correction is provider-neutral and applies to every supported agent. It removes the provisional spinner from the pending draft renderer and relies on the existing post-save agent stream path for the separate reply card.
