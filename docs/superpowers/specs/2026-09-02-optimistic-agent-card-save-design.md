# Optimistic Agent Card Save

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Draft saving prevents repeated clicks through the shared saving-draft ID.
- [x] Saved agent directives dispatch agent work without awaiting the agent run.
- [x] New and appended comment entries use stable IDs before persistence begins.

### To Implement

- [ ] Transition a new or appended draft to one read-only pending card as soon as save begins.
- [ ] Keep exactly one card visible when the in-memory persisted entry appears before storage finishes.
- [ ] Preserve durable-save-before-agent-dispatch ordering.
- [ ] Restore the exact editable draft and remove its optimistic in-memory mutation if persistence fails.
- [ ] Show a concise save-failure notice when the editable draft is restored.
- [ ] Leave inline edit saves on their existing behavior.

### Verification

- [ ] Mutation tests prove the saving state is rendered before persistence settles.
- [ ] Rendering tests prove a saving draft and its same-ID persisted entry never produce duplicate cards.
- [ ] Failure tests prove the original draft and pre-save thread state are restored.
- [ ] Dispatch tests prove agent routing starts only after persistence succeeds.
- [ ] Focused tests, the full test suite, and the production build pass.

## Problem

Agent execution is already detached from draft saving, but comment persistence is not visually detached. During a new or appended save, the comment manager adds the persisted entry before the storage write finishes. The draft remains active until that write resolves. The current sidebar render-order path can therefore render both the draft and the same-ID thread or child entry, while the editor appears to hang on Save.

## User Experience

Clicking Add on a new or appended card immediately replaces the editor controls with one read-only card containing the submitted text. There is no second copy when the same entry enters the in-memory thread model. Once storage finishes, the normal persisted card takes over. Agent status and grey streaming steps appear only after the comment is durably saved and the agent run is queued.

If preparation or persistence fails, the read-only pending presentation returns to the exact editable draft and Aside shows `Unable to save this side note. Your draft was restored.` No agent run starts.

## Design

The existing saving-draft ID remains the source of truth for pending presentation; no second pending-card store is introduced.

When saving a non-edit draft, the mutation controller performs the cheap body and word-limit validation, snapshots the submitted draft, sets the saving ID, and requests a lightweight sidebar refresh before beginning the potentially slower anchor preparation, canonical reload, and persistence work. The draft renderer sees that ID and renders the submitted body as a read-only pending card instead of an editable textarea. Inline edit drafts retain their current presentation and save flow.

The render-order layer treats a saving draft and a persisted entry with the same stable ID as one logical item:

- Before the manager mutation, the pending draft supplies the card.
- After the manager mutation, the persisted thread or child entry supplies the card and the pending draft is omitted.
- After successful persistence, the draft state is cleared and the same persisted card remains.

The mutation layer snapshots the affected file's thread state immediately before adding a new thread or appended entry. If persistence throws, it restores that snapshot before clearing the saving ID and refreshing views. The original draft object remains in the draft session, so the renderer returns to the editable form with its text and anchor unchanged.

## Async Boundary

The user-facing save transition is asynchronous, but durability ordering does not change:

1. Validate the submitted body and capture the draft.
2. Mark it saving and render one read-only pending card.
3. Prepare its anchor and reload the latest canonical comment state.
4. Snapshot the pre-mutation threads.
5. Apply the stable-ID mutation in memory.
6. Persist comments and synchronized sidecar/plugin data.
7. On success, clear the draft and dispatch the saved entry without awaiting agent execution.
8. On failure, restore the thread snapshot when a mutation occurred, clear the saving state, re-render the editable draft, and show the recovery notice.

The agent never sees a comment that failed to persist.

## Error Handling

The existing cheap validation notices remain synchronous: empty drafts and word-limit violations do not enter the pending state. Preparation failures such as missing files or invalid anchors restore the editor from the pending presentation. A persistence failure logs the underlying diagnostic and shows the concise recovery notice. Rollback affects only the in-memory mutation created by this save attempt; it does not overwrite newer canonical state loaded before the snapshot.

Repeated clicks remain blocked by both the button-local guard and the shared saving-draft ID. The stable entry ID, rather than body text or timing, is the deduplication key.

## Testing

Controller tests hold canonical loading or persistence behind a promise and assert that the saving state refresh occurs first. They then release the promise and verify successful clearing and delayed saved-entry dispatch. Failure tests reject persistence and compare the restored draft and thread state to their pre-save snapshots.

Render-order and draft-renderer tests cover new and appended cards before and after their same-ID persisted entries appear. They assert one logical card throughout the transition and verify that edit drafts remain editable. The full build validates TypeScript, lint, Obsidian compliance, bundling, and release artifact security.
