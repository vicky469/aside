# Explicit Mention Filtering Design

## Goal

Make an inline built-in mention query such as `@co` return and select only its matching directive, `@codex`, instead of leaving every built-in visible with `@todo` selected. The fix applies the existing case-insensitive exact, prefix, and substring matching policy to explicit `@` queries.

This design supersedes only the mention-filtering preservation in `2026-08-05-inline-draft-suggestions-design.md` and the ranking non-goal in `2026-08-06-compact-mention-dropdown-design.md`. The compact presentation, provider separation, insertion, keyboard, mouse, lifecycle, and accessibility behavior remain unchanged.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Inline `@` suggestions reset their active selection to the first returned result after each query refresh.
- [x] Mention suggestion ranking already handles case-insensitive exact, prefix, and substring matches.
- [x] `@` and `/` queries already remain provider-scoped: built-ins for `@`, runnable vault scripts for `/`.
- [x] Bare `@` already shows all supported built-ins in their stable default order.

### To Implement

- [ ] Apply the existing built-in match scoring whenever an explicit `@` query contains text.
- [ ] Remove nonmatching built-ins from a nonempty explicit `@` query.
- [ ] Keep bare `@` behavior unchanged so it still offers all built-ins.
- [ ] Keep `/` script filtering and unprefixed compatibility behavior unchanged.
- [ ] Let the existing inline selection controller select the first filtered result without adding controller special cases.

### Verification

- [ ] A fail-first regression proves `@co` returns only `@codex` instead of keeping `@todo` first.
- [ ] Tests prove explicit mention filtering is case-insensitive.
- [ ] Tests prove bare `@`, `/` scripts, and unprefixed compatibility queries retain their intended behavior.
- [ ] A controller-level regression proves the first filtered mention is the active listbox option.
- [ ] The complete test suite, lint, typecheck, Obsidian compliance check, production bundle, and release-artifact guard pass.
- [ ] The built `main.js`, `manifest.json`, and `styles.css` contain no source map, embedded source, local path, or obvious secret exposure.
- [ ] The verified build is installed byte-identically in `lean-startup`, where typing `@co` is smoke-tested to show and select only `@codex`.

## Root Cause

`buildMentionSuggestions()` strips the leading trigger and computes a normalized query, but its `shouldFilterBuiltInsByQuery` condition explicitly disables scoring whenever the original query starts with `@`. Every built-in therefore receives score zero for `@co`, retains registry order, and reaches the inline controller as `@todo`, `@codex`, `@claude`, and `@gemini`. The controller correctly resets selection to result index zero, which makes `@todo` appear selected.

The error belongs to provider filtering, not active-row rendering. Changing selection in the controller would leave irrelevant choices visible and create a second ranking policy.

## Behavior

- Typing bare `@` shows all built-ins in their existing order.
- Typing `@co` shows only `@codex`; because it is result index zero, it is active automatically.
- Matching ignores case, so `@CO` behaves like `@co`.
- Exact matches rank before prefix matches, which rank before substring matches.
- Nonmatching built-ins are omitted once the explicit query contains text.
- If no built-in matches, the existing empty-result behavior closes the inline dropdown and leaves the typed text untouched.
- `/` remains script-only and keeps its current filtering.
- Unprefixed calls to the suggestion builder retain their compatibility behavior for existing callers and tests.

Typo-tolerant fuzzy matching is not added to mention directives in this fix. The four built-ins are short, stable commands, and the reported regression is caused by bypassed filtering rather than a missing fuzzy engine.

## Architecture

`commentMentionSuggestions.ts` remains the single owner of provider scope and textual ranking. The implementation changes only the condition that decides whether a nonempty built-in query is scored. No state or branch is added to `SidebarDraftEditorController`; it continues to render provider order and activate index zero.

The fallback modal consumes the same provider output, so it receives the corrected filtering automatically. No mirrored modal fix is needed.

## Testing

Pure provider tests cover `@co`, `@CO`, bare `@`, unprefixed queries, and `/` scripts. A representative connected-editor test renders a query with `@todo` available before `@codex` in source order, then verifies that only the `@codex` option remains and carries `aria-selected="true"` through the existing controller path.

After focused tests pass, the complete repository build and exact release-artifact inspection run. The verified three-file plugin build is installed into `lean-startup`, compared byte-for-byte, reloaded, and smoke-tested in a real Aside draft.

## Out of Scope

- Fuzzy or typo-tolerant matching for built-in mentions.
- Changes to tag-modal matching.
- Changes to vault-script `/` suggestion ranking.
- Keeping nonmatching built-ins visible below a best match.
- New active-selection, keyboard, mouse, insertion, layout, or accessibility behavior.
