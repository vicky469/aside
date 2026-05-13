# Agent Mentions Plan

## Status

Draft plan

Implementation spec:

- [agent-mentions-spec.md](agent-mentions-spec.md)

## Summary

Aside should support semantic agent mentions inside side notes.

Current implementation scope:

- support `@codex` in the shipped build
- keep the target abstraction open so additional agents can be added later without rewriting the feature shape

When a user writes an explicit agent target such as `@codex` in a side note, Aside should treat that as an instruction to hand the thread to an external coding assistant runtime.

The important architecture decision is:

- do **not** put the queue between source notes and `Aside index.md`
- keep the note as canonical storage
- keep `Aside index.md` as derived output
- place the queue between successful Aside comment persistence and external agent execution

This feature should borrow the runtime model from OpenClaw:

- external coding harnesses run as ACP-backed sessions
- detached work is tracked as background tasks
- multi-step Task Flow is only needed if one request becomes a true pipeline

For Aside phase 1, one explicit agent-target trigger should map to one queued task.

## Problem

Today, Aside supports agent workflows only through an external handoff:

- copy a side-note URI
- paste it into Codex, Claude Code, or another assistant
- rely on external instructions and the `aside` CLI to write back safely

That works, but it creates product friction:

1. The workflow starts outside Aside.
   The user has to leave the note and manually hand off context.

2. `@mentions` are only visual today.
   In the editor and rendered markdown, `@foo` is styled, but it has no product meaning.

3. The system has no built-in queue or delivery state for agent work.
   There is no first-class model for queued, running, succeeded, failed, or blocked agent actions.

4. The existing index is the wrong place to own agent runtime state.
   `Aside index.md` is derived output and should not become a queue ledger or source of truth.

## Product Goal

Make explicit agent targets feel native to Aside:

- user writes a side note in the normal sidebar flow
- user includes an explicit agent target such as `@codex` or `@claude`
- Aside persists the side note to canonical note storage first
- Aside queues and dispatches the request to the selected runtime
- the runtime result comes back into the same Aside thread
- the existing note and index refresh path continues to work normally

The core product goal is not just mention highlighting. It is first-class in-note agent delegation.

## Non-Goals

Not in phase 1:

- turning `Aside index.md` into a queue database
- replacing the existing share-link workflow
- full multi-step orchestration or branching flow graphs
- multiple concurrent agent replies inside one thread without policy
- collaborative multi-user assignment semantics
- cross-vault distributed execution
- background execution for arbitrary non-side-note markdown mentions outside Aside-managed threads

## Current System Learning

### Aside storage model

Aside is note-canonical today.

- Each markdown note stores comments in one trailing `<!-- Aside comments -->` block.
- The stored format is already threaded.
- `Aside index.md` is derived output only.

This means any agent feature must preserve:

- note-backed source of truth
- normal thread append/edit/resolve behavior
- normal aggregate index rebuild behavior

### Current Aside save path

The current save path is already a good interception point:

1. draft save begins in the mutation controller
2. comment or entry is added to the in-memory manager
3. the note is persisted
4. aggregate and derived views refresh

This means agent dispatch should start only after canonical comment persistence succeeds.

### Current mention behavior

Current `@mentions` are presentation-only:

- styled in draft preview
- styled in rendered comment markdown
- not stored as structured semantics
- not used by index, graph, or metadata augmentation

By contrast, `[[wikilinks]]` already have semantic meaning:

- derived metadata
- mentioned-page labels
- thought-trail graph
- index file-filter graph

So `@codex` and `@claude` require new semantic parsing, not a CSS-only extension.

### Existing Aside share flow

The product already has a safe external handoff path:

- user clicks Share side note
- Aside copies an `obsidian://aside-comment?...` link

This should remain as:

- fallback workflow
- debugging path
- interoperability path for agents outside the built-in runtime integration

## OpenClaw Learning To Reuse

### ACP runtime model

OpenClaw distinguishes between:

- native subagents
- external coding harness runtimes through ACP

That distinction matches this feature well.

Codex and Claude Code should be modeled as external runtimes, not as internal Aside logic.

### Background tasks

OpenClaw tracks detached work as background tasks with simple states:

- queued
- running
- succeeded
- failed
- timed_out
- cancelled
- lost

That is the right level for Aside phase 1.

### Task Flow scope

OpenClaw uses Task Flow only when work spans multiple sequential or branching steps with durable orchestration.

That means Aside should **not** start with a full Task Flow equivalent unless the feature truly becomes:

- classify request
- pick runtime
- gather context
- run multiple steps
- wait for approvals
- perform chained follow-up jobs

