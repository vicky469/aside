# Default Agent No-Fallback Design

**Date:** 2026-09-02
**Status:** Approved for planning

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside stores one user-selected default agent.
- [x] Default-agent commands preflight runtime availability before queueing a run.
- [x] Create Script, Update Script, PDF to Markdown, and their retry paths consume one shared default-agent runtime selection result.
- [x] Historical run records can store `preferredAgent` to explain old fallback attribution.

### To Implement

- [ ] Resolve only the configured default agent; never substitute another available agent.
- [ ] Return the existing unavailable/no-agent outcome when the configured agent fails preflight.
- [ ] Remove fallback-only fields and branching from new default-agent runtime selections and new run creation.
- [ ] Remove the Settings fallback notice, its formatter, its CSS, and its active presentation tests.
- [ ] Preserve normalization and display compatibility for historical runs that already contain fallback metadata.

### Verification

- [ ] Shared selection tests prove an unavailable preference returns no selection even when another agent is available.
- [ ] Default-agent command and retry tests prove another available provider is never queued.
- [ ] Settings contract tests prove the fallback notice element and copy formatter are absent.
- [ ] Historical run normalization and author-label tests remain green.
- [ ] Full tests, lint, typecheck, Obsidian compliance, production bundle, and release-artifact inspection pass.

## Problem

When the configured default agent is unavailable, Aside currently scans the supported agent registry and silently substitutes the first available provider. Settings exposes that substitution with an `aside-default-agent-fallback` description such as “Using Claude Code while Codex is unavailable.” Default-agent commands and retries then persist the substituted provider plus fallback attribution metadata.

The desired policy is explicit failure: the configured default agent is the only provider authorized for a default-agent command. If it is unavailable, the command should use the existing unavailable/no-agent path instead of launching a different provider.

## Goals

- Make the saved default-agent choice authoritative.
- Fail safely during availability preflight when that provider is unavailable.
- Remove all active substitution behavior and fallback UI copy.
- Keep the existing command-specific failure messages and notices.
- Preserve readability of historical runs without generating new fallback metadata.

## Non-Goals

- Attempting to launch a CLI after diagnostics already report it unavailable.
- Removing explicit `@agent` routing or changing its failure behavior.
- Removing the generic provider-error message shown after a selected provider fails during execution.
- Rewriting stored run history to delete legacy `preferredAgent` fields.
- Changing the saved default-agent setting automatically.

## Product Behavior

For Create Script, Update Script, PDF to Markdown, and retries of those commands:

1. Read the configured default agent.
2. Check that agent's runtime diagnostics.
3. If available, queue the run for exactly that agent.
4. If unavailable, take the command's existing no-agent failure path.
5. Never inspect another provider as a substitution candidate.

Settings continues to show each provider's availability status and keeps unavailable choices visible according to the existing radio-control behavior. It no longer appends a fallback sentence beneath the Default agent description.

An unavailable configured default may therefore remain selected. This is intentional: Aside does not mutate the user's preference merely because runtime availability is temporarily missing.

## Shared Ownership and Change-Surface Audit

`src/core/agents/defaultAgentSelection.ts` remains the pure policy owner, but its result becomes preferred-or-none rather than preferred-fallback-none. It checks only the configured target's diagnostics.

`Aside.resolveDefaultAgentRuntimeSelection` remains the runtime adapter. It may fetch only the configured agent's diagnostics, then use the existing runtime-selection planner. An unavailable or blocked result becomes the existing `none` outcome.

`CommentAgentController` remains a thin consumer. Its create/update/PDF and retry branches queue `selection.selectedAgent` only for a resolved result. They no longer inspect `usedFallback` or attach `preferredAgent` to new runs.

`AsideSetting` continues to probe every provider so radio-row statuses remain useful, but it does not derive or render an effective fallback. The fallback formatter and `.aside-default-agent-fallback` style have no remaining active consumer and are removed.

Historical compatibility stays in the run model, normalizer, and author-label renderer. Existing records with `requestedAgent !== preferredAgent` may still display their original fallback attribution. This legacy read path is not a candidate-selection policy and must not create new fallback runs.

```text
configured default agent
    -> diagnostics for that agent only
    -> available: queue exactly that agent
    -> unavailable: existing command failure

historical run with preferredAgent
    -> normalize unchanged
    -> render legacy attribution unchanged
```

## Failure Handling

- Configured runtime missing, unauthenticated, or unsupported: return the existing no-agent outcome.
- Diagnostics lookup throws: treat the configured provider as unavailable; do not probe another provider.
- Runtime becomes unavailable after a successful preflight: the queued run fails through the existing provider-failure pipeline and remains attributed to the configured provider.
- Old fallback run is retried as a default-agent command: resolve the current configured default only; do not reuse or recompute the old fallback provider.
- Explicit `@agent` retry: continue resolving the explicit target, independent of the default-agent policy.

## Testing Strategy

Direct selection tests replace registry-order fallback expectations with assertions that an unavailable configured target yields `none` even when Codex, Claude Code, or another provider is available. Main/runtime adapter coverage proves diagnostics are requested for the configured target and that blocked selection does not queue another provider.

Controller tests for Create Script, Update Script, PDF to Markdown, and default-agent retries replace fallback-success cases with failure expectations: no run is created for another provider, and the existing command response or notice is emitted. Successful preferred-agent cases continue to assert exact attribution.

Settings source/style tests prove the fallback formatter import, supplemental description element, and `.aside-default-agent-fallback` rule are absent while radio availability statuses remain. Historical run normalization, persisted author, and streamed author tests remain unchanged and green to lock backward compatibility.

## Change-Surface Completion Check

A final repository search for `usedFallback`, active `formatDefaultAgentFallback` calls, `kind: "fallback"`, and `.aside-default-agent-fallback` must find no active selection or Settings paths. Remaining `preferredAgent` hits must be limited to legacy persistence, normalization, historical display, fixtures, and migration documentation.
