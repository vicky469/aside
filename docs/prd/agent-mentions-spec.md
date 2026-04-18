# Agent Mentions Spec

## Status

Draft implementation spec based on:

- [agent-mentions-plan.md](agent-mentions-plan.md)
- [architecture.md](../architecture.md)

## Objective

Implement the current shipped phase of agent delegation for explicit `@codex` mentions inside SideNote2-managed threads, while keeping the internal target model extensible for additional agents later.

This spec turns the plan plus the answered sidebar questions into concrete implementation requirements for:

- directive parsing
- post-persist dispatch
- durable run storage
- runtime invocation
- agent reply append behavior
- index sidebar `Agent` mode
- retry behavior
- tests

## Final Decisions

These decisions are closed for phase 1:

- auto-dispatch happens only for newly saved user entries in `new` or `append` mode
- editing an existing triggering entry never auto-dispatches
- explicit retry creates a new run record
- agent execution is owned by the desktop plugin/runtime, not by mobile clients
- the current shipped build supports `@codex` only
- unsupported explicit targets such as `@claude` must not dispatch and should surface a concise notice instead
- the runtime working directory is the nearest git repo containing the note, with fallback to the note folder and then the vault root
- raw agent reply text is the only note-body output
- live streamed agent text is an in-memory sidebar surface only until completion
- execution metadata stays in plugin data
- the existing index sidebar `Agent` tab is the only dedicated phase-1 agent surface
- no second active-runs panel is added

## Scope

In scope:

- semantic parsing for `@codex` and `@claude`
- one durable run record per triggered save or explicit retry
- a global FIFO queue with one active run at a time
- runtime dispatch through an `AgentRuntimeAdapter`
- raw reply append back into the same thread
- live streamed reply rendering while a run is in progress
- index sidebar `Agent` tab
- status rendering for queued, running, succeeded, failed
- explicit retry from agent-involved threads
- desktop-hosted execution plus runtime-precondition handling

Out of scope:

- generic `@agent` auto-dispatch
- multi-agent fan-out from one saved entry
- per-note or frontmatter workspace mapping
- multiple concurrent runtime executions
- mobile-local agent runtime execution
- structured note-body execution summaries
- chain-of-thought or thinking-step storage
- incremental note writes for partial streamed output
- source-note agent tabs outside the index sidebar
- direct note writes by the external runtime
- an OpenClaw-style mobile node, relay, or off-device execution layer for SideNote2 phase 1

## Product Rules

### Rule 1: Explicit Targets Only

Phase 1 auto-dispatch recognizes only:

- `@codex`
- `@claude`

The existing `preferredAgentTarget` setting must not override explicit mention text.

### Rule 2: Auto-Dispatch Happens Only After Canonical Save

SideNote2 persists the user entry first.
Only after the note write succeeds may agent dispatch begin.

### Rule 3: Only New User Saves Auto-Dispatch

Auto-dispatch is allowed only when the saved draft mode is:

- `new`
- `append`

Saved edits never auto-dispatch.

### Rule 4: Retry Is Explicit

Retry is a user action, not a save side effect.
Every retry creates a new run record and preserves earlier runs for history.

### Rule 5: One Saved Entry Produces At Most One Run

One saved entry may create:

- zero runs if no valid directive exists
- one run if exactly one valid target exists

If one saved entry contains conflicting explicit targets, SideNote2 must not auto-dispatch.

### Rule 6: Runtime Working Directory Follows The Note's Local Repo Context

Phase 1 resolves the runtime working directory in this order:

- nearest git repo root that contains the note
- the note's own folder
- the active vault root

Do not add explicit workspace-root settings, frontmatter mapping, or folder mapping in phase 1.

### Rule 7: Raw Reply Text Only

The appended agent reply entry stores only the reply text.
Run status, timestamps, errors, and output linkage live in plugin data only.

### Rule 7a: Streaming Is Transient Until Completion

If the runtime exposes partial text, SideNote2 may render that text live in the sidebar while the run is `running`.

That live text must:

- stay in memory only
- never become the canonical thread source of truth during generation
- be replaced by one final persisted child entry only after the run succeeds

