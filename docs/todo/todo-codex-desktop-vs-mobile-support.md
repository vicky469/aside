# TODO: Codex Desktop Support vs Mobile Support

Related docs:

- [agent-cross-platform-runtime-plan.md](../prd/agent-cross-platform-runtime-plan.md)

## Why This Note Exists

I need a short current-state reference for two questions:

1. How `@codex` works today on desktop.
2. What would have to change to support mobile cleanly.

This note is intentionally narrower than the cross-platform runtime plan. It describes the current implementation and the immediate gaps.

## Current Desktop `@codex` Path

Today, built-in `@codex` support is local-runtime based.

High-level flow:

1. The user types `@codex` in a SideNote2 comment.
2. SideNote2 parses the comment for supported agent mentions.
3. On save, SideNote2 queues an agent run for that thread.
4. The plugin launches the local `codex` executable from desktop Obsidian.
5. Streamed progress and final reply are appended back into the same thread.

Key files:

- [src/core/agents/codexActor.ts](../../src/core/agents/codexActor.ts)
- [src/core/text/agentDirectives.ts](../../src/core/text/agentDirectives.ts)
- [src/control/commentAgentController.ts](../../src/control/commentAgentController.ts)
- [src/control/agentRuntimeAdapter.ts](../../src/control/agentRuntimeAdapter.ts)
- [src/main.ts](../../src/main.ts)

## What "supported on desktop" currently means

`@codex` is currently wired to the `codex-app-server` runtime strategy in [codexActor.ts](../../src/core/agents/codexActor.ts).

That runtime path depends on desktop-only capabilities:

- Electron `window.require(...)`
- Node modules such as `node:child_process`
- launching local processes with `execFile(...)` and `spawn(...)`
- a local `codex` binary available on the user's machine

The actual runtime dispatch happens in [agentRuntimeAdapter.ts](../../src/control/agentRuntimeAdapter.ts):

- `runAgentRuntime(...)` resolves the actor runtime strategy
- supported `codex` runs go through `runCodexDirect(...)`
- if Node/Electron process access is unavailable, the call fails immediately

## Current availability check

There is already a diagnostic function in the plugin runtime, but it is not surfaced in the settings UI yet.

Public entrypoint:

- [main.ts](../../src/main.ts)
  `getCodexRuntimeDiagnostics()`

Runtime probe:

- [agentRuntimeAdapter.ts](../../src/control/agentRuntimeAdapter.ts)
  `getCodexRuntimeDiagnostics(...)`

What it checks:

1. Is this Obsidian environment desktop with a filesystem-backed vault?
2. Is Node/Electron runtime access available?
3. Can SideNote2 recover a usable login-shell `PATH`?
4. Can it launch `codex --help` successfully?

Possible statuses:

- `available`
- `missing`
- `unsupported`
- `unavailable`

Important limitation:

This is not an account or subscription check.

It only answers:

- can this Obsidian runtime launch the local Codex executable?

It does not answer:

- is the user signed in?
- does the user have a Codex entitlement or subscription?
- can mobile reuse the user's ChatGPT/Codex access automatically?

## Current settings surface

The settings tab can expose a read-only Codex runtime line backed by the existing runtime diagnostic.

Current settings UI file:

- [src/ui/settings/SideNote2SettingTab.ts](../../src/ui/settings/SideNote2SettingTab.ts)

That status is diagnostic only. It does not show:

- OpenAI account sign-in state
- Codex entitlement or subscription state
- any mobile-capable runtime configuration

## Why mobile does not work with the current approach

The current built-in `@codex` path is desktop-local.

That breaks on mobile for several reasons:

- Obsidian mobile does not provide the same desktop Electron + Node process model.
- The plugin cannot rely on `window.require("node:child_process")`.
- The plugin cannot assume a local `codex` executable exists on the device.
- Even if a user has a ChatGPT or Codex subscription, the plugin currently has no OpenAI sign-in or entitlement check.
- The current diagnostic checks local executable availability, not account-backed access.

So mobile is not blocked by one missing `if` statement. It needs a different runtime model.

## What would be needed to support mobile

Minimum product/technical requirements:

1. A non-local runtime path.
   Mobile cannot depend on launching a local Codex CLI. It needs a remote runtime or official embedded Codex runtime model.

2. Explicit user-owned auth and entitlement.
   The plugin would need a secure way to know that the current user is allowed to use Codex, without shipping private API keys in the plugin.

3. Cross-platform runtime abstraction.
   `@codex` should choose between:
   - local desktop runtime
   - remote/account-backed runtime

4. Settings and status UI.
   The plugin should expose:
   - current runtime mode
   - whether Codex is available
   - whether the user is authenticated
   - what compute/account is being used

5. Mobile-safe streaming and cancellation.
   The current in-thread progress/reply UX is good, but the transport has to work without local process spawning.

## Most likely implementation direction

The most realistic path is not "make the current desktop CLI check work on mobile."

The realistic path is:

- keep the current desktop local-runtime path
- add a second remote runtime path for desktop and mobile
- make runtime selection explicit in settings

