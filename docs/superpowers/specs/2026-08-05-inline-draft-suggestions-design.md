# Inline Draft Suggestions Design

## Summary

Aside will replace the full-screen suggestion modals for `@` mentions and `#` tags with one compact, editor-owned dropdown rendered directly beneath the active comment textarea. The textarea keeps focus, results filter as the user types, and up to six rows remain visible before the list scrolls. `[[` note-link suggestions keep their existing modal because file paths and note creation need the larger presentation.

The tag dropdown suggests existing tags only. It does not render a synthetic “Create tag” row. When no existing tag matches, the dropdown closes and the user can continue typing; the unmatched text becomes a new tag naturally when the comment is saved.

This design supersedes only the mention-modal presentation in the approved vault-script mention design and plan. It preserves their query, registry, insertion, routing, execution, and Regenerate policies. No existing implementation plan covers the combined inline mention-and-tag interaction, so this spec will receive a new plan after approval.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Mention query parsing, replacement, ranking, and live vault-script candidates exist.
- [x] Tag query parsing, replacement, vault-tag ranking, and usage counts exist.
- [x] New, append, and edit drafts share the same textarea rendering and draft editor controller.
- [x] Wiki-link suggestions have precedence over mention and tag suggestions inside an open `[[` query.
- [x] The built plugin can be installed and reloaded in the `lean-startup` test vault.

### To Implement

- [ ] Add one reusable inline dropdown presentation for mention and tag suggestions beneath the active draft editor.
- [ ] Keep textarea focus while filtering suggestions on every relevant input event.
- [ ] Update the active query and replacement range as the user types or backspaces.
- [ ] Support mouse selection and Up, Down, Enter, Tab, and Escape keyboard behavior.
- [ ] Preserve the existing mention candidates and ranking, including current runnable vault scripts.
- [ ] Extract tag suggestion planning from the modal and remove the synthetic create-tag candidate.
- [ ] Keep `[[` link suggestions on the existing modal path.
- [ ] Remove obsolete mention and tag modal code after their callers move to the inline component.
- [ ] Add theme-aware styling, a six-row visible height, scrolling, and accessible listbox semantics.

### Verification

- [ ] Fail-first tests cover live mention and tag filtering while textarea focus remains active.
- [ ] Tests cover selection by mouse, Up/Down plus Enter, and Tab.
- [ ] Tests cover Escape closing the dropdown before a later Escape can cancel the draft.
- [ ] Tests cover unmatched `#tag` text remaining editable and savable without a create row.
- [ ] Tests cover zero matches, invalidated tokens, blur, save, cancel, rerender, and disconnected textareas.
- [ ] Regression tests cover wiki-link precedence and new, append, and edit draft modes.
- [ ] The complete repository build and release-artifact guard pass.
- [ ] A built-plugin smoke test in `lean-startup` confirms placement, filtering, focus, keyboard behavior, and unmatched new-tag typing.

## Goals

- Make small mention and tag completions feel like autocomplete inside the comment card rather than a separate workflow.
- Let users continue typing in the original textarea while results narrow immediately.
- Keep the menu visually stable beneath the editor and compact enough for narrow sidebars.
- Reuse one interaction model for `@` and `#` without merging their distinct query and result policies.
- Preserve the existing live vault-script registry and vault-tag index as the data sources.

## Non-Goals

- Moving `[[` note-link suggestions inline.
- Adding a create-tag command or confirmation step.
- Changing tag syntax, tag persistence, mention syntax, or script execution behavior.
- Adding fuzzy search beyond the existing mention and tag ranking rules.
- Creating a general application-wide autocomplete framework outside draft editors.

## Interaction Design

### Placement and visual behavior

The dropdown is part of the draft editor’s normal layout, between the textarea shell and the draft action row. It aligns to the editor width instead of floating at the text caret. Opening it may move the action row downward, but it must not obscure the textarea or escape the comment card.

The dropdown displays at most six rows at once. Additional results remain available by scrolling, up to a shared cap of 40 results. Each row uses Obsidian theme variables and keeps the current useful detail:

- mention rows show the directive and its built-in label or vault script path;
- tag rows show the existing tag and its usage count.

The active row has a clear theme-aware highlight. The textarea exposes the open list through `aria-controls`, `aria-expanded`, and `aria-activedescendant`; the menu and rows use `listbox` and `option` roles.

### Opening and filtering

Typing a valid standalone `@` opens mention suggestions. Typing a valid `#` opens existing tag suggestions. The textarea retains focus, and every subsequent text insertion, composition update, or deletion recomputes the active query and filters the list immediately.

