# Default-Agent Script Creation Design

**Date:** 2026-08-19
**Status:** Approved design; implementation pending

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Direct JavaScript files under the active vault's `🛠️ scripts/` folder are registered live and run through `/script-name`; this existing behavior is owned by `shared/vaultScriptPolicy.js`, `VaultScriptRegistry`, and the vault-script controller.
- [x] Codex, Claude, and Gemini are registered in priority order and already expose local runtime diagnostics through the shared agent registry and runtime adapter.
- [x] The product behavior in this specification was reviewed and approved in the originating Aside thread.

### To Implement

- [ ] Add a shared, availability-aware default-agent selection policy with the order Codex → Claude Code → Gemini.
- [ ] Change the shared Claude actor label to **Claude Code** so every consumer uses the approved product name.
- [ ] Persist and normalize a user-selectable `defaultAgent` setting without changing existing explicit `@agent` behavior.
- [ ] Add a top-level **Agents** settings section with the default-agent picker and independent runtime status.
- [ ] Add `/create-script` as a reserved built-in directive and a first-class slash suggestion.
- [ ] Route `/create-script <request>` through the selected available agent with a shared script-creation prompt contract.
- [ ] Add the empty-request response, no-agent fast return, fallback attribution, and explicit Regenerate behavior.
- [ ] Preserve all existing `/script-name`, `@codex`, `@claude`, `@gemini`, and ordinary side-note routing.

### Verification

- [ ] Unit tests cover agent preference, ordered fallback, and no-agent selection.
- [ ] Directive and registry tests cover `/create-script`, reserved-name handling, mixed directives, and existing vault scripts.
- [ ] Controller and run-store tests cover queueing, fallback metadata, fast returns, runtime failure, and Regenerate.
- [ ] Settings tests cover migration, persistence, status relocation, available choices, disabled unavailable choices, and fallback display.
- [ ] Prompt tests prove that one shared script-creation contract reaches Codex, Claude Code, and Gemini.
- [ ] The full automated test suite and production build pass.
- [ ] An installed-plugin smoke test creates a script from the Aside frontend and then runs it through `/script-name`.

## Context

Aside already treats uniquely registered direct JavaScript children of `🛠️ scripts/` as slash-invoked vault scripts. The frontend suggests them and `/script-name` runs the selected script against the current Markdown note. Agents also receive a general instruction to put reusable vault scripts in that folder.

That general instruction is not enough to make script creation a predictable product workflow. An agent can still ask how a script will be invoked even though Aside already owns that convention. Users also cannot select a default agent, and the current runtime status is attached to the unrelated **Show agent tab** setting.

This design introduces an agent-backed `/create-script` command, a persistent default-agent preference, deterministic availability fallback, and a dedicated **Agents** settings section. The first user acceptance test will ask `/create-script` to create the Docling image-to-Markdown script; creating that script itself is outside this implementation scope.

## Goals

- Make `/create-script <natural-language request>` the obvious frontend workflow for creating a reusable vault script.
- Encode the existing `🛠️ scripts/` and `/script-name` conventions in product behavior instead of asking the user to choose an invocation model.
- Let the user choose a default agent from Settings.
- Use an available fallback deterministically when the preferred agent is unavailable.
- Return immediately and clearly when no local agent is available.
- Keep agent status separate from sidebar-tab visibility.
- Preserve the existing explicit-agent and vault-script workflows.

## Non-Goals

- Creating the Docling script as part of this product change.
- Automatically invoking an agent for an ordinary side note without a directive.
- Changing the semantics of `@codex`, `@claude`, or `@gemini`.
- Automatically retrying a failed creation request with a second provider.
- Adding nested, TypeScript, JSX-family, or non-JavaScript vault scripts.
- Adding a Scripts settings section or Scripts sidebar tab.

## User Experience

### Creating a script

The user writes a saved Aside entry such as:

```text
/create-script convert the selected image to Markdown using Docling
```

`/create-script` appears as a built-in slash suggestion before live vault-script suggestions. Aside removes the command token, validates that a request remains, selects an available agent, and queues a normal streamed agent run. The completed reply names the created vault-relative path and its invocation, for example:

```text
Created `🛠️ scripts/image-to-markdown.mjs`. Run it with `/image-to-markdown`.
```

The existing vault file-event path registers the new script without restarting Obsidian. The new `/script-name` suggestion and execution behavior remain owned by the existing vault-script registry and controller.

### Choosing the default agent

Settings gains a top-level **Agents** section before **Sidebar tabs**. It contains:

1. **Default agent** — a persisted picker ordered as Codex, Claude Code, Gemini.
2. **Agent status** — current availability for all three agents in the same order.

Opening the settings page probes all agents concurrently. Available agents are enabled in the picker. Unavailable agents remain visible with an unavailable label but cannot be newly selected. If the saved preference becomes unavailable after selection, it remains visible as the preference while the settings description identifies the effective fallback. Temporary availability changes never rewrite the saved preference.

The existing **Show agent tab** row remains under **Sidebar tabs** and controls only whether that tab is visible. It no longer owns or hides runtime status.

### Availability outcomes

The selection order is always Codex → Claude Code → Gemini:

- If the saved default is available, use it.
- Otherwise, use the first available agent in the fixed order.
- If none are available, immediately append `No agent is available to create the script.` and do not create an agent run.

The actual selected provider is recorded on a launched run. When it differs from the preference, the run UI identifies it as a fallback. The saved preference remains unchanged.

## Command Policy

`/create-script` is a built-in directive, not a physical vault script. Its normalized name is reserved in the same central built-in directive policy consumed by parsing, mention suggestions, and `VaultScriptRegistry`. A file such as `🛠️ scripts/create-script.mjs` may exist as an ordinary vault file, but Aside neither suggests nor launches it as `/create-script`.

The built-in command is resolved before registered vault scripts and explicit agent mentions. Routing follows these rules:

- One `/create-script` plus non-directive request text: launch the selected agent.
- `/create-script` without request text: append a compact usage response and do not launch an agent.
- `/create-script` mixed with a registered `/script-name`: reject the entry with a concise one-directive instruction.
- `/create-script` mixed with an explicit `@agent`: reject the entry and direct the user to choose the default under **Settings → Agents**.
- Existing entries containing only `/script-name` or one explicit `@agent` follow their current controllers unchanged.

The parser and router must be idempotent for a saved entry. A launched run continues to use the existing persisted run receipt. Empty and no-agent fast-return branches must not append duplicate replies during one save operation.

## Architecture

### Shared agent-selection policy

A new pure core policy owns preference and fallback selection. It consumes:

- the normalized saved `defaultAgent`;
- the ordered supported actors from the existing agent registry;
- one diagnostic result per actor.

Only diagnostics with status `available` qualify. `checking`, `unavailable`, and `unsupported` do not. The result is one of:

- `preferred` with the selected actor;
- `fallback` with the preferred and selected actors;
- `none` when no actor is available.

The policy does not probe runtimes or persist settings. Settings rendering and command dispatch are thin adapters that independently obtain fresh diagnostics and call this shared function. Command dispatch must not depend on settings having been opened or on stale settings-page diagnostic state.

The existing Claude actor's shared display label changes from **Claude** to **Claude Code**. The directive remains `@claude`, and all settings, suggestions, statuses, and run attribution continue to derive their labels from the actor registry rather than introducing settings-only copy.

### Persisted preference

`AsideSettings` gains `defaultAgent: AsideAgentTarget`. Missing or invalid stored values normalize to Codex, matching the current primary actor. A dedicated settings-controller method persists changes. Runtime availability is never stored.

The setting is a preference, not a promise that the provider remains installed. If the preferred runtime later becomes unavailable, selection falls back per run and the preference is retained.

### Saved-entry routing

The saved-entry router gains a built-in-command phase before the current vault-script phase:

```text
built-in /create-script → registered /script-name → explicit @agent → ordinary side note
```

The existing `CommentAgentController` remains the single owner of agent run creation, streaming, persistence, cancellation, and Regenerate. It receives a typed create-script request from the built-in route instead of duplicating agent orchestration in a new controller. The create-script path reuses the normal queue after resolving the effective agent.

Agent runs created by the command persist enough metadata to distinguish them from explicit-agent runs:

- request kind: `create-script`;
- effective `requestedAgent`;
- preferred agent when fallback was used.

Legacy runs without a request kind normalize as explicit-agent runs. Regenerate recognizes the create-script request kind, obtains fresh diagnostics, and resolves the effective agent again. Regenerate is an explicit user action; Aside never automatically starts a second provider after launch failure.

### Shared prompt contract

`shared/sideNotePromptPolicy.js` remains the single prompt owner used by Codex, Claude Code, and Gemini. Its builder accepts a request kind and injects the script-creation contract only for `create-script` runs.

The contract tells the agent to:

- treat the text after `/create-script` as the requested behavior;
- create a collision-free direct child of the active vault's `🛠️ scripts/` folder;
- use `.mjs`, `.js`, or `.cjs`, never raw TypeScript or JSX-family source;
- avoid the reserved `create-script` name and existing case-insensitive mention collisions;
- accept the current Markdown note's absolute path as the first positional argument;
- assume the process working directory is the vault root;
- write concise user-facing output to standard output and failures to standard error;
- report the created path and `/script-name` in the Aside reply.

The three runtime adapters continue to differ only in executable and transport details. They must not contain provider-specific copies of this contract.

### Settings presentation

The shared settings catalog gains an `agents` section before `sidebar`. The default picker and agent-status presentation live in that section so both the legacy and declarative settings adapters render the same behavior.

The existing diagnostic provider remains the source for status. The renderer starts with checking state, probes all supported actors concurrently, ignores stale refresh results using the existing refresh token, then renders availability and the effective fallback. The picker includes all actors in registry order, disables unavailable choices after probing, and allows the user to move from an unavailable saved preference to any available choice.

Mention suggestions consume the same built-in directive definition as the router and registry. `/create-script` appears for slash queries; `@todo` and agent mentions remain under `@` queries; live vault scripts follow the built-in slash command.

## Error Handling

- An empty command appends a short usage response such as `Use /create-script followed by the script you want to create.`
- Diagnostic probe failures count as unavailable for that provider and do not block probes for the others.
- No available provider produces the immediate thread reply and no agent run.
- If the selected provider becomes unavailable between preflight and launch, the normal agent-run failure is shown. Aside does not try another provider automatically because the first process may already have changed files.
- An explicit Regenerate re-evaluates availability and may select a different provider. The prompt tells the agent to inspect existing matching work before creating another file.
- If an agent creates a colliding or unsupported file, the vault registry does not expose it as runnable. The registry remains the final authority even when an agent's reply claims success.

## Testing Strategy

### Pure policy tests

- Preferred provider available.
- Preferred provider unavailable with Codex, Claude Code, or Gemini fallback.
- Fixed ordering independent of diagnostic completion order.
- All providers unavailable or unsupported.
- Missing and invalid `defaultAgent` normalization.
- Built-in command recognition, empty body, repeated token, and mixed-directive rejection.
- Reserved `create-script` filtering in the registry and suggestions.

### Controller and persistence tests

- Create-script queues exactly one run with the effective provider and request-kind metadata.
- Fallback records both preferred and effective providers without changing settings.
- No-agent and empty-command branches append one compact response and queue nothing.
- A provider failure after launch does not automatically launch another provider.
- Regenerate obtains fresh diagnostics, replaces the prior output, and may select a new fallback.
- Existing explicit-agent and registered-script idempotency remains unchanged.

### Settings tests

- **Agents** appears before **Sidebar tabs** in both settings adapters.
- Agent status no longer depends on **Show agent tab**.
- The picker orders all actors consistently, enables available choices, and disables unavailable choices.
- An unavailable saved preference remains visible and the effective fallback is described.
- Changing the picker persists the normalized preference.

### Prompt and integration tests

- The shared prompt contains the creation contract only for create-script requests.
- Representative Codex, Claude Code, and Gemini invocation tests receive the same built prompt.
- Mention UI inserts `/create-script` and newly created live scripts remain discoverable.
- Existing `/script-name`, `@todo`, and explicit-agent regression tests continue to pass.

### Manual frontend acceptance

1. Install the built plugin in a test vault with at least one available agent.
2. Open **Settings → Aside → Agents**, confirm all statuses, and choose the default.
3. Submit `/create-script <request>` from a real Aside draft.
4. Confirm the run uses the preference or clearly identifies the fallback.
5. Confirm the reply includes the created `🛠️ scripts/<name>.<ext>` path and `/name` invocation.
6. Type `/` in a new Aside draft and confirm the created script appears without restarting Obsidian.
7. Run `/name` and confirm the existing vault-script runtime handles the current note.
8. Repeat with all agents unavailable and confirm the immediate no-agent reply with no queued run.

## Change-Surface Ownership

The rule must have one owner at each layer:

- agent order and fallback: shared agent-selection policy consuming the agent registry;
- built-in command identity: shared built-in slash-directive policy;
- vault script file eligibility: existing `shared/vaultScriptPolicy.js`;
- creation instructions: existing shared side-note prompt policy;
- settings metadata: existing shared settings catalog;
- agent execution: existing comment-agent controller.

Provider adapters, settings adapters, and view code remain thin consumers. After implementation, a repository-wide search for `create-script`, the priority order, and creation-contract phrases should show only these owners, intentional adapters, tests, and documentation.