This is already the direction described in [agent-cross-platform-runtime-plan.md](../prd/agent-cross-platform-runtime-plan.md).

## DGX Spark Route

If we want `@codex` in the SideNote2 UI to keep the same meaning while making mobile usable, the cleanest near-term route is:

- keep `@codex` as the trigger in the UI
- route mobile and remote-capable clients through the existing remote bridge path
- run that remote bridge on an NVIDIA DGX Spark
- have the DGX bridge launch the same `codex` CLI family that desktop SideNote2 launches today

This is feasible, but there is one important engineering distinction:

- the desktop plugin runtime cannot be copied as-is onto the DGX Spark because [agentRuntimeAdapter.ts](../../src/control/agentRuntimeAdapter.ts) currently depends on Obsidian/Electron-specific `window.require(...)` access
- however, the underlying execution model is still just local process execution of `codex`, using `execFile(...)` and `spawn(...)`
- so the DGX service can preserve behavior by launching the same `codex` executable server-side, while reimplementing the wrapper as a normal Node service instead of an Obsidian plugin module

So the answer is:

- yes, `@codex` in the UI can still route to a DGX backend
- yes, that DGX backend can launch the same local `codex` binary path we use on desktop today
- no, it should not literally embed the current Obsidian-only adapter unchanged

Relevant current code:

- desktop local runtime probe and process launch:
  [src/control/agentRuntimeAdapter.ts](../../src/control/agentRuntimeAdapter.ts)
- remote bridge request contract:
  [src/control/openclawRuntimeBridge.ts](../../src/control/openclawRuntimeBridge.ts)
- remote run lifecycle in the plugin:
  [src/control/commentAgentController.ts](../../src/control/commentAgentController.ts)

## Recommended DGX Architecture

```text
Obsidian desktop/mobile
  -> SideNote2 remote bridge client
  -> HTTPS bridge running on DGX Spark
  -> local codex CLI on DGX Spark
  -> streamed progress + final reply
  -> SideNote2 appends the reply into the note thread
```

Key idea:

- SideNote2 should continue to build the final prompt locally
- the DGX bridge should receive that final prompt text
- the DGX bridge should invoke `codex` on the DGX host
- the DGX bridge should translate Codex progress/output into the remote event contract SideNote2 already expects

That preserves:

- the `@codex` user-facing mental model
- prompt parity between desktop-local and DGX-backed runs
- SideNote2 ownership of note writes

## Detailed DGX Setup Steps

These are the concrete steps to get a first usable DGX-backed `@codex` path working.

### Phase 1: Prepare the DGX Spark

1. Complete the normal DGX Spark first-boot setup.
2. Make sure the DGX Spark is reachable over the network.
3. Prefer private access over public exposure:
   - local LAN if both devices are on the same network
   - or Tailscale for cross-network access
4. Enable SSH access so the DGX can be administered remotely.

Reason:

- the DGX should behave like a small always-on inference appliance, not like a laptop-only local environment

### Phase 2: Install and verify the local Codex runtime on the DGX

1. SSH into the DGX Spark.
2. Install the same `codex` CLI that SideNote2 expects on desktop.
3. Verify it is on `PATH`.
4. Verify it can launch non-interactively:

```bash
codex --help
```

5. Verify it can run under the user account that will own the bridge service.

This matters because the current desktop availability probe is effectively checking the same thing:

- can a local process on this machine launch `codex` successfully?

### Phase 3: Build a small SideNote2 bridge service on the DGX

Create a standalone service on the DGX Spark, preferably in Node.js, with these endpoints:

- `POST /v1/sidenote2/runs`
- `GET /v1/sidenote2/runs/{runId}?after=<cursor>`
- `POST /v1/sidenote2/runs/{runId}/cancel`

The service should:

1. Accept the final `promptText` from SideNote2.
2. Start a local `codex` process on the DGX host.
3. Track the running process by `runId`.
4. Buffer progress and output-delta events.
5. Expose those events through the poll endpoint.
6. Support cancellation by terminating the underlying process.

This service should reuse the same behavioral ideas as the current desktop path:

- launch `codex`
- stream progress text
- stream partial reply text
- return the final reply text only

But it should do that in a normal server process, not through the plugin’s Obsidian-specific runtime adapter.

### Phase 4: Mirror the desktop-local execution behavior

The bridge should intentionally stay close to the desktop-local runtime behavior.

Recommended implementation approach:

1. Extract or copy the Codex process-launch logic from [agentRuntimeAdapter.ts](../../src/control/agentRuntimeAdapter.ts) into a server-safe module.
2. Remove the Obsidian/Electron-only pieces:
   - `window.require(...)`
   - plugin runtime assumptions
3. Keep the useful parts:
   - `PATH` resolution behavior
   - `codex` launch arguments
   - streamed progress parsing
   - streamed partial-text parsing
   - cancellation handling
4. Expose those results through the remote bridge contract already defined in [agent-cross-platform-runtime-spec.md](../prd/agent-cross-platform-runtime-spec.md).

This is the highest-leverage path if the goal is:

- "DGX backend can launch what we have for local desktop today"

Because it preserves the same runtime family while only changing where that process runs.

