# Share Side Notes During Inline Editing

**Date:** 2026-08-19

**Objective:** Keep Share side note available while a persisted parent or child entry is being edited inline, without saving or closing the active draft, and report copied feedback only after a successful clipboard write.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Reproduced the regression with the persisted-card renderer: an active edit draft renders zero Share buttons.
- [x] Verified the existing URI builder includes the encoded vault name, file path, and comment id.
- [x] Verified the feature branch starts from a clean `main` baseline with 1,121 compiled tests and 92 contract tests passing.

### To Implement

- [x] Render Share for an inline-edited parent entry without restoring unrelated footer actions.
- [x] Render Share for an inline-edited child entry without restoring unrelated footer actions.
- [x] Let Share copy the stable persisted location without saving, cancelling, or closing the active draft.
- [x] Propagate clipboard success or failure to the footer and show Copied feedback only on success.
- [x] Merge the verified feature branch back into `main` and remove the temporary branch/worktree.

### Verification

- [x] A parent edit-mode regression test proves Share stays visible, copies the parent URI, and does not invoke draft saving.
- [x] A child edit-mode regression test proves Share stays visible, copies the child URI, and does not invoke draft saving.
- [x] A clipboard-failure regression test proves false success feedback is not shown.
- [x] Existing non-edit Share feedback behavior continues to pass.
- [x] Full test, lint, typecheck, Obsidian compliance, and production bundle checks pass on the feature branch and merged `main`.

## Context

The persisted-card renderer currently wraps header and footer actions in `if (!editDraft)` guards. This correctly suppresses destructive or state-changing controls while an edit is active, but it also removes Share. Share does not depend on the draft body: its payload is the persisted entry's stable vault, file path, and comment id.

The click handler also calls the general save-visible-draft guard before writing the URI. That couples a read-only copy action to draft validation and rerendering. Finally, the host discards the clipboard writer's boolean result, so the footer can display Copied after a failed write.

## Approaches Considered

### 1. Render the complete footer during editing

This is mechanically small but would also expose Add to thread, regenerate, move, redirect, and other actions whose save-first behavior conflicts with an active draft. Rejected because it broadens the change and weakens the edit-state safety boundary.

### 2. Render a Share-only footer during editing

Use the existing footer renderer with every option disabled except Share. Make Share independent from the save guard and return the clipboard result through the host boundary. This preserves one rendering and feedback path while keeping all unrelated actions suppressed. Selected.

### 3. Add a second Share control to the draft editor

This would keep persisted and draft actions separate, but it duplicates placement, styling, interaction, and tests. Rejected because the existing persisted-card footer already owns Share and can express the edit-state policy directly.

## Design

### Rendering policy

Parent and child persisted entries continue to render their full action sets only when no inline edit draft is active. When an edit draft is active, the same card renders a footer configured with Share as its only action. Index source-redirect cards and deleted entries continue to suppress Share under their existing conditions.

### Clipboard flow

The Share click remains an explicit user gesture and calls the existing `copyCommentLocationToClipboard` adapter. It does not call `saveVisibleDraftIfPresent`, because the persisted location does not depend on draft text. The adapter's boolean result crosses the `SidebarPersistedCommentHost.shareComment` boundary.

When the result is `true`, the existing one-second Copied feedback runs. When the result is `false`, the button remains in its normal Share state. This change introduces no clipboard reads, background clipboard access, or clipboard logging.

### Testing

Renderer tests exercise the real button click path with parent and child edit drafts. They assert the exact shared entry id, verify draft-saving is not called, and inspect feedback state. A failure-path test makes `shareComment` return `false` and proves Copied is not rendered. Existing pure adapter tests continue to own exact URI encoding.

## Acceptance Criteria

1. Share remains visible for editable parent and child side-note entries while their inline editor is open.
2. Clicking Share copies the persisted entry URI containing its vault, file path, and comment id.
3. Sharing neither saves nor closes the current edit draft.
4. Copied feedback appears only after a successful clipboard write.
5. No other actions become newly available during inline editing.
6. Existing Share behavior outside edit mode remains unchanged.
