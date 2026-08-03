# Dead Feature Cleanup Design

## Summary

Remove two abandoned feature surfaces from Aside:

- the user-facing resolved-thread workflow that was removed from the product
- the unreachable support-report submission workflow that was replaced by the local log inspector

The only resolved-thread compatibility retained is recognition of legacy `setThreadResolved` sync events as no-ops. This does not restore resolved state; it preserves contiguous event-clock processing for existing synced event logs.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code or documentation change is complete and its listed verification passes.

### Already Done

- [x] Resolved-thread state and controls are absent from the current domain model and UI.
- [x] The live sidebar support entrypoint opens the local log inspector rather than a submission form.
- [x] The current debug log inspector design explicitly excludes remote upload and a new support-report workflow.

### To Implement

- [ ] Remove the broken `comment:resolve` package command and stale resolve workflow documentation and prompt policy.
- [ ] Remove no-op resolved-selection calls and their unused loader from the plugin composition root.
- [ ] Stop new helper scripts and fixtures from serializing `resolved: false`.
- [ ] Retain legacy `setThreadResolved` sync-event recognition and reduce it to an explicit no-op.
- [ ] Remove the unreachable support-report modal, sender, payload/config modules, and modal-only preview code.
- [ ] Remove support-form-only planner helpers, tests, and CSS while preserving log-inspector behavior.
- [ ] Remove current README claims that Aside can send support reports.
- [ ] Mark the older persistent-diagnostics plan and spec as superseded where they describe report submission.

### Verification

- [ ] A fail-first package-script test proves direct Node script entries point to existing files.
- [ ] A fail-first prompt-policy test proves current Aside actions no longer advertise resolve/archive.
- [ ] Legacy `setThreadResolved` events remain parseable, produce no domain change, and do not block later event clocks.
- [ ] Repository-wide searches leave no unintended resolve or support-submission surfaces.
- [ ] Targeted tests, typecheck, lint, Obsidian compliance, bundle, and release-artifact inspection pass.

## Context

Commit `0cdc6ca` removed resolved comments from the domain and UI, but several callers, scripts, prompts, and documentation surfaces remain. Most visibly, `package.json` still exposes `comment:resolve` even though `scripts/resolve-note-comment.mjs` no longer exists.

The original persistent-diagnostics implementation also introduced a support-report submission form. The current runtime instead opens `SupportLogInspectorModal`, and the later debug log inspector design explicitly states that remote upload and a new support-report workflow are non-goals. The submission modal and transport modules have no production entrypoint.

## Change-Surface Classification

| Surface | Classification | Decision |
| --- | --- | --- |
| Current comment domain and UI | Source of truth | Keep resolved behavior absent. |
| `setThreadResolved` sync operation | Legacy compatibility adapter | Recognize and ignore so event clocks remain contiguous. |
| Resolve package command, helper emissions, prompts, and docs | Stale duplicate | Remove. |
| `SupportLogInspectorModal` and log parsing | Current implementation | Preserve. |
| Support submission modal, sender, payload/config, and modal-only previews | Unreachable implementation | Remove. |
| Persistent diagnostics plan/spec | Historical design with superseded product rules | Add a clear superseded notice for report submission. |

## Resolved-Thread Cleanup

Remove:

- the `comment:resolve` package script
- resolve/archive routing from `AGENTS.md` and `shared/sideNotePromptPolicy.js`
- README instructions for the deleted helper
- `resolved: false` from newly generated thread objects in repository scripts and fixtures
- `ensureCommentSelectionVisible` and its eight no-op awaits
- the unused `loadKnownCommentSelectionTarget` method
- obsolete tests that assert the removed workflow

Keep:

- `setThreadResolved` in legacy sync-event recognition
- the reducer branch that returns threads unchanged
- a regression test demonstrating that a legacy resolved event followed by a current event can still advance through replay

The tombstone is storage compatibility, not product behavior. No resolved flag is added to `CommentThread`, no hidden state is restored, and no UI is rendered.

## Support-Submission Cleanup

Delete the unreachable submission implementation:

- `SupportReportModal`
- `SupportImagePreviewModal`
- the old `SupportLogPreviewModal` used only by the submission form
- `supportReportSender`
- `supportTypes`
- `supportConfig`

From `supportReportPlanner`, remove only form and screenshot-submission helpers whose non-test caller is the deleted modal. Preserve log parsing, filtering, formatting, truncation, and all helpers used by `SupportLogInspectorModal`.

Remove CSS selectors unique to the deleted form and image preview. Preserve selectors shared with the live inspector, even if their names still contain `support` for compatibility and styling locality.

Update README privacy language to describe current network-capable actions only. Mark the earlier persistent-diagnostics plan and spec as superseded for report submission rather than rewriting their historical implementation narrative.

## Error and Compatibility Behavior

- Existing legacy resolve events are accepted and ignored.
- Existing threads become ordinary visible threads because the current domain has no resolved state.
- Later sync events must remain processable and compactable across legacy event-clock positions.
- Removing the support sender cannot produce a runtime error because it has no production importer.
- The live log inspector, log location actions, local persistent logs, and sanitization remain unchanged.

## Test Strategy

Follow red-green-refactor:

1. Add a generic package-script integrity test and observe it fail on the missing resolve script.
2. Change the existing prompt-policy expectation to require the current create/append/update action set and observe it fail while resolve remains advertised.
3. Add or tighten a sync-event regression proving the compatibility tombstone ignores resolved state while preserving a later event.
4. Remove the dead surfaces minimally until targeted tests pass.
5. Re-run import and text searches to verify only the intentional legacy tombstone remains.
6. Run the complete build, which includes tests, lint, typecheck, Obsidian compliance, bundling, and release-artifact checks.

## Acceptance Criteria

- `npm run comment:resolve` is no longer advertised.
- Every direct Node-backed package script references an existing file.
- Current agent instructions and prompt policy do not offer resolve or archive actions.
- New helper-script and fixture output contains no `resolved` field.
- Legacy `setThreadResolved` events are ignored without blocking later sync events.
- No support-report submission code is reachable or retained.
- The local log inspector continues to work and its tests remain green.
- Current README language does not claim a support submission capability.
- The full build and artifact inspection pass.

## Non-Goals

- Do not remove or rewrite the active local log inspector.
- Do not remove persistent local logging, sanitization, or log retention.
- Do not migrate or rewrite users' historical sync-event files.
- Do not add a replacement support transport.
- Do not broaden this change into unrelated unused-code cleanup.
