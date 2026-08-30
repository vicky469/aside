# User-Managed OpenCode Agent Profiles Design

## Summary

Aside will let users explicitly expose selected OpenCode agents as first-class Aside agents without changing or rebuilding the plugin. An enabled OpenCode agent receives a user-controlled `@mention`, appears in the existing mention suggestions and Default agent setting, and runs through Aside's existing OpenCode JSON runtime with the exact OpenCode agent ID.

Codex, Claude Code, and Gemini remain built-in direct-CLI integrations. This version does not add ACP or native integrations for other CLIs. OpenCode remains the source of truth for imported agents' models, prompts, credentials, tools, and permissions.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside has working direct-CLI adapters for Codex, Claude Code, Gemini, and OpenCode, including diagnostics, streaming, progress, metadata, retry, cancellation, and persisted replies.
- [x] Built-in agent definitions already centralize labels, mentions, availability, settings descriptions, and runtime strategies in one actor registry.
- [x] Mention suggestions, actionable-mention styling, Default agent selection, run history, sidebar grouping, and author labels already consume shared agent definitions rather than maintaining independent provider adapters.
- [x] OpenCode 1.18.23 exposes a non-mutating agent catalog command, a documented structured `app.agents()` SDK API, and exact agent selection through `opencode run --agent <id>`.
- [x] No existing design or implementation plan covers user-managed OpenCode agent profiles; the completed DeepSeek/OpenCode work is the migration base for this feature.

### To Implement

- [ ] Replace the closed `AsideAgentTarget` identity union with a persisted agent-profile model and one registry that merges built-in profiles with enabled OpenCode profiles.
- [ ] Add a focused OpenCode catalog client that uses the documented structured agent API, owns its temporary server/process lifecycle, and returns only visible `primary` or `all` agents.
- [ ] Add OpenCode-agent management under the Agents settings tab: refresh, explicit enablement, editable unique mention, availability, removal, and one-time `--auto` acknowledgement.
- [ ] Make enabled OpenCode profiles first-class consumers of mention parsing, suggestions, actionable styling, Default agent selection and fallback, agent-run persistence, retry, cancellation, sidebar grouping, and author labels.
- [ ] Pass the selected profile's exact OpenCode agent ID through the existing OpenCode runtime as `--agent <id>` while preserving argument-array spawning, fresh private runs, JSON events, and `--auto`.
- [ ] Migrate the hard-coded DeepSeek identity, existing Default agent value, and legacy run records without losing saved mentions, fallback meaning, or historical author labels.
- [ ] Keep every agent and LLM control inside the Agents settings tab; disabling Agents must hide agent UI elsewhere, remove agent mentions and commands, stop probes and discovery, reject new runs, and cancel active agent processes while preserving dormant configuration.
- [ ] Update user documentation to explain OpenCode agent import, `@mention` invocation, Default agent use, refresh/removal behavior, and the `--auto` permission boundary.

### Verification

- [ ] Pure profile-registry and migration tests cover built-in seeding, dynamic IDs, catalog refresh, enablement, rename, removal, missing agents, legacy DeepSeek/default/run data, deterministic ordering, and defensive copies.
- [ ] Mention and settings tests cover dynamic suggestions, case-insensitive resolution, duplicate-agent conflicts, reserved-name conflicts, dynamic Default agent selection and fallback, and full Agents-off behavior.
- [ ] Catalog tests cover structured discovery, visible `primary`/`all` filtering, hidden/internal/subagent-only exclusion, malformed responses, missing OpenCode, lifecycle cleanup, cancellation, and no model request during discovery.
- [ ] Runtime and controller tests prove `@qwen` resolves to the saved profile, passes the exact `--agent` value without a shell, streams and persists the reply under a stable profile/label snapshot, and retains retry and cancellation behavior.
- [ ] Security tests prove acknowledgement gates first enablement, `--auto` is never silently introduced before acknowledgement, credentials and OpenCode configuration are never persisted, and disabled Agents start no processes.
- [ ] A repeated change-surface audit leaves one agent-profile owner plus intentional built-in/runtime adapters, migration fixtures, and documentation examples.
- [ ] The full tests, lint, typecheck, Obsidian compliance check, production bundle, and exact `main.js`/`manifest.json`/`styles.css` release-artifact guard pass.
- [ ] An installed-vault smoke test confirms catalog refresh and profile import without model credits; an actual OpenCode-agent run is performed only with explicit authorization to spend provider credits and mutate a test thread.

