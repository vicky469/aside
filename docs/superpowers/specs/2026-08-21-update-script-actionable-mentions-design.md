# Update Script and Actionable Mentions Design

**Date:** 2026-08-21
**Status:** Approved; implementation pending

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Direct JavaScript children of the active vault's `🛠️ scripts/` folder are registered live and exposed as `/script-name` directives.
- [x] `/create-script` already routes through the availability-aware default agent and the shared agent-run pipeline.
- [x] Draft and persisted comment rendering already share one mention matcher and the live vault-script predicate.
- [x] The arbitrary-`@mention` bug was reproduced against the real renderer: `@hi` is currently wrapped as a mention even when no registry accepts it.
- [x] The strict `/update-script /script-name <request>` syntax and one shared actionable-mention policy were approved in the originating conversation.

### To Implement

- [ ] Add one shared actionable-mention policy for active built-ins, supported agents, and live vault scripts.
- [ ] Derive autocomplete, draft highlighting, persisted highlighting, and reserved vault-script names from that policy.
- [ ] Leave unknown tokens such as `@hi` and unregistered slash names unstyled and non-actionable.
- [ ] Add `/update-script` as a reserved built-in slash command and suggestion when Agents is enabled.
- [ ] Parse the strict `/update-script /script-name <request>` grammar and resolve the first argument through the live vault-script registry.
- [ ] Fast-return before agent selection when the target is missing, ambiguous, or the request is empty.
- [ ] Queue valid update requests through the existing default-agent run pipeline with typed target-script metadata.
- [ ] Add one shared update-script prompt contract that modifies the exact target file in place.
- [ ] Revalidate the latest target and request when regenerating an update-script run.
- [ ] Update compact editor guidance to mention both script-authoring commands without duplicating the actionable-name policy.

### Verification

- [ ] A red-green regression test proves `@hi` stays plain while `@todo` and enabled supported-agent directives remain highlighted.
- [ ] Tests prove disabled agent directives and disabled script-authoring commands stay plain and are absent from autocomplete.
- [ ] Tests prove registered vault scripts and enabled built-in slash commands are highlighted in both draft and persisted comments.
- [ ] Parser and controller tests cover valid, empty, missing, ambiguous, repeated, and malformed update-script inputs.
- [ ] Agent-run, prompt, persistence, and Regenerate tests cover the exact target path and in-place update contract.
- [ ] Existing `/create-script`, `/script-name`, `@todo`, and explicit-agent behavior remains green.
- [ ] The full automated test suite, lint, typecheck, production bundle, and release-artifact guard pass.
- [ ] An installed-plugin smoke test updates a real vault script from an Aside thread and then runs it successfully.

## Context

Aside has three kinds of user-facing magic words: built-in directives such as `@todo`, supported agent directives, and live registered vault scripts. The current autocomplete already filters these categories, and slash highlighting validates built-in commands or live vault scripts. At-mention highlighting is broader: every token matching the `@name` shape is styled blue, including random text such as `@hi`.

Aside can create a reusable vault script through `/create-script`, but it has no equally explicit workflow for changing an existing script. The desired interaction is:

```text
/update-script /embed-image-urls make the default size reasonable. currently too big.
```

The first argument identifies one currently registered script. The remaining text is the update request. Autocomplete should make the normal path discoverable, while the saved-entry router remains the final authority if a value was typed manually, became stale, was deleted, or is ambiguous.

## Goals

- Add a strict, agent-backed command for updating one existing vault script in place.
- Make autocomplete, blue highlighting, and saved-entry validation agree on which mentions are currently actionable.
- Stop invalid update requests before runtime probing, agent selection, persistence, or execution.
- Preserve one shared agent prompt and execution path across Codex, Claude Code, and Gemini.
- Keep existing create-script, direct vault-script, todo, and explicit-agent workflows intact.

## Non-Goals

- Renaming scripts or creating replacement scripts through `/update-script`.
- Editing unrelated vault files as part of an update-script request.
- Allowing prose before `/update-script` or allowing the target argument to appear later in the entry.
- Treating arbitrary `@name` text as a tag, person, or mention.
- Automatically selecting a similarly named script when the requested name is missing or ambiguous.
- Adding nested, TypeScript, JSX-family, or non-JavaScript vault scripts.

## User Experience

### Autocomplete and insertion

When Agents is enabled, a slash query offers `/create-script`, `/update-script`, and live registered vault scripts. Selecting `/update-script` inserts the command plus a trailing space. Typing the next `/` opens the same live script list, and selecting `/embed-image-urls` inserts another trailing space so the user can type the natural-language request.

When Agents is disabled, neither script-authoring command appears. Live vault scripts remain available because they run without an agent.

### Highlighting

Blue styling means the token is actionable in the current feature state:

- `@todo` is always actionable.
- `@codex`, `@claude`, and `@gemini` are actionable only while Agents is enabled.
- `/create-script` and `/update-script` are actionable only while Agents is enabled.
- `/script-name` is actionable only while that exact name resolves to one live registered vault script.
- Unknown tokens such as `@hi` and `/missing` remain plain.

The same rule applies to the live draft and persisted comment rendering. A command token and its target are evaluated separately, so `/update-script` can be blue while a manually typed invalid target remains plain.

### Successful update

For a valid entry, Aside resolves `/embed-image-urls` to its current vault-relative path, selects the available default agent, and queues the normal streamed agent run. The agent edits that exact file in place and replies compactly with the updated path and invocation.

### Invalid input

