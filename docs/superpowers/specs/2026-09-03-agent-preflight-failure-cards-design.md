# Agent Preflight Failure Cards

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside creates persistent reply cards for agent runs that fail after they have been queued.
- [x] Aside marks failed agent cards with `❌ Failed` and keeps them retryable.
- [x] One shared failure policy formats `{Agent} couldn’t complete this request. Try another agent.` for Codex, Claude, Cursor, Gemini, and DeepSeek.
- [x] Runtime diagnostics detect a missing, broken, or unavailable local CLI before execution.

### To Implement

- [x] Convert a blocked runtime preflight for a supported `@agent` mention into a persisted failed run and reply card instead of showing only a transient notice.
- [x] Apply the same failed-card path when retrying a saved supported-agent prompt whose runtime preflight is blocked.
- [x] Extract and sanitize a useful preflight diagnostic for the failed-card body, falling back to the shared friendly failure reply only when no useful diagnostic is available.
- [x] Preserve the full specific preflight diagnostic in run metadata and logs even when the card uses a shorter sanitized message.
- [x] Keep availability handling provider-neutral and derive provider labels from the existing actor registry.

### Verification

- [x] Fail-first controller tests cover initial blocked preflights and retry blocked preflights.
- [x] Table-driven coverage proves the behavior works for every supported agent target.
- [x] Regression tests prove no runtime process starts for a blocked preflight and no transient-only notice replaces the failed card.
- [x] The focused agent tests, full test suite, production build, and release-artifact guard pass.
- [x] The verified build is installed into `lean-startup` and its shipped assets match byte-for-byte.

## Problem

Aside currently checks whether a selected local agent CLI can launch before it creates an agent run. If the check is blocked, the controller shows a transient notice and returns. The user's saved `@agent` request remains in the thread without a reply card, run record, visible failure state, or retry action. This looks like a silent failure even though Aside detected the problem correctly.

Failures after queueing already produce the desired experience. The missing case is the preflight boundary before queueing.

## Scope

The change applies to direct supported-agent mentions and retries of saved direct-agent prompts:

- `@codex`
- `@claude`
- `@cursor`
- `@gemini`
- `@deepseek`

Local agent CLIs remain user-managed. Aside does not bundle, install, update, or repair them. Built-in command validation and command-specific no-agent replies remain unchanged.

## User Experience

When a supported agent cannot pass runtime preflight, Aside immediately inserts the normal agent reply card beneath the saved request. The card is persisted and displays the best concise, safe, actionable diagnostic available, for example:

```text
@codex  ❌ Failed

Missing required Codex runtime package `@openai/codex-darwin-arm64`.
```

When Aside cannot extract a useful diagnostic, it falls back to:

```text
Codex couldn’t complete this request. Try another agent.
```

The actor label changes according to the requested provider. The card retains the existing Retry action. Retrying after the user repairs or authenticates the CLI reuses the normal retry flow; if preflight is still blocked, the card remains failed with the same diagnostic or fallback reply.

The transient notice is not the primary failure surface. Full diagnostics such as a missing executable, broken optional dependency, authentication problem, or launch error remain in run metadata and logs for troubleshooting. Stack traces, command echoes, environment values, and noisy duplicated output never enter the card body.

## Architecture

`commentAgentController.ts` remains the single owner of converting an agent request into a persisted run and reply card. A small provider-neutral helper will accept the saved-entry context, requested agent, mode preference, runtime, and preflight diagnostic, then create the normal queued run and transition it through the existing failed-run persistence path without launching a process.

The runtime-selection result will retain enough information for a blocked local selection to create a valid run record. It must carry the intended runtime and normalized diagnostic rather than forcing the controller to infer provider-specific behavior.

`agentFailurePolicy.ts` remains the single owner of the generic fallback copy. A shared diagnostic sanitizer will select a bounded actionable message from structured diagnostic fields and CLI stderr, remove stack frames and duplicate lines, and reject unsafe or meaningless output. The preflight path will explicitly identify the failure as runtime availability rather than relying on broader prose heuristics. Provider labels continue to come from `agentActorRegistry.ts`.

Initial dispatch and retry will call the same blocked-preflight helper. Runtime adapters remain responsible only for diagnostics and execution; they will not create comments or duplicate UI wording.

## Data Flow

1. Aside parses the saved comment and resolves a supported agent target.
2. Runtime selection performs the existing non-mutating CLI diagnostic.
3. If available, Aside follows the existing queue and execution path unchanged.
4. If blocked, Aside creates a run for the requested agent, inserts the ordinary empty reply entry, and transitions the run to `failed` without spawning the CLI.
5. The failed reply entry receives a sanitized actionable diagnostic when one exists; otherwise it receives `{Agent} couldn’t complete this request. Try another agent.`
6. The full diagnostic is stored as `run.error` and written to the existing structured log.
7. The UI renders the persisted card with `❌ Failed` and its existing Retry action.

## Error Handling

If Aside cannot append the failed reply entry, it records the run failure through the existing persistence safeguards and does not create duplicate cards. Repeated save callbacks remain protected by the existing trigger-entry run lookup. Cancellation is irrelevant because a blocked preflight never starts a process.

The sanitizer prefers an explicit CLI error line that tells the user what is missing, unavailable, or unauthenticated. It bounds length, collapses duplicate lines, and excludes stack frames, serialized objects, command echoes, and environment details. If the remaining text is empty, generic, or unsafe, the card uses the shared provider-aware fallback. This avoids leaking launcher internals or provider garbage while still returning useful errors when possible.

## Testing

Implementation follows red-green-refactor. Controller tests first establish that a blocked preflight currently produces no run and then require a persisted failed card, sanitized body or generic fallback, raw `run.error`, zero runtime invocations, and no transient-only notice.

A table-driven test covers all supported agent targets using registry-derived expectations. Sanitizer tests cover an actionable missing-package error, authentication text, repeated output, stack traces, empty diagnostics, and unsafe or meaningless output. Retry coverage starts from a saved prompt with missing or failed run metadata and proves that a blocked retry produces or updates one retryable failed card without duplication. Existing success, post-launch failure, cancellation, and command-specific no-agent tests remain unchanged.

After focused tests, run the full build. The production artifact guard must inspect `main.js`, `manifest.json`, and `styles.css` and reject source maps, embedded source content, raw source files, secrets, and local-only paths. Install the built plugin into `lean-startup`, compare the three shipped assets byte-for-byte, reload Aside, and confirm the original thread can be retried into a visible card.

## Non-Goals

- Bundling or automatically installing any agent CLI.
- Falling back to a different agent automatically.
- Changing successful or in-progress agent-card presentation.
- Adding provider-specific failure text outside the existing shared policy.
- Changing command-specific validation for `/create-script`, `/update-script`, or `/pdf-to-markdown`.
- Cutting or publishing a release.
