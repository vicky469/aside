# Tag Modal and Tight Inline Suggestions Design

## Summary

Aside will return `#` tag entry to the existing Obsidian suggestion modal while keeping `@` built-ins and `/` vault scripts in the editor-owned inline dropdown. The tag modal will filter and rank results live as the user types, including case-insensitive, hyphen-insensitive, and bounded typo-tolerant matching. Usage frequency remains an invisible tie-breaker but is no longer displayed.

The inline `@` and `/` menu will become genuinely content-sized: no artificial minimum width, no full-editor width, and only compact row padding. This design supersedes the tag-trigger and tag-presentation decisions in `2026-08-05-inline-draft-suggestions-design.md` and the minimum-width/padding decisions in `2026-08-06-compact-mention-dropdown-design.md`.

## Implementation Tracking

Use this section as the working checklist. Mark an item complete only after it is implemented on the working branch and the listed verification passes.

### Already Done

- [x] `@` and `/` have separate providers, live filtering, keyboard navigation, pointer selection, focus retention, and accessible listbox semantics.
- [x] The tag suggestion modal supports live queries, tag creation, keyboard navigation, and insertion callbacks.
- [x] Indexed vault tag usage is available to suggestion planning.
- [x] Mention and script rows render only their insertion value without duplicated labels.

### To Implement

- [x] Route a typed `#` and explicit tag-suggestion requests to the tag modal instead of the inline dropdown.
- [x] Preserve the active tag query and draft insertion/focus behavior when the modal opens, selects, or closes.
- [x] Move tag normalization and ranking into a pure shared module consumed by the modal.
- [x] Rank tags case-insensitively and hyphen-insensitively by exact, prefix, path-segment prefix, substring, then bounded typo-tolerant relevance.
- [x] Keep usage frequency only as an invisible tie-breaker after textual relevance.
- [x] Remove visible tag usage-count detail from modal rows without removing tag creation.
- [x] Remove obsolete inline-tag suggestion state, rendering, and usage-count presentation code.
- [x] Remove the `@`/`/` dropdown minimum width and reduce its box and row spacing to a tight content-sized layout.

### Verification

- [x] Pure tests cover case-insensitive, hyphen-insensitive, exact, prefix, segment, substring, and typo-tolerant tag ranking.
- [x] Ranking tests prove textual relevance wins before hidden usage frequency and deterministic alphabetical fallback.
- [x] Controller tests prove `#` opens the modal while `@` and `/` remain inline.
- [x] Controller tests cover tag selection, close/focus restoration, disconnected draft fallback, and precedence over conflicting triggers.
- [x] Rendering tests prove tag usage counts are absent and create-tag behavior remains available.
- [x] Stylesheet tests prove the inline menu has no minimum width, remains width-capped, and uses the approved compact padding.
- [x] The complete repository build and release-artifact guard pass.
- [ ] The verified build is installed byte-identically in `lean-startup`.
- [ ] A real Obsidian draft visually confirms the `#` modal and tight `@`/`/` inline dropdown, including keyboard and pointer selection.

## Goals

- Restore the richer tag-search experience that lets users refine results continuously in a modal.
- Surface the best textual matches first even when casing differs or the query contains a small typo.
- Stop presenting tag popularity as user-facing metadata.
- Keep the simple `@` and `/` flows fast and inline.
- Remove the remaining empty horizontal space from short inline suggestion lists.

## Non-Goals

- Changing mention or vault-script matching, providers, or insertion syntax.
- Moving `[[` note-link suggestions out of their modal.
- Adding a new tag analytics or popularity surface.
- Changing persisted tag data or comment syntax.
- Anchoring the inline menu to exact caret coordinates.

## Interaction Design

### Trigger ownership

- Typing `#` opens `SideNoteTagSuggestModal` with the active tag fragment prefilled.
- Typing `@` opens only built-in directive suggestions inline.
- Typing `/` opens only runnable vault scripts inline.
- Typing `[[` retains the existing note-link modal and continues to take precedence over other open queries.