For a simple explicit-target handoff, one queued task is enough.

## Product Decision

The queue belongs between:

- successful Aside thread persistence
- external agent runtime execution

The queue does **not** belong between:

- note storage
- aggregate index generation

So the write path should be:

```text
save draft -> persist canonical note -> enqueue agent task -> run agent -> append reply entry -> normal refresh
```

This keeps the existing Aside mental model intact:

- note is canonical
- sidebar is working view
- index is derived
- agent execution is an attached subsystem, not a replacement storage layer

## Desired UX

### Triggering

Inside a draft or appended entry:

- `@codex` means route to Codex
- `@claude` means route to Claude Code

Phase 1 should support explicit textual invocation inside Aside-managed comments only.

### Agent sidebar surface

In the index sidebar, Aside should add a third top-level tab:

- `List`
- `Thought Trail`
- `Agent`

The purpose of `Agent` is speed and clarity:

- faster way to find threads that involve agent work
- clearer visual separation from normal human-only side notes
- one obvious place to inspect queued, running, failed, and completed agent conversations

This should be treated as a dedicated sidebar surface, not as hidden filtering buried inside the normal list.

### Agent tab behavior

The `Agent` tab should show only agent-relevant threads.

Minimum inclusion rule:

- a thread contains an explicit agent target such as `@codex` or `@claude`
- or the thread already has associated agent run state
- or the thread has at least one agent-produced reply entry

The initial presentation can still be list-like, but the mode should be distinct because the user goal is distinct:

- `List` = all side-note threads
- `Thought Trail` = graph/navigation view
- `Agent` = active and historical agent work

### Agent tab controls

The `Agent` tab should hook into the same list-style toolbar controls as `List`.

In particular, phase 1 should reuse:

- `Files`
- resolved visibility
- nested-comment visibility

That means `Agent` is not a completely separate rendering model. It is a list-derived mode with an extra agent-specific scope.

The practical expectation is:

- `Files` still narrows the visible threads
- resolved visibility still determines whether resolved agent-involved threads are shown
- hide nested comments still affects how agent thread entries are expanded or collapsed

The difference from `List` is the base population:

- `List` starts from all scoped side-note threads
- `Agent` starts from agent-relevant scoped side-note threads

After that initial population step, the familiar list controls should continue to apply.

### Agent tab status cues

Inside the `Agent` tab, each thread should expose agent state clearly.

Minimum phase 1 cues:

- queued
- running
- succeeded
- failed

The user should be able to scan this surface and quickly answer:

- which threads are waiting on an agent
- which threads are actively running
- which threads failed and need retry
- which threads already have an agent response

### Task feedback

The user should be able to tell that work is happening.

Minimum phase 1 states:

- queued
- running
- succeeded
- failed

The feedback may first appear as sidebar-local status rather than a full task board.

### Delivery

When the agent finishes:

- append a new child entry into the same thread
- keep the original triggering entry unchanged
- preserve thread history

This should feel like the thread gained another reply, not like the original comment was overwritten.

### Failure

If execution fails:

- keep the saved comment in place
- keep a task record or failure marker
- do not corrupt the note
- allow retry

## Product Rules

### Rule 1

The markdown note remains canonical.

Agent runtime state must not become the source of truth for the thread.

### Rule 2

`Aside index.md` remains derived.

It may reflect agent-produced replies after normal refresh, but it must not store or own the task queue.

### Rule 3

Aside owns note writes.

The external runtime may work on repo files or produce text, but Aside should be the layer that appends the reply back into the thread.

### Rule 4

Agent dispatch begins only after canonical comment persistence succeeds.

If the note write fails, no external task should start.

### Rule 5

One explicit agent-target trigger creates one detached task in phase 1.

Do not introduce full flow orchestration unless the request shape proves it necessary.

### Rule 6

The explicit target text decides the runtime in phase 1.

Do not guess from installed binaries at save time.

### Rule 7

The index sidebar should provide a dedicated `Agent` tab for agent-involved threads.

This should be a first-class surface, not only a secondary filter inside `List`.

### Rule 8

The `Agent` tab must reuse the same list-style controls as `List`.

At minimum:

- file scoping
- resolved visibility
- nested-comment visibility

It should behave like a scoped list mode, not like an unrelated special panel.

## Recommended Architecture

### New subsystem shape

Add a small Aside agent subsystem:

- `AgentDirectiveParser`
- `AgentRunStore`
- `AgentQueue`
- `AgentRuntimeAdapter`
- `CommentAgentController`
- `AgentSidebarPlanner`

