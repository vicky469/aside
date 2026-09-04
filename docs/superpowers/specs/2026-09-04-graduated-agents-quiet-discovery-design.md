# Graduated Agents and Quiet Discovery Design

**Date:** 2026-09-04
**Status:** Approved for implementation planning

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code or documentation change is complete and the listed verification passes.

### Already Done

- [x] Direct vault-script commands are discovered only from eligible direct children of `🛠️ scripts/`.
- [x] Agent work starts only after a user saves a side note containing an agent mention or a built-in agent command.
- [x] The sidebar already has a persisted **Show agent tab** visibility setting.
- [x] The user approved graduating agents from the feature flag while keeping discovery quiet.

### To Implement

- [ ] Remove the `agents` feature flag, its disabled policy, and every availability adapter and branch.
- [ ] Keep **Show agent tab** as a visible setting, default it off for new or missing settings, and preserve explicit existing values.
- [ ] Replace the new-side-note placeholder with the neutral text `add a comment`.
- [ ] Preserve the existing `@` and `/` inline dropdown, filtering, and autocomplete while removing its agent-feature availability input.
- [ ] Lazily create `🛠️ scripts/` for a valid `/create-script` request before dispatching its agent run.
- [ ] Change the Aside workspace view display text, and therefore its tab-icon hover label, from `Side notes` to `Aside`.
- [ ] Move scripts into normal user documentation and document their local execution security boundary.
- [ ] Update focused and full regression coverage.

## Context

Aside currently places local agents behind an `agents` feature flag even though vault-script execution is already usable independently. The split creates dead states throughout mention parsing, command routing, settings, sidebar tabs, and runtime diagnostics. It also makes a standard workflow look experimental and requires users to know a hidden activation mechanism.

Graduating the feature must not turn Aside into an agent-first interface. People who never use agents should continue to see a calm side-note experience. People who do use them should be able to discover them naturally by typing `@` or `/`, choose a default local agent, and optionally expose the Agent sidebar tab.

The workspace tab currently uses `Side notes` as its display text while the manifest and ribbon use the product name. This makes the same Aside icon show inconsistent hover copy.

## Goals

- Make every supported local agent and built-in agent command available without a hidden feature flag.
- Preserve explicit invocation: enabling the plugin alone must not start, probe, or run an agent.
- Keep the default side-note surface free of agent advertising.
- Retain **Show agent tab** as the only control for Agent-tab visibility and default it off.
- Make `/create-script` work without requiring users to create its folder manually.
- Give the Aside workspace icon the consistent hover label `Aside`.
- Make scripts visible in normal documentation without understating their local-code execution risk.

## Non-Goals

- Bundling Codex, Claude, Cursor, Gemini, OpenCode, Node, or any other agent runtime.
- Starting agents automatically, probing all agents during plugin startup, or showing an agent onboarding interruption.
- Hiding or removing the **Show agent tab** setting.
- Automatically showing the Agent tab after an agent run.
- Creating `🛠️ scripts/` during plugin startup or for users who never invoke `/create-script`.
- Executing a script merely because `/create-script` created it.
- Sandboxing arbitrary vault scripts inside the plugin.
- Changing the separate experimental publishing flag.

## Selected Approach

Remove the agent feature flag completely instead of forcing it on or replacing it with another scripts flag. The `publish` flag remains the only feature flag. Agent controllers, mention policy, settings, and sidebar code should express their real conditions directly: an explicit supported directive, an available local runtime, and the persisted Agent-tab visibility preference.

Discovery remains quiet:

```text
Normal use
→ add a comment
→ no Agent tab by default
→ no agent process or startup prompt

Intentional agent use
→ type @ or /
→ see supported agents, built-in commands, and eligible vault scripts
→ save the side note to start the selected action
```

This avoids dormant always-true adapters and makes the enabled behavior easier to reason about than retaining a hidden compatibility flag.

## Feature-Flag and Settings Model

`FeatureFlag`, `FEATURE_FLAG_KEYS`, `FeatureFlags`, default settings, normalization, and storage synchronization retain only `publish`. Loaded plugin data containing a legacy `featureFlags.agents` property is normalized to the supported shape and rewritten through the existing settings migration path. A stale browser-local agent feature key, if one exists from an older build, is ignored and has no effect; permanent cleanup code is not added solely to delete an inert external key.

Remove `isAgentsFeatureAvailable`, `agentsFeatureAvailable`, and the `Agents experiment is disabled` notice from production interfaces. Do not replace them with constants returning `true`.

The persisted `showAgentSidebarTab` setting remains. Its behavior is:

- explicit `true` remains `true`;
- explicit `false` remains `false`;
- a missing or invalid value normalizes to `false`; and
- the normalized value is persisted by the existing rewrite mechanism when needed.

The **Show agent tab** control remains visible under Settings → Sidebar tabs and controls visibility only. The Scripts settings group and default-agent control are no longer feature-gated. Hiding the Agent tab while it is selected resolves the active sidebar mode back to List, as it does today.

## Editor and Sidebar Experience

The empty new-side-note editor uses exactly:

```text
add a comment
```

It does not enumerate formatting, todo, script, or agent commands. This is the default experience for both existing and new users.

Typing `@` already opens the inline agent and todo dropdown. Typing `/` already opens the inline built-in command and eligible vault-script dropdown. Continued typing filters the open dropdown, and click, Enter, or Tab autocompletes the selected item. This existing interaction remains unchanged. Directly typed supported mentions remain actionable even if the suggestion menu was not used. The mention/action policy no longer accepts an agent-feature availability argument.

