# Instant Index Ribbon Opening

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] The ribbon action delegates index opening to `openIndexNote()`.
- [x] The generated index has a stable configured path and can be focused in an existing Markdown leaf or opened in a new tab.
- [x] Aggregate-index refresh is serialized by the comment persistence controller.
- [x] Diagnosis confirmed that `openIndexNote()` currently awaits aggregate refresh before either focusing or opening the index.

### To Implement

- [x] Give existing index files an immediate reveal path that does not await aggregate refresh.
- [x] Start aggregate refresh asynchronously after an existing index is visible.
- [x] Preserve first-run behavior by awaiting refresh when the index file does not yet exist, then opening the newly created file.
- [x] Preserve index-sidebar activation and final index-leaf focus behavior.
- [x] Handle asynchronous refresh failures without producing an unhandled promise rejection.

### Verification

- [x] Add a regression test with an unresolved refresh promise proving that an existing index becomes visible before refresh completes.
- [x] Test the missing-index path waits for creation before attempting to open the file.
- [x] Test that refresh failure does not prevent an existing index from opening.
- [x] Run focused index-opening tests.
- [x] Run the full test, lint, type-check, Obsidian compliance, production bundle, and artifact-guard pipeline.

## Goal

Make the Aside ribbon action feel instant when `🐰 Aside Index.md` already exists. Index freshness must not gate navigation.

## Current Problem

The ribbon callback calls `openIndexNote()`. That method awaits `refreshAggregateNoteNow()` before it checks for the generated index, focuses an existing index leaf, or asks Obsidian to open the file. Aggregate refresh can scan stored comment sources, initialize the aggregate index, rebuild Markdown, and write the generated note. Any latency in that work becomes click latency even though the existing index is already safe to display.

## Behavior

### Existing Index

1. Resolve the configured index path and confirm the Markdown file exists.
2. Focus an already-open index leaf or open the index in a tab.
3. Start aggregate refresh without awaiting it as a prerequisite for visibility.
4. Activate the Aside sidebar using the existing behavior.
5. Restore focus to the index leaf if sidebar activation moved it.

The displayed index may briefly contain its previously generated content. The background refresh updates it through the existing aggregate-note write and rerender path.

### Missing Index

1. Await aggregate refresh so it can create the generated index file.
2. Confirm the file now exists.
3. Show the existing index-open error notice and stop if creation failed or the file is still unavailable.
4. Open the created index and activate the Aside sidebar.

The missing-file path must not trigger a second redundant refresh during the same click.

## Architecture

Move the open-order policy to a small testable application-level coordinator rather than leaving timing-sensitive orchestration embedded in the plugin class. The coordinator receives narrow host operations for checking index existence, revealing the index, refreshing it, activating the sidebar, restoring focus, and reporting failures. Obsidian-specific leaf selection and workspace calls remain in the plugin host.

This boundary makes the user-visible ordering deterministic in tests without constructing the full Obsidian plugin runtime. It also keeps aggregate generation in `CommentPersistenceController`; no indexing or persistence responsibilities move into the navigation coordinator.

## Error Handling

- A background refresh failure must be observed and logged through the existing plugin logging path; it must not close or delay an existing index.
- A first-run refresh failure follows the existing open failure behavior because no index is available to reveal.
- Navigation failures continue to use the existing index notice policy.

## Testing Strategy

Use deferred promises to test event ordering rather than wall-clock duration:

- For an existing index, leave refresh unresolved and assert that reveal has already completed.
- For a missing index, leave refresh unresolved and assert that reveal has not started; resolve refresh, make the index available, and assert that reveal follows.
- Reject the background refresh and assert that the returned open operation remains handled and navigation stays completed.

The production pipeline remains the final regression check.

## Out of Scope

- Changing how aggregate-index Markdown is generated.
- Making first-time index creation instantaneous.
- Adding loading indicators, progress notices, or new settings.
- Reworking general Obsidian file-opening performance.
