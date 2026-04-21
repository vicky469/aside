# DGX Spark Bridge Spec

## Status

Draft implementation spec based on:

- [todo-codex-desktop-vs-mobile-support.md](../todo/todo-codex-desktop-vs-mobile-support.md)
- [agent-cross-platform-runtime-spec.md](agent-cross-platform-runtime-spec.md)
- [agent-runtime-experience-plan.md](agent-runtime-experience-plan.md)
- [architecture.md](../architecture.md)

## Objective

Define one concrete remote runtime deployment for SideNote2 `@codex`:

- SideNote2 keeps the current thread UX
- desktop can continue using local Codex when available
- mobile can use the same `@codex` trigger through a private DGX-hosted bridge
- the DGX bridge runs the same Codex CLI execution family that desktop SideNote2 uses today

This spec is intentionally narrower than the general cross-platform runtime spec.
It does not define a generic public hosted SideNote2 product.
It defines a private or allowlisted DGX-hosted remote runtime running on an NVIDIA DGX Spark.

## Current Repo State

The plugin already contains most of the client-side remote runtime plumbing:

- remote bridge request contract:
  [src/control/openclawRuntimeBridge.ts](../../src/control/openclawRuntimeBridge.ts)
- remote run lifecycle, persistence, restart reconciliation, cancel:
  [src/control/commentAgentController.ts](../../src/control/commentAgentController.ts)
- local desktop Codex process launch and event parsing:
  [src/control/agentRuntimeAdapter.ts](../../src/control/agentRuntimeAdapter.ts)
- runtime settings persistence and device-local secret storage:
  [src/control/indexNoteSettingsController.ts](../../src/control/indexNoteSettingsController.ts),
  [src/control/localSecretStore.ts](../../src/control/localSecretStore.ts)
- current settings surface:
  [src/ui/settings/SideNote2SettingTab.ts](../../src/ui/settings/SideNote2SettingTab.ts)

That means the DGX route is not blocked on inventing a new plugin-side thread model.
It is mainly blocked on:

1. a concrete DGX bridge service that implements the existing remote contract
2. productizing the current remote settings and runtime copy
3. keeping prompt and event behavior close to the existing desktop local runtime

## Final Decisions

- DGX Spark is not a new runtime id in the plugin. It is one deployment target for the existing remote runtime family: `openclaw-acp`.
- SideNote2 remains the source of truth for note writes. The DGX bridge returns reply text only.
- The DGX bridge launches `codex app-server --listen stdio://` and translates Codex app-server notifications into the existing remote bridge event contract.
- The first DGX rollout is a private or allowlisted bridge, not a public shared SaaS surface.
- Bridge access and any initial free allowance live on the DGX service side and may be configured from `.env`.
- The public Obsidian plugin API available in this repo does not expose a stable logged-in Obsidian account id, so bridge allowance must not depend on an Obsidian user id read by the plugin.
- The bridge token is bridge-specific and revocable. It is not an OpenAI API key, ChatGPT cookie, or Codex session token.
- Settings stay generic. The plugin should talk about `Remote runtime`, not `DGX`, `OpenAI`, or provider-specific branding.
- The bridge should be reachable only over trusted transport:
  - HTTPS on a private LAN
  - HTTPS behind Tailscale or VPN
  - localhost HTTP for development only
- `Auto` runtime selection prefers remote when remote is configured and available, then falls back to local.
- Remote DGX runs should preserve the same Codex CLI family and execution behavior as desktop local as closely as the deployment allows.
- Prompt parity matters more than transport symmetry. The DGX bridge should mirror the local desktop Codex behavior closely even if the wrapper code lives outside the plugin at first.

## Non-Goals

Not part of this spec:

- public multi-tenant bridge hosting
- OAuth or OpenAI account linking in the plugin
- raw provider API key entry in SideNote2 settings
- DGX-side vault writes
- cross-device job sync beyond the existing run resume model

## Architecture

```text
Obsidian desktop/mobile
  -> SideNote2 remote bridge client
  -> HTTPS bridge on DGX Spark
  -> local codex app-server process on DGX
  -> streamed progress + output delta events
  -> final reply text
  -> SideNote2 writes the reply into the note thread
```

Key boundary:

- SideNote2 owns note context assembly, thread state, and note writes
- the DGX bridge owns process execution, event buffering, and remote cancellation

## Compatibility Rule

The DGX bridge must behave like the current desktop local runtime from the point where Codex execution starts.

That means it should mirror the behavior in
[agentRuntimeAdapter.ts](../../src/control/agentRuntimeAdapter.ts):

