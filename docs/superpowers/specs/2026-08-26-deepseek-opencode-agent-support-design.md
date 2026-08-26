# DeepSeek via OpenCode Agent Support Design

## Summary

Aside will add `@deepseek` as a first-class local agent beside Codex, Claude Code, and Gemini. Saving a comment with one `@deepseek` directive will launch the user's installed OpenCode CLI in headless JSON mode, show the available reply and tool progress through the existing agent-run UI, and persist the final answer in the same thread.

OpenCode remains the source of truth for provider credentials, model selection, model variants, plugins, tools, and permissions. Aside will not pass `--model`, so `@deepseek` uses whichever model is currently configured in OpenCode. The DeepSeek label therefore identifies the Aside actor and requested workflow; it does not guarantee that OpenCode's active model still belongs to the DeepSeek provider.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Agent directives, labels, supported-provider iteration, settings options, and mention suggestions share an actor registry.
- [x] Agent run records, prompt context, runtime selection, retry, cancellation, streaming presentation, and persisted replies are provider-neutral.
- [x] Desktop agent processes share PATH resolution, lifecycle tracking, prompt construction, reply sanitization, and metadata normalization.
- [x] No existing DeepSeek/OpenCode implementation plan or tracked design overlaps this feature.

### To Implement

- [x] Add a supported DeepSeek actor with target `deepseek`, directive `@deepseek`, and runtime strategy `opencode-cli`.
- [x] Add OpenCode diagnostics and route `opencode-cli` through the generic local runtime entrypoints.
- [x] Launch a fresh OpenCode run with JSON output and automatic non-interactive approval, while inheriting the user's configured model and OpenCode environment.
- [x] Translate supported OpenCode JSON events into Aside reply text, progress, tool metadata, completion, and actionable failures.
- [x] Extend shared provider-derived copy and remove newly exposed hard-coded provider lists where application code owns the list.
- [x] Document `@deepseek`, the OpenCode prerequisite, inherited model behavior, and the actor/model mismatch caveat.

### Verification

- [x] Fail-first registry, directive, suggestion, and settings tests prove `@deepseek` behaves as a peer supported actor.
- [x] CLI argument tests prove `--format json` and `--auto` are present while model, agent, and session overrides are absent.
- [x] Diagnostics tests cover desktop availability, a missing binary, and launch failures.
- [x] JSON event and runtime tests cover text, tool activity, metadata, malformed events, structured errors, empty success, nonzero exit, spawn failure, and cancellation.
- [x] Controller and presentation tests prove DeepSeek uses existing dispatch, retry, cancellation, author-label, fallback, and persistence paths.
- [x] A repeated change-surface search leaves only intentional provider adapters, type declarations, documentation examples, and test fixtures.
- [x] The full test suite, lint, typecheck, production bundle, Obsidian compliance check, and release-artifact guard pass.
- [ ] A built-plugin smoke check confirms discovery, availability, execution, progress, cancellation, and persisted reply behavior with the user's OpenCode setup.
  Not run on 2026-08-26 because it would spend provider credits and mutate a real vault note without explicit authorization. The non-mutating local checks confirmed OpenCode 1.18.23 is installed and that `opencode run --help` exposes the required JSON, model-inheritance, fresh-session, and `--auto` flags.

## Goals

- Let users invoke OpenCode from an Aside comment by typing `@deepseek`.
- Match the existing local-agent experience for routing, progress, cancellation, retry, settings availability, run history, and persisted replies.
- Keep OpenCode configuration authoritative rather than adding an Aside model picker, credential store, or OpenCode profile editor.
- Add the runtime as a thin provider adapter without copying shared actor or process behavior.

## Non-Goals

- Calling the DeepSeek API directly or storing a DeepSeek API key in Aside data.
- Guaranteeing that OpenCode's active model belongs to the DeepSeek provider.
- Adding `@opencode` as a second directive or exposing arbitrary OpenCode agents in Aside.
- Passing a fixed `provider/model`, variant, custom agent, reusable session ID, or server attachment URL.
- Resuming earlier OpenCode sessions or importing their history into Aside.
- Adding remote or mobile OpenCode execution.
- Redesigning the mention dropdown, settings, agent cards, or thread UI.
- Cutting a release, changing the version, or creating release notes as part of the feature implementation itself.