Backspacing widens the results when the shorter query is still valid. The menu closes when:

- the cursor or selection leaves the active token;
- the token becomes invalid;
- no provider result matches;
- the textarea loses focus to a non-menu target;
- the user presses Escape;
- the draft is saved, cancelled, rerendered, or disconnected; or
- another suggestion flow takes ownership.

An open `[[` query always wins. Mention or tag dropdowns close before the link modal opens.

### Selection

While the dropdown is open:

- Up and Down move the active row and keep it scrolled into view;
- Enter or Tab selects the active row and prevents the draft’s normal Enter/Tab behavior;
- Escape closes only the dropdown and keeps the draft active;
- a later Escape, with no dropdown open, retains the existing draft-cancel behavior;
- mouse selection inserts the chosen value without losing the draft or moving focus permanently.

Selection replaces only the current live query range. It does not use the value captured when the dropdown first opened, so surrounding edits and continued filtering cannot be overwritten by a stale snapshot.

## Suggestion Policies

### Mentions

Mention candidates and ordering remain unchanged: `@todo`, supported agents, then current non-conflicting runnable vault scripts. The menu reads the current registry whenever it recomputes, so newly registered scripts participate without restarting Obsidian.

### Tags

Tag suggestions contain existing indexed tags only and retain the existing case-insensitive ranking and usage-count ordering. No create candidate is produced. If the user types a tag that does not exist, the empty menu closes while the typed `#tag` remains in the textarea. Saving the comment follows the existing tag extraction and indexing path, which makes the new tag available to later suggestions.

### Links

`[[` continues to open `SideNoteLinkSuggestModal`. Its note path, create-note behavior, and larger result surface do not move into the inline component.

## Architecture

### Shared inline presentation

A focused inline menu unit owns only presentation state:

- its container and option elements;
- the current result list and active index;
- rendering, scrolling, accessibility attributes, and open/close cleanup; and
- callbacks for choosing or dismissing a result.

It does not parse draft text, mutate comments, or load vault data. Mention and tag result types remain distinct and supply their own row renderer and selection value.

### Draft editor coordination

`SidebarDraftEditorController` owns the active suggestion session. On each relevant textarea input or selection change it:

1. checks for an open wiki-link query;
2. resolves a live mention or tag query from the current textarea value and selection;
3. requests current results from the appropriate host provider;
4. opens, updates, switches, or closes the shared inline menu; and
5. replaces the current query range when a result is chosen.

The controller exposes whether it consumed a key so the draft renderer can preserve existing list-continuation, Tab, and Escape behavior whenever no inline menu action applies.

### Host and data boundaries

`AsideView` continues to adapt plugin-owned data into editor providers:

- mention suggestions come from the current runnable vault-script registry plus built-ins;
- tag suggestions come from the current indexed vault tags plus tags found in indexed comments; and
- link suggestions continue through the existing modal adapter.

Tag collection and ranking move into a pure editor-level module so they no longer depend on a modal class. After both inline paths are wired and verified, the obsolete mention and tag modal classes and imports are removed.

## Error and Lifecycle Handling

The dropdown has no network or persistence behavior. Empty or stale providers close the menu without changing the draft. A script removed after insertion remains governed by the existing saved-entry validation and script-run failure behavior; autocomplete does not bypass execution checks.

All listeners and menu nodes are scoped to the rendered draft. Closing a session removes its DOM and accessibility attributes. Rerender and disconnection checks prevent callbacks from applying an edit to a replaced textarea; the existing draft update and scheduled-focus path remains the fallback when selection causes a render.

On narrow or mobile layouts, the menu remains within the comment card width and scrolls internally after six rows. It must not introduce a viewport-fixed overlay or require caret-coordinate measurement.

## Testing Strategy

Pure tests cover mention and tag query resolution, provider filtering, existing-tag-only behavior, and replacement against the latest textarea value. Controller tests cover session transitions, live input updates, keyboard consumption, mouse choice, link precedence, and cleanup. Presentation tests cover the six-row class contract, active-row state, scrolling calls, and accessibility attributes without duplicating provider logic.

Regression coverage exercises new, append, and edit drafts. The final built-plugin smoke test in `lean-startup` verifies that:

1. typing `@` opens an editor-width menu and filters current vault scripts;
2. typing `#` filters existing tags;
3. typing an unmatched tag leaves ordinary editable text with no create row;
4. keyboard and mouse selection insert only the active query;
5. textarea focus remains active throughout filtering; and
6. `[[` still opens the existing link modal.
