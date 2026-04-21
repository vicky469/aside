# Agent Cross-Platform Runtime Spec

## Status

Draft implementation spec based on:

- [[agent-cross-platform-runtime-plan]]
- [agent-mentions-spec.md](agent-mentions-spec.md)
- [architecture.md](../architecture.md)

## Objective

Implement the first cross-platform `@codex` runtime layer so that:

1. SideNote2 can resolve between local desktop and remote runtime before dispatch.
2. Desktop keeps the current local path.
3. Desktop and mobile can use a configured remote path for Codex execution against a bridge-managed workspace.
4. Compute ownership is always explicit and SideNote2 never uses author-paid compute.

## Final Decisions

- Phase 1 ships exactly two backends:
  - `direct-cli` = local desktop Codex runtime
  - `openclaw-acp` = remote bridge runtime
- User-facing mode setting is `auto | local | remote`.
- `Auto` prefers configured remote when available, otherwise uses local, otherwise blocks.
- `Local` never falls through to remote.
- `Remote` never falls through to local.
- Remote runtime v1 means an HTTPS bridge endpoint plus bearer token. SideNote2 does not accept raw provider API keys in plugin settings and does not host compute.
- Remote v1 is a bridge-managed Codex runtime. It may stream text, support cancel, inspect or modify the configured bridge workspace, and return reply text back into the thread.
- SideNote2 continues to own note writes. Both local and remote runtimes return reply text only to the plugin, even when they edit workspace files.
- Product copy must say `Using your local Codex setup` or `Using remote runtime` before and during a run.

## Scope

In scope:

- runtime abstraction layer and resolved-runtime selection
- settings for explicit mode selection and remote-runtime config
- desktop local runtime preservation
- mobile-compatible remote runtime execution
- remote progress, partial text, cancel, and retry
- persisted remote execution ids for reconnect after app restart
- ownership/status copy in settings and thread UI
- tests for selection, config gating, and remote reconciliation

Out of scope:

- SideNote2-hosted runtime
- raw provider API key entry
- OAuth/account linking
- arbitrary access outside the configured bridge workspace
- background cross-device sync across different devices
- multi-provider UI
- multiple concurrent runs

## Product Rules

### Rule 1: Resolved Runtime Is Chosen Before Enqueue

When a user saves a triggering `@codex` entry, SideNote2 resolves one concrete runtime before the run record is created.
The run record stores the resolved runtime, not just the preference.

### Rule 2: Ownership Must Stay User-Owned

Only two ownership states are valid in phase 1:

- user-local
- user-remote

No author-owned or SideNote2-hosted compute may appear anywhere in settings, fallback logic, or status copy.

### Rule 3: Auto Is The Only Allowed Fallback Mode

Automatic switching is allowed only inside `Auto`.
If the user explicitly picks `Local desktop` or `Remote runtime`, unavailable mode selection blocks with setup guidance instead of rerouting.

### Rule 4: Remote Capability Is Reply-Only

The remote backend receives the same SideNote2 reply-generation instructions as the local backend, but phase 1 remote runs are limited to returning thread reply text.
They must not claim to have modified local workspace files.

### Rule 5: SideNote2 Owns Canonical Writes

The note remains the source of truth.
The runtime returns reply text and SideNote2 appends or edits the thread entry itself.
Remote services never write vault files directly.

### Rule 6: Secrets Are Device-Local

Remote auth tokens must be stored only in device-local plugin storage.
They must not be written to synced note content, index notes, logs, or exported run records.
The syncable base URL may live in plugin data, but the token must not.

### Rule 7: Remote Runs Are Recoverable

If Obsidian reloads while a remote run is queued or running, SideNote2 should reconnect using the stored remote execution id and continue polling until terminal state.

## User-Facing Model

### Settings

Add an `Agent runtime` section with:

- `Runtime mode` dropdown:
  - `Auto`
  - `Local desktop`
  - `Remote runtime`
- `Local runtime` status row
- `Remote runtime base URL`
- `Remote runtime token`
- optional `Test connection` button
- capability copy:
  - local: `Best for workspace-aware coding on desktop`
  - remote: `Best for remote Codex runs on desktop and mobile`

### Availability Copy

Use concise, ownership-explicit copy:

- `Using your local Codex setup`
- `Using remote runtime`
- `Remote runtime is not configured`
- `Local desktop runtime is unavailable on this device`

### Pre-Dispatch Gating

Before a run is queued:

- if resolved mode = local and local is unavailable, do not enqueue; show setup copy
- if resolved mode = remote and remote config is incomplete, do not enqueue; show setup copy
- if `Auto` resolves to no eligible runtime, do not enqueue; show the missing-setup notice for the current device