### Responsibilities

`AgentDirectiveParser`

- detect semantic agent mentions
- resolve `@codex`, `@claude`
- separate visible mention text from runtime intent

`AgentRunStore`

- store durable run metadata in plugin data
- map runs to thread ids and triggering entry ids
- survive Obsidian restart

`AgentQueue`

- serialize or rate-limit runtime starts
- protect against duplicate dispatch from repeated refreshes or save retries

`AgentRuntimeAdapter`

- provide one abstraction over runtime backends
- preferred phase-1 backend: direct local Codex and Claude CLI execution
- possible later backend: OpenClaw ACP

`CommentAgentController`

- listen after successful comment persistence
- enqueue work
- update run state
- append successful agent replies back into the thread

`AgentSidebarPlanner`

- derive which threads belong in the `Agent` tab
- sort them by active status and recency
- expose compact status data for rendering
- apply the same file-scope and visibility controls used by the normal list mode after agent-thread selection

## Runtime Model

### Preferred phase 1 backend

Primary backend:

- direct local CLI execution

Reason:

- it removes the extra dependency on an ACP bridge for the first shipping version
- it keeps Aside aligned with the Codex and Claude CLIs users already run locally
- it still leaves room for a later ACP adapter if the runtime model expands

### Runtime selection

Phase 1 should use plugin settings for:

- a preferred-agent dropdown with `Codex` and `Claude`
- later runtime/backend config for `@codex`
- later runtime/backend config for `@claude`
- automatic working-directory resolution based on the note context

The preferred-agent dropdown should be the first settings surface in the plugin.

It provides a simple explicit picker for future agent actions and fallback routing, while explicit thread text still remains authoritative:

- `@codex` routes to Codex
- `@claude` routes to Claude Code

### Permission boundary

Because external runtimes should not write directly into Aside-managed note storage, Aside should avoid delegating the final note write to the harness.

Instead:

- runtime returns text or structured output
- Aside appends the reply entry itself

## Data Model Direction

Phase 1 needs durable run metadata separate from the note body.

Suggested minimum run record:

```ts
interface AgentRunRecord {
  id: string;
  threadId: string;
  triggerEntryId: string;
  filePath: string;
  requestedAgent: "codex" | "claude";
  runtime: "openclaw-acp" | "direct-cli";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  promptText: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  outputEntryId?: string;
}
```

This record should live in plugin data, not inside the note-managed comment block.

The sidebar `Agent` tab should be derived from:

- canonical thread content in notes
- durable run metadata in plugin data

It should not become a second source of truth.

## Safest Delivery Order

1. Add a plan-backed semantic model for `@codex` and `@claude`.
2. Add durable run storage in plugin data.
3. Add post-persist dispatch hook after successful Aside note writes.
4. Add derived agent-thread selection logic for a dedicated `Agent` tab.
5. Add a no-op or stub runtime adapter for local development.
6. Add the first real direct CLI adapter for Codex and Claude.
7. Append successful runtime output back into the same thread.
8. Add retry and failure UX.

## Acceptance Criteria

### AC1

If a user saves a side note without an agent directive:

- Aside behaves exactly as it does today.

### AC2

If a user saves a side note containing `@codex` or `@claude`:

- the note is persisted first
- one agent task record is created
- the task enters `queued` then `running`

### AC3

If a thread contains agent work, it appears in the sidebar `Agent` tab.

### AC4

If a thread has an active or failed run, the `Agent` tab exposes that state clearly.

### AC5

The `Agent` tab respects the same list-style controls as `List`:

- file filter
- resolved visibility
- nested-comment visibility

### AC6

If the runtime succeeds:

- Aside appends one new child entry to the same thread
- the index refresh path picks it up through normal derived behavior

### AC7

If the runtime fails:

- the original saved side note remains intact
- the run is marked failed
- retry is possible without manual note repair

### AC8

`Aside index.md` stays derived and is never used as queue storage.

## Open Questions

1. Should `@codex` or `@claude` dispatch on every save, or only on new entries and explicit retries?
	
2. Should an edited triggering entry re-run the same task or create a new run?
   
3. What is the right working-directory mapping:
   - global setting
   - per-note rule
   - frontmatter mapping
   - folder-based mapping

 4. Should Aside append raw agent text only, or store a small structured execution summary too?
    
5. Do we want a dedicated sidebar section for active agent runs in phase 1, or only inline thread status?
  
## Success Metric

A user can stay inside Aside, write a thread entry with `@codex` or `@claude`, and receive the agent reply back into the same thread without using the manual share-link workflow.
