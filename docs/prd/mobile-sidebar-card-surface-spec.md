# Mobile Sidebar Card Surface Spec

## Status

Draft implementation spec based on:

- [mobile-sidebar-card-surface-mismatch.md](../issue/mobile-sidebar-card-surface-mismatch.md)

## Objective

Make Aside sidebar cards read as one consistent Obsidian-style card on desktop and mobile.

The fix should simplify the CSS model instead of adding more mobile-only patches. Desktop and mobile should share the same card surface contract wherever possible.

## Problem

The mobile sidebar can show a white or lighter band inside an active or edited side-note card.

The mismatch appears around content, action buttons, footers, replies, or edit mode depending on which local patch is applied. That means the root problem is not one bad color. The root problem is that multiple descendants inside the card are allowed to paint their own surfaces.

## Scope

In scope:

- sidebar side-note card surface rules
- active card state
- persisted Markdown content
- thread reply rendering
- card footer and action rows
- inline edit and append draft surfaces
- desktop/mobile CSS alignment

Out of scope:

- redesigning the sidebar layout
- changing stored thread data
- replacing Obsidian Markdown rendering
- changing `[[` link suggestion or `#` tag suggestion behavior
- making the sticky toolbar transparent

## Decision Summary

### Decision 1: One Card Owns The Surface

The top-level side-note card shell owns the visual card surface.

The card shell owns:

- background
- border
- radius
- padding
- active border state

Card descendants should not paint their own full-width backgrounds unless there is a documented exception.

Primary owner:

```css
.aside-comment-item
```

### Decision 2: Card Descendants Are Surface-Neutral

Content, Markdown wrappers, headers, footers, action rows, and editor wrappers should inherit the card surface.

They should not create lighter bands, white panels, or nested card surfaces.

Recommended CSS direction:

```css
.aside-comment-item :where(
  .aside-comment-content,
  .markdown-rendered,
  .aside-comment-header,
  .aside-comment-actions,
  .aside-thread-footer,
  .aside-thread-footer-actions,
  .aside-inline-editor
) {
  background: transparent;
  box-shadow: none;
}
```

This should be one scoped contract, not many scattered mobile fixes.

### Decision 3: Nested Replies Are Reply Blocks, Not Cards

Expanded thread replies should not behave like independent cards inside the parent card.

Preferred model:

- top-level side notes are cards
- nested replies are reply blocks
- replies may use indentation, spacing, or a subtle left border
- replies do not paint a separate card background

If a reply currently receives `.aside-comment-item`, either remove that card-shell class from replies or override reply styling in one intentional place.

### Decision 4: Markdown Renders Text, Not The Card

Persisted comment content should stay close to Obsidian's native Markdown rendering.

Obsidian/theme CSS should own:

- paragraph styling
- links
- lists
- code
- callouts
- typography

Aside should own:

- the card shell
- card spacing
- card actions
- card active state

The Markdown wrapper must not behave like a full markdown pane with its own pane background inside the card.

### Decision 5: Edit Mode Uses The Preview Slot

Editing should not introduce a larger or different-looking surface than preview.

When a card enters edit mode:

- the editor occupies the same content slot as the preview
- the textarea/editor inherits the card surface
- editor chrome does not add a second card or white panel
- save, cancel, formatting, `[[`, and `#` behavior remain on the existing input path

Avoid a separate mobile editor model unless the shared editor surface cannot be made stable.

### Decision 6: Mobile CSS Is Layout-Only By Default

Desktop and mobile should share the same card surface CSS.

`.is-non-desktop` may handle:

- scroll sizing
- safe-area padding
- keyboard spacing
- toolbar wrapping
- touch target sizing

`.is-non-desktop` should not define a separate card theme, Markdown surface, footer surface, or editor surface.

### Decision 7: Toolbar Chrome Is Separate

The sticky sidebar toolbar is not part of the card surface.

It should stay opaque enough for readability while comments scroll underneath it.

## Surface Ownership Table

| Element | Surface owner |
| --- | --- |
| Top-level side-note card | `.aside-comment-item` |
| Active card border | `.aside-comment-item` state |
| Markdown content | transparent; text styling from Obsidian |
| Header actions | transparent row; button-only hover/focus |
| Footer actions | transparent row; button-only hover/focus |
| Nested replies | transparent reply block inside parent |
| Inline editor | transparent editor in preview slot |
| Toolbar/search area | separate opaque toolbar chrome |

## Implementation Notes

### CSS

1. Audit current selectors touching:

   - `.aside-comment-item`
   - `.aside-thread-entry-item`
   - `.aside-comment-content`
   - `.markdown-rendered`
   - `.aside-thread-footer`
   - `.aside-inline-editor`
   - `.is-non-desktop`

2. Define the card shell once.

3. Add one scoped descendant rule for surface neutrality.

4. Remove mobile-only background patches that duplicate the card contract.

5. Keep mobile overrides only when they are layout or platform fixes.

### Rendering

1. Confirm persisted comments still use Obsidian Markdown rendering.

2. Confirm nested replies do not need to carry the top-level card shell class.

3. Confirm edit mode mounts into the same content area as preview.

4. Confirm editor controls do not add a full-width background.

## Verification

Check the same thread on desktop and mobile emulation.

States to verify:

- normal persisted card
- active persisted card
- expanded thread with replies
- append draft
- inline edit
- footer action row
- header action row

Computed-background checks should show:

- the card shell has the card background
- content, Markdown wrapper, replies, footers, actions, and editor wrappers are transparent
- toolbar/search remains opaque and readable

## Acceptance Criteria

- Desktop and mobile cards use the same surface model.
- Mobile active/editing cards do not show a white or lighter band.
- Preview and edit mode occupy the same visual content area.
- Nested replies do not appear as independent cards inside a card.
- Persisted Markdown remains close to Obsidian's native rendering.
- `[[` link suggestions and `#` tag suggestions still work while editing.
- No hard-coded white or grey values are introduced.
- Mobile-specific CSS is layout-only unless a platform exception is documented.

## Non-Goals

- Do not introduce a separate mobile card theme.
- Do not replace Obsidian Markdown rendering with a custom renderer.
- Do not solve the issue with `!important` as the primary mechanism.
- Do not make the sticky toolbar transparent.