### Thread / Run Presentation

While queued or running, show the resolved runtime label on the run card or status line:

- `Runtime: Local desktop`
- `Runtime: Your remote runtime`

Remote v1 should also show `Capability: Workspace-aware` for the blessed DGX-backed route until negotiated bridge capabilities exist.

## Runtime Resolution Spec

### Availability Checks

Local runtime is available only when:

- desktop Obsidian provides filesystem access
- current Codex runtime diagnostics are `available`

Remote runtime is available only when:

- base URL parses successfully
- URL is `https://`, or `http://localhost` / `http://127.0.0.1` for local development
- a device-local bearer token exists

A successful live health check is helpful but not required for `available` status.
Real connectivity failures should surface at run time.

### Resolution Algorithm

```text
if modePreference === "local":
  require localAvailable
  runtime = "direct-cli"

if modePreference === "remote":
  require remoteConfigured
  runtime = "openclaw-acp"

if modePreference === "auto":
  if remoteConfigured:
    runtime = "openclaw-acp"
  else if localAvailable:
    runtime = "direct-cli"
  else:
    block
```

Notes:

- `Auto` prefers remote on both desktop and mobile when configured
- local remains available as explicit `Local desktop` mode and as fallback when remote is not configured
- `Auto` does not imply any author-paid fallback

## Runtime Abstraction

Replace the current one-path runtime execution with a backend registry.

Recommended interface:

```ts
type ResolvedAgentRuntime = "direct-cli" | "openclaw-acp";

interface AgentRuntimeBackend {
  runtime: ResolvedAgentRuntime;
  label: string;
  capability: "workspace-aware" | "reply-only";
  isAvailable(context: RuntimeAvailabilityContext): Promise<RuntimeAvailabilityResult>;
  startRun(invocation: AgentRuntimeInvocation): Promise<StartedRun>;
  pollRun?(state: StartedRun): Promise<RuntimePollResult>;
  cancelRun(state: StartedRun): Promise<void>;
}
```

Behavior:

- `direct-cli` can remain mostly synchronous behind the adapter
- `openclaw-acp` uses start + poll + cancel
- `CommentAgentController` should no longer hardcode `runtime: "direct-cli"` when building queued runs; it should resolve the runtime first

## Remote Bridge Contract

Phase 1 remote runtime is a simple bridge contract, not provider-specific API wiring inside the plugin.

### Authentication

- `Authorization: Bearer <token>`
- never include tokens in query params
- never log token values

### Start Run

`POST /v1/sidenote2/runs`

Request body:

```json
{
  "agent": "codex",
  "promptText": "final SideNote2 prompt text",
  "metadata": {
    "notePath": "docs/prd/agent-cross-platform-runtime-plan.md",
    "contextScope": "anchor",
    "pluginVersion": "x.y.z",
    "capability": "workspace-aware"
  }
}
```

Response:

```json
{
  "runId": "remote-run-123",
  "status": "queued"
}
```

### Poll Events

`GET /v1/sidenote2/runs/{runId}?after=<cursor>`

Response:

```json
{
  "status": "running",
  "cursor": "evt-9",
  "events": [
    { "type": "progress", "text": "Preparing context" },
    { "type": "output_delta", "text": "First partial..." }
  ]
}
```

Terminal responses may include:

- `completed` with final reply text
- `failed` with a user-safe error message
- `cancelled`

### Cancel

`POST /v1/sidenote2/runs/{runId}/cancel`

Success may return `202 Accepted` or a terminal state payload.

### Event Types

Required event kinds:

- `progress`
- `output_delta`
- `completed`
- `failed`
- `cancelled`

Optional later event kinds:

- `queued_position`
- `rate_limit_notice`

### Prompt Parity

SideNote2 builds the final prompt locally.
The remote bridge should receive the same final prompt text the local runtime would use, so reply behavior stays consistent across runtimes.

## Data Model Changes

Extend settings with:

```ts
interface SideNote2Settings {
  indexNotePath: string;
  indexHeaderImageUrl: string;
  indexHeaderImageCaption: string;
  agentRuntimeMode?: "auto" | "local" | "remote";
  remoteRuntimeBaseUrl?: string;
}

interface SideNote2LocalSecrets {
  remoteRuntimeBearerToken?: string;
}
```

Extend run records with:

```ts
interface AgentRunRecord {
  id: string;
  threadId: string;
  triggerEntryId: string;
  filePath: string;
  requestedAgent: "codex" | "claude";
  runtime: "direct-cli" | "openclaw-acp";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  promptText: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  retryOfRunId?: string;
  outputEntryId?: string;
  error?: string;
  modePreference?: "auto" | "local" | "remote";
  remoteExecutionId?: string;
  remoteCursor?: string;
}
```

Rules:

- `modePreference` is diagnostic and history data only
- `remoteExecutionId` exists only for remote runs
- `remoteCursor` may be updated after each poll so restarts can resume cleanly

## Controller Behavior

### Queue Creation

- parse directive
- resolve runtime from settings and device availability
- if unavailable, show setup notice and do not create a run
- persist run with resolved `runtime`

### Local Run Path

No product change except the runtime is now reached through the backend abstraction.

### Remote Run Path

- append empty output entry the same way local runs do
- create remote run
- persist `remoteExecutionId`
- poll until terminal state
- update transient streamed text from `output_delta`
- on `completed`, write the final reply into the thread and mark succeeded
- on `failed` or `cancelled`, preserve the same failure and cancel semantics already used locally

### Restart Reconciliation

On startup:

- scan persisted runs for `runtime === "openclaw-acp"` and status `queued` or `running`
- resume polling by `remoteExecutionId`
- if the remote bridge no longer knows the run, mark it failed with a concise recovery notice

## Prompt Context

Reuse the current local context builder for both backends:

- current note path
- context scope (`anchor` or `section`)
- anchored text or local section
- nearby headings
- thread transcript
- current request

Do not create a separate mobile-specific prompt packer in phase 1.

## Logging And Privacy

Allowed logs:

- runtime kind
- mode preference
- availability status
- HTTP status
- elapsed time
- remote origin host

Disallowed logs:

- remote auth token
- full prompt text
- anchored text
- reply body
- full remote URL with credentials or query secrets

## Tests

Add or update tests for:

- runtime selection across desktop and mobile with different mode settings
- settings normalization and migration defaults
- remote config gating notices
- remote start / poll / cancel happy path
- remote restart reconciliation
- no silent fallback when `Local desktop` or `Remote runtime` is explicitly selected
- run record persistence for `openclaw-acp`
- log redaction of remote credentials

## Delivery Order

1. Add settings, data model, and runtime-resolution planner.
2. Refactor `CommentAgentController` to enqueue a resolved runtime instead of hardcoding `direct-cli`.
3. Keep the current local backend behind the new abstraction.
4. Add the remote bridge client and polling reconciliation.
5. Add settings UI, notices, and runtime labels.
6. Add tests and migration coverage.

## Acceptance Criteria

This spec is successful when:

- `Auto` uses remote when remote is configured and available
- mobile can run `@codex` through remote runtime
- local desktop still works as explicit local mode and as fallback when remote is unavailable
- explicit `Local desktop` and `Remote runtime` modes never silently reroute
- the user can tell which runtime owns the run before and during execution
- remote runs can stream partial text, cancel, and recover after app restart
- SideNote2 never uses author-paid compute in this rollout

<!-- SideNote2 comments
[
  {
    "id": "ecf8bec7-c856-4f95-8e37-22617ee9812e",
    "startLine": 0,
    "startChar": 0,
    "endLine": 0,
    "endChar": 0,
    "selectedText": "agent-cross-platform-runtime-spec",
    "selectedTextHash": "9d64b6b5fd6337597494c47d08c1386c22264f6d4edee11479301395d87cd7f8",
    "anchorKind": "page",
    "entries": [
      {
        "id": "ecf8bec7-c856-4f95-8e37-22617ee9812e",
        "body": "@codex will we have problem with mobile codex replies/writes?",
        "timestamp": 1776740168093
      },
      {
        "id": "8721179f-2bad-411e-aefc-427cab0a75ba",
        "body": "Yes—mobile is the riskier write path, but it’s manageable if we keep the write model narrow.\n\nMain risks:\n- app backgrounding can interrupt long agent runs\n- sync lag/conflicts can make the local thread state stale\n- anchor/selection context is easier to drift on mobile\n- auth / deep-link / clipboard handoff is less reliable than desktop\n- full-note rewrites are much more fragile than append-only replies\n\nSo I’d treat mobile like this:\n- allow reply / resolve / small entry updates\n- make writes append-only where possible\n- include conflict detection + retry/idempotency\n- avoid large structural note edits from mobile in v1\n\nShort version: mobile Codex replies should be fine if we design them as small, conflict-tolerant thread writes; arbitrary note rewrites are where the real problems start.",
        "timestamp": 1776740197380
      }
    ],
    "createdAt": 1776740168093,
    "updatedAt": 1776740197380
  }
]
-->
