# Agent Cross-Platform Runtime Plan

## Status

Draft plan

Related docs:

- [[agent-cross-platform-runtime-spec]]
- [agent-mentions-plan.md](agent-mentions-plan.md)
- [agent-runtime-experience-plan.md](agent-runtime-experience-plan.md)

## Summary

Built-in `@codex` should work on both desktop and mobile Obsidian, but the current implementation is still uneven across runtimes.

Today, SideNote2 has:

- a mature local Codex CLI path on desktop
- a remote bridge path that can work on desktop and mobile

The remaining gap is not inventing remote runtime support from scratch.
It is productizing runtime selection, access policy, and remote deployment.

This plan adds a cross-platform runtime model with clear compute ownership:

- desktop users can keep using their own local Codex setup
- desktop and mobile users can optionally use their own remote runtime or account-backed subscription
- SideNote2-hosted runtime is deferred for now

The core product requirement is not only technical compatibility. It is also billing clarity:

- do not silently spend the author's subscription on other users
- keep the first rollout explicit about who owns and pays for the remote runtime
- make runtime ownership explicit before a run starts

## Problem

Current built-in `@codex` has three hard limits:

1. It is desktop-only in practice.
   The runtime depends on desktop Node and process spawning, so mobile cannot execute it.

2. The product model around remote execution is still incomplete.
   The code now has a remote path, but settings, ownership copy, and access policy still need to be formalized.

3. It has no billing or entitlement layer.
   If SideNote2 starts proxying requests through a DGX bridge, shared subscription, or operator-funded allowance, the product needs an explicit access and usage policy. Full billing is deferred.

## Product Goal

Make built-in `@codex` available on both desktop and mobile with a clear runtime model and clear payment policy.

The target user experience should be:

- on desktop, `@codex` works with the user's own local setup when available
- on mobile, `@codex` works through a supported remote path
- the UI always makes it clear whether the run uses:
  - the user's own local setup
  - a configured remote runtime
- no run ever falls back to operator-paid compute invisibly

## Non-Goals

Not part of the first rollout:

- full remote workspace mirroring for arbitrary code edits
- silently sharing one global subscription across unpaid users
- hiding provider ownership behind vague "built-in" wording
- hosted paid runtime
- cross-device background job sync beyond what the selected runtime already supports

## Product Principles

### 1. Runtime ownership must be explicit

Each run should have a clear source of compute:

- local desktop runtime
- user-managed remote runtime

The product should never quietly substitute one for another.

### 2. Remote access policy must be explicit

The first rollout may use a user-managed remote runtime or an operator-managed bridge, but it must stay explicit.

That means:

- no silent fallback from local to any operator-paid runtime
- no hidden use of the author's Codex subscription just because the local runtime is unavailable
- if a bridge offers free allowance or paid access, that policy belongs to the bridge product layer, not hidden plugin fallback logic

### 3. Desktop and mobile should share one thread UX

The SideNote2 comment flow should stay the same:

- user types `@codex`
- user saves the side note
- the run appears in the same thread
- progress, cancel, retry, and final reply stay in-thread

Only the runtime backend should vary by platform and settings.

### 4. Capability should match the runtime

Not every runtime needs the same capabilities.

For example:

- local desktop runtime can support workspace-aware coding tasks
- remote runtime should target the same workspace-aware Codex behavior when the bridge has a real server-side workspace checkout

The UI should expose this honestly, or negotiate it later, instead of pretending every remote endpoint is identical.

## Runtime Modes

### Mode A: Local desktop runtime

Use the existing local Codex CLI path on desktop when available.

Characteristics:

- desktop only
- uses the user's own local Codex availability
- no SideNote2-hosted compute cost
- best fit for workspace-aware coding and local file changes

This should remain the default desktop path when it is available.

### Mode B: Remote runtime

Allow the user to configure a remote endpoint for both desktop and mobile.

Characteristics:

- works on desktop and mobile
- uses a configured remote endpoint plus bearer auth
- keeps provider or DGX specifics out of the plugin settings surface
- best first cross-platform path for mobile support and remote execution

This is the cleanest way to make `@codex` cross-platform while keeping the plugin surface provider-neutral.

## Product Decision

SideNote2 should support both desktop and mobile through a multi-runtime architecture:

1. Desktop keeps the current local runtime path.
2. Desktop and mobile gain a remote runtime path.
3. Hosted SideNote2 runtime is deferred for now.

Recommended default policy:

- remote runtime configured and available: prefer remote
- otherwise local desktop runtime when available
- no eligible runtime: show setup UI instead of attempting the run