## Goals

- Let a user configure an agent in OpenCode, explicitly expose it in Aside, and invoke it with an Aside `@mention` without modifying Aside code.
- Make user-managed OpenCode agents behave like first-class Aside agents, including Default agent use and existing run lifecycle features.
- Keep the visible experience small: no editor picker, no automatically imported agents, and no LLM controls outside the Agents settings tab.
- Preserve the existing built-in Codex, Claude Code, and Gemini integrations.
- Keep OpenCode authoritative for imported agent behavior and secrets.

## Non-Goals

- Adding ACP to Aside or migrating the working built-in adapters to ACP.
- Supporting the native Kimi CLI or any other new direct CLI in this feature.
- Letting users register arbitrary commands or output formats.
- Editing OpenCode agents, models, prompts, credentials, tools, or permissions from Aside.
- Automatically exposing every OpenCode agent as an Aside mention.
- Adding an agent picker, toolbar button, or persistent agent control to a side-note editor.
- Calling provider APIs directly, storing provider keys in Aside, or implementing an agent loop inside Aside.
- Cutting a release, changing the version, or publishing artifacts as part of feature implementation.

## Product Experience

All LLM-related configuration remains under the existing Agents settings tab. The tab starts with the master Agents switch.

When Agents are disabled, Aside shows only the disabled-state explanation in that tab. It does not show agent controls elsewhere, advertise agent mentions, probe CLIs, refresh the OpenCode catalog, start agent processes, or accept new agent runs. Turning Agents off cancels active runs. Saved built-in preferences and imported OpenCode profiles remain dormant and return when the user re-enables Agents.

When Agents are enabled, the tab contains the existing built-in availability and Default agent controls plus an **OpenCode agents** section. The section shows OpenCode connection status, a **Refresh agents** action, enabled profiles, and discoverable profiles that the user may explicitly add.

Catalog entries are eligible only when they are not hidden and their OpenCode mode is `primary` or `all`. Internal hidden agents and `subagent`-only entries never appear as import choices. Refreshing the catalog is non-mutating and does not run a model.

Adding an agent requires a one-time acknowledgement that Aside runs OpenCode headlessly with `--auto`: operations not explicitly denied by the selected OpenCode agent may be approved automatically. Declining leaves the profile disabled. The acknowledgement is versioned so materially changed safety wording can require confirmation again.

For each imported agent, the user sees its OpenCode display name and agent ID and chooses a unique Aside mention. Aside stores the mention name without the leading `@`. It follows the existing mention grammar, compares case-insensitively, and cannot collide with `@todo`, enabled built-in agents, another imported profile, or a registered vault-script action name. Invalid or conflicting values are rejected before persistence.

Typing `@qwen` in a side note follows the same save-to-run behavior as `@codex`. Repeating one mention still selects one agent; mixing multiple enabled agent mentions keeps the existing conflict rejection. Imported agents also appear in Default agent settings and can run agent-powered commands that do not contain an explicit agent mention.

If an imported OpenCode agent is later missing or becomes ineligible, Aside preserves the profile and mention but marks it unavailable. It does not silently delete or remap the profile. The settings row offers **Refresh** and **Remove**. Existing run history continues to show the label captured when each run started.

## Profile Model and Source of Truth

A new agent-profile registry becomes the sole owner of user-facing agent identity. The registry exposes immutable snapshots indexed by stable profile ID and normalized mention name.

Conceptually, each profile contains:

```text
AgentProfile
├─ id: stable opaque profile ID
├─ source: built-in | opencode
├─ displayName
├─ mentionName
├─ enabled
├─ runtimeStrategy
└─ openCodeAgentId, for imported OpenCode profiles
```

Built-in definitions for Codex, Claude Code, and Gemini seed three immutable profiles. Their IDs may keep the existing strings for compatible persistence, but consumers treat profile IDs as opaque strings rather than a closed TypeScript union.

Imported profiles use generated stable IDs rather than OpenCode agent IDs. This lets a profile preserve run history and Default agent references if its mention or OpenCode mapping changes. `openCodeAgentId` is a separate exact identifier and is never derived back from the user-editable mention.

The registry, not individual views or controllers, owns:

- profile normalization and validation;
- built-in plus imported ordering;
- lookup by ID and mention;
- enabled and available membership;
- mention conflict detection;
- user-facing labels and directives;
- Default agent normalization and fallback candidates;
- the dynamic reserved-name set consumed by vault scripts.

Mention parsing, suggestions, styling, sidebar filters, settings, author labels, and run controllers consume a registry snapshot or a narrow lookup interface. They do not read raw settings or maintain provider lists.

Runtime strategy remains a closed adapter union because executable protocols are implemented code, not user data. This distinction is intentional: users may add identities backed by the existing `opencode-cli` strategy, but may not add arbitrary executable protocols.

## OpenCode Catalog Discovery

A focused OpenCode catalog client owns discovery. It uses the documented OpenCode SDK/server `app.agents()` API from the vault-root working directory and never parses the human-formatted `opencode agent list` output.

The client starts only after the Agents tab requests a refresh while Agents are enabled. It resolves the same login-shell environment used by existing runtime diagnostics, starts or connects to a loopback-only temporary OpenCode server through the official client, retrieves the catalog, normalizes the bounded fields Aside needs, and closes every process and connection on success, failure, cancellation, settings-tab disposal, or plugin unload.

Aside keeps only these catalog fields in transient memory:

- exact OpenCode agent ID;
- display name and description;
- mode;
- hidden state;
- optional model/provider display metadata needed for user identification.

Catalog prompts, permission rules, credentials, request headers, and provider configuration are neither copied into Aside settings nor rendered in diagnostic logs. Imported persistence stores only the exact agent ID and user-facing profile fields.

Discovery failures distinguish a missing executable, launch failure, incompatible SDK/server response, malformed catalog, and cancellation. Existing saved profiles remain usable or visibly unavailable according to the normal runtime diagnostic; a failed refresh never replaces the last valid persisted configuration with an empty list.

## Runtime and Data Flow

The direct CLI adapters remain intact:

```text
Codex profile  -> codex exec --json ...
Claude profile -> claude -p --output-format stream-json ...
Gemini profile -> gemini --output-format stream-json ...
OpenCode profile -> opencode run --agent <exact-id> --format json --auto <prompt>
```

The flow for an imported agent is:

1. The saved side note is scanned for mentions using the active profile-registry snapshot.
2. One enabled profile ID is resolved, or the existing conflict/unsupported path stops the run.
3. The controller records the requested profile ID and label snapshot and asks the profile's runtime strategy for diagnostics.
4. The OpenCode adapter receives the exact `openCodeAgentId` from the resolved profile and appends `--agent` and that ID as separate process arguments.
5. Existing prompt construction, vault-root working directory, JSON event translation, streaming card, metadata collection, cancellation, retry, reply sanitization, and persistence remain shared.
6. The final run record and output entry retain the stable profile ID, requested/preferred label snapshots, and existing fallback metadata.

The adapter never infers an OpenCode agent from comment text, interpolates a shell command, passes a model override, resumes an earlier OpenCode session, shares a session, or modifies OpenCode configuration.

Default-agent resolution iterates enabled profiles in registry order. It prefers the saved profile when available and otherwise uses the existing fallback policy. User-imported profiles are first-class candidates, not a separate command-only path.

