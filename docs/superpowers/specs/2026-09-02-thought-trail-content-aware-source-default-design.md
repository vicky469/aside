# Thought Trail Content-Aware Source Default Design

**Date:** 2026-09-02
**Status:** Approved for planning

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Thought Trail offers Wikilinks, Tags, and Attachments through one shared source-policy module.
- [x] Note and index surfaces compute tag and attachment availability and consume the shared presentation planner.
- [x] Source selection is transient, resets to Wikilinks when the selected file changes, and is not stored in server or frontend persistence.
- [x] Tag-related file filtering is transient and single-select.

### To Implement

- [x] Represent whether the current Thought Trail has renderable Wikilink results alongside existing Tags and Attachments availability.
- [x] Select the first populated source in Wikilinks, Tags, Attachments priority order when a file's source state is initialized or the selected source becomes unavailable.
- [x] Select Wikilinks when no source contains results.
- [x] Disable empty source controls when another source contains results, while keeping Wikilinks enabled as the empty-state default when every source is empty.
- [x] Preserve an available manual source choice for the current file without persisting it.
- [x] Keep tag-related file filtering single-select; do not add Shift+click or multi-tag matching in this change.

### Verification

- [x] Shared policy tests cover every availability combination, source priority, empty-state fallback, disabled states, and preservation of an available manual choice.
- [x] Presentation-state tests prove note and index callers receive Wikilink availability and resolve through the shared policy.
- [x] Renderer contract tests prove source controls expose the resolved selection and disabled states consistently.
- [x] Existing Thought Trail, typecheck, lint, build, Obsidian compliance, and release-artifact checks pass.

## Problem

Thought Trail always initializes its transient source to Wikilinks. Wikilinks is also treated as available even when its graph has no renderable lines. A file with no Wikilink results but with tag relationships or direct attachments therefore opens on an empty Wikilinks view instead of its useful content.

The selection is intentionally ephemeral. A manual source choice is held only in the active view's in-memory state; it is not saved to a server, plugin data, local storage, or another frontend database. Changing the selected file resets the source lifecycle.

## Goals

- Open each Thought Trail on its most relevant populated source.
- Use the fixed priority Wikilinks, then Tags, then Attachments.
- Keep Wikilinks as the stable fallback when no source contains results.
- Prevent users from selecting empty sources when useful results exist elsewhere.
- Preserve a manual source choice while it remains available for the current file.
- Keep the rule identical across note and index Thought Trail surfaces.

## Non-Goals

- Persisting a source choice across files, sessions, devices, or renders outside the existing in-memory lifecycle.
- Adding settings for source priority.
- Changing Wikilink graph construction, tag relationship discovery, or attachment discovery.
- Adding Shift+click, multi-select, AND, or OR behavior to tag filtering.
- Changing the existing single-select `All` and per-tag filters.

## Product Behavior

Source choice follows this priority:

1. Select Wikilinks when it has at least one renderable graph line.
2. Otherwise select Tags when it has at least one related file.
3. Otherwise select Attachments when it has at least one direct resolved attachment.
4. Otherwise select Wikilinks.

This priority determines the automatic choice when a selected file starts with the default Wikilinks state and whenever the active source becomes unavailable. If the user manually selects another populated source, normal rerenders for the same file preserve that choice. Changing files uses the existing reset boundary, after which the new file is resolved from the priority again.

When at least one source has results, sources without results remain visible but are disabled. When no source has results, Wikilinks remains enabled and selected as the stable empty-state default; Tags and Attachments remain disabled. Thought Trail's existing overall availability rules may still move the sidebar back to List when no trail source can render useful content.

Tag filtering under the Tags source remains unchanged: `All` is selected initially, and choosing one tag replaces the previous filter. Multi-selection is deferred until its matching semantics and interaction model justify the added complexity.

## Shared Policy and Data Flow

`src/ui/views/sidebarThoughtTrailSource.ts` remains the single source of truth for source order, content availability, disabled-state policy, automatic priority, and fallback behavior. It accepts availability facts for all three sources and returns the resolved source. Note and index surfaces do not implement their own fallback ladders.

The adapters derive facts from their existing models:

- Wikilinks: the rooted graph has at least one renderable line.
- Tags: the unique tag-related file set has at least one file.
- Attachments: the direct attachment model has at least one item.

`src/ui/views/sidebarThoughtTrailState.ts` remains the shared presentation coordinator. `AsideView` supplies the three availability facts from both note and index contexts, stores only the resolved transient source, and passes it to the renderer. The renderer asks the shared policy whether each radio option is enabled; it does not infer availability from DOM content.

```text
note or index relationship models
    -> { wikilinks, tags, attachments } availability facts
    -> shared source policy
    -> resolved transient source + enabled controls
    -> shared Thought Trail renderer
```

## Edge Cases

- Wikilinks and Tags available: Wikilinks is the automatic choice.
- Tags and Attachments available without Wikilinks: Tags is the automatic choice.
- Attachments only: Attachments is the automatic choice.
- No sources available: Wikilinks is selected and remains the only enabled source control.
- A manually selected populated source remains selected across same-file rerenders.
- A manually selected source loses its last result: resolve to the first populated source by priority, or Wikilinks if none remain.
- File navigation: the existing source reset runs before availability is evaluated for the new file.

## Testing Strategy

Direct unit tests for the shared source policy should use a compact availability matrix. They must prove the priority order, preservation of a selected available source, deterministic fallback when a source disappears, and the special all-empty Wikilinks state.

Presentation-state tests should cover Tags-only and Attachments-only files starting from Wikilinks, plus a manual populated selection surviving a same-file rerender. Representative note/index wiring assertions should verify both surfaces pass Wikilink line availability into the shared policy rather than maintaining separate selection branches.

Renderer contract tests should verify empty controls are disabled from the shared availability policy and that the selected source remains accessible through the existing native radio semantics. Existing single-select tag-filter tests remain unchanged and serve as regression coverage for the deferred multi-select request.

## Change-Surface Audit

- Shared source of truth: `src/ui/views/sidebarThoughtTrailSource.ts`.
- Shared presentation coordinator: `src/ui/views/sidebarThoughtTrailState.ts`.
- Thin availability adapters: note and index paths in `src/ui/views/AsideView.ts`.
- Thin UI consumer: `src/ui/views/sidebarThoughtTrailRenderer.ts`.
- Direct policy tests: `tests/sidebarThoughtTrailSource.test.ts` and `tests/sidebarThoughtTrailState.test.ts`.
- Representative wiring tests: `tests/sidebarThoughtTrailRendererSource.test.mjs`.

No source-priority ladder should be copied into either `AsideView` branch or the renderer. A final repository search must confirm that priority and special empty-state behavior remain owned by the shared source-policy module.