The Agent tab appears only when **Show agent tab** is on. Agent commands and replies continue to work when the tab is hidden; the tab is a filter/view preference, not a capability switch. Aside must not automatically change this preference after an agent run.

## Lazy Script-Folder Creation

The shared vault-script policy remains the single owner of the exact `🛠️ scripts` folder path and eligible file rules. Folder creation occurs only after a saved `/create-script` entry has passed directive validation and conflict checks, and immediately before its request is dispatched.

The create-script controller asks its host to ensure the folder:

1. If the exact path already resolves to a folder, continue without writing.
2. If the path is missing, create it with the Obsidian Vault API.
3. If concurrent work creates it first, re-read the path after the create call fails and continue when it is now a folder.
4. If a file occupies that path or creation still fails, append a visible, persistent reply explaining that Aside could not create `🛠️ scripts/`, then stop without dispatching the agent.

The platform-specific Vault API operation belongs in the main-plugin adapter; command validation and sequencing remain in the testable create-script controller. Creation is idempotent and does not delete, rename, or overwrite anything.

Successful folder creation does not execute a generated script. A generated script becomes runnable only through a later explicit `/script-name` side note after the script registry observes the new file.

## Agent Runtime Behavior

Supported direct mentions and `/create-script`, `/update-script`, and `/pdf-to-markdown` always reach their existing runtime-selection path. Runtime selection still checks the platform, filesystem-backed vault, configured default agent, and local CLI diagnostics. Existing visible reply-card failure behavior remains authoritative when a runtime is unavailable or returns an error.

Removing the flag must not add runtime work at plugin startup. Runtime diagnostics may run when needed for an explicit agent request or when the user opens the Scripts settings that display availability. No local agent CLI is bundled.

## Workspace Label Consistency

The Aside view keeps its existing icon and view type. `AsideView.getDisplayText()` returns exactly `Aside`, which controls the workspace tab label and the hover label for the icon shown in `.workspace-tab-header-inner-icon`. The manifest name remains `Aside`, and the existing ribbon tooltip remains `Open Aside` because it describes an action rather than the view name.

Internal copy that correctly describes the user's side notes is not globally renamed. This change targets product/view identification only.

## Documentation and Security

Normal user documentation presents local agents and vault scripts as supported desktop features rather than experimental features. The README links to a focused scripts guide covering:

- supported agents and the local CLI requirement;
- the `@agent`, `/create-script`, `/update-script`, `/pdf-to-markdown`, and `/script-name` workflows;
- the default-agent and **Show agent tab** settings;
- automatic creation of `🛠️ scripts/` on `/create-script`;
- script naming, collision, and discovery rules; and
- regenerate behavior.

Move the existing Vault Scripts material out of `EXPERIMENTAL_FEATURES.md`; that document continues to describe only still-experimental publishing behavior.

The guide must state prominently that vault scripts are not sandboxed. They execute through local Node with the user's account permissions, inherited environment, vault-root working directory, and current note path. Users should review and trust a script before invoking it. Documentation, examples, fixtures, logs, and screenshots must use placeholders and must not expose personal vault paths, usernames, secrets, tokens, or other private information.

## Error Handling

- Invalid or mixed directives retain their current persistent reply behavior.
- Missing local runtimes retain the supported-agent failure card and captured diagnostic message when available, with the existing generic fallback otherwise.
- Failure to create the scripts folder produces one persistent reply and no agent run.
- A path collision is never resolved destructively; Aside reports it and leaves the existing file untouched.
- Legacy agent feature values cannot disable an otherwise supported directive.
- Hiding the Agent tab never cancels, deletes, or hides persisted agent replies from the normal List view.

## Testing Strategy

Implementation follows test-first slices:

1. Prove the feature-flag model contains only `publish` and legacy agent properties normalize away.
2. Prove the Agent tab defaults off for missing or invalid settings while explicit values survive loading.
3. Prove Scripts settings remain visible and sidebar Agent-tab visibility depends only on `showAgentSidebarTab`.
4. Prove built-in agent mentions and commands are actionable without any availability input.
5. Prove the neutral placeholder and trigger-specific suggestion lists.
6. Prove `/create-script` handles an existing folder, missing folder, concurrent creation, path collision, and creation failure before dispatch.
7. Prove direct agent and built-in command controllers contain no feature-disabled branch and preserve runtime failures.
8. Prove the Aside view display text is exactly `Aside` while the ribbon action remains `Open Aside`.
9. Prove the README and scripts guide expose the graduated workflow and the non-sandboxed execution warning, while experimental docs no longer classify scripts as experimental.

Repository verification runs focused tests, the full test suite, lint, typecheck, Obsidian compliance, production build, bundle-size guard, and release-artifact security inspection. Any live installation or release remains a separate explicitly authorized step.

## Acceptance Criteria

- No production reference remains to `FeatureFlag.agents`, `isAgentsFeatureAvailable`, `agentsFeatureAvailable`, or the agents-experiment-disabled notice.
- Supported `@agent` mentions and built-in agent commands work without localStorage activation.
- New and migrated users with no explicit Agent-tab preference do not see the Agent tab.
- Users can always find and change **Show agent tab** in settings, and explicit existing preferences are preserved.
- The empty editor says `add a comment`; agent and script choices appear after `@` or `/`.
- A valid `/create-script` request creates `🛠️ scripts/` when missing and dispatches exactly once.
- Folder conflicts and creation errors produce one visible reply and never overwrite an existing path.
- The Aside workspace icon hover label says `Aside`.
- Normal documentation explains the supported workflows and their security boundary without private information.
- Full verification passes without exceeding the existing production bundle-size limit.
