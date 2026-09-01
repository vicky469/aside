# Supported Agent Failure Fallback

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside records unsuccessful agent runs with `status: "failed"`.
- [x] Aside renders live reply text separately from grey process-progress text.
- [x] Runtime adapters expose structured diagnostics for supported local agents.

### To Implement

- [x] Classify known quota, billing, authentication, rate-limit, and runtime-availability failures through one shared policy for every supported agent, including failure text returned through an otherwise successful transport result.
- [x] Replace streamed provider error text with a concise provider-aware fallback when a classified failure reaches the controller.
- [x] Keep classified runs visibly failed and retain their retry behavior.
- [x] Render the failed state with a clear failure mark (`❌ Failed`) rather than a success mark.
- [x] Preserve specific diagnostics in run metadata and logs without exposing raw provider garbage as the persisted reply.

### Verification

- [x] Shared classifier tests cover Codex, Claude, Cursor, Gemini, and DeepSeek failure examples.
- [x] Controller tests prove prior partial text is replaced for classified failures while ordinary failures keep their existing behavior.
- [x] UI tests prove failed agent output uses `❌ Failed` and the generic fallback copy.
- [x] Focused tests, the full test suite, and the production build pass.

## Problem

Some agent CLIs emit quota, credit, billing, authentication, rate-limit, or service-availability failures as assistant text before exiting or reporting failure. Aside currently treats any streamed assistant text as the failed reply body. This can persist verbose, duplicated, malformed, or provider-internal output in the user’s thread. Gemini exposed the problem, but every supported agent runtime can produce the same class of unusable response.

## User Experience

A recognized provider or runtime-availability failure remains visibly failed:

```text
@gemini  ❌ Failed

Gemini couldn’t complete this request. Try another agent.
```

The agent label changes for Codex, Claude, Cursor, Gemini, or DeepSeek. DeepSeek's OpenCode transport remains an internal implementation detail. The run does not masquerade as a successful assistant reply. Existing retry controls remain available.

## Design

A shared failure-policy helper owns classification and user-facing fallback formatting for all supported agents. It accepts the requested agent plus the final runtime diagnostic and classifies only high-confidence failure signatures: quota or credits exhausted, billing disabled or required, authentication or authorization failure, rate limiting, and runtime or service unavailability.

Runtime adapters remain responsible for extracting provider-specific structured diagnostics from their transports. They do not each format UI copy. The controller validates both thrown runtime diagnostics and the final returned reply text through the shared policy. A reply that is itself a high-confidence provider failure is converted into a failed run before normal completion. The controller passes an explicit replacement reply to the failed-run persistence path.

The failed-run path distinguishes two values:

- `error`: the diagnostic retained for debugging, logging, and status metadata.
- `failureText`: the safe text persisted and rendered in the comment.

For classified failures, `failureText` is always `{Agent} couldn’t complete this request. Try another agent.` even if partial reply text was already streamed. For unclassified failures, current behavior remains unchanged: an existing partial reply is preserved, otherwise the diagnostic is shown.

This split keeps one policy owner, thin runtime extractors, and one controller enforcement point. It also avoids a broad “bad answer” quality heuristic that could replace legitimate unusual replies.

## Error Handling

Classification is conservative and case-insensitive. It uses known diagnostic concepts rather than judging prose quality. Raw diagnostics remain accessible in the failed run’s `error` field and logs. Cancellation is not classified and retains its existing behavior. Empty successful responses retain their existing runtime-specific failure messages unless they match a classified availability signature.

## UI

The existing failed-run presentation gains an explicit `❌ Failed` label. The generic body tells the user what happened at the useful level and recommends trying another agent without claiming a specific billing cause that Aside cannot prove.

## Testing

Unit tests exercise the shared classifier and formatter for every supported agent. Controller tests simulate a classified runtime error after garbage partial text and assert that the persisted comment contains only the fallback while the run remains failed and retains the original diagnostic. Representative unclassified and cancellation tests prevent overreach. Sidebar rendering tests assert the failure mark and copy without changing successful or running states.