The tag modal updates results on every query change. Selecting an existing or create-tag row replaces the original open `#` token in the draft. Closing without selection restores focus and the caret when the original textarea still exists; disconnected drafts use the existing persisted-draft rerender path.

### Tag rows

Existing-tag rows show only the normalized tag text. They do not show “Used once,” “Used N times,” or any equivalent popularity detail. The create row remains explicit, for example `Create tag: #project`, with concise creation guidance if the Obsidian modal requires secondary copy.

Usage frequency remains internal and affects order only after two candidates have equal textual relevance. It is never rendered.

### Inline `@` and `/` geometry

The dropdown stays aligned to the editor's left edge and uses intrinsic content width. It has no non-zero minimum width. `max-width: 100%` and the existing ellipsis behavior constrain long script names in narrow sidebars.

The mention/script list uses `2px 0` list padding and `3px 5px` row padding. The container keeps a subtle theme-aware border, selected-row background, and small radius, but adds no horizontal padding of its own. This produces a tight box around short values such as `@todo` while preserving a comfortable pointer target.

## Tag Ranking

Tag matching uses a canonical comparison value that strips the leading `#`, lowercases text, and ignores hyphens. Slash-separated tag segments remain available for segment matching.

Candidates sort by the following textual tiers:

1. Exact canonical match.
2. Full-tag prefix match.
3. Slash-segment prefix match.
4. Full-tag or segment substring match.
5. Bounded fuzzy match against the full tag or an individual slash segment.

Fuzzy matching uses bounded Damerau-Levenshtein distance and is disabled for queries shorter than four canonical characters. Queries of four through seven characters allow a distance of one; queries of eight or more allow a distance of two. This catches ordinary omissions, substitutions, insertions, and adjacent transpositions without flooding short queries with weak results.

Within a tier, candidates sort by lower edit distance, then smaller length difference, then higher hidden usage frequency, then tag text alphabetically. The create-tag row remains first when the normalized query is valid and no exact existing tag matches.

## Architecture

A pure editor-level tag suggestion module will own collection, canonicalization, scoring, sorting, and create-candidate planning. `SideNoteTagSuggestModal` will consume that model and own only Obsidian modal lifecycle and DOM rendering. This keeps fuzzy ranking independently testable and prevents modal code from becoming the ranking source of truth.

`SidebarDraftEditorController` will stop constructing inline tag choices. Its tag path will capture the open query and original caret, open the host-provided tag modal, and apply the selected replacement through the same connected/disconnected draft paths used by other modal suggestions. The generic inline state can then be mention-only, covering both `@` and `/`.

CSS will scope intrinsic sizing and compact spacing to the mention/script inline menu. Tag modal presentation will use Obsidian's `SuggestModal` structure and existing theme tokens rather than custom full-width editor styles.

## Error and Lifecycle Handling

An empty tag result set still permits a valid create-tag candidate. Invalid or too-short queries do not receive fuzzy candidates. Escape or outside dismissal changes no draft text. A stale or disconnected textarea cannot receive a DOM edit; the controller updates stored draft text, rerenders, and schedules focus instead.

Opening `[[` closes or prevents competing inline/modal suggestion flows as it does today. Repeated `#` triggers cannot open overlapping tag modals because the controller retains one active suggestion owner until close.

## Testing Strategy

Pure ranking tests establish normalization, tier ordering, typo thresholds, hidden-frequency tie-breaking, deterministic ordering, and create-tag behavior. Controller tests establish the trigger split and connected/disconnected insertion lifecycle. Modal presentation tests or a small extracted presentation helper prove usage counts are not rendered.

Stylesheet tests assert the exact absence of the old `8.25rem` minimum, the retained width cap, and the compact list/row padding. Final verification runs the focused tests, full build, release artifact inspection, byte-identical installation, and a real Obsidian visual/interaction check.
