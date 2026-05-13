# Mobile Sidebar Card Surface Mismatch

Related spec:

- [mobile-sidebar-card-surface-spec.md](../prd/mobile-sidebar-card-surface-spec.md)

## Natural-language issue

On mobile, the Aside sidebar does not look like the desktop sidebar when a side-note card is active or being edited.

In `Screenshot 2026-04-30 at 3.24.02 PM.png`, normal side-note cards look consistent: each card has one clean surface, a subtle border, and the text sits directly on the card. The active card at the bottom breaks that model. It has the same purple active border, but the inside of the card is split into multiple visual layers:

- the card shell has one background
- the rendered comment text appears on a lighter horizontal band
- top-right and bottom-right action icons sit on that same mismatched band
- the active card no longer reads as one desktop-style card

The user-facing problem is: the mobile active/editing state feels like a different component from the normal sidebar card. It should feel like the desktop card design, not like a native mobile form sheet embedded inside a card.

Reference screenshot:

`/Users/wenqingli/Downloads/Screenshot 2026-04-30 at 3.24.02 PM.png`

## Why this happens on mobile

This is not one isolated color bug. It is a surface ownership problem.

Aside currently mixes several surfaces inside the same visual card:

1. The card surface

   `.aside-comment-item` owns the card background through `--aside-comment-background`.

2. The persisted comment renderer

   `src/ui/views/sidebarPersistedComment.ts` creates `.aside-comment-content` and also adds Obsidian's global `markdown-rendered` class to it.

   That is useful for markdown rendering, but it also means the content region is participating in Obsidian's markdown preview styling model. On desktop this may be subtle. On mobile, where Obsidian and WebKit use different default surfaces and rendering behavior, this can show up as a full-width lighter band inside the Aside card.

3. The draft/editor shell

   `.aside-inline-editor-shell`, `.aside-inline-editor-preview`, and `.aside-inline-textarea` create another nested surface. Desktop uses the preview-plus-transparent-textarea overlay to preserve inline styling while typing.

4. The mobile override

   `.aside-view-container.is-non-desktop` adds a separate branch of CSS for mobile. Previous fixes tried to force the draft/editor to one mobile surface. That reduced one symptom but also created drift from the desktop card model.

5. Native mobile textarea behavior

   iOS/WebKit textareas can draw native backgrounds, text fill, focus affordances, selection surfaces, and composited layers differently from desktop Electron. If Aside relies on a transparent textarea layered over a preview, mobile can expose the wrong layer unless the component explicitly defines which surface is authoritative.

The screenshot shows the result: Aside does not have one stable "card surface contract." Instead, card, markdown content, editor preview, textarea, and action rows each have a chance to paint their own surface.

## Why this is mobile-specific

Desktop Obsidian and mobile Obsidian do not render this stack the same way:

- desktop runs in Electron and tends to respect the existing transparent textarea plus preview overlay more predictably
- mobile runs in WebKit, where native form controls and text compositing are more opinionated
- Aside currently marks mobile with `is-non-desktop`, which means mobile has a second set of CSS rules that can drift from the desktop rules
- Obsidian mobile theme variables can have stronger contrast between `background-primary`, `background-secondary`, and markdown preview surfaces

So the problem appears on mobile because mobile is the only runtime where all three risks combine: native form control painting, global markdown-rendered styling inside a custom card, and mobile-only Aside CSS overrides.

## What would be a hack

These should be avoided:

- hard-coding white, grey, or near-white colors
- adding more one-off `is-non-desktop` background overrides for individual child elements
- using `!important` as the primary design mechanism
- hiding the mismatch by making borders or opacity weaker
- fixing only `.aside-inline-textarea` when the screenshot also shows persisted active-card content and action rows

Those approaches treat symptoms. They do not define which element owns the card surface.

## Simplified plan

### Guiding rule

Aside should have one card surface.

