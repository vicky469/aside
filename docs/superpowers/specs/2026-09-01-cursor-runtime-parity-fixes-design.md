# Cursor Runtime Parity Fixes

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside exposes separate partial-reply and grey progress callbacks for local agent runtimes.
- [x] The Cursor adapter parses newline-delimited stream JSON and replaces streamed text with the terminal result.

### To Implement

- [ ] Route non-terminal Cursor assistant text through the grey progress callback instead of the persisted reply callback.
- [ ] Publish only a successful terminal Cursor result as reply text.
- [ ] Force the Cursor CLI sandbox on while preserving the selected workspace and additional vault root.
- [ ] Reject an executable named `agent` when its help output does not identify the Cursor Agent CLI.

### Verification

- [ ] Regression tests prove interim Cursor narration never enters partial reply text.
- [ ] Argument tests prove Cursor launches with the sandbox enabled.
- [ ] Diagnostic tests cover both genuine Cursor help output and a colliding non-Cursor `agent` executable.
- [ ] The focused runtime adapter tests, full test suite, and production build pass.

## Problem

The Cursor runtime currently treats every timestamped `assistant` event as end-user reply text. Cursor uses those events for live working narration as well as response output, so process messages appear in the normal reply body and can repeat while tools are running. The same adapter also launches Cursor without an explicit sandbox and considers any successful `agent --help` command to be Cursor.

## Design

`agentRuntimeAdapter.ts` remains the single owner of Cursor-specific transport semantics.

- `assistant` text events are live progress. Their text is normalized and sent through `onProgressText`, which the existing controller renders in grey.
- A successful terminal `result` event is the authoritative end-user reply. It alone updates `onPartialText` and becomes `replyText`.
- Cursor CLI arguments include `--sandbox enabled`, followed by the existing workspace and optional vault-root arguments.
- Runtime diagnostics inspect combined standard output and standard error from `agent --help`. Availability requires a Cursor-specific help signature, not merely exit code zero.

The generic JSON-line runner, comment controller, and streamed reply renderer do not change. This keeps runtime-specific event interpretation in the thin Cursor adapter and avoids changing Claude, Gemini, OpenCode, or Codex behavior.

## Error Handling

Terminal Cursor error events retain their current structured diagnostic handling. A non-Cursor executable found at `agent` returns `unavailable` with the existing launch message rather than being advertised as available and failing later.

## Testing

Tests use representative Cursor stream events: two narration deltas followed by a successful result. They assert that narration is present only in progress updates and that the result is the only partial reply. Separate tests assert the sandbox argument and reject generic help output.
