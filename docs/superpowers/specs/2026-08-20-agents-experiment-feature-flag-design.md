# Agents Experiment Feature Flag Design

**Date:** 2026-08-20
**Status:** Implemented and repository-verified; installed acceptance pending

## Implementation Tracking

### Approved

- [x] Treat Agents as one experimental product surface rather than a settings-only preference.
- [x] Keep the experiment disabled by default and enable it only per vault.
- [x] Reuse Publishing's vault-scoped local-storage-to-plugin-data synchronization semantics.
- [x] Enable the experiment in the `lean-startup` vault for frontend acceptance testing.

### To Implement

- [x] Add the canonical `agents` feature flag with a default value of `false`.
- [x] Generalize the publish-only storage synchronizer so every declared feature flag uses `aside.feature.<flag>.<vault name>`.
- [x] Synchronize all declared feature flags after settings load and before UI registration.
- [x] Label the settings group **Agents (experimental)** and hide it while the flag is disabled.
- [x] Hide **Show agent tab** and the Agent sidebar tab while the flag is disabled.
- [x] Remove agent mentions and `/create-script` from suggestions and draft guidance while preserving `@todo` and vault-script suggestions.
- [x] Fail closed before agent diagnostics or runtime selection when a disabled agent directive, create-script command, or regenerate action is invoked.
- [x] Preserve stored agent preferences, existing agent runs, and existing agent-authored comments while the experiment is disabled.
- [ ] Enable `aside.feature.agents.lean-startup` through the same local-storage override used by Publishing and reload the installed plugin.

### Verification

- [x] Feature-flag normalization and storage synchronization tests cover both `publish` and `agents`.
- [x] Settings tests prove both Agents rows and the Agents group follow the flag.
- [x] Suggestion and draft-presentation tests prove disabled mode exposes no agent/create-script affordance.
- [x] Agent and create-script controller tests prove disabled mode performs no diagnostics or runtime launch.
- [x] Sidebar tests prove the Agent tab cannot appear or remain selected while the flag is disabled.
- [x] Existing Publishing behavior and storage keys remain unchanged.
- [x] The full test, typecheck, lint, compliance, build, and release-artifact checks pass.
- [ ] The installed `lean-startup` build has the Agents flag enabled and shipped assets match the verified build.

## Repository Verification

Verified on 2026-08-21:

- Focused cross-surface verification: 144 tests passed, 0 failed.
- Complete suite: 1,165 compiled tests and 95 contract tests passed, 0 failed.
- `npm run build`: tests, lint, typecheck, Obsidian compliance, production bundle, and release-artifact inspection all exited zero.
- Public artifact inspection passed for exactly `main.js`, `manifest.json`, and `styles.css`, with no source map, `sourceMappingURL`, `sourcesContent`, raw TypeScript/JSX-family source, local path, or secret-bearing file exposure.
- SHA-256: `main.js` `d7e4af36e4f6f11231b7967479eed6fe256ea7c6aea59489f1cbccd52fec4dff`; `manifest.json` `4f192021a6dd3bf8f90ed8486eb342f1e7524863faedb9c5f8924c253bf54528`; `styles.css` `f8177522020c0d3108e15c8d8d91b96927d0bddec99a526eda700a8088ebb425`.

## Context

Aside's Publishing experiment is hidden and rejected at runtime unless its vault-scoped feature flag is enabled. The new agent-backed `/create-script` workflow and its default-agent setting currently ship without an equivalent experiment boundary. That exposes agent settings, suggestions, runtime probing, and the Agent sidebar tab in every vault.

Agents must use the same product policy as Publishing: default off, explicitly enabled per vault, persisted in plugin data, and controllable through a vault-scoped local-storage key. The `lean-startup` vault is the acceptance-test vault and must have the experiment enabled.

## Goals

- Make Agents a complete, fail-closed experimental surface.
- Keep one canonical feature-flag registry and one storage synchronization implementation.
- Avoid agent availability probes and process launches when the experiment is off.
- Preserve non-agent features, especially `@todo`, `/script-name`, and ordinary side notes.
- Preserve existing agent data so re-enabling the experiment restores access without migration or loss.

## Non-Goals

- Deleting or rewriting existing agent runs, replies, or default-agent preferences.
- Disabling ordinary vault scripts or the `@todo` workflow.
- Adding a user-facing feature-flag toggle to Aside settings.
- Changing agent priority, availability fallback, prompt policy, or runtime adapters.
- Automatically enabling Agents in vaults other than `lean-startup`.

## User Experience

### Disabled by default

With the `agents` flag off:

- **Agents (experimental)** is absent from Aside settings.
- **Show agent tab** is absent from **Sidebar tabs**.
- The Agent tab is not rendered, even if `showAgentSidebarTab` was previously saved as `true` or existing agent replies are present.
- Mention suggestions include `@todo` and registered `/script-name` entries, but exclude `@codex`, `@claude`, `@gemini`, and `/create-script`.
- Draft placeholder/help text does not advertise agent directives or `/create-script`.
- Manually entered agent directives and `/create-script` remain saved as user text but do not probe runtimes or launch processes. Aside shows the concise notice `Agents experiment is disabled.`
- Regenerate on an existing agent reply returns the same notice and launches nothing.

Existing agent-authored comments remain visible in ordinary comment lists. The feature flag controls interaction and the dedicated Agent view; it does not delete user data.

### Enabled per vault

With the flag on, the current Agents behavior is unchanged. Settings show **Agents (experimental)**, the default-agent choices and statuses probe in their existing order, **Show agent tab** is available, mention suggestions advertise all supported agents and `/create-script`, and agent/create-script dispatch continues to use the current selection and fallback policies.

The local-storage key for `lean-startup` is:

```text
aside.feature.agents.lean-startup
```

Only the exact string values `"true"` and `"false"` request a persisted change. Missing or invalid values preserve plugin data and are overwritten with the canonical persisted value, matching Publishing.

## Architecture

### Canonical flag registry

`src/core/config/featureFlags.ts` remains the source of truth. It declares `publish` and `agents`, defaults both to `false`, normalizes unknown persisted input, drops unknown flags, and supplies the shared `isFeatureFlagEnabled` query.

### Generic vault-scoped synchronization

`src/core/config/featureFlagStorageSync.ts` becomes flag-agnostic:

```ts
getFeatureFlagStorageKey(flag, vaultName)
syncFeatureFlagStorage({ flag, storage, storageKey, ... })
```

The storage key format is `aside.feature.<flag>.<vault name>`. Startup iterates the canonical flag registry after loading settings and before registering plugin UI. Each flag is synchronized independently. A valid override updates the complete feature-flag object through the existing queued settings persistence path; failed persistence restores the prior canonical object and mirrors the restored value.

The existing Publishing key and semantics remain byte-for-byte compatible. Publish-specific wrappers are unnecessary once all internal callers and tests use the generic API.

### Shared availability boundary

Aside exposes `isAgentsFeatureAvailable()` as the runtime query over the canonical settings object. Thin adapters consume it at the nearest stable boundaries:

- settings catalog visibility;
- mention suggestion and draft-presentation builders;
- sidebar tab visibility and mode fallback;
- `CreateScriptCommandController` before command parsing triggers any dispatch;
- `CommentAgentController` before explicit-agent dispatch or retry diagnostics.

The UI adapters receive a boolean capability; pure builders do not import the plugin or persisted settings. Runtime controllers receive a host callback so tests can prove that disabled requests never call diagnostic or launch dependencies.

### Disabled manual input

The command and agent controllers recognize whether the saved text targets the disabled experiment. They return without runtime selection and issue one concise notice. `/create-script` continues to count as handled so it cannot fall through to a physical vault script. An ordinary side note and a registered `/script-name` continue through their existing routes.

The disabled check also runs at retry time. This closes stale UI entry points and ensures programmatic calls cannot bypass the flag.

### Existing data

Feature disablement does not alter `defaultAgent`, `showAgentSidebarTab`, run-store records, or comment entries. When the flag is re-enabled, the prior preference and saved data are available. Sidebar mode resolution falls back from `agent` to `list` while disabled without rewriting stored user preference.

## Error Handling

- Local storage unavailable or unreadable: preserve persisted flags and continue startup.
- Invalid local-storage value: preserve the persisted flag and mirror its canonical value.
- Persistence failure: restore the previous complete flag object, report the operation through existing logging, and mirror the restored value.
- Disabled explicit agent, `/create-script`, or Regenerate: show `Agents experiment is disabled.`, perform no diagnostics, and launch no process.
- Existing unknown feature-flag keys: discard during normalization and rewrite canonical settings through the existing migration path.

## Testing Strategy

Tests follow red-green-refactor slices:

1. Extend pure flag normalization and generic storage-key/sync tests for `agents` while retaining Publishing assertions.
2. Add settings-catalog tests for the Agents section and **Show agent tab** visibility.
3. Add suggestion and draft-presentation tests with the capability disabled and enabled.
4. Add controller tests that assert the disabled path handles only targeted directives and never reaches diagnostics, dispatch, or retry selection.
5. Add sidebar-mode tests that force Agent visibility and selection off when the capability is false.
6. Run the complete project verification gate, build exact release assets, inspect them for source exposure, install them into `lean-startup`, enable the vault-scoped override, reload Aside, and compare installed assets byte-for-byte.