### Phase 5: Secure the bridge

Do not expose the bridge directly to the public internet without protection.

Minimum requirements:

1. Put the bridge behind HTTPS.
2. Require `Authorization: Bearer <token>`.
3. Generate a dedicated bridge token only for SideNote2.
4. Do not reuse:
   - OpenAI API keys
   - ChatGPT/Codex account cookies or login tokens
   - personal master credentials
5. Prefer private network access:
   - Tailscale
   - VPN
   - private LAN + reverse proxy

The token in SideNote2 settings should be:

- a bridge-specific token
- revocable
- rotatable
- scoped only to this DGX bridge

### Phase 6: Point SideNote2 at the DGX bridge

On the client device running Obsidian:

1. Open SideNote2 settings.
2. Expand `Advanced Remote Bridge`.
3. Enter the DGX bridge HTTPS URL.
4. Enter the DGX bridge token.
5. Save and test with a new `@codex` thread.

Expected behavior:

- desktop with local Codex available should still prefer local
- mobile should use the DGX bridge path
- the final reply still lands back in the SideNote2 thread

### Phase 7: Validate end-to-end behavior

Validate these cases:

1. New `@codex` thread from desktop with local Codex available.
   Expected:
   - local path still works

2. New `@codex` thread from mobile with DGX bridge configured.
   Expected:
   - reply runs remotely
   - thread reply is appended normally

3. Progress and partial text.
   Expected:
   - running state updates appear in the thread

4. Cancel.
   Expected:
   - SideNote2 cancel propagates to the DGX bridge
   - DGX bridge terminates the underlying `codex` process

5. Restart / reconnect.
   Expected:
   - SideNote2 can resume polling a still-running remote run by `runId`

## What Not To Do

Avoid these shortcuts:

- do not put an OpenAI API key directly into SideNote2 settings
- do not put ChatGPT/Codex session cookies into SideNote2 settings
- do not expose the DGX bridge directly to the public internet without auth
- do not assume mobile can launch the local desktop runtime directly
- do not make the DGX bridge write vault notes directly

The note should remain canonical.
The DGX bridge should return reply text only.

## Recommended First Deliverable

The smallest useful DGX-backed milestone is:

1. DGX Spark reachable over Tailscale or LAN
2. `codex` installed and runnable on the DGX
3. Tiny Node bridge implementing:
   - start
   - poll
   - cancel
4. SideNote2 configured to call that bridge from mobile

This should be treated as the first practical mobile `@codex` path.

It does not solve:

- OpenAI account entitlement detection
- official subscription reuse
- polished consumer auth UX

But it does solve:

- private user-owned compute
- mobile-capable `@codex` replies
- preservation of the current SideNote2 thread UX

## Later Follow-Up

If this route works well, the next engineering step should be:

- pull the desktop Codex process-launch logic into a shared runtime package that both:
  - the Obsidian plugin
  - and the DGX bridge service
  can use

That would reduce drift between:

- desktop-local `@codex`
- DGX-backed remote `@codex`

## Open follow-up questions

- Should settings expose a read-only Codex diagnostic now, even before mobile support exists?
- Should desktop keep preferring local Codex automatically when both local and remote runtimes exist?
- If OpenAI ever offers third-party mobile entitlement/auth for Codex, can SideNote2 integrate that directly, or would we still want a provider-agnostic remote runtime layer?

<!-- SideNote2 comments
[
  {
    "id": "4ac0ef3a-64bf-4e81-8cf7-844d69c7e8e5",
    "startLine": 102,
    "startChar": 0,
    "endLine": 102,
    "endChar": 148,
    "selectedText": "Right now it only exposes index-note image settings. So the plugin has a Codex runtime diagnostic, but no settings row that surfaces it to the user.",
    "selectedTextHash": "f5e9bdcc0893803b237ee1eff02a3ac5b0496edfe3d9a399235365018cdb703b",
    "orphaned": true,
    "entries": [
      {
        "id": "4ac0ef3a-64bf-4e81-8cf7-844d69c7e8e5",
        "body": "@codex do we need to show codex section or status instead? at what cost?",
        "timestamp": 1776739227909
      },
      {
        "id": "4ad313f7-fae1-49f2-be38-5b353115b59d",
        "body": "I’d show a small status row, not a full Codex section, unless we expect real user actions there soon.\n\nA good default:\n- `Codex runtime: Available`\n- `Codex runtime: Unavailable on this device`\n- optional short reason: `Desktop only for now`\n\nWhy:\n- the problem here is discoverability, not configuration\n- a status row makes the diagnostic visible without adding settings clutter\n- it also sets expectations on mobile\n\nCost:\n- status row: low cost; mostly reuse the existing check and render one line of UI/copy\n- full section: medium cost; more UI, more empty-state design, more maintenance, and it looks odd if it only contains status text\n\nSo my recommendation: start with a single read-only status line + brief explanatory text. Add a dedicated Codex section later only if we introduce actions like install/check/fix/test/logs.",
        "timestamp": 1776739253598
      }
    ],
    "createdAt": 1776739227909,
    "updatedAt": 1776739253598
  }
]
-->
