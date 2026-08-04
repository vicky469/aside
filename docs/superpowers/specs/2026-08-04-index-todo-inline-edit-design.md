# Index Todo Inline Editing Design

**Date:** 2026-08-04
**Status:** Approved design; pending implementation plan

## Goal

Let users edit `@todo` side-note entries directly from the generated index sidebar's Todo tab. Removing the final `@todo` from a thread should make that thread leave the Todo results after the edit is saved.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside can filter index-sidebar threads by case-insensitive `@todo` mentions.
- [x] Aside has an inline draft editor and canonical mutation path for existing parent and child entries.
- [x] Index cards can navigate to their original source comments.

### To Implement

- [ ] Centralize exact entry-level Todo matching beside the existing thread-level matcher.
- [ ] Enable inline editing only when the generated index sidebar is in its effective Todo mode.
- [ ] Show an edit pencil only on parent or child entries whose bodies contain `@todo`.
- [ ] Keep the existing source-navigation action beside the Todo edit pencil.
- [ ] Automatically reveal matching child entries without changing the stored collapse preference.
- [ ] Re-filter the Todo results after a successful save.

### Verification

- [ ] Add focused matcher, renderer, nested-entry, and mutation-flow regression tests.
- [ ] Confirm other index modes remain redirect-only and note-sidebar editing is unchanged.
- [ ] Confirm removing the final `@todo` removes the thread while remaining Todo entries keep it visible.
- [ ] Run the full test, lint, typecheck, Obsidian compliance, build, and release-artifact checks.

## User Experience

The feature is available only in the generated index sidebar's Todo tab. A parent entry or reply containing case-insensitive `@todo` receives an edit pencil. The existing source-navigation control remains visible beside it.

Clicking the pencil replaces that exact entry with Aside's existing inline editor. Save and cancel behave like inline editing in a normal note sidebar. When a matching Todo occurs in a reply, the reply is automatically rendered even if the thread would otherwise be collapsed.

After a successful save, the index is refreshed and the Todo filter is applied again:

- If the edited entry contained the thread's final `@todo`, the thread disappears from the Todo tab.
- If another parent or child entry still contains `@todo`, the thread remains.
- Cancelling or failing to save leaves the stored comment and Todo result unchanged.

## Scope

### Included

- The generated index sidebar's Todo tab.
- Parent entries and child replies containing `@todo`.
- Existing inline edit, save, cancel, and source-navigation behavior.
- Case-insensitive matching consistent with the current Todo thread filter.

### Excluded

- Edit controls in the index List, Agent, Tags, or Thought Trail modes. Filtering the Todo tab with its search box does not disable Todo editing.
- A one-click Done action or automatic deletion of Todo text.
- New settings, persisted UI state, storage fields, or migrations.
- Changes to how `@todo` is represented in comment bodies.
- Changes to note-sidebar editing outside the generated index.

## Architecture

### Todo matching

`src/ui/views/sidebarThreadGroups.ts` remains the owner of Todo membership. It should expose an entry-level matcher that uses the same case-insensitive `@todo` token rule as the thread-level matcher. Thread matching should delegate to the entry matcher so the two rules cannot drift.

The matcher evaluates stored entry bodies. It does not mutate text or infer completion state from any separate field.

### View-level capability

`AsideView` derives an explicit inline-Todo-edit capability only when both conditions are true:

1. The current surface is the generated all-comments index.
2. The effective index sidebar mode is `todo` after visibility and availability fallbacks.

The capability is passed to the shared persisted-card renderer. Other index modes do not receive it, even if a rendered entry happens to contain `@todo`.

### Card actions

The shared card renderer currently treats source redirect and mutation actions as mutually exclusive. The implementation should separate those decisions:

- Source-navigation remains controlled by the index-surface policy.
- Inline editing is allowed by an entry-level predicate supplied by the Todo capability.
- Only entries that satisfy the Todo matcher receive an edit pencil.

This avoids enabling delete, append, pin, move, or other mutation controls in the index sidebar. The new capability authorizes editing only.

### Matching replies

When a child reply contains `@todo`, Todo mode must render that reply even if the thread's normal nested state is collapsed. This is a render-time override, not a call to update the user's stored expand/collapse preference.

Only matching replies need forced visibility. Existing rules may still reveal additional replies for searches, agent streams, drafts, or the user's normal nested preference.

## Data Flow

1. The index sidebar loads canonical threads from the existing aggregate index.
2. Todo mode filters threads using the shared Todo entry matcher.
3. `AsideView` identifies matching entry IDs and renders matching replies.
4. The card renderer shows source navigation plus an edit pencil on each matching entry.
5. Clicking edit calls the existing `startEditDraft` path with the selected entry ID and the index view as the draft host.
6. The mutation controller reloads the latest canonical target and preserves its original source-file identity.
7. Saving uses the existing edit mutation and source-sidecar persistence path.
8. The normal refresh rebuilds the aggregate index and re-applies Todo filtering.

The generated index note is never used as the comment's persistence target.

## Failure Handling

- If an entry disappears or cannot be reloaded before editing starts, the existing mutation controller should decline to create the draft; no stale entry is edited.
- A save failure must retain the existing draft/error behavior and must not remove the card optimistically.
- A concurrent edit is resolved by the existing latest-target load and persistence safeguards rather than a Todo-specific conflict system.
- Auto-revealing a matching reply must not write view state, so a render failure cannot corrupt collapse preferences.

## Testing Strategy

### Matcher tests

- Parent and child bodies match `@todo` case-insensitively.
- A thread matches when any current entry matches.
- Similar text that does not satisfy the existing token boundary remains unmatched.

### Renderer and view tests

- Todo index entries show both source-navigation and edit actions.
- Nonmatching entries in the same Todo thread do not receive edit actions.
- Matching child replies are rendered while the thread is normally collapsed.
- Index List and other modes remain redirect-only.
- Normal note-sidebar edit actions are unchanged.

### Mutation-flow tests

- Saving a parent or child edit targets the original source comment.
- Removing the final `@todo` makes the thread leave Todo results after refresh.
- Removing one Todo while another remains keeps the thread visible.
- Cancelled and failed saves do not change Todo membership.

## Acceptance Criteria

The feature is complete when a user can open the generated index sidebar's Todo tab, edit any exact parent or reply containing `@todo` inline, retain access to the source-navigation action, and see the Todo list update from canonical stored data after saving, with no new edit surface in other index modes.