## Persistence and Migration

Aside settings add normalized imported profile records, a Default agent profile ID, and a versioned OpenCode auto-approval acknowledgement. Malformed records, duplicate stable IDs, invalid mentions, and duplicate OpenCode mappings are rejected or deterministically repaired by a pure settings planner before runtime construction.

The current `defaultAgent` values for Codex, Claude, and Gemini map directly to their seeded profile IDs.

The hard-coded `deepseek` actor is migrated into a legacy OpenCode-backed profile that preserves the existing `@deepseek` mention and Default agent reference. Because existing DeepSeek behavior follows OpenCode's current default agent and does not pass `--agent`, migration must not silently guess an OpenCode agent ID. The legacy profile remains explicitly marked as following the OpenCode default until the user maps it to a discovered agent or removes it. New imported profiles always require an exact OpenCode agent ID.

Legacy run records containing built-in target strings remain readable. Normalization maps recognized built-ins to seeded profile IDs and maps `deepseek` to the migrated legacy profile while preserving historical label and fallback meaning. New records store profile IDs plus label snapshots so future profile removal does not erase authorship.

Turning Agents off preserves all profile settings and acknowledgement state but makes them inactive. Removing a profile clears it from future Default agent selection and mention lookup without rewriting historical runs or comment bodies.

## Agents Settings Ownership

Every control in this feature lives inside the Agents settings tab:

- master Agents enablement;
- built-in runtime status;
- Default agent selection;
- OpenCode connection and refresh;
- discoverable and imported OpenCode profiles;
- mention editing, removal, and unavailable status;
- the one-time `--auto` acknowledgement;
- Agent sidebar visibility and existing agent-related preferences.

No agent picker, connection badge, setup prompt, or inactive placeholder is added to the editor, thread toolbar, sidebar toolbar, or general settings. The existing inline mention dropdown remains the only invocation affordance.

Disabling Agents immediately invalidates outstanding catalog refresh tokens, stops temporary discovery processes, cancels active agent runs, removes agent candidates from mention suggestions and actionable highlighting, disables agent-powered commands, and hides Agent sidebar surfaces. `@codex` and imported mentions remain ordinary text while disabled.

## Security and Permission Boundary

Aside never stores provider API keys, OAuth tokens, OpenCode auth data, model configuration, agent prompts, tool configuration, or permission rules. OpenCode owns those values and its normal storage paths.

Imported runs retain the existing non-interactive OpenCode contract with `--auto`. The settings acknowledgement states that this auto-approves operations that the selected OpenCode permissions do not explicitly deny. Aside does not weaken or rewrite explicit denies. The selected OpenCode agent's configuration is the safety boundary.

The executable remains the fixed `opencode` binary resolved through the existing login-shell environment. Users cannot configure an executable path, arbitrary arguments, environment variables, or response parser in this version. The exact OpenCode agent ID comes only from the structured local catalog and is passed as one child-process argument without a shell.

Catalog discovery binds only to loopback, makes no model prompt, performs no credential mutation, and is fully disposed after use. Diagnostic output is bounded and sanitized through existing runtime logging policy. Structured catalog errors never dump permission bodies, headers, credentials, or full local configuration into notices or logs.

## Failure Handling

- Missing OpenCode: show the existing actionable installation/PATH status; preserve imported profiles as unavailable.
- Catalog launch or protocol failure: keep the previous persisted profile set, show a bounded refresh error, and allow retry.
- Missing imported agent: preserve its profile, block new runs with an actionable refresh/remap message, and keep history readable.
- Mention conflict: reject the edit before persistence and identify the conflicting action.
- Default profile unavailable: use the existing explicit fallback presentation; never silently rewrite the saved preference.
- OpenCode run failure: retain the current structured-error priority, retry action, and output-entry behavior.
- Agents disabled during discovery or execution: cancel the work, ignore late callbacks, and persist a cancelled rather than successful run state.
- Profile removed during an active run: let the resolved run finish under its captured profile snapshot; remove it only from future lookup and selection.