If the run fails or is cancelled, SideNote2 must not persist the partial text as a normal thread entry in phase 1.

### Rule 8: The `Agent` Tab Reuses List Controls

The index sidebar `Agent` tab must reuse the same controls as `List`:

- `Files`
- resolved visibility
- nested-comment visibility

## Directive Parsing Spec

## Recognition Rules

Add a new parser module:

- `src/core/text/agentDirectives.ts`

Parsing should mirror the current mention-token boundary rules used in:

- `src/ui/editor/commentEditorStyling.ts`

Minimum rules:

- match `@codex` and `@claude` as standalone mention tokens
- do not treat emails as directives
- repeated mentions of the same target count as one directive
- conflicting targets in one entry are invalid for auto-dispatch

Recommended output shape:

```ts
type AgentDirectiveTarget = "codex" | "claude";

interface AgentDirectiveResolution {
  target: AgentDirectiveTarget | null;
  hasConflict: boolean;
  matchedTargets: AgentDirectiveTarget[];
}
```

## Parsing Scope

Directive parsing runs only for:

- newly saved user thread parents
- newly saved user child entries
- explicit retry on a previously saved triggering entry

It does not run for:

- agent-generated reply entries
- edited entries during normal save

## Runtime Availability And Working Directory

## Execution Topology

Phase 1 follows the same broad control-plane idea OpenClaw uses for mobile:

- one host-side runtime owns real agent execution
- thinner clients are surfaces around that runtime, not independent runtimes

In SideNote2 terms, the Obsidian desktop plugin process is the execution owner.
It is responsible for:

- parsing explicit directives after canonical save
- creating run records
- invoking the external agent runtime
- appending the agent reply back into the canonical note

Phase 1 does not introduce a separate SideNote2 mobile runtime, background relay, or node layer.

## Working Directory

Resolve the working directory from the note path plus the desktop vault adapter:

- if the note lives inside a git repo, use that repo root
- otherwise use the note folder
- if that cannot be resolved safely, fall back to the vault root

This keeps agent work scoped to the repo the note is actually about instead of forcing every run to start at the whole vault root.

## Unsupported Environments

If no filesystem-backed working directory can be resolved, SideNote2 must:

- keep the saved user entry
- create a failed run record
- attach a concise environment error
- avoid starting any external runtime process

Phase 1 should treat this as unsupported runtime execution, which is expected on:

- Obsidian mobile
- any environment without a filesystem-backed vault
- any client surface that can render synced notes but cannot safely host local runtime execution

Agent-thread visibility is still allowed on those surfaces, but runtime dispatch is not.

## Runtime Selection

Phase 1 uses direct local CLI adapters:

- `@codex` -> `codex app-server` over local stdio JSON-RPC
- `@claude` -> `claude -p`

The adapter should launch through a login-shell environment so PATH and exported user credentials match normal terminal execution. The existing `preferredAgentTarget` setting remains non-authoritative for explicit mentions and may be reused later for generic agent affordances.

## Runtime Streaming

When supported by the local runtime, the adapter should stream partial assistant text into SideNote2 during execution.

Recommended phase-1 runtime behavior:

- `@claude` should use `claude -p --verbose --output-format stream-json --include-partial-messages`
- `@codex` should use `codex app-server --listen stdio://`
- the Codex adapter should `initialize`, `thread/start`, and `turn/start` once per run and consume `item/agentMessage/delta` notifications for live text
- the Codex adapter should treat `item/completed` and `turn/completed` as the canonical final-reply boundary before note persistence

Streaming requirements:

- parse stdout incrementally with `spawn`, not buffered `execFile`
- ignore reasoning, tool, and command-output deltas for note text purposes
- surface only assistant reply text deltas in the sidebar
- do not rerender the full sidebar on every partial-text delta
- route partial-text deltas into one per-thread transient UI controller that mutates a single DOM node in place
- use plain-text rendering for live streamed text and reserve markdown rendering for the final persisted reply only

Streaming UI rules:

- the parent thread card owns run status rendering
- the transient child streaming card must not repeat queued/running/succeeded/failed status
- the transient child streaming card may show the agent identity only, plus the live text body
- when the run completes, the transient child streaming card is removed and replaced by the normal persisted child entry on the next standard render
- do not render a generic placeholder like `Working...` before real text exists
- do not synthesize fake streaming from the final reply text
- if a runtime does not provide partial assistant deltas, keep the transient child card hidden and persist only the final reply once the run completes

## Data Model

## Note Schema

Do not change the thread entry schema in note-backed comments.

Agent-produced replies remain normal appended child entries.
Agent identity is derived from run records, not stored in the note body schema.

## Run Record

Add a dedicated run type module, recommended file:

- `src/core/agents/agentRuns.ts`

Recommended phase-1 shape:

```ts
type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

interface AgentRunRecord {
  id: string;
  threadId: string;
  triggerEntryId: string;
  filePath: string;
  requestedAgent: "codex" | "claude";
  runtime: "direct-cli";
  status: AgentRunStatus;
  promptText: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  retryOfRunId?: string;
  outputEntryId?: string;
  error?: string;
}
```

Ephemeral streamed state should stay separate from persisted run records.

Recommended in-memory shape:

```ts
interface AgentRunStreamState {
  runId: string;
  threadId: string;
  requestedAgent: "codex" | "claude";
  partialText: string;
  startedAt: number;
  updatedAt: number;
}
```

## Plugin Data Persistence

Extend persisted plugin data with agent runs.

Recommended direction:

- keep settings normalization in `indexNoteSettingsPlanner.ts`
- add agent-run normalization in a dedicated store/planner instead of mixing queue logic into settings code

Recommended store files:

- `src/control/agentRunStore.ts`
- `src/control/agentRunStorePlanner.ts`

`PersistedPluginData` should grow a new field:

```ts
agentRuns?: unknown;
```

## Queue And Lifecycle

## Queue Model

Add a queue owned by:

- `src/control/commentAgentController.ts`

Phase 1 queue rules:

- global FIFO
- one active run at a time
- queued runs survive reload as persisted records
- persisted `queued` or `running` runs from a previous session are normalized to `failed` on startup
- streamed partial text does not need to survive reload

This avoids pretending an external local CLI session survived an Obsidian restart.

## Post-Persist Trigger Point

Use `CommentMutationController` as the post-persist trigger point because it already knows:

- save mode
- saved entry id
- target file path
- whether canonical persistence succeeded

Concrete requirement:

- after a successful `new` or `append` save, call `CommentAgentController.handleSavedUserEntry(...)`
- do not call this after `edit` saves

Recommended payload:

```ts
interface SavedUserEntryEvent {
  threadId: string;
  entryId: string;
  filePath: string;
  body: string;
}
```

## Retry Flow

Phase 1 requires an explicit retry action.

Retry behavior:

1. identify the latest run for the thread
2. load the current saved body of that run's `triggerEntryId`
3. parse directives again from that current saved body
4. if no valid explicit target remains, do not retry
5. if valid, create a new run record with `retryOfRunId`

This keeps explicit text authoritative even after the user edits the triggering entry.

## Reply Append Path

Do not route agent replies through draft UI state.

Recommended requirement:

- add a programmatic append helper in `CommentMutationController`
- that helper appends one child entry and persists through the existing note-write path

`CommentAgentController` should use that helper so note writes continue to be owned by SideNote2.

## Sidebar Spec

## Index Mode State

Extend index sidebar mode state in:

- `src/ui/views/viewState.ts`

Required change:

```ts
export type IndexSidebarMode = "list" | "thought-trail" | "agent";
```

Persist `agent` in `CustomViewState` the same way current index modes are persisted.

## Agent Tab Placement

Add `Agent` as the third top-level tab in:

- `src/ui/views/SideNote2View.ts`

Tab order:

- `List`
- `Thought Trail`
- `Agent`

This applies only to the index sidebar.
Do not add a separate agent mode to source-note sidebars in phase 1.

## Agent Membership

Add a derived planner, recommended file:

- `src/ui/views/agentSidebarPlanner.ts`

The base universe for `Agent` mode is:

