# Claude Local Runtime Spec

## Status

Implemented in the local agent runtime change that adds `@claude` support to
Aside's existing local agent workflow.

## Objective

Enable users to mention `@claude` in an Aside comment and have Aside run the
local Claude CLI as a first-class agent provider in the same product flow used
by `@codex`: queue the request, show progress, stream a draft reply when
available, append the final answer as a child entry, and support cancel, retry,
and persisted run metadata.

This phase assumes the user has already installed Claude CLI and completed CLI
authentication outside Aside.

## Existing Context

- `src/core/agents/agentActorRegistry.ts` already models both Codex and Claude
  actors.
- `src/core/agents/claudeActor.ts` currently marks Claude as unsupported.
- `src/core/text/agentDirectives.ts` already parses registered actor directives
  and blocks unsupported targets.
- `src/agents/commentAgentController.ts` is mostly target-agnostic and already
  records `requestedAgent`.
- `src/agents/agentRuntimeAdapter.ts` currently implements only the Codex local
  runtime strategy.
- `docs/prd/agent-mentions-spec.md` defines the shipped `@codex` behavior and
  should be treated as the baseline behavior to preserve.

## Product Rules

1. Supported agents are peers. There is no primary or secondary provider in the
   UI, dispatch logic, metadata model, or settings copy.
2. `@codex` invokes Codex. `@claude` invokes Claude. Explicit directives are the
   source of truth for agent selection.
3. A new saved entry without an explicit agent directive does not choose Codex or
   Claude; it should not dispatch an agent run.
4. Aside does not collect, store, or manage Claude credentials.
5. Aside does not call the Claude API directly in this phase.
6. Aside does not bypass Claude CLI permission checks.
7. Aside remains the canonical writer of side-note entries; Claude returns reply
   text only.
8. A single saved entry may target exactly one supported agent.
9. Entries that mention more than one distinct supported agent are treated as a
   conflict and are not dispatched.
10. Retry and regenerate actions preserve the original target when a prior run
   exists.
11. Existing Codex behavior must not regress.

## User Experience

When a user saves an Aside entry containing `@claude`, Aside should:

1. Create a run record with `requestedAgent: "claude"`.
2. Show the run in the same Agent tab and thread footer surfaces used by Codex.
3. Display the label `Claude` in status copy and run history.
4. Queue the run behind any active local agent run.
5. Start the Claude CLI from the same vault-aware working directory strategy used
   for Codex.
6. Stream partial assistant text when the CLI exposes usable streaming events.
7. Append the final Claude reply as a child entry under the triggering comment.
8. Persist metadata in the footer under the existing agent status area.

Expected failure copy:

- `Claude CLI was not found on PATH.`
- `Claude CLI is not authenticated or could not start.`
- `Claude CLI does not support the required non-interactive mode.`
- `Claude execution requires desktop Obsidian with a filesystem-backed vault.`

## Agent Provider Model

Treat Codex, Claude, and future agents as entries in the same provider registry.
The parser, controller, run store, footer, settings, and diagnostics should ask
the registry what providers exist instead of hardcoding a Codex/Claude pair.

Provider fields should include:

- stable id
- display label
- mention directive
- supported flag
- runtime strategy
- settings description
- optional diagnostics strategy
- optional provider-native configuration notes

Routing algorithm:

1. Parse all registered agent directives.
2. If there is exactly one distinct supported target, dispatch to that target.
3. If there are multiple distinct supported targets, show a conflict notice.
4. If there are only unsupported targets, show the unsupported-agent notice.
5. If there is no explicit target, preserve existing no-dispatch behavior unless
   a retry flow is intentionally reusing a previous run target.

## Runtime Strategy

Add a new actor runtime strategy:

```ts
type AgentActorRuntimeStrategy =
  | "codex-app-server"
  | "claude-cli"
  | "unsupported";
```

This enum can exist for the first implementation, but call sites should remain
registry-driven so adding a later provider does not require rewriting directive
parsing, queueing, footer rendering, or settings layout.

Update `CLAUDE_AGENT_ACTOR`:

```ts
{
  id: "claude",
  label: "Claude",
  directive: "@claude",
  supported: true,
  runtimeStrategy: "claude-cli",
  unsupportedNotice: null
}
```

`runAgentRuntime()` should dispatch by provider strategy:

- `codex-app-server` -> existing Codex app-server flow.
- `claude-cli` -> new Claude CLI flow.
- `unsupported` -> existing unsupported error path.

## Claude CLI Invocation

Implementation must verify the exact current Claude CLI flags against the
installed CLI and official docs before coding the adapter.

The intended non-interactive shape is:

```sh
claude -p --output-format stream-json --include-partial-messages
```

Runtime requirements:

- Use the existing login-shell PATH resolution from `resolveAgentExecutionEnv()`.
- Use the same `cwd` selection as Codex.
- Pass the generated prompt without shell interpolation.
- Prefer stdin or argv according to the verified CLI contract.
- Parse newline-delimited JSON streaming output.
- Surface assistant deltas to `onPartialText`.
- Collect the final assistant reply for write-back.
- Send `SIGTERM` on cancellation.
- Do not pass flags that skip or weaken Claude's permission model.