The top-level card shell owns the background, border, radius, and padding. Everything inside that shell should be transparent unless there is a clearly documented reason for a second surface.

In practice:

- `.aside-comment-item` is the card shell.
- `.aside-comment-content`, `.markdown-rendered`, headers, footers, action rows, and editor wrappers do not paint their own background.
- Hover and focus states can paint the button itself, but not a full row or band behind the content.

### 1. Prefer one desktop/mobile CSS model

Desktop and mobile should use the same card surface contract.

Keep `.is-non-desktop` only for mobile layout and platform behavior, such as:

- scroll area sizing
- bottom safe-area padding
- keyboard spacing
- toolbar wrapping
- touch target sizing

Do not use `.is-non-desktop` to define a separate card theme, markdown surface, footer surface, or editor surface.

If the desktop and mobile CSS can be identical for cards, prefer that. If mobile needs an override, it should be the smallest layout-only override possible.

### 2. Let Obsidian render Markdown, but not the card

Persisted comment content should stay close to Obsidian's native Markdown rendering.

That means keeping the normal markdown rendering path for text, links, lists, code, callouts, and theme typography.

But the Markdown wrapper should not behave like a full Obsidian markdown pane inside the Aside card. It should not add a pane background, a full-width band, or extra pane padding.

The boundary should be:

- Obsidian owns Markdown text styling.
- Aside owns the card shell.

### 3. Nested replies should not be full cards

Expanded thread replies are likely the biggest source of repeated surface bugs.

If a reply entry carries `.aside-comment-item`, it inherits the same card shell as a top-level note. That makes the reply look like a second card inside the first card, and any transparent/background fix can move the white block instead of removing it.

Preferred model:

- top-level side notes are cards
- nested replies are reply blocks inside the parent card
- replies may have indentation, spacing, or a subtle left border
- replies should not paint a separate card background

This is cleaner than patching every child selector that happens to draw a background.

### 4. Keep editor and preview the same size

Editing should not introduce a larger or different-looking surface than preview.

When a card enters edit mode:

- the edit area should occupy the same content slot as the preview
- the textarea/editor should inherit the card surface
- editor chrome should not add another card or white panel
- save, cancel, formatting, `[[` link suggestions, and `#` tag suggestions should keep using the existing input behavior

Avoid a separate mobile editor model unless the shared desktop/mobile editor is proven impossible to make stable.

### 5. Keep toolbar chrome separate

The sidebar toolbar is not part of the card surface.

It can stay opaque so text does not scroll behind it and become hard to read. The card simplification should focus on side-note cards, replies, footers, and editors.

## Acceptance criteria

- Desktop and mobile cards use the same surface model.
- An active mobile card does not show a white or lighter band through content, actions, footer, or editor.
- Preview and edit mode occupy the same visual content area.
- Nested replies do not look like independent cards inside a card.
- Persisted Markdown stays close to Obsidian's native rendering.
- No hard-coded white or grey values are introduced.
- Mobile-specific CSS is layout-only unless there is a documented platform reason.

## Likely files involved

- `styles.css`
  - collapse card, reply, markdown, footer, and editor surfaces into one card contract
  - remove mobile-only surface overrides where possible

- `src/ui/views/sidebarPersistedComment.ts`
  - confirm persisted comments keep Obsidian Markdown rendering without letting the wrapper become a pane surface

- `src/ui/views/sidebarDraftComment.ts`
  - confirm edit mode uses the same content slot and does not add a larger nested surface

## Recommended implementation order

1. Audit current card-related selectors in `styles.css`.
2. Define the card shell once on `.aside-comment-item`.
3. Make card descendants surface-neutral with one scoped rule instead of many mobile patches.
4. Change nested replies so they are reply blocks, not full card shells.
5. Keep persisted Markdown on the native Obsidian rendering path.
6. Check edit mode against preview mode and remove any extra editor surface.
7. Verify desktop and mobile with the same side-note thread before adding any mobile-only CSS.
