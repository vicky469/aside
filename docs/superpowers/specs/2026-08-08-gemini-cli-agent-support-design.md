# Gemini CLI Agent Support Design

## Summary

Aside will add Gemini as a first-class local agent beside Codex and Claude. A saved comment containing one `@gemini` directive will launch the user's installed Gemini CLI in headless streaming mode, show live reply and tool progress through the existing agent-run UI, and persist the final answer in the same thread.

Gemini runs will use the active local Gemini authentication, default model, settings, extensions, MCP servers, and policy configuration. Aside will not add a Gemini API key, model picker, account flow, or session browser. Every comment starts a fresh Gemini process and never resumes an earlier session.

## Implementation Tracking

Use this section as the working checklist. Mark an item complete only after it is implemented and the listed verification passes.

### Already Done

- [x] Agent directives, labels, supported-provider iteration, and mention suggestions have a shared actor registry.
- [x] Agent run records, prompt context, retry, cancellation, streaming presentation, and runtime selection are provider-neutral.
- [x] Desktop agent processes share PATH resolution, lifecycle tracking, prompt construction, reply sanitization, and metadata normalization.
- [x] Settings already render supported actors from registry data.

### To Implement

- [ ] Add a supported Gemini actor with target `gemini`, directive `@gemini`, and runtime strategy `gemini-cli`.
- [ ] Route Gemini diagnostics and execution through the existing provider-neutral runtime entrypoints.
- [ ] Build a Gemini headless command that enables `stream-json`, folder trust bypass for the resolved vault workspace, sandboxing, and automatic approval inside the sandbox.
- [ ] Send the Aside prompt through stdin and include the vault root when it differs from the process working directory.
- [ ] Translate Gemini init, assistant-message, tool-use, tool-result, error, and result events into existing partial-text, progress, metadata, success, and failure callbacks.
- [ ] Keep each run independent by starting a new process without `--resume` and without persisting a Gemini session identifier in Aside data.
- [ ] Replace user-facing hard-coded Codex/Claude directive lists with actor-registry-derived copy where application code owns the list.
- [ ] Update README usage examples to include `@gemini`.

### Verification

- [ ] Fail-first registry, directive, and mention tests prove `@gemini` is supported case-insensitively and conflicts with another agent directive.
- [ ] CLI argument tests prove sandboxed headless streaming, automatic in-sandbox approval, deliberate workspace inclusion, and no model/auth/session override.
- [ ] Diagnostics tests cover an available CLI, a missing binary, and a launch/authentication failure.
- [ ] JSONL parser tests cover partial chunks, final text, tool metadata, tool failures, error events, malformed lines, and unknown future event types.
- [ ] Runtime process tests cover successful streaming, empty output, nonzero exit codes, stdin failure, spawn failure, and cancellation.
- [ ] Controller and presentation tests prove Gemini uses the existing run, retry, cancellation, progress, and persisted-reply flows.
- [ ] Settings, placeholder, and README checks include Gemini without duplicating provider identity in application code.
- [ ] The complete repository test suite, build, and release-artifact guard pass.
- [ ] A built-plugin smoke check in `lean-startup` confirms `@gemini` discovery, execution, streaming, cancellation, and persisted reply behavior with the user's existing Gemini setup.

## Goals

- Let users invoke their local Gemini CLI by writing `@gemini` in an Aside comment.
- Match the existing Codex and Claude experience for routing, streaming, status, retry, cancellation, and run metadata.
- Allow Gemini to read, edit, run commands, search, and use configured extensions or MCP servers while keeping shell and file actions inside Gemini's sandbox boundary.
- Keep Gemini account, model, extensions, and policy ownership in Gemini CLI rather than duplicating those controls in Aside.
- Make future provider additions smaller by deriving shared directive presentation from the actor registry.

## Non-Goals

- Calling the Gemini API directly or storing a Gemini API key in plugin data.
- Adding a Gemini model selector, authentication flow, extension manager, MCP manager, or provider-specific settings section.
- Resuming a prior Gemini session or threading Gemini CLI session IDs through Aside records.
- Suppressing Gemini CLI's own automatic local history; its retention remains controlled by the user's Gemini settings.
- Adding remote Gemini execution, mobile Gemini execution, or Gemini-specific remote bridge support.
- Adopting Gemini's experimental ACP interface.
- Changing the visual design of the mention dropdown, agent threads, progress cards, or settings rows.

