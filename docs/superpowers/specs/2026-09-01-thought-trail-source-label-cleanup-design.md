# Thought Trail Source Label Cleanup Design

**Date:** 2026-09-01
**Status:** Approved

## Goal

Reduce visual crowding in the Thought Trail source selector by removing the visible `Related Files By` prefix while preserving the Wikilinks, Tags, and Attachments controls and the dynamic scope note.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Thought Trail renders one shared source control for note and index surfaces.
- [x] The source choices and dynamic `Scope: Vault` or `Scope: File` note are already owned by that shared control.
- [x] The user approved removing only the visible prefix and retaining the controls and scope note.
- [x] The user explicitly approved skipping new tests for this copy-only change.

### To Implement

- [ ] Remove the visible `Related Files By` element from the shared Thought Trail source control.
- [ ] Preserve the same context as an accessible label on the radio-options group.
- [ ] Keep source ordering, selection, availability, and scope behavior unchanged.

### Verification

- [ ] Confirm the production source and bundle contain no visible source-label element.
- [ ] Confirm the installed `lean-startup` artifacts match the rebuilt repository artifacts.
- [ ] Confirm Aside reloads in `lean-startup` with the rebuilt bundle.
- [ ] Run the repository production build; do not add a new targeted test per the user's explicit instruction.

## Design

The renderer will stop creating the visible `aside-thought-trail-source-label` span. The existing source-options container will receive `role="radiogroup"` and `aria-label="Related files by"`, keeping the meaning available to assistive technology without consuming visual space.

The visible control becomes:

```text
( ) Wikilinks  ( ) Tags  ( ) Attachments    Scope: File
```

No source definitions, attachment discovery, fallback rules, event handling, or scope logic will change. The obsolete label style may remain if it is shared or harmless; otherwise it can be removed only when confirmed unused.

## Verification Strategy

No new test will be added, as explicitly requested. Verification will use the existing production build, source and bundle inspection, exact installed-artifact comparison, and the plugin startup log after reloading `lean-startup`.

## Non-Goals

- Renaming or removing the Wikilinks, Tags, or Attachments choices.
- Removing or shortening the dynamic scope note.
- Changing source selection, availability, attachment behavior, or layout beyond the redundant prefix.
- Changing the plugin version or publishing a release.
