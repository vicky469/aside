# TODO: Codex Desktop Support vs Mobile Support

Related docs:

- [agent-cross-platform-runtime-plan.md](../prd/agent-cross-platform-runtime-plan.md)
- [agent-cross-platform-runtime-spec.md](../prd/agent-cross-platform-runtime-spec.md)
- [mobile-to-macos-codex-bridge-spec.md](../prd/mobile-to-macos-codex-bridge-spec.md)
- [mobile-to-dgx-codex-bridge-spec.md](../prd/mobile-to-dgx-codex-bridge-spec.md)
- [agent-dgx-spark-bridge-spec.md](../prd/agent-dgx-spark-bridge-spec.md)

## Why This Note Exists

I need a short current-state reference for two questions:

1. How `@codex` works today on desktop.
2. What mobile support actually looks like in the current branch.
3. What is still missing to turn the DGX Spark route into a clean supported product path.

This note is intentionally narrower than the cross-platform runtime plan. It describes the current implementation and the immediate gaps.

## Current `@codex` Paths

Today, built-in `@codex` has two runtime paths in code:

1. desktop local runtime: `direct-cli`
2. remote bridge runtime: `openclaw-acp`

The local desktop path is still the original implementation.
The remote bridge path is now also implemented in the plugin runtime and is the only mobile-capable route.

### Local desktop path

High-level flow:

1. The user types `@codex` in a SideNote2 comment.
2. SideNote2 parses the comment for supported agent mentions.
3. SideNote2 resolves the runtime before queuing the run.
4. If the resolved runtime is local, the plugin launches the local `codex` executable from desktop Obsidian.
5. Streamed progress and final reply are appended back into the same thread.

### Remote bridge path

High-level flow:

1. The user types `@codex` in a SideNote2 comment.
2. SideNote2 resolves the runtime before queuing the run.
3. If the resolved runtime is remote, the plugin builds the thread/note prompt context locally.
4. The plugin calls the configured remote bridge endpoint.
5. The remote bridge streams progress and output deltas back through poll responses.
6. SideNote2 appends the final reply into the same thread.

Key files:

- [src/core/agents/codexActor.ts](../../src/core/agents/codexActor.ts)
- [src/core/text/agentDirectives.ts](../../src/core/text/agentDirectives.ts)
- [src/control/commentAgentController.ts](../../src/control/commentAgentController.ts)
- [src/control/agentRuntimeAdapter.ts](../../src/control/agentRuntimeAdapter.ts)
- [src/control/openclawRuntimeBridge.ts](../../src/control/openclawRuntimeBridge.ts)
- [src/control/agentRuntimeSelection.ts](../../src/control/agentRuntimeSelection.ts)
- [src/main.ts](../../src/main.ts)

## What "supported on desktop" currently means

`@codex` is currently wired to the `codex-app-server` runtime strategy in [codexActor.ts](../../src/core/agents/codexActor.ts).

Desktop currently supports two practical cases:

1. local runtime on the same machine
2. remote bridge runtime if configured

The local runtime path depends on desktop-only capabilities:

- Electron `window.require(...)`
- Node modules such as `node:child_process`
- launching local processes with `execFile(...)` and `spawn(...)`
- a local `codex` binary available on the user's machine

The actual runtime dispatch happens in [agentRuntimeAdapter.ts](../../src/control/agentRuntimeAdapter.ts):

- `runAgentRuntime(...)` resolves the actor runtime strategy
- supported `codex` runs go through `runCodexDirect(...)`
- if Node/Electron process access is unavailable, the call fails immediately

Desktop remote support already exists in parallel through [commentAgentController.ts](../../src/control/commentAgentController.ts) and [openclawRuntimeBridge.ts](../../src/control/openclawRuntimeBridge.ts).

Important capability distinction:

- local desktop runtime is the current fully capable path
- the current remote bridge path is still simpler than the intended DGX target and needs productization plus parity work

## What "supported on mobile" currently means

Mobile cannot use the desktop-local Codex path.

The current mobile-capable route is:

- configure a remote bridge base URL
- configure a device-local bearer token
- let SideNote2 run `@codex` through `openclaw-acp`

So mobile support is no longer purely hypothetical in the codebase.
What is still incomplete is the product surface around it:

- the settings UI still frames remote use as `Advanced Remote Bridge`
- there is no explicit runtime-mode selector in the settings UI yet
- there is no first-class supported deployment story yet, which is the gap the DGX route is meant to close

## Current availability check

There are now two separate availability surfaces in the plugin runtime.

Local runtime diagnostic:

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

Remote runtime availability:

- [main.ts](../../src/main.ts)
  `getRemoteRuntimeAvailability()`
- [agentRuntimeSelection.ts](../../src/control/agentRuntimeSelection.ts)
  `getRemoteRuntimeAvailability(...)`

