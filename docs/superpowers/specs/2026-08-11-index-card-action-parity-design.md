# Index Card Action Parity Design

## Summary

Aside will move each Index card's **Open source** action from the card header to the bottom-right footer action row. File-scoped Index child cards will expose the same edit, delete, and drag controls as child cards in an individual-file sidebar whenever the current Index mode renders interactive cards. The unscoped global Todo surface remains editable and deletable but does not expose drag controls.

Each rendered Index card still represents one canonical thread entry from one source file. Entry mutations continue to resolve that canonical source by comment ID, while the existing move controller remains responsible for rejecting a drop whose source and destination belong to different files.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code change is complete and the listed verification passes.

### Already Done

- [x] Parent and child Index cards share the persisted-card renderer used by individual-file sidebars.
- [x] Edit, delete, and move handlers resolve stored entries through their canonical comment and thread IDs.
- [x] The move controller rejects child moves between different source files.
- [x] Index List, Todo, and Agent modes already share an explicit card-action policy that can be extended with scope.

### To Implement

- [ ] Render the Index source redirect as the final footer action on parent and child cards.
- [ ] Remove the source redirect from Index card headers without changing its click behavior or presentation.
- [ ] Permit active Index child entries to expose edit and delete actions in file-scoped List, Todo, and Agent modes and in unscoped global Todo.
- [ ] Enable the existing child drag handle for file-scoped Index cards while keeping unscoped global Todo drag-free.
- [ ] Keep non-card Index modes read-only and preserve existing deleted-entry controls.

### Verification

- [ ] Fail-first renderer tests locate both parent and child source redirects in their footer action rows and not in their headers.
- [ ] Renderer tests prove the footer redirect opens the correct parent or child source entry.
- [ ] Action-policy and renderer tests prove file-scoped Index children receive edit, delete, and drag controls while unscoped global Todo receives edit and delete without drag.
- [ ] Tests preserve the read-only policy for non-card Index modes and existing individual-file card behavior.
- [ ] Relevant focused tests, the full build, and the release-artifact security guard pass.

## Context

The Index currently renders **Open source** beside edit, delete, pin, and drag controls in each card header. Individual-file cards keep secondary navigation actions in the footer, making the Index placement visually inconsistent.

Index parent cards recently regained valid mutation actions, but child edit remains limited to `@todo` entries in Todo mode, child deletion remains disabled, and child drag handles remain note-sidebar-only. These are policy remnants from the earlier read-only Index design rather than storage limitations. A child entry belongs to a canonical thread in a single source file regardless of which sidebar renders it.

## Considered Approaches

### Extend the shared footer and card-action policy (selected)

Pass the existing source-redirect presentation into the shared footer renderer and render it after all other footer actions. Expand the existing card-action state so active child entries receive edit, delete, and drag permission wherever interactive Index cards are supported.

This keeps parent and child behavior in one rendering path, reuses the current right-aligned footer layout, and makes the action policy explicit and testable.

### Reposition the header action with CSS

An absolute-position or grid-placement override could make the existing header button appear near the bottom-right. The DOM ownership and keyboard order would still describe it as a header action, and the control could overlap variable-height content or footer metadata. This approach is rejected as fragile.

### Add an Index-only footer action container

A separate footer could be appended only for Index cards. That would duplicate shared footer layout, action interaction handling, and parent/child branching. This approach is rejected because future card-action changes could drift between surfaces.

## Design

### Source redirect placement

`renderThreadFooterActions` will accept an optional source-redirect presentation containing the current redirect label and icon. The function already receives the entry-specific `Comment`, so it can call the existing `renderSourceRedirectButton` without introducing another navigation handler.

For an active Index entry, the footer renderer will ensure that the footer action row exists and append **Open source** after the other footer controls. It will therefore be both bottom-aligned through the existing footer and the rightmost action in DOM and visual order. Parent and child header branches will stop rendering the redirect.

The button keeps its current classes, icon selection, accessible label, draft-save guard, event isolation, and `openCommentInEditor` behavior. Individual-file cards do not request a source redirect and remain unchanged.

### Child action parity

The shared card-action state will represent permission for active entries rather than treating Index permission as parent-only. It will also accept the resolved Index scope from `2026-08-11-index-mode-scope-gate-design.md`. In file-scoped Index List, Todo, and Agent modes:

- parent and child entries can be edited;
- parent and child entries can be soft-deleted through the existing confirmation path; and
- child entries render the same drag handle used in an individual-file sidebar.

In unscoped global Todo, parent and child entries can still be edited and soft-deleted, and every card retains **Open source**. Top-level and child drag handles remain hidden because a mixed-file aggregate has no single visible order. The previous Todo-only child-edit exception becomes unnecessary because both global and file-scoped Todo authorize active-entry editing.

Collapsed children remain collapsed unless existing visibility rules reveal them; enabling an action does not implicitly expand a thread.

Thought Trail, Tags, and any other non-card mode retain the current no-mutation action state. Deleted children continue to show restore and permanent-delete controls instead of active-entry actions.

### Mutation safety

No persistence or mutation implementation changes are required. Edit and delete continue to locate the canonical entry by ID. Child dragging continues through the existing entry-move controller, which persists the canonical source file and refuses a target thread from another file.

The cross-file guard remains a defensive boundary. The UI exposes drag handles only after one file is selected, so ordinary Index dragging has same-file targets and matches the individual-file sidebar.

## Testing

Focused renderer tests will distinguish header and footer ownership rather than checking only the global redirect count. They will verify one redirect per rendered parent or child, rightmost footer placement, and navigation with the correct entry ID.

Card-action state tests will cover file-scoped Index List, Todo, and Agent parity, unscoped global Todo's no-drag exception, and read-only modes. Persisted-card tests will cover child edit, delete, and drag attributes on the Index surface while retaining the existing note-sidebar and deleted-entry assertions.

Existing mutation-controller coverage remains the source of truth for canonical-file persistence and cross-file move rejection. The final verification run will include focused tests, the repository build, and the release artifact guard even though this change does not itself publish a release.

## Out of Scope

- Enabling Add to thread, Share, Retry, or Move thread footer actions in the Index.
- Changing drag-and-drop mutation semantics or permitting cross-file moves.
- Automatically expanding collapsed threads.
- Changing Index file filtering, search, Thought Trail, or Tags behavior.
- Cutting or publishing a release.
