# File-View Agent Regenerate Design

**Date:** 2026-08-25
**Status:** Approved for implementation

## Implementation Tracking

Use this checklist as the implementation source of truth. Mark an item done only after its code and listed verification have passed.

### Already Done

- [x] Aside uses `isPageNoteCapableFile` as the shared page-note capability and excludes the generated Aside index there.
- [x] Agent retry already reuses and clears a valid stored output entry, or appends a replacement output entry when the stored entry is missing.
- [x] Runtime prompt construction already limits source-content reads to Markdown paths.
- [x] Sidebar streaming already renders queued/running state against the selected output entry.

### To Implement

- [ ] Expose `isPageNoteCapableFile` through `CommentAgentHost` and wire it to the existing shared plugin capability.
- [ ] Validate retry source files with page-note capability instead of Markdown-only capability.
- [ ] Preserve Markdown-only source-content and annotation behavior for non-Markdown retries.
- [ ] Cover non-Markdown retry with both an existing output entry and a missing output entry.
- [ ] Cover missing and ineligible source rejection without reply mutation.

### Verification

- [ ] Focused comment-agent tests pass and demonstrate the pre-fix Markdown guard failure.
- [ ] Typecheck, lint, all automated tests, production build, Obsidian compliance, and release-artifact inspection pass.
- [ ] Exact built assets are inspected, synced to `lean-startup`, compared byte-for-byte, Aside is reloaded, and the failed PDF Generate flow is smoke-tested.

## Problem

Aside now supports page notes for every real vault file exposed through an Obsidian file-backed view, but agent regeneration still validates the source with the older Markdown-only `isCommentableFile` capability. As a result, a failed agent run attached to a PDF, DOCX, image, or other supported file-level thread cannot be regenerated: the controller exits before it clears or creates the output reply and before the UI can show the queued spinner.

The retry path should follow the same file-level capability boundary as page notes without expanding Markdown-only source-text behavior to binary files.

## Goals

- Let Generate/regenerate retry agent runs on every page-note-capable vault file.
- Reuse and clear an existing output reply before the regenerated run starts.
- Append a new empty output reply when the previous output entry no longer exists.
- Let the existing queued/running stream state render the turning spinner in that output reply.
- Keep missing files and the generated Aside index ineligible.
- Prevent PDF, DOCX, media, and other non-Markdown source bytes from being read as text.

## Non-Goals

- Adding previews for formats Obsidian cannot display.
- Extracting, parsing, OCRing, or converting non-Markdown source content as general agent context.
- Enabling selection anchors or agent-created text annotations on non-Markdown files.
- Changing agent runtime selection, `/pdf-to-markdown` conversion behavior, or script-run regeneration.
- Adding a second format allowlist or special-casing only PDF conversion runs.

## Capability Boundary

`src/core/rules/commentableFiles.ts` remains the shared source of truth.

- `isPageNoteCapableFile` determines whether a real source file may own page-note threads and agent runs. It accepts any real vault `TFile` except the configured generated Aside index.
- `isCommentableFile` remains the narrower Markdown text capability. It continues to guard note-content reads, selection anchors, source-text annotation proposals, and editor integrations.

`CommentAgentHost` will expose both predicates. The regeneration entry point will validate with `isPageNoteCapableFile`; downstream Markdown-only operations will continue using `isCommentableFile` or their existing Markdown path check.

This is a capability substitution, not removal of validation. A null or deleted source and the generated Aside index must still stop the retry before thread mutation.

## Regenerate Flow

1. The sidebar Generate button resolves the stored agent run associated with the selected thread entry.
2. `CommentAgentController` resolves the latest source path, loads the `TFile`, and validates it with `isPageNoteCapableFile`.
3. The controller reloads the stored thread and resolves the current saved trigger text and previous run metadata.
4. If the previous `outputEntryId` still identifies an entry in the thread, the controller reuses that entry and clears its body.
5. If no valid output entry exists, the existing execution path appends a new empty reply after the trigger entry.
6. The replacement run is stored as queued and emits the existing run-stream update. The sidebar renders the turning spinner against the reused or new output entry.
7. Runtime output progressively and finally edits that same output entry. Failure leaves the same entry retryable through the existing Generate action.

The ordering is intentional: capability and thread validation happen before mutation; output clearing happens only after a valid retry request has been reconstructed.

## Source-Content Safety

General runtime prompt construction may include Markdown note content, but it must pass `null` for non-Markdown sources. Existing runtime prompt construction already checks the Markdown path before calling `getCurrentNoteContent`; the change must preserve that check.

Agent annotation proposals remain Markdown-only. If a non-Markdown run returns annotation proposals, the controller must not read source bytes or create text anchors; it retains the current unavailable-source handling.

Tests will use a throwing source-content reader for a non-Markdown retry so a future accidental binary read fails immediately.

## Error Handling

- Agents feature disabled: retain the current notice and do not mutate the reply.
- Missing or deleted source: retain the current missing-file notice and do not mutate the reply.
- Generated Aside index: treat it as ineligible and do not mutate the reply.
- Missing trigger or thread: retain the current notice and do not create an output entry.
- Existing output clear fails: retain the current failed-run behavior; do not silently append a duplicate reply.
- Previous output entry missing: append one replacement output entry through the existing run execution path.
- Runtime failure after queueing: render the existing failure reply in the chosen output entry and keep Generate available.

## Testing Strategy

### Controller capability and wiring

- Extend the comment-agent harness with separate `isCommentableFile` and `isPageNoteCapableFile` behavior.
- Prove a failed PDF or DOCX page-note run can be regenerated while `isCommentableFile` is false.
- Prove the controller host supplied by `main.ts` delegates page-note eligibility to the shared plugin capability.
- Prove null/deleted files and the generated Aside index remain rejected without reply mutation.

### Reply and spinner lifecycle

- With an existing output entry, assert Generate clears and reuses it, emits queued/running stream state for that entry, and writes the final response back into it without appending another reply.
- With a missing output entry, assert Generate appends one empty reply, associates stream state with it, and writes the final response into it.
- Keep the existing failed-run retry and current-saved-directive tests green.

### Binary-read regression

- Retry a non-Markdown agent run with `getCurrentNoteContent` configured to throw or count calls.
- Assert the retry reaches the runtime and completes without calling the reader.
- Keep Markdown prompt-context and agent-annotation tests green to prove their narrower capability remains intact.

### Verification

- Run the focused comment-agent controller tests first.
- Run typecheck, lint, the full automated test suite, production build, Obsidian compliance check, and release-artifact guard.
- If syncing to `lean-startup`, inspect the exact public `main.js`, `manifest.json`, and `styles.css`, verify no maps, embedded source, raw source, secrets, or local paths ship, install those exact artifacts, compare them byte-for-byte, reload Aside, and smoke-test Generate on the failed PDF thread.

## Change-Surface Ownership

- Shared file capability and generated-index exclusion: `src/core/rules/commentableFiles.ts`.
- Agent retry capability consumption and reply lifecycle: `src/agents/commentAgentController.ts`.
- Production host adapter: `src/main.ts`.
- Regression coverage: `tests/commentAgentController.test.ts` plus existing capability tests.
- Sidebar button/action resolution and spinner rendering: existing UI code, unchanged unless a failing test identifies a separate wiring defect.

Generated `main.js` and installed plugin files remain build artifacts, not policy owners. Production code must not introduce a PDF/DOCX/media extension list or duplicate the generated-index exclusion inside the agent controller.