## Product Behavior

`@deepseek` appears after the existing supported agents in mention suggestions and default-agent settings. Matching and insertion remain case-insensitive. Repeating `@deepseek` in one comment still selects one target; mixing it with another supported agent uses the existing conflicting-agent rejection path.

Saving an eligible comment starts an OpenCode-backed local run. The run uses the normal queued, running, succeeded, failed, and cancelled states. Replies, progress, used tools, files, URLs, errors, retry actions, fallback labels, and persisted output continue through existing provider-neutral models and views.

The user-facing actor label is `DeepSeek`. Availability and error copy name the actual executable as `OpenCode CLI` so setup failures are actionable. Help text states that the run inherits OpenCode's current model. If that model is later changed to another provider, Aside will still display the actor as DeepSeek by design.

## Architecture and Change-Surface Ownership

`agentActorRegistry.ts` remains the source of truth for actor order, labels, directives, support state, settings descriptions, and runtime strategy. A focused `deepseekActor.ts` definition contributes the new identity. `AsideAgentTarget` and `AgentActorRuntimeStrategy` expand only as required for `deepseek` and `opencode-cli`.

Directive parsing, actionable mentions, suggestions, settings options, default-agent fallback, run storage, sidebar grouping, and author labels continue consuming registry data or `AsideAgentTarget`. They must not gain separate DeepSeek-specific lists or conditionals.

`agentRuntimeAdapter.ts` remains the shared desktop process owner. It resolves the executable environment, spawns and tracks child processes, constructs the Aside prompt, emits callbacks, handles cancellation, normalizes metadata, and dispatches by runtime strategy. OpenCode-specific argument construction and JSON event translation are narrow adapter functions. Event parsing may move to a focused module if that keeps the process owner readable, but lifecycle logic must not be duplicated.

`main.ts` adds the `opencode-cli` diagnostics branch to its existing generic runtime lookup. Settings continue iterating the actor registry and requesting diagnostics through the generic target-based method; no public `getDeepSeekRuntimeDiagnostics()` compatibility method is needed without a caller.

The implementation will re-run provider-enumeration searches across `src`, `tests`, `scripts`, README, and experimental-feature documentation. Application-owned copy derives from the actor registry where possible. Type unions, provider adapters, documentation examples, and explicit test fixtures may name providers intentionally.

## Runtime Command Contract

Aside launches the executable without a shell, using arguments equivalent to:

```text
opencode run --format json --auto <aside-prompt>
```

The prompt is one positional argument, as documented by OpenCode's non-interactive `run` command. Passing it through the child-process argument array prevents shell interpolation. The child uses the resolved invocation working directory and existing login-shell-derived environment.

Aside deliberately omits:

- `--model` and `--variant`, preserving OpenCode's current model selection.
- `--agent`, preserving OpenCode's normal primary agent selection.
- `--continue`, `--session`, and `--fork`, ensuring every Aside request starts a fresh OpenCode session.
- `--attach`, avoiding dependence on a separately managed OpenCode server.
- `--share`, preventing Aside from making a session public.

`--auto` prevents a headless run from waiting for interactive permission confirmation while continuing to honor operations explicitly denied by the user's OpenCode permission configuration. Aside does not weaken, rewrite, or persist those permissions.

## Diagnostics

Diagnostics use a non-mutating `opencode --version` probe in the resolved execution environment. A successful probe reports `OpenCode CLI is available.` An `ENOENT`-style failure reports `OpenCode CLI was not found on PATH.` Other probe failures report that OpenCode could not be launched from Obsidian.

The probe does not start a model request, inspect or expose credentials, refresh the model catalog, or assert that the configured model is DeepSeek. Authentication, provider, model, plugin, and policy errors are reported from the real run because validating them during settings rendering would be mutating, costly, or unreliable.

The runtime remains desktop-only and requires the existing filesystem-backed invocation context.

## JSON Event Translation

OpenCode's newline-delimited JSON stdout is parsed incrementally across arbitrary chunk boundaries. The adapter recognizes the documented headless event shapes needed by Aside and ignores unknown additive event types safely:

- `step_start` announces that OpenCode has begun work.
- `text` reads `part.text`, sanitizes it, and publishes the accumulated reply through `onPartialText` at the cadence OpenCode provides.
- `tool_use` reads the completed tool part, publishes concise progress, and extracts normalized tool names, file paths, URLs, and bounded tool errors.
- `reasoning`, when emitted, may provide concise progress but is never persisted as reply text.
- `step_finish` marks observed completion and may contribute bounded usage or finish diagnostics when existing run metadata supports them.
- `error` contributes the most actionable bounded failure message.

The adapter does not assume token-level deltas because OpenCode may emit completed text parts. It also does not require `step_finish` when the process exits successfully with a valid nonempty reply, because some OpenCode versions have historically omitted terminal JSON events. A successful exit with no sanitized text fails explicitly as `OpenCode returned an empty response.` rather than persisting a blank agent reply.

Malformed nonempty lines and unknown events never become user-visible reply text. They may be retained as bounded diagnostics for a failed or empty run. Metadata flows through the existing deduplication and sanitization helpers.

## Lifecycle, Security, and Failure Handling

OpenCode processes join the existing active-process registry. Aside cancellation and plugin unload send the existing termination signal, detach listeners, prevent late callbacks, and settle the run as `AgentRuntimeCancelledError`. Spawn failures, missing stdout, nonzero exits, and stream errors follow the same cleanup guarantees as the other local runtimes.

Aside does not add credentials, model IDs, variants, OpenCode configuration, session IDs, or sharing URLs to plugin data. The complete Aside prompt and accessible workspace context are sent to the model selected by OpenCode, matching the user's explicit local-agent invocation. OpenCode may maintain its own credentials, configuration, session records, telemetry, plugins, and caches under its normal storage paths; Aside neither relocates nor manages them.

Because `--auto` approves operations that are not explicitly denied, documentation must tell users that OpenCode's own permission configuration is the safety boundary for `@deepseek` runs. Aside never uses a shell to construct the command and never derives executable flags from comment text.

Run failures prefer structured OpenCode errors, then bounded stderr, then malformed-stream diagnostics, and finally a concise exit-code fallback. Authentication, missing-provider, missing-model, permission, and plugin failures must retain enough original detail to be actionable without exposing secrets in logs or notices.

## Testing Strategy

Test-driven implementation starts with focused failing tests before production edits.

Registry and directive tests add DeepSeek to supported ordering, lookup, normalization, labels, supported-directive formatting, reserved mention names, duplicate mentions, and cross-provider conflicts. Suggestion, settings, placeholder, author-label, and fallback tests prove existing consumers gain the actor through shared registry data.

Pure command tests assert the exact executable and required flags, positional prompt transport, inherited working directory, and omission of model, agent, session, attachment, and sharing options. Diagnostics tests use fake process modules and never invoke a real model or credential flow.

JSON tests use representative `step_start`, `text`, `tool_use`, `reasoning`, `step_finish`, and `error` events. They cover split chunks, multiple lines per chunk, malformed JSON, unknown event types, empty text, file and URL extraction, normalized tool failures, and metadata deduplication.

Fake child-process tests cover successful reply delivery, tool progress, valid reply without a terminal event, empty successful exit, structured failure, stderr and nonzero exit, spawn failure, cancellation before spawn, cancellation during execution, and late events after cancellation. Controller tests add one tracer case from `@deepseek` parsing through runtime selection and persisted reply creation.

Focused tests are followed by the complete repository build. The release-artifact guard inspects the shipped `main.js`, `manifest.json`, and `styles.css` and rejects source maps, embedded sources, raw TypeScript/JSX-family files, secret-bearing files, and other local-only artifacts.

The final built-plugin smoke check uses the user's installed OpenCode CLI and current configured model. It confirms mention discovery, settings availability, process launch, visible progress, cancellation, persisted output, and actionable failure display. It must not change OpenCode credentials, model selection, or permission configuration.

## Documentation

README setup and usage examples add `@deepseek` beside the existing directives and state that OpenCode must already be installed and configured. The wording calls out both inherited model selection and `--auto` permission behavior.

`EXPERIMENTAL_FEATURES.md` adds `deepseek` to reserved command names so a vault script cannot shadow the built-in directive. Any other provider enumeration uncovered during the change-surface audit is either derived from the actor registry or documented as an intentional static example.

No release is part of this implementation. Before a later release, the normal versioned release notes and exact shipped-asset security inspection remain mandatory.