## Change-Surface Ownership

The implementation must collapse identity behavior into the new profile registry instead of teaching each current consumer about imported OpenCode agents separately.

Expected shared-owner changes include the current actor definition/registry, agent target normalization, settings planner, run normalization, and actionable-mention catalog. Existing built-in actor modules and executable runtime adapters remain thin definitions or transport adapters.

The following surfaces must consume the shared registry rather than add OpenCode-profile branches:

- agent directive parsing and conflict handling;
- mention suggestions and highlighting;
- Default agent options, diagnostics, fallback, and persisted selection;
- create-script, update-script, and PDF-to-Markdown default-agent routing;
- comment-agent dispatch, retry, cancellation, and run storage;
- sidebar Agent grouping, content filters, author labels, and render signatures;
- vault-script reserved action names;
- README and experimental feature documentation.

After implementation, a repeated search for `AsideAgentTarget`, static provider arrays, the hard-coded DeepSeek actor, and direct `@codex`/`@claude`/`@gemini`/`@deepseek` enumerations must leave only intentional migration fixtures, explicit transport tests, and documentation examples.

## Testing Strategy

Test-driven implementation begins with pure profile-registry and settings-migration tests. These tests establish dynamic identity before any UI or runtime changes and cover immutable snapshots, normalized mentions, generated IDs, built-in ordering, duplicate repair, reserved-name conflicts, availability, removal, and the legacy DeepSeek exception.

Catalog tests use fake OpenCode SDK/server modules. They prove loopback startup, vault-root location, structured `app.agents()` use, eligibility filtering, bounded field retention, cancellation, and complete cleanup without invoking a model. No test parses `opencode agent list` text.

Consumer tests replace hard-coded target unions with registry fixtures. Representative tracer tests prove one imported `@qwen` profile appears in suggestions, becomes actionable only while Agents are enabled, resolves case-insensitively, can be selected as Default agent, and retains the existing mixed-agent conflict behavior.

Runtime tests assert exact argv construction, including separate `--agent` and exact ID arguments, `--format json`, `--auto`, fresh-session omissions, and no shell. Existing OpenCode event, error, streaming, metadata, cancellation, empty-response, and nonzero-exit tests remain green. A controller tracer covers saved `@qwen` text through resolved profile, runtime invocation, run snapshot, and persisted reply.

Settings and view tests prove every new control is scoped to the Agents tab and that disabled Agents produce no catalog calls, runtime probes, mention candidates, agent commands, sidebar surface, or process starts. Toggling off during work proves cancellation and late-callback suppression.

Full verification runs repository tests, lint, typecheck, Obsidian compliance, production bundling, and the release artifact guard. The exact shippable set remains `main.js`, `manifest.json`, and `styles.css`; inspection rejects `main.js.map`, source-map markers, embedded sources, raw TypeScript/JSX-family files, secret-bearing files, and local-only artifacts.

The installed-vault smoke first verifies OpenCode discovery, explicit import, mention suggestion, Agents-off hiding, and settings persistence without a model request. A real `@qwen` run is a separate opt-in smoke because it spends provider credits and writes an Aside reply.

## Documentation

README agent setup will distinguish built-in direct agents from user-managed OpenCode profiles. It will show the OpenCode-side agent as the source of model, prompt, tool, credential, and permission configuration, followed by explicit import and `@mention` use in Aside.

The documentation will state that:

- adding another eligible OpenCode agent requires Refresh and explicit enablement, not an Aside code change;
- native third-party CLIs are not automatically supported;
- only visible primary-capable OpenCode agents can be imported;
- imported agents can be the Default agent;
- `--auto` makes explicit OpenCode denies the safety boundary;
- disabling Agents prevents all LLM discovery and execution while retaining dormant settings.

`EXPERIMENTAL_FEATURES.md` will describe dynamic reserved mentions rather than a permanently enumerated DeepSeek name. No release notes are required until this feature is included in an actual versioned release.