## UX Requirements

### Settings

Add a runtime section with explicit mode selection:

- `Auto`
- `Local desktop`
- `Remote runtime`

Recommended supporting fields:

- remote base URL
- remote auth token
- bridge/provider status

### Status copy

The settings and runtime UI should clearly describe ownership:

- `Using your local Codex setup`
- `Using remote runtime`
- `Uses your own account or endpoint`

### Run gating

Before dispatch:

- if the chosen mode is unavailable, block early with setup guidance
- do not silently reroute a failed local run into any operator-paid runtime

## Capability Scope

### Phase 1 remote capability

The first remote runtime should focus on:

- reading packed SideNote2 prompt context
- generating streamed replies
- supporting cancel and retry

This is enough to make `@codex` useful on mobile.

### Later remote capability

Workspace-changing tasks are harder remotely.

They require one of:

- a remote worker with a synced checkout or accessible repository
- a paired desktop agent
- a note-scoped edit model that only writes back thread replies or dedicated markdown notes

So remote mobile support should start with reply generation, not full arbitrary workspace automation.

## Architecture Plan

### Phase 1: runtime abstraction

Refactor the runtime layer so `@codex` no longer means one hardcoded desktop CLI path.

Add a runtime abstraction that can choose between:

- local desktop runtime
- remote BYO runtime

This should be decided before dispatch, with a capability result the UI can read.

### Phase 2: Remote runtime

Add a remote transport that works on both desktop and mobile:

- request/response API
- streaming progress text
- cancellation
- authentication

This should reuse the existing in-thread run model rather than inventing a separate mobile UI.

### Phase 3: hosted paid runtime

This is explicitly deferred.

If SideNote2 later wants a turnkey experience, add a hosted runtime with:

- account sign-in
- entitlement checks
- paid plan gating
- usage reporting

The plugin should treat hosted runtime as a separate product surface, not as an invisible extension of local runtime.

### Phase 4: advanced remote work

After cross-platform reply generation is stable, evaluate richer modes for:

- creating or updating markdown notes remotely
- paired desktop execution
- multi-workspace selection and capability negotiation for remote workers

## Recommended Rollout Order

1. Build runtime abstraction and explicit mode selection.
2. Ship remote-runtime Codex execution on desktop and mobile.
3. Revisit hosted paid runtime only after billing and entitlement are real.
4. Expand hosted or remote productization beyond the first bridge after the base model is stable.

## Acceptance Criteria

This plan is successful when:

- `@codex` can run on mobile through a supported remote path
- desktop still supports the current local path
- the plugin clearly tells the user which runtime is being used
- the first rollout uses only user-owned access
- local or remote-runtime users are not silently switched onto operator-paid compute
- the same SideNote2 thread UX works on both desktop and mobile

## Open Questions

- Should remote runtime mean raw API key entry, account linking, or a user-managed bridge service?
- For remote runtime, should the first version support one provider shape only, or a generic bridge contract?
- If hosted runtime is revisited later, should it keep the same `@codex` label or use distinct branding in settings?

<!-- SideNote2 comments
[
  {
    "id": "01269687-ee71-4842-ada1-48896fb457f0",
    "startLine": 253,
    "startChar": 0,
    "endLine": 254,
    "endChar": 58,
    "selectedText": "1. Build runtime abstraction and explicit mode selection.\n2. Ship BYO remote reply generation on desktop and mobile.",
    "selectedTextHash": "6d80330ad2eefe7b33571ba8f3181321c553cc40e30dcb2be2eed09e1a64e08a",
    "orphaned": true,
    "entries": [
      {
        "id": "01269687-ee71-4842-ada1-48896fb457f0",
        "body": "@codex create a spec under the same prd folder for this. use wiki link page",
        "timestamp": 1776739676586
      },
      {
        "id": "ed3a8d07-dc28-488d-b1fb-3794c637eabd",
        "body": "Created [[agent-cross-platform-runtime-spec]].\n\nIt covers:\n- explicit `auto | local | remote` mode selection\n- `direct-cli` vs `openclaw-acp` runtime abstraction\n- BYO remote bridge contract for desktop + mobile reply generation\n- settings, availability gating, and ownership copy\n- remote run persistence, polling, cancel, and restart recovery\n- no-silent-fallback rules and data/logging constraints\n\nI also linked it from [[agent-cross-platform-runtime-plan]].",
        "timestamp": 1776739691237
      }
    ],
    "createdAt": 1776739676586,
    "updatedAt": 1776739691237
  }
]
-->