What the remote check answers:

1. Is there a configured base URL?
2. Is there a device-local bearer token?
3. Is the URL allowed by policy?
   - HTTPS for normal use
   - HTTP only for `localhost` or `127.0.0.1` development

Important limitation:

Neither availability surface is an account or subscription check.

It only answers:

- can this Obsidian runtime launch the local Codex executable?
- or: is there a syntactically valid remote bridge configuration?

It does not answer:

- is the user signed in?
- does the user have a Codex entitlement or subscription?
- is the remote bridge actually healthy right now?
- can mobile reuse the user's ChatGPT/Codex access automatically?

## Current settings surface

The settings tab now has an `Agent Runtime` section.

Current settings UI file:

- [src/ui/settings/SideNote2SettingTab.ts](../../src/ui/settings/SideNote2SettingTab.ts)

What it currently exposes:

- a read-only `Codex runtime` diagnostic row with a re-check button
- an `Advanced Remote Bridge` details block
- remote bridge base URL input
- remote bridge token input

What is still missing:

- explicit `Auto | Local desktop | Remote runtime` mode selection
- first-class generic product copy for a supported remote runtime such as DGX
- live remote connection test
- OpenAI account sign-in state
- Codex entitlement or subscription state

## What is still missing for clean mobile support

The plugin now has the remote runtime plumbing, but it still needs productization.

Minimum remaining requirements:

1. A concrete supported remote deployment story.
   The plugin-side remote client exists, but there still needs to be an endorsed remote runtime target.
   The DGX Spark route is the cleanest current candidate.

2. Explicit runtime selection in settings.
   The persisted mode state exists, but the settings UI still needs to expose it clearly.

3. Ownership and capability clarity.
   The UI should make it obvious whether the run is:
   - using local desktop Codex
   - using a configured remote runtime
   - remote-first `Auto`, local fallback, or explicit local mode

4. Optional remote health validation.
   Configuration-only status is useful, but a supported remote product path will likely want a test connection or health-check surface.

5. Bridge-side access and allowance policy.
   The first DGX route can gate access and any initial free allowance on the bridge side.
   The public Obsidian plugin API in this repo does not expose a stable logged-in user id, so that allowance should be keyed to bridge-side identity such as the bridge token, not an Obsidian account id.

## Current implementation direction

The repo is already following the broad multi-runtime plan:

- keep the local desktop path
- add a remote runtime path
- preserve the same thread UX
- keep SideNote2-owned note writes even when the remote runtime is workspace-aware
- make runtime selection explicit in settings
- keep mobile-safe streaming and cancellation

The next step is not to invent a new mobile architecture from scratch.
The next step is to bless concrete remote deployment targets and tighten the product surface around them.

This is already the direction described in [agent-cross-platform-runtime-plan.md](../prd/agent-cross-platform-runtime-plan.md).

## User-Facing Mobile Rule

Normal mobile support should keep note writes in SideNote2, even when the remote bridge is workspace-aware.

That means the remote host, whether it is:

- a Mac
- a DGX Spark
- or another user-managed machine

should not:

- inspect local vault files directly
- modify note bodies directly

It may:

- access a mirrored repo or workspace on the remote machine
- modify project files inside that remote workspace

Instead:

- SideNote2 builds and sends the relevant context
- the remote host can inspect or update its configured server-side workspace
- the remote host returns reply text only
- SideNote2 writes that reply back into the original markdown thread

This keeps mobile support:

- explicit about where workspace changes happen
- simpler to explain
- easier to operate
- compatible with deployments that keep a mirrored checkout on the remote machine

Earlier reply-only variants are still described in:

- [mobile-to-macos-codex-bridge-spec.md](../prd/mobile-to-macos-codex-bridge-spec.md)
- [mobile-to-dgx-codex-bridge-spec.md](../prd/mobile-to-dgx-codex-bridge-spec.md)

## DGX Spark Route

Detailed implementation spec:

- [agent-dgx-spark-bridge-spec.md](../prd/agent-dgx-spark-bridge-spec.md)

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

- SideNote2 should continue to build the note/thread context locally
- the DGX bridge should receive that prompt context
- the DGX bridge should apply the same SideNote2 reply envelope that the local runtime uses today
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

- `Auto` should prefer remote when remote is configured and available
- local should still work as explicit local mode and as fallback when remote is unavailable
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
The DGX bridge should not write SideNote2 note threads directly.

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

- private or allowlisted remote compute
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

## Current decisions

- keep the settings surface generic: `Remote runtime`, not provider-specific branding
- change `Auto` to prefer remote first, then local
- do not depend on an Obsidian logged-in user id for DGX access or allowance
- keep note-thread writes owned by SideNote2 even when the DGX backend runs Codex

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
