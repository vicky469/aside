# Thought Trail Attachment Filename Alignment

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Thought Trail attachments render filenames through the scoped `.aside-thought-trail-attachment-link` button.
- [x] The filename button already uses `text-align: left` and retains ellipsis behavior for long names.

### To Implement

- [ ] Align the attachment filename button's flex content to the left with `justify-content: flex-start`.
- [ ] Leave the attachment type label and all other Thought Trail layout unchanged.

### Verification

- [ ] The stylesheet regression test requires left flex alignment on the attachment filename button.
- [ ] The focused stylesheet test passes.
- [ ] The production build passes, including release artifact inspection.

## Problem

Obsidian presents buttons as flex containers. The Thought Trail attachment filename button sets `text-align: left`, but that property does not move centered flex content to the start of the button. As a result, filenames can still appear centered.

## Design

Add `justify-content: flex-start` to the existing, highly scoped `.aside-thought-trail button.aside-thought-trail-attachment-link` rule. This aligns only the filename text inside attachment buttons and preserves the current flex sizing, type label, truncation, hover state, and surrounding attachment layout.

Extend the existing Thought Trail attachment stylesheet regression test to require this property. No renderer markup or TypeScript behavior changes are needed.