## Product Behavior

`@gemini` appears in the compact inline `@` suggestion list after the existing supported agent directives. Matching and insertion use the same case-insensitive behavior as `@codex` and `@claude`. The row shows only `@gemini`, preserving the existing no-duplicated-label design.

Saving a comment with exactly one supported agent target dispatches that actor. Repeated `@gemini` mentions still resolve to one Gemini run. A comment that names Gemini and another supported agent is rejected by the existing conflict path rather than launching multiple processes. Script directives retain their existing precedence and conflict rules.

Gemini runs appear in the same Agent view and thread presentation as other agents. The existing streaming reply, progress text, tool metadata, cancel, retry, reveal, and persisted reply behavior remains provider-neutral. Labels come from the Gemini actor definition so views show `Gemini` without provider-specific branches.

Settings show Gemini in the local-agent status summary and describe `@gemini` using the actor definition. If Gemini is missing or cannot launch, saving an `@gemini` comment uses the normal blocked-runtime notice and does not create a hanging run.

## Architecture and Change-Surface Ownership

`agentActorRegistry.ts` remains the source of truth for provider identity, order, labels, directives, support state, settings descriptions, and runtime strategy. A new `geminiActor.ts` contributes one definition. `AsideAgentTarget` and `AgentActorRuntimeStrategy` expand to include `gemini` and `gemini-cli`.

Directive parsing, suggestion collection, run storage, prompt context, sidebar grouping, and runtime ownership labels continue consuming the registry or `AsideAgentTarget`; they do not gain Gemini-only logic. Application-owned help copy that currently spells out `@codex` and `@claude`, such as the new-comment placeholder, will be generated from the supported actor list through one shared formatter. Documentation examples may name providers explicitly because README text cannot import runtime data.

`agentRuntimeAdapter.ts` remains the shared desktop process owner: it resolves the login-shell PATH, spawns and tracks children, builds the Aside prompt, normalizes replies and metadata, handles cancellation, and dispatches by runtime strategy. Gemini-specific command construction and JSON event translation remain narrow provider adapters. Pure Gemini event parsing may live in a focused module if that prevents the existing runtime adapter from growing another block of intertwined schema logic; process ownership must not be copied into a separate implementation.

`main.ts` retains the filesystem-backed-vault guard and adds the Gemini diagnostic strategy. Settings continue iterating supported actors and calling the generic diagnostic entrypoint. A compatibility `getCodexRuntimeDiagnostics()` method may remain for current callers, but no new Gemini-specific public plugin method is required unless a real caller needs it.

After implementation, a repeated search for Codex/Claude enumerations must leave only intentional provider examples, provider adapters, compatibility entrypoints, and tests. Shared user-facing provider lists should derive from the registry.

## Runtime Command Contract

Aside launches `gemini` with arguments equivalent to:

```text
--prompt ""
--output-format stream-json
--skip-trust
--sandbox
--approval-mode yolo
```

When `vaultRootPath` is present and differs from `cwd`, the command also adds:

```text
--include-directories <vaultRootPath>
```

The process working directory is the invocation's resolved workspace directory. The complete `buildSideNotePrompt(...)` result is written to stdin and stdin is closed. Supplying an empty prompt flag explicitly selects headless mode while keeping the potentially large, multiline Aside prompt out of the command constructed by the plugin.

Aside does not pass `--model`, `--extensions`, `--allowed-mcp-server-names`, an authentication override, `--resume`, or a reusable `--session-id`. Omitting those options intentionally inherits the user's normal Gemini CLI ownership. A new process and automatically generated session are used for every run. Aside never reuses or stores that session identifier, although Gemini may record the session in its own local history according to the user's retention settings.

`--skip-trust` applies only to a working directory and optional included directory resolved from the active filesystem-backed Obsidian vault. Neither path comes from comment text. `--approval-mode yolo` is paired with `--sandbox`: it removes impossible interactive approval prompts in a headless run while Gemini's sandbox constrains shell and file operations. If the user's administrative Gemini policy disables yolo mode or prevents required tools, Aside reports Gemini's failure rather than weakening or rewriting that policy.

## Streaming Event Translation

Gemini's newline-delimited JSON stdout is parsed incrementally across arbitrary chunk boundaries. The adapter recognizes the documented event families and ignores unknown fields so minor schema additions remain compatible:

- `init` announces startup and may provide session or model diagnostics, but its session ID is not persisted in Aside.
- Assistant `message` chunks append text in arrival order, run through the existing reply sanitizer, and publish `onPartialText`. User-message echoes and non-text payloads do not enter the reply.
- `tool_use` records the normalized tool name, extracts file paths and URLs from its arguments, correlates the call identifier, and publishes concise progress such as `Using <tool>` or `Running command`.
- `tool_result` uses the correlated tool name, adds file or URL evidence present in the result, and records a normalized tool error when the event reports failure.
- `error` contributes a bounded diagnostic. Non-terminal warnings do not erase a valid reply; terminal failures are considered when the process closes.
- `result` records terminal status and aggregated diagnostics or statistics needed for validation. Final reply text comes from the accumulated assistant messages unless a documented result response is present and more complete.

Malformed nonempty stdout lines are retained only as bounded diagnostics and never rendered as reply text. Unknown JSON event types are ignored safely. Metadata is deduplicated through the existing normalizers. Explicit skill identity may populate `usedSkills`; the adapter does not guess that an arbitrary extension or tool name is a skill.

The run succeeds only when Gemini exits successfully, reports no terminal failure, and yields a nonempty sanitized reply. A successful exit with no reply becomes `Gemini returned an empty response.` Nonzero exits combine bounded stderr, structured Gemini errors, and malformed-line diagnostics, preferring the most actionable message. Known Gemini exit codes may receive concise context, including input errors and turn-limit exhaustion, without hiding the original diagnostic.

## Lifecycle, Security, and Failure Handling

Gemini uses the existing active-process registry. Plugin unload and an Aside cancellation abort both send `SIGTERM`, remove listeners, prevent late callbacks, and settle the run as `AgentRuntimeCancelledError`. Spawn errors and missing stdin fail immediately through the same controller cleanup path used by other agents.

No Gemini credential, token, model selection, session ID, prompt copy, or extension configuration is added to Aside plugin data. Prompt and tool activity continue to be persisted only where the existing agent-run and comment model already records them. Gemini itself may write normal configuration, authentication, telemetry, and session-history data under its own home directory; Aside neither relocates nor manages those files.

The runtime remains desktop-only and requires a filesystem-backed vault. A missing `gemini` executable yields `Gemini CLI was not found on PATH.` Other diagnostic failures state that Gemini could not launch or authenticate from Obsidian. Settings diagnostics use a short, non-mutating CLI probe and must not start a model request.

## Testing Strategy

Registry tests add Gemini to supported actor ordering, directive lookup, target normalization, labels, settings descriptions, and supported-directive notices. Directive tests cover case-insensitive matching, duplicate Gemini mentions, and Gemini conflicts with both Codex and Claude. Mention tests prove `@gemini` is suggested and inserted without secondary duplicate text.

Pure command tests assert the exact required Gemini flags, conditional `--include-directories`, omitted model/auth/extension/session flags, and stdin prompt transport. Diagnostics tests use fake process modules so they never invoke the user's real model or authentication flow.

Pure JSONL/event tests use representative documented events for init, assistant message chunks, tool use, successful and failed tool results, warnings, terminal errors, and result statistics. They cover split chunks, multiple lines per chunk, malformed lines, unknown events, file and URL extraction, tool-call correlation, metadata deduplication, and sanitized partial/final text.

Fake child-process tests cover normal completion, terminal event failure, empty success, known and unknown nonzero exit codes, stderr precedence, spawn errors, stdin errors, cancellation before spawn, cancellation while streaming, and late close events after cancellation. Controller tests use `AsideAgentTarget` rather than local Codex/Claude unions and add one Gemini tracer case proving the generic dispatch-to-persisted-reply flow.

Presentation and settings tests derive expected provider rows from registry data where practical. Focused tests are followed by the full repository suite, production build, and release-artifact guard. The artifact check inspects `main.js`, `manifest.json`, and `styles.css` and rejects source maps, `sourceMappingURL`, `sourcesContent`, raw TypeScript/JSX-family files, and obvious secret-bearing files.

The verified build is then installed into `lean-startup` and compared byte-for-byte. A manual desktop smoke test confirms that typing and saving `@gemini` starts the locally authenticated CLI, streams visible output, reports tool progress, permits cancellation, and persists the final reply without adding any Gemini setting to Aside.