- recover a usable execution `PATH`
- launch `codex app-server --listen stdio://`
- initialize the JSON-RPC session
- start a thread and turn
- parse streamed progress and agent text deltas
- treat turn completion, failures, and cancellation the same way the local runtime does

The bridge must not literally import the current Obsidian-specific adapter unchanged because that code depends on `window.require(...)`.
But it should preserve the same runtime model and event semantics.

## Prompt Handling

### Rule 1: Preserve the current SideNote2 reply envelope

Today the local runtime adds a SideNote2-specific reply wrapper in
`buildSideNotePrompt(...)` before sending the request to Codex.

For DGX parity, the remote bridge should use the same wrapper behavior.

Practical v1 rule:

- SideNote2 sends the same context-rich `promptText` it already builds for remote runs
- the DGX bridge prepends the same SideNote2 reply envelope the local runtime uses today

Later cleanup:

- extract this prompt-envelope builder into a shared package or shared module so local desktop and DGX do not drift

### Rule 2: SideNote2 still owns note writes

The bridge may run the same Codex runtime family and tool flow as desktop local, but SideNote2 remains the canonical writer for note-thread replies.

That means:

- the bridge returns reply text back to SideNote2
- the plugin appends or edits the thread entry locally
- the bridge must not write markdown note threads directly

If the DGX deployment later gains a real server-side workspace or repository checkout, those changes are outside the note-thread write contract.

### Rule 3: No raw note content logging

The bridge must not log:

- prompt text
- thread transcript text
- reply text
- bearer tokens
- credentials embedded in URLs

### Rule 4: Accept the current client metadata contract

The current plugin remote-run path sends:

```json
{ "capability": "workspace-aware" }
```

The DGX bridge should accept that field and ignore unknown future values for compatibility with shipped clients.
Treat it as client metadata, not as the sole source of truth for what the bridge deployment allows.

## DGX Bridge API

The DGX bridge implements the existing SideNote2 remote contract:

- `POST /v1/sidenote2/runs`
- `GET /v1/sidenote2/runs/{runId}?after=<cursor>`
- `POST /v1/sidenote2/runs/{runId}/cancel`

Authentication:

- `Authorization: Bearer <token>`
- missing or invalid token returns `401` or `403`

### Start Run

Request:

```json
{
  "agent": "codex",
  "promptText": "SideNote2 runtime prompt text",
  "metadata": {
    "notePath": "docs/prd/agent-cross-platform-runtime-plan.md",
    "contextScope": "anchor",
    "pluginVersion": "2.0.39",
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

Rules:

- reject unsupported agents with a user-safe `failed` response
- assign `runId` before process spawn so SideNote2 can persist it immediately
- create the run record even if Codex startup is still pending

### Poll Run

Request:

- `GET /v1/sidenote2/runs/{runId}?after=<cursor>`

Response shape:

```json
{
  "status": "running",
  "cursor": "evt-9",
  "runId": "remote-run-123",
  "events": [
    { "type": "progress", "text": "Preparing context" },
    { "type": "output_delta", "text": "Hello" }
  ]
}
```

Rules:

- `cursor` must move forward whenever new events are emitted
- polling with `after=<cursor>` returns only later events
- terminal responses may also include `replyText` or `error`

### Cancel Run

Request:

- `POST /v1/sidenote2/runs/{runId}/cancel`

Rules:

- cancel must be idempotent
- if the run is already terminal, return the current terminal state
- if the Codex child process is still live, attempt graceful termination first, then force-kill after a short timeout

## Event Mapping

The DGX bridge should map Codex app-server notifications into SideNote2 bridge events as follows.

### Required bridge events

- `progress`
- `output_delta`
- `completed`
- `failed`
- `cancelled`

### Mapping rules

- `item/started` with command/tool/file-change style items:
  emit `progress`
- `item/reasoning/summaryTextDelta`:
  emit `progress`
- `turn/plan/updated`:
  emit `progress`
- `item/agentMessage/delta`:
  emit `output_delta`
- `item/completed` for the active agent message:
  capture the best current final text candidate
- `turn/completed` with success:
  emit `completed`
- JSON-RPC `error`, process spawn error, non-success turn status, empty final reply, or abnormal child exit:
  emit `failed`
- explicit user cancel or killed process because of cancel:
  emit `cancelled`

Normalization rules:

- progress text should stay short and user-safe
- partial output should be appended in order
- terminal reply text should be sanitized the same way the local runtime sanitizes the final answer

## DGX Run Lifecycle

### Rule 1: One Codex app-server process per SideNote2 run in v1

For the first rollout, each SideNote2 run gets its own short-lived Codex app-server child process.

Reason:

- simplest failure isolation
- easiest cancel semantics
- closest match to current local desktop behavior

### Rule 2: Working directory is deployment-controlled

The DGX bridge should launch Codex inside a server-side working directory chosen by deployment configuration.

Recommended environment variable:

```text
SIDENOTE2_DGX_WORKSPACE_ROOT=/srv/sidenote2/workspace
```

If no stable workspace is configured, the bridge may fall back to a per-run scratch directory such as:

```text
/tmp/sidenote2-dgx/<runId>
```

For exact parity with desktop-local behavior, point the DGX runtime at the server-side workspace or repository Codex should use.
The Codex sandbox policy should still restrict writes to the configured runtime workspace root.

### Rule 3: Retain terminal state long enough for reconnect

The bridge must retain run metadata, cursor state, terminal payload, and buffered events long enough for SideNote2 restart recovery.

Minimum retention target:

- keep active runs until terminal
- keep terminal runs for at least 15 minutes after completion, failure, or cancellation

This lets a restarted mobile client poll the final state instead of immediately hitting `404`.

### Rule 4: Unknown resumed runs return `404`

If SideNote2 resumes a previously known `runId` and the bridge no longer has it, return `404`.

This matches the plugin's current resume failure path:

- unknown prior run
  -> SideNote2 marks the local run failed with a concise recovery notice

## Security Requirements

### Network

- require HTTPS for real deployments
- allow plain HTTP only for `localhost` development
- prefer Tailscale, VPN, or private LAN over public exposure

### Credentials

- store the bridge bearer token separately from Codex/OpenAI credentials
- run Codex on the DGX under a dedicated service account
- do not expose Codex provider credentials to the client plugin

## Access And Allowance

- Do not depend on an Obsidian logged-in user id for bridge access or quota. The public Obsidian API available in this repo does not expose that identifier.
- Authenticate the client with the bridge bearer token.
- The DGX bridge may map that token to a bridge-side user record or allowance bucket.
- Initial free access may be configured in `.env` on the DGX bridge.
- Later paid access can replace the `.env` allowance model with a real account and billing layer.

### Logging

Allowed logs:

- run id
- status transitions
- HTTP status
- event counts
- elapsed time
- origin host
- safe spawn and exit metadata

Disallowed logs:

- prompt text
- reply text
- full note paths if the operator does not need them
- bearer token
- upstream provider secrets

## Plugin Requirements For DGX Productization

The plugin already has the core remote lifecycle logic.
To make DGX a supported route rather than a hidden developer path, the plugin should also do the following.

### Settings

- expose `Runtime mode` with:
  - `Auto`
  - `Local desktop`
  - `Remote runtime`
- rename or replace `Advanced Remote Bridge` with first-class generic remote-runtime copy
- keep showing the local Codex diagnostic row
- show remote bridge availability in ownership-explicit language
- optional follow-up: add `Test connection`

### Runtime selection

Honor the stored `agentRuntimeMode` exactly:

- `Auto`: prefer remote when configured and available, otherwise local
- `Local desktop`: block instead of rerouting
- `Remote runtime`: block instead of rerouting

### Ownership copy

Before and during runs, keep the runtime explicit:

- `Using your local Codex setup`
- `Using remote runtime`
- `Runtime: Local desktop`
- `Runtime: Your remote runtime`

## Delivery Order

1. Build the DGX bridge service as a standalone Node process that mirrors the local Codex adapter behavior.
2. Verify `codex` install, `PATH`, and non-interactive launch on the DGX service account.
3. Validate start, poll, cancel, and reconnect against the current plugin.
4. Productize SideNote2 settings and runtime-mode UI so DGX is not framed as dev-only.
5. Extract shared prompt-envelope or event-parsing helpers only after the end-to-end route works.

## Acceptance Criteria

This spec is complete when:

- mobile SideNote2 can run `@codex` through a DGX-hosted remote bridge
- `Auto` resolves to remote before local when the remote runtime is configured and available
- local desktop Codex still works as explicit local mode and as fallback when remote is unavailable
- DGX runs stream progress and partial text back into the same thread
- cancel in SideNote2 stops the DGX child process and the thread state cleanly
- plugin restart can resume polling a still-running DGX run by `runId`
- the DGX bridge never writes vault files directly
- no bridge token or prompt text is exposed in client or server logs
