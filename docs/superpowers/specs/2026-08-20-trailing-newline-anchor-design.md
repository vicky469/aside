# Preserve Trailing-Newline Side-Note Anchors

**Date:** 2026-08-20

**Objective:** Prevent selections that include a note's final newline or trailing whitespace from becoming orphaned during their first persistence cycle, and allow matching false-orphan records to recover automatically.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Reproduced the reported record against `startup/idea/product blueprint.md` without modifying the vault.
- [x] Verified the stored 272-character selection exactly equals the raw note and has the same SHA-256 hash.
- [x] Verified `parseNoteComments` reduces the anchor source to 271 characters by removing the final newline.
- [x] Verified the production anchor resolver succeeds against the raw note and fails against the trimmed `mainContent`.
- [x] Verified the isolated branch begins with 1,124 compiled tests and 90 contract tests passing.

### To Implement

- [x] Preserve all trailing source characters while normalizing CRLF line endings for Markdown comment parsing.
- [x] Keep full-file selections anchored through the same persistence synchronization path that previously marked them orphaned.
- [x] Allow a previously false-orphaned thread to clear `orphaned` when its exact stored selection still exists.
- [x] Preserve current behavior for truly changed or missing anchor text.

### Verification

- [x] A parser regression test proves trailing newlines and spaces remain in `mainContent`.
- [x] A synchronization regression test proves a full-file selection ending at the final newline remains anchored.
- [x] A synchronization regression test proves a matching stored false orphan is healed.
- [x] Existing missing-text orphan tests continue to pass.
- [x] Full test, lint, typecheck, Obsidian compliance, production bundle, and release-artifact checks pass.

## Context

Aside stores exact selection text and line/character coordinates. When a selected range includes the final newline, the stored text is a byte-for-byte match for the note. The current parser normalizes CRLF to LF and then calls `trimEnd()`. Persistence passes that shortened `mainContent` into `syncLoadedCommentsForCurrentNote`, which asks `CommentManager.updateCommentCoordinatesForFile` to re-resolve every selection anchor. The full-file target no longer exists in the shortened string, so the manager sets `orphaned: true` during the first save.

The reported note demonstrates the failure deterministically:

- raw note length: 272
- stored selection length: 272
- parsed `mainContent` length: 271
- raw resolution: succeeds at `0:0 → 22:0`
- parsed resolution: fails

The source file's modification time predates draft creation, confirming that no user edit caused the mismatch.

## Approaches Considered

### 1. Preserve exact source content after newline normalization

Change the parser's source normalization from CRLF-to-LF plus `trimEnd()` to CRLF-to-LF only. Anchor synchronization then sees the same visible text that the editor selected. Existing coordinate synchronization already clears `orphaned` whenever resolution succeeds, so matching false-orphan records heal without a migration. Selected.

This is the smallest source-level fix and maintains exact-match semantics.

### 2. Ignore trailing whitespace in the anchor resolver

Normalize or trim both the note and target before matching. Rejected because it weakens exact matching, complicates offset reconstruction, may shorten the stored selection, and can select the wrong occurrence when text differs only by whitespace.

### 3. Carry separate raw and trimmed content through persistence

Keep trimmed `mainContent` but pass a second raw string specifically to coordinate synchronization. Rejected because it creates two competing representations across multiple persistence paths and makes future call sites easy to get wrong.

## Design

### Source normalization

`parseNoteComments` will continue converting CRLF to LF so editor coordinates and stored anchors use one newline convention. It will stop removing trailing newlines or spaces. The plugin no longer stores canonical side-note data in a trailing managed Markdown block, so preserving the original visible source ending does not conflict with current sidecar persistence.

### Anchor synchronization and recovery

No resolver relaxation or migration is required. `syncLoadedCommentsForCurrentNote` will receive the preserved `mainContent` and run the existing exact resolver. A new full-file anchor remains anchored. A stored thread with `orphaned: true` is still evaluated; if its exact text exists, the existing manager logic updates its coordinates and clears the flag. If the text genuinely changed or disappeared, resolution remains `null` and the thread stays orphaned.

### Testing

The parser test will cover trailing newline and trailing-space preservation. The synchronization test will use the public `syncLoadedCommentsForCurrentNote` seam with a full-file thread whose target includes the final newline, first as a normal anchor and then as a false orphan. Existing resolver and manager tests continue to cover genuine missing-text orphaning.

## Acceptance Criteria

1. Selecting through the final newline and saving a side note does not mark it orphaned.
2. Aside does not modify the note's trailing newline or whitespace as part of comment persistence.
3. Existing false-orphan records recover on the next normal synchronization when their exact selection is present.
4. Truly missing selections remain orphaned.
5. No fuzzy or whitespace-insensitive matching behavior is introduced.
