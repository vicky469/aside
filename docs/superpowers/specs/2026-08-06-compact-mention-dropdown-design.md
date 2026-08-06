# Compact Mention Dropdown Design

## Summary

Aside will make inline `@` and `/` suggestion menus content-sized instead of editor-width and remove duplicated secondary text from every mention or script row. The `@` trigger remains limited to built-ins such as `@todo`, `@codex`, and `@claude`; the `/` trigger remains limited to runnable vault scripts such as `/clean-citations`.

This design supersedes only the row-content and editor-width presentation decisions in `2026-08-05-inline-draft-suggestions-design.md`. Mention/script query parsing, ranking, insertion, keyboard behavior, lifecycle handling, and accessibility stay unchanged. Tag suggestions remain separate and keep their usage-count detail.

No current implementation plan covers this compact presentation refinement, so this spec will receive a focused plan after approval.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Inline draft suggestions support live filtering, mouse selection, keyboard navigation, and accessible listbox semantics.
- [x] `@` queries return built-in mentions without vault scripts.
- [x] `/` queries return runnable vault scripts without built-in mentions.
- [x] Tag suggestions use the same inline container while retaining their own provider and usage-count policy.
- [x] Disconnected mention flows have an Obsidian modal fallback.

### To Implement

- [x] Define one shared single-line presentation rule for mention and script suggestions.
- [x] Consume that rule in the inline dropdown and fallback mention modal.
- [x] Let inline suggestion details be optional so tag usage counts remain visible while mention/script details disappear.
- [x] Mark the shared inline container with a mention-specific variant for `@` and `/` sessions.
- [x] Size the inline dropdown to its content, align it to the editor's left edge, and cap it at the available editor width.
- [x] Reduce mention/script row horizontal padding from 10px to 8px without changing the active-row treatment.
- [x] Remove obsolete mention-detail styling after both rendering surfaces stop producing that element.

### Verification

- [x] Fail-first tests prove built-in `@` rows and vault-script `/` rows render no secondary detail.
- [x] Regression coverage proves tag rows still render their usage-count detail.
- [x] CSS regression coverage proves the dropdown is start-aligned, content-sized, width-capped, and uses the approved padding.
- [x] Existing keyboard, mouse, focus, lifecycle, and ARIA tests remain green.
- [x] The complete repository build and release-artifact guard pass.
- [x] The verified `main.js`, `manifest.json`, and `styles.css` are installed byte-identically in `lean-startup`.
- [ ] The installed dropdowns are visually checked in the real Aside draft editor after a reliable Obsidian reload.

## Goals

- Remove unused horizontal space from short mention lists.
- Remove repeated information such as `@todo` followed by `Todo`.
- Keep `@` built-ins and `/` vault scripts visually consistent without mixing their providers.
- Preserve useful secondary information in non-mention dropdowns.

## Non-Goals

- Anchoring the menu to the text caret.
- Changing mention or script ranking, filtering, or insertion syntax.
- Changing tag or wiki-link suggestion presentation.
- Replacing the inline dropdown interaction model.
- Changing the maximum result count or scroll behavior.

## Interaction Design

### Trigger ownership

- Typing `@` opens only built-in directives: `@todo` and supported agent directives.
- Typing `/` opens only current runnable vault scripts.
- Typing `#` continues to open tag suggestions with usage counts.
- Typing `[[` continues to use the existing note-link flow.

### Row content

Mention and script rows display exactly one visible text line: the insertion value. Built-in labels and vault script paths are not rendered beneath it. The active row retains its existing theme-aware highlight and the entire row remains the pointer and keyboard selection target.

Tag rows continue to display the tag on the first line and its usage count on the second line. Making inline detail optional is therefore a provider-level presentation decision, not a global CSS hide.

### Width and spacing

The `@` and `/` dropdown aligns with the editor's left edge and uses its intrinsic content width. Its minimum width is `min(8.25rem, 100%)`, matching the approved 132px reference at the default 16px root size. `max-width: 100%` prevents long script names from escaping narrow sidebars. Existing ellipsis behavior handles names that exceed the available width.

Mention and script rows use `5px 8px` padding. Tag rows retain their existing geometry. The vertical density, border, corner radius, shadow, scroll limit, and selected-row background remain unchanged.

## Architecture

`commentMentionSuggestions.ts` owns the presentation rule that a mention suggestion exposes only its directive as visible row content. Both `SidebarDraftEditorController` and `SideNoteMentionSuggestModal` consume that rule, preventing the inline and fallback surfaces from drifting.

The generic inline choice model makes `note` optional. Mention and script adapters omit it; the tag adapter continues supplying it. The renderer creates the secondary detail element only when a note exists. The shared container receives a mention-specific variant class whenever its session kind is `mention`, which covers both `@` and `/` without affecting `#` tags.

CSS scopes content sizing and `5px 8px` padding to that mention-specific variant. It does not hide duplicated content that remains in the DOM, and it does not introduce caret-coordinate measurement or runtime layout code.

## Error and Lifecycle Handling

No persistence, network, or execution path changes. Empty providers, stale textareas, outside clicks, Escape handling, rerenders, and disconnected textarea fallbacks retain their current behavior. Long suggestion names remain constrained to the editor width and use the existing overflow treatment.

## Testing Strategy

Pure presentation tests cover built-in and script suggestions returning one visible title with no detail. A representative inline-renderer test verifies that optional detail is omitted for mentions but still created for tags. Fallback-modal coverage verifies that it consumes the same single-line presentation rule.

Stylesheet coverage asserts content sizing, start alignment, maximum width, and the approved `5px 8px` row padding. The final repository build supplies regression coverage for keyboard navigation, mouse selection, focus retention, lifecycle cleanup, accessibility attributes, lint, type checking, Obsidian compliance, bundling, and release-artifact security.