If the installed CLI cannot provide a reliable non-interactive result, the run
should fail clearly instead of silently switching to an interactive workflow.

## Shared Aside Skill Contract

The built-in Aside skill must be provider-neutral. Codex and Claude should
receive the same Aside workflow contract even if their native configuration
formats differ.

Shared contract:

- Return only the side-note reply text.
- Do not narrate tool use, process, or internal reasoning.
- Do not attempt to edit the vault directly.
- Treat Aside as responsible for appending the final reply.
- Keep the response suitable for insertion as a child comment.
- Use the same side-note context shape, thread history, and write-back rules.
- Report the selected Aside skill as `aside (write)` in metadata for built-in
  runs, regardless of whether the provider is Codex or Claude.

Provider-specific delivery:

- Codex can continue using the existing bundled `skills/aside/SKILL.md` sync and
  runtime instructions.
- Claude should receive the same Aside contract through the Claude-native path
  available to the installed CLI, such as invocation instructions or a
  provider-specific settings/memory mechanism after that mechanism is verified.
- The shared Aside skill content should have one source of truth so behavior does
  not drift between providers.
- Future providers should integrate the same shared contract through their own
  native instruction/configuration path.

## Prompt Contract

Reuse the existing Aside side-note prompt builder where possible. Provider
adapters may add small provider-specific wrapper instructions, but the resulting
behavior must remain the shared Aside skill contract above.

## Metadata

Keep the current footer metadata model:

- `requestedAgent` identifies whether the run used Codex or Claude.
- `runtime` may remain the existing direct local runtime value if provider is
  already disambiguated by `requestedAgent`.
- Built-in Aside skill metadata should report `aside (write)` for both Codex and
  Claude built-in runs.
- Claude tool names and browser URLs should be persisted only when they are
  available from parseable CLI stream events.
- Plain shell execution should not be rendered as a skill.

The footer must keep `Add to file` on the same line as the agent status; runtime
metadata remains below that status line.

## Settings And Diagnostics

Replace Codex-only runtime status copy with a general local agent diagnostics
section. The settings UI should render diagnostics from the provider registry so
Codex, Claude, and future agents appear as peers.

Suggested rows:

- `Codex CLI`
- `Claude CLI`

Each row should show:

- available or unavailable status
- a concise failure reason
- a re-check action

No Claude API key or auth UI is required in this phase. If Claude requires
provider-native configuration for instructions, expose it in the Claude way
rather than forcing it into Codex-specific skill settings.

## Tests

Add or update tests for:

- Actor registry marks Claude supported.
- `@claude` dispatches instead of showing unsupported copy.
- `@codex` dispatches Codex and `@claude` dispatches Claude with no provider
  priority.
- More than one distinct supported agent in the same entry produces a conflict.
- Runtime dispatcher selects `claude-cli` for Claude.
- Parser/controller/settings tests are registry-driven enough to add another
  provider fixture without Codex/Claude-specific branching.
- Claude diagnostics handle missing CLI, available CLI, and startup/auth failure.
- Claude stream parser handles partial text, final text, malformed JSON lines,
  stderr, and cancellation.
- Controller queue, cancel, retry, and append flows work for Claude.
- Shared Aside skill metadata reports `aside (write)` for both Codex and Claude.
- Footer metadata renders Claude runs without moving `Add to file`.
- Codex regression coverage for the existing app-server path.

## Rollout Plan

1. Generalize actor/runtime definitions and diagnostics types around a provider
   registry.
2. Add Claude stream parser fixtures and unit tests.
3. Implement `runClaudeDirect()`.
4. Wire `runAgentRuntime()` to the Claude strategy.
5. Generalize Codex-specific settings, skill sync wording, and retry copy.
6. Add controller and UI regression tests.
7. Run the plugin build and sync the latest build to the PM vault.

## Risks

- Claude CLI flags and stream event schemas may vary by version.
- Claude permission prompts may not be satisfiable in a non-interactive Obsidian
  plugin run.
- Treating Claude tool events as metadata may require a tolerant parser.
- Prompt text that works well for Codex may need small wording changes for
  Claude while preserving the same write-back contract.
- Codex skill files and Claude-native instructions may not support identical
  packaging, so Aside needs one provider-neutral source of truth plus
  provider-specific delivery adapters.

## Open Questions

- Should phase one support a non-streaming `--output-format text` fallback, or
  require streaming JSON so progress and metadata remain consistent?
- Should settings expose a read-only Claude CLI version once diagnostics are
  available?
- Should `@claude` appear in placeholders/help text immediately, or only after
  diagnostics confirms the CLI is available?
- Which Claude-native instruction/configuration path should Aside use for the
  shared Aside skill after verifying the installed CLI behavior?
