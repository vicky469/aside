# Agent Runtime Experience Plan

## Status

Phase 1 in progress

Implemented in current branch:

- staged in-thread runtime status copy for active `@codex` runs
- visible `Cancel` action on active run cards
- delete -> cancel behavior so active runs stop immediately when their thread is deleted

Still pending from this plan:

- smarter default context packing
- built-in Aside runtime knowledge primer
- cold-start reduction work

Related docs:

- [agent-mentions-plan.md](agent-mentions-plan.md)
- [agent-mentions-spec.md](agent-mentions-spec.md)

## Summary

Built-in `@codex` is now usable, but the current experience still feels slower and less confident than it should.

The main issue is not only raw runtime latency. It is also:

- opaque progress while the agent is starting
- weak default context packing
- missing built-in Aside-specific operating knowledge
- limited control when a run is taking too long or no longer matters

This plan focuses on the next iteration of built-in agent UX:

- make long runs feel understandable instead of stuck
- improve first-pass answer quality by sending better default context
- carry the most important Aside knowledge in the built-in prompt path
- make cancellation and deletion feel immediate and predictable
- reduce first-run startup friction where possible

## Problem

Today the user-visible pain points are:

1. The running state is too generic.
   A spinner with minimal status text is easy to interpret as "stuck", especially before the first streamed text arrives.

2. The built-in request path does not make context scope explicit enough.
   The current markdown note, current thread, anchored text, or nearby section context may not be represented clearly enough in the runtime prompt.

3. Built-in `@codex` does not carry enough Aside-specific knowledge by default.
   Users should not need external `skills/aside` knowledge just to get good built-in results.

4. Long-running work lacks strong interruption controls.
   If the user deletes the note or decides the run is no longer useful, the UI should stop feeling live immediately and the underlying run should be cancelled.

5. First-run latency is especially expensive.
   Even when the end-to-end runtime is acceptable, startup overhead makes the feature feel hesitant.

## Product Goal

Make built-in `@codex` feel native, informed, and responsive inside Aside.

The target user impression should be:

- I can see what phase the agent is in.
- The agent already understands the current note and thread.
- The built-in flow knows enough about Aside to answer usefully without extra setup.
- If I no longer want the run, I can stop it cleanly.
- Even when the work takes time, it does not feel stuck or mysterious.

## Non-Goals

Not part of this plan:

- multi-agent orchestration
- full workflow planning across multiple note threads
- sending the entire note body by default for every request
- replacing the existing share-link workflow
- turning the agent runtime into a general-purpose background jobs system

## Recommended Improvements

### 1. Replace the generic spinner with staged progress

The current running cue should become phase-based status feedback.

Recommended minimum phases:

- `Preparing context`
- `Starting Codex`
- `Drafting reply`
- `Writing back`

This should appear inline in the thread where the run is happening.

The goal is perceived responsiveness:

- users should understand why nothing has streamed yet
- startup delay should read as an expected phase, not as a hang

Optional follow-up:

- show elapsed time while running
- show queue position if queued runs are allowed to stack

### 2. Auto-attach smarter default note context

When a user writes `@codex` in the sidebar, the built-in runtime should automatically include the most relevant local context without requiring manual setup.

Recommended default context payload:

- current note path
- current thread transcript
- current triggering entry text
- anchored text if the thread is selection-anchored
- otherwise the current local section or nearest heading block
- nearby headings for orientation

Important constraint:

- do **not** send the full markdown file by default unless explicitly needed

Reason:

- full-note prompts increase latency
- full-note prompts add noise when the task is really about one anchored region or one section

Recommended future setting:

- context scope: `anchor`, `section`, `full note`

Default recommendation:

- selection-anchored thread: `anchor`
- page note thread: `section`

### 3. Carry built-in Aside knowledge in the prompt

Built-in `@codex` should not depend on an external `skills/aside` install to behave well.

The runtime prompt should include a compact built-in primer for Aside behavior, for example:

- Aside replies are appended back into the same thread
- the reply should be concise and thread-friendly
- anchored notes refer to a local selection in the current markdown file
- page notes refer to the file or current section rather than one exact range
- if a longer artifact is needed, the runtime may create or update a local markdown note and return a short pointer

This should be treated as product knowledge, not optional external skill packaging.

The public `skills/aside` package can still exist for external handoff workflows, but built-in `@codex` should not rely on it.

### 4. Add strong cancellation behavior

Long-running agent work needs immediate user control.

Recommended behavior:

- add a visible `Cancel` action on an active agent run card
- deleting a thread with an active run should cancel the run first
- cancelling should remove the live spinning state immediately
- the card should either disappear or switch to a clear cancelled state without reviving itself

This is both a UX and correctness improvement:

- the UI should stop implying active work after the user has explicitly dismissed it
- the runtime should not continue streaming into a deleted thread

### 5. Reduce cold-start cost where possible

The first run after plugin load is often the worst-feeling run.

Recommended options to evaluate:

- lightweight runtime warm-up on plugin load or first sidebar open
- pre-resolve the execution environment before the first user-triggered run
- avoid unnecessary prompt bloat in the default request path

This does not need to eliminate startup cost entirely. It only needs to reduce the "nothing is happening" phase enough that the product feels ready.

## Implementation Order

### Phase 1: perceived latency and control

Ship first:

- staged status copy instead of a generic spinner
- visible cancel action
- delete -> cancel -> clear live UI behavior

Reason:

- this gives the fastest improvement to user trust
- it also reduces confusion during longer tasks without needing deeper prompt work first

### Phase 2: smarter context packing

Ship next:

- current note path
- thread transcript
- anchored selection or section slice
- nearby headings
- explicit context-scope policy

Reason:

- this should improve answer quality while also keeping prompts smaller than full-note defaulting

### Phase 3: built-in Aside primer

Ship next:

- compact built-in product knowledge block derived from the old `skills/aside` assumptions

Reason:

- this improves reliability for Aside-specific tasks without making built-in use depend on external setup

### Phase 4: startup optimization

Evaluate and ship after the UX changes above are measurable:

- warm-up strategy
- environment pre-resolution
- prompt trimming follow-up

Reason:

- startup work is worth doing, but it should be informed by the clearer phase-based telemetry from earlier phases

## Acceptance Criteria

This plan is successful when:

- a running `@codex` request no longer looks indistinguishable from a stuck request
- the user can see a meaningful phase before the first streamed text arrives
- deleting or cancelling an active run removes the live spinning state immediately
- built-in `@codex` behaves well without requiring Aside skill installation
- default context includes the current note and the most relevant local thread scope
- built-in responses improve on Aside-specific tasks without needing full-note prompts by default

## Open Questions

1. Should page-note requests default to `section` or `full note` context scope?
2. Should warm-up happen automatically on plugin load, or only after the user first opens the sidebar?
3. Should cancelled runs remain visible as historical rows in the `Agent` tab, or disappear completely from the local thread surface?
4. Do we want the built-in Aside primer to be hardcoded, or generated from a maintained local reference file?
