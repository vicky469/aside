# Stable Slash Menu Keyboard Selection Design

## Summary

Aside will keep the inline `/` suggestion menu's existing option elements stable while Up and Down move the active selection. A stationary pointer must not reset keyboard selection, and exactly one row will carry the visual selected treatment at a time.

This design narrows and corrects the keyboard-selection behavior specified in `2026-08-05-inline-draft-suggestions-design.md`. It does not change slash-query parsing, actionable-mention policy, suggestion ordering, insertion, or script execution. No existing implementation plan covers this regression, so this spec will receive a focused plan after approval.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Typing `/` opens the inline list of registered script directives and built-in script-management directives.
- [x] The textarea owns Up, Down, Enter, Tab, and Escape while its inline suggestion session is open.
- [x] The active option is exposed through `aria-selected` and `aria-activedescendant`.
- [x] A live reproduction confirmed that rebuilding rows can let pointer hover compete with keyboard selection.

### To Implement

- [x] Update option selection classes and ARIA attributes in place when the active index changes.
- [x] Preserve existing option elements during Up and Down navigation.
- [x] Keep the active option scrolled into view.
- [x] Use `.is-selected` as the only blue row-selection state while retaining pointer selection through `mouseenter`.
- [x] Preserve Enter, Tab, Escape, query filtering, and mouse choice behavior.

### Verification

- [x] A fail-first controller test proves ArrowDown changes selection without replacing option elements.
- [x] A fail-first stylesheet test proves pointer hover cannot paint a second selected row.
- [x] Focused controller and stylesheet tests pass after the implementation.
- [x] The complete repository build and release-artifact guard pass.
- [x] The verified `main.js`, `manifest.json`, and `styles.css` are installed byte-identically in `lean-startup`.
- [x] A live Aside draft smoke test confirms `/`, repeated Up and Down, Enter, pointer movement, and single-row highlighting; controller coverage confirms the selected row is scrolled into view.

## Goals

- Make slash-menu keyboard navigation visibly reliable even when the pointer rests over the menu.
- Keep one authoritative active row for visual and accessibility state.
- Fix the regression without adding a second keyboard event route or changing suggestion policy.

## Non-Goals

- Changing which `/` directives are actionable or suggested.
- Changing suggestion ordering, result limits, menu dimensions, or insertion syntax.
- Moving keyboard handling to a document-level listener.
- Introducing persistent keyboard-versus-pointer input-mode state.
- Changing `@`, `#`, or `[[` query policies beyond behavior inherited from the shared inline menu.

## Interaction Design

Typing `/` continues to open the current compact inline menu with the first row selected. Up and Down move the single active row and keep it visible. Enter or Tab inserts that active directive, while Escape closes the menu.

Moving the pointer into a row makes that row active through the existing `mouseenter` behavior. Merely leaving the pointer stationary while using the keyboard does not change the active row. A row is painted blue only when it owns `.is-selected`; browser `:hover` does not add a competing visual selection.

## Architecture

`SidebarDraftEditorController` will continue to own the active index and option elements. Result-set changes still rebuild the list because row content may have changed. Selection-only changes will instead iterate over the existing option elements, toggle `.is-selected`, update `aria-selected`, update the textarea's `aria-activedescendant`, and scroll the active element into view.

This separates two operations that are currently conflated:

1. result rendering, which creates option elements; and
2. active-index synchronization, which mutates selection state on those elements.

The stylesheet will remove the direct `:hover` selection selector. Pointer movement remains functional because `mouseenter` already updates the controller's active index and therefore `.is-selected`.

## Error and Lifecycle Handling

Empty result sets, stale textareas, query invalidation, outside clicks, draft rerenders, and menu teardown keep their existing behavior. Selection synchronization tolerates a missing option element and removes `aria-activedescendant` when there is no valid active option. No persistence or script-execution path changes.

## Testing Strategy

The controller regression will open a connected `/` menu with multiple directives, retain references to its rendered rows, dispatch ArrowDown through `handleDraftSuggestionKeydown`, and assert that the same row objects remain while selection and ARIA move to the second item. It will also retain existing key-consumption and scrolling assertions.

The stylesheet regression will require `.aside-inline-suggest-item.is-selected` to own the active background and reject `.aside-inline-suggest-item:hover` as a parallel selection selector. After focused tests pass, the full build will run tests, lint, type checking, Obsidian compliance, bundling, and the release-artifact guard. The installed-build smoke test will exercise real keyboard and pointer transitions in `lean-startup`.