Aside returns immediately without agent diagnostics or execution when:

- `/update-script` is not the first token;
- the first argument is missing or is not a slash token;
- the target does not resolve to exactly one registered script;
- the natural-language request is empty.

The response is a compact usage or unavailable-target reply inserted in the thread. Invalid target text remains unhighlighted before submission.

## Shared Actionable-Mention Policy

A pure core policy is the single owner of mention recognition. It consumes the current feature state and a live vault-script resolver and returns the recognized kind or no match:

```text
@todo                 -> todo
@supported-agent      -> agent, when Agents is enabled
/create-script        -> built-in command, when Agents is enabled
/update-script        -> built-in command, when Agents is enabled
/registered-script    -> vault script
anything else         -> none
```

The policy also exposes the complete reserved built-in names independently of feature availability. `VaultScriptRegistry` uses that complete set so a physical script cannot shadow a command that is temporarily hidden by a feature flag.

Consumers remain thin:

- autocomplete asks the policy for active built-in candidates, then adds live script registrations;
- draft and persisted renderers ask whether each token is actionable before adding mention markup;
- the built-in command router uses the same command identities before applying command-specific grammar;
- the vault-script registry uses the complete reserved-name set when building runnable registrations.

Supported agent directives continue to come from the agent actor registry. The policy must not introduce a second hard-coded list of agent names.

## Update-Script Command Policy

The accepted grammar is strict:

```text
/update-script /script-name <non-empty natural-language request>
```

`/update-script` must be the first non-whitespace token. `/script-name` must be the immediately following token. Everything after the target is request text and is not reinterpreted as another top-level command. This allows the request itself to mention paths, commands, or agents without changing routing.

The built-in command controller runs before direct vault-script and explicit-agent controllers. It resolves the target through `VaultScriptRegistry` rather than constructing a file name. This preserves case normalization, extension handling, ambiguity rules, and live file state in one place.

The command is idempotent per saved entry. Fast-return branches append at most one reply and create no agent run. A valid request dispatches once through `CommentAgentController`.

## Agent Run and Prompt Contract

The existing request-kind union gains `update-script`. Update runs persist the resolved vault-relative target path in addition to the normal requested-agent, fallback, trigger, and status fields. Legacy records and create-script records continue to normalize unchanged; malformed update records are not treated as valid update runs.

Script-authoring requests run from the active vault root. The shared prompt builder receives the request kind and resolved target path. For update-script runs it tells every supported runtime to:

- inspect the exact registered target file;
- modify that file in place to satisfy the request;
- preserve its direct vault-script path and supported extension;
- avoid renaming it, creating a replacement, or editing unrelated vault files;
- preserve the current-note positional argument and vault-root working-directory contract;
- report the updated vault-relative path and `/script-name` invocation;
- state failure plainly if the target disappears or cannot be edited.

Provider adapters remain transport-only and must not copy this policy text.

## Regenerate

Regenerate loads the latest saved trigger entry, reparses the strict grammar, and resolves the named script against the current registry. It obtains a fresh default-agent selection only after validation succeeds. A renamed, deleted, or newly ambiguous target fast-returns instead of using a stale stored path.

When validation succeeds, the replacement run persists the newly resolved path and current request text. Existing retry output replacement, fallback attribution, streaming, cancellation, and failure behavior remain shared with other agent runs.

## Error Handling

- Empty or malformed syntax returns `Use /update-script /script-name followed by the change you want.`
- A missing or ambiguous target returns a concise unavailable-target reply and does not guess.
- No available agent returns `No agent is available to update the script.` and creates no run.
- If the file changes after validation but before agent execution, the prompt requires a plain failure response rather than creating a substitute.
- A runtime failure after launch follows existing agent-run failure handling and never starts another provider automatically.
- A failed or partial update remains explicit; Aside does not claim success based only on the agent reply.

## Testing Strategy

### Actionable mentions

- Exercise the shared policy directly across feature-enabled and feature-disabled states.
- Convert the current arbitrary-`@mention` expectations into red-green regressions where `@hi`, `@idea`, and `@safe` stay plain.
- Keep positive cases for `@todo`, enabled supported agents, enabled built-in commands, and live scripts.
- Cover both draft HTML/fragment rendering and persisted DOM decoration through the shared matcher.
- Verify autocomplete and registry reservation consume the same built-in definitions.

### Command parsing and routing

- Accept the exact example and preserve the full request text.
- Reject prose before the command, missing targets, non-slash targets, empty requests, repeated command tokens, unknown targets, and ambiguous targets.
- Prove invalid inputs return before default-agent selection or runtime diagnostics.
- Prove request text after the target is opaque to other top-level directive parsers.

### Agent execution

- Persist `requestKind: "update-script"` and the resolved target path.
- Send the same update contract through representative Codex, Claude Code, and Gemini adapter tests.
- Run from the vault root and include the exact target path in the prompt.
- Reparse and re-resolve on Regenerate, including deleted and renamed target cases.
- Preserve all existing create-script and ordinary agent-run behavior.

### End-to-end acceptance

In an installed test vault:

1. Type `/update-script` and select it from autocomplete.
2. Type `/` and select `/embed-image-urls` from the live script list.
3. Submit `make the default size reasonable. currently too big.`
4. Confirm `/update-script` and `/embed-image-urls` are blue while `@hi` remains plain.
5. Confirm the selected default agent edits the existing script without renaming it or creating a replacement.
6. Run `/embed-image-urls` and confirm the updated default size is used.