1. the same resolved-mode comment universe used by `List`
2. narrowed by the same file filter root when active
3. narrowed to agent-relevant threads only

Minimum inclusion rule:

- thread has at least one run record
- or thread has at least one `outputEntryId` from an agent run

Do not infer agent relevance from raw rendered reply text.
Use run records as the durable source for agent involvement.

## Agent Sorting

Recommended sort order for `Agent` mode:

1. running
2. queued
3. failed
4. succeeded
5. most recent `endedAt` or `createdAt`

## Agent Status Rendering

Extend the sidebar card presentation so agent-relevant threads can show:

- queued
- running
- failed
- succeeded

At minimum, these statuses must be visible in the `Agent` tab.
If reused in `List`, the status model must stay identical.

While a run is `running`, the thread may also show a transient streamed child reply card underneath the thread so the user can watch text arrive without waiting for completion.

Status placement rule:

- parent thread footer shows run state
- transient child stream card shows only the in-progress agent text surface
- do not show the same run state in both places at once

## Agent Thread Actions

Phase 1 thread-level actions in the `Agent` tab should include:

- open thread
- edit normal entries
- append normal entries
- retry latest run when valid

Do not add a separate active-runs panel.

## Module Ownership

### `src/core/text/agentDirectives.ts`

Owns:

- parsing `@codex` and `@claude`
- conflict detection
- explicit-target resolution

### `src/core/agents/agentRuns.ts`

Owns:

- run status types
- run record shape
- helper selectors such as latest-run-by-thread

### `src/control/agentRunStore.ts`

Owns:

- reading persisted `agentRuns`
- normalizing legacy or malformed stored payloads
- writing updated run arrays back into plugin data

### `src/control/commentAgentController.ts`

Owns:

- post-persist directive handling
- queue management
- runtime invocation
- ephemeral streamed text state for active runs
- run-state transitions
- retry creation
- raw reply append orchestration

### `src/control/commentMutationController.ts`

Owns:

- calling the agent controller after successful `new` and `append` saves
- never auto-dispatching after `edit`
- exposing a programmatic append helper for agent replies

### `src/ui/views/SideNote2View.ts`

Owns:

- rendering the `Agent` tab
- wiring shared toolbar controls
- owning one transient streamed-reply controller per visible active thread
- binding stream updates to the correct transient streamed-reply controller
- routing retry clicks to plugin/controller entry points

### `src/ui/views/sidebarPersistedComment.ts`

Owns:

- displaying run status cues
- rendering retry action affordances
- keeping parent and child card layouts consistent
- rendering the parent-owned status location without duplicating stream status in transient child UI

### `src/ui/views/streamedAgentReplyController.ts`

Owns:

- one transient streamed-reply DOM surface per visible active thread
- direct text updates for partial assistant output without full sidebar rerenders
- removing its transient DOM when the run ends or the thread leaves the current view

## Logging

Add agent-specific log events under area `agents`.

Minimum events:

- `agents.directive.detected`
- `agents.directive.conflict`
- `agents.run.queued`
- `agents.run.started`
- `agents.run.succeeded`
- `agents.run.failed`
- `agents.reply.appended`
- `agents.retry.created`

Payloads must continue following the existing logging hygiene rules:

- no raw reply text
- no note body
- no selected text
- no absolute paths
- no persisted partial streamed text

## Tests

Add or extend tests for:

- directive parsing and email avoidance
- conflicting-target detection
- run-store normalization
- post-persist trigger behavior in `CommentMutationController`
- edit-save no-dispatch behavior
- retry creating a new run record
- unsupported environment failure when vault root is unavailable
- agent reply append behavior
- `IndexSidebarMode = "agent"` persistence
- agent-tab membership under file filter and resolved mode
- agent-tab sorting by status and recency

## Implementation Notes

- The current `preferredAgentTarget` setting already exists in code. This spec does not require it to drive explicit mention dispatch.
- This desktop-owned execution model is intentional. Unlike OpenClaw, SideNote2 phase 1 does not add a second mobile/client transport layer around the runtime.
- The current plan `Open Questions` section can remain as historical context, but implementation should follow the closed decisions in this spec.
