# Sidebar Category Visibility Spec

## Status

Draft implementation spec for [GitHub issue #3](https://github.com/vicky469/aside/issues/3): users who do not use Todo or agent workflows want settings toggles that turn those sidebar tabs off so Aside remains usable in a narrow right sidebar.

## Problem

Aside currently renders primary sidebar tabs such as `Todo` and `Agent` as part of the mode control. Even when those modes are unavailable because the current file has no matching threads, disabled tabs still consume horizontal space. That is painful for users who intentionally keep a narrow sidebar and do not use AI agent features.

The feature request is not asking to remove Todo or agent behavior from Aside. It asks for top-level settings toggles that default on so users can discover those features, while still letting users turn the Todo and Agent sidebar tabs off when they do not need them.

## Objective

Add user-configurable top-level settings for optional sidebar tabs:

- `Todo`
- `Agent`

Defaults must preserve existing behavior: both tabs are shown until the user turns a setting off.

## Scope

In scope:

- settings model with explicit Todo and Agent sidebar-tab toggles
- settings UI toggles for Todo and Agent tabs
- mode control rendering that omits turned-off tabs instead of rendering disabled tabs
- safe fallback to `List` when a turned-off tab is currently active
- normal note sidebar coverage for both settings
- index sidebar coverage for both settings
- tests for settings normalization, mode visibility, fallback behavior, and narrow-toolbar regressions

Out of scope:

- disabling `@todo` parsing or Todo indexing
- disabling `@codex` or `@claude` agent dispatch
- disabling agent runtime dispatch or diagnostics globally
- changing the draft editor placeholder text
- redesigning the whole sidebar toolbar
- adding per-vault, per-file, or per-workspace tab visibility

## Product Rules

### Rule 1: Top-Level Settings Are The Source Of Truth

Aside settings must expose two top-level on/off toggles:

- Todo sidebar tab
- Agent sidebar tab

Those setting values determine whether the corresponding tabs are rendered in both the normal note sidebar and the index sidebar.

Turning a setting off removes the dedicated sidebar tab. It must not change the stored thread data, tag extraction, Todo detection, agent-run persistence, or agent dispatch rules.

If a user turns off the Agent sidebar tab and later writes a side note with `@codex`, the agent workflow should still behave according to existing agent rules. The setting only affects whether the dedicated Agent tab is shown.

### Rule 2: Defaults Preserve Existing Users

Existing users must see no change after upgrading:

- Todo sidebar tab on by default
- Agent sidebar tab on by default

Missing settings must normalize to that default.

### Rule 3: Turned-Off Tabs Are Removed, Not Disabled

When a tab setting is off, the mode control must omit that tab completely. It should not leave a disabled, empty, or placeholder tab behind.

This is the key narrow-sidebar behavior: turned-off tabs reclaim width.

### Rule 4: Availability Still Applies To Turned-On Tabs

Tab settings and content availability are separate axes.

For example:

- Todo tab setting on + no Todo threads -> keep existing unavailable/disabled behavior
- Todo tab setting off + Todo threads exist -> do not show the Todo tab
- Agent tab setting on + no agent threads -> keep existing unavailable/disabled behavior
- Agent tab setting off + agent threads exist -> do not show the Agent tab

### Rule 5: Active Turned-Off Modes Fall Back To List

If a persisted view state or current in-memory state points at a turned-off mode, Aside must render `List` instead.

This must apply when:

- settings are loaded
- settings are changed while a sidebar is open
- a sidebar restores `noteSidebarMode` or `indexSidebarMode` from `CustomViewState`

The fallback should not delete comments, clear drafts, or lose search text beyond the mode-specific behavior that already exists when switching back to `List`.

## Recommended UX

Add a settings section:

```text
Sidebar tabs
```

Settings:

- `Show todo tab`
  - description: `Show the todo sidebar tab for @todo side notes.`
  - default: on
- `Show agent tab`
  - description: `Show the agent sidebar tab for local agent replies.`
  - default: on
  - when on, show the agent runtime status on the next line under this setting
  - when off, do not render the runtime status or probe agent runtimes

Use Obsidian `Setting.addToggle` controls. The labels should be positive because the default state is visible and easier to understand as "show this tab."

Changing either toggle should save immediately and refresh open Aside sidebars.

The agent runtime status should not have its own `Agent runtime` heading after this merge. The status belongs to the `Show agent tab` setting because the runtime status only matters when the Agent tab is visible. Keep provider states such as `@codex` and `@claude` together on the next line under the description, with a wider visible gap between providers so the row stays readable without becoming too tall.

## Settings Model

Use explicit boolean settings in persisted plugin data:

```ts
interface AsideSettings {
  showTodoSidebarTab: boolean;
  showAgentSidebarTab: boolean;
}
```

Normalization rules:

- missing `showTodoSidebarTab` -> `true`
- missing `showAgentSidebarTab` -> `true`
- non-boolean values normalize to `true` and mark settings for rewrite
- settings should be saved with explicit booleans after normalization

Rationale:

- the product UI is two top-level toggles
- each setting has one obvious meaning
- future optional tabs can add their own explicit setting if they become user-facing

## Rendering Model

Keep the existing distinction between:

- mode visibility: whether a tab should be rendered
- mode availability: whether a rendered tab can be selected

Recommended helper shape:

```ts
type SidebarModeVisibility = {
  showTodoSidebarTab: boolean;
  showAgentSidebarTab: boolean;
};
```

`getSidebarModeTabs(...)` and `getSidebarModeTabGroups(...)` should filter optional modes by these booleans before rendering. `isSidebarModeAvailable(...)` should continue to answer availability for modes that are visible.

Do not encode turned-off tabs as `isTodoEnabled = false` or `isAgentEnabled = false`; that would keep the tab in the tab model and confuse visibility with content availability.

The same visibility settings must be applied to:

- note sidebar mode tabs
- index sidebar mode tabs

## Fallback Model

Add a reusable resolver for sidebar modes:

```ts
function resolveModeWithSidebarModeVisibility(
  mode: SidebarPrimaryMode,
  visibility: SidebarModeVisibility,
): SidebarPrimaryMode
```

Rules:

- `todo` + `showTodoSidebarTab === false` -> `list`
- `agent` + `showAgentSidebarTab === false` -> `list`
- all other modes unchanged

Apply this alongside the existing thought-trail availability fallback so a turned-off or unavailable mode never becomes the rendered mode.

## Implementation Notes

Likely modules:

- `src/ui/settings/AsideSetting.ts`
  - add the settings section and toggles
  - reflect current values from `plugin.settings.showTodoSidebarTab` and `plugin.settings.showAgentSidebarTab`
  - render and refresh agent runtime status only when `showAgentSidebarTab` is `true`
- `src/settings/indexNoteSettingsPlanner.ts`
  - normalize `showTodoSidebarTab` and `showAgentSidebarTab`
  - mark invalid persisted values for rewrite
- `src/settings/indexNoteSettingsController.ts`
  - add setters such as `setShowTodoSidebarTab(visible)` and `setShowAgentSidebarTab(visible)`
  - save and refresh sidebars
- `src/main.ts`
  - expose the setters for settings UI
- `src/ui/views/sidebarModeTabs.ts`
  - add optional-mode visibility filtering from the two booleans
  - keep availability logic separate
- `src/ui/views/AsideView.ts`
  - pass sidebar-tab settings into mode rendering
  - resolve turned-off active modes back to `List`
- `src/ui/views/viewState.ts`
  - keep persisted mode values backward-compatible; do not remove `todo` or `agent` from `SidebarPrimaryMode`

## Acceptance Criteria

1. A fresh install shows the same Todo and Agent tabs as today.
2. Turning off `Show todo tab` removes the Todo tab from both the note sidebar and index sidebar mode controls.
3. Turning off `Show agent tab` removes the Agent tab from both the note sidebar and index sidebar mode controls.
4. Turned-off tabs do not occupy toolbar width as disabled tabs.
5. Existing Todo side notes remain visible in `List` after the Todo tab is turned off.
6. Existing agent threads remain visible in `List` after the Agent tab is turned off.
7. If a turned-off tab was the active mode, the sidebar renders `List`.
8. Restored view state containing `todo` or `agent` falls back to `List` when that tab is turned off.
9. Invalid persisted sidebar-tab toggle values are normalized and rewritten.
10. The settings tab does not render the agent runtime status or probe runtimes while `Show agent tab` is off.
11. Narrow sidebar layout tests confirm the toolbar reclaims width when optional tabs are turned off.

## Testing Decisions

Add focused unit tests before implementation:

- settings normalization in `tests/indexNoteSettingsController.test.ts`
  - missing toggles default to `true`
  - invalid toggle values rewrite to `true`
  - valid `false` values persist
- mode tab behavior in `tests/sidebarModeTabs.test.ts`
  - `showTodoSidebarTab: false` omits Todo
  - `showAgentSidebarTab: false` omits Agent
  - settings apply to both note and index tab groups
  - visible-but-unavailable modes still behave as unavailable
- fallback behavior in a sidebar state or view helper test
  - turned-off active `todo` -> `list`
  - turned-off active `agent` -> `list`
- agent runtime settings behavior in `tests/agentRuntimeSettings.test.ts`
  - runtime status renders only when `showAgentSidebarTab` is `true`
- toolbar layout regression in `tests/sidebarToolbarLayout.test.mjs`
  - turned-off tabs are not represented by disabled tab elements

Manual verification:

- open a markdown note with no Todo or agent threads at a narrow right-sidebar width
- turn off Todo and Agent tabs
- confirm the primary toolbar fits better and no turned-off tab label remains
- create or open a note with `@todo` and agent threads
- confirm they remain visible in `List`

## Accessibility Requirements

- Settings toggles must have clear labels and descriptions.
- Removing a tab must not leave focus on a detached element.
- If a focused tab is removed after a settings change, focus should return to the mode control or sidebar container without trapping keyboard users.
- Remaining tabs must keep correct `role="tablist"` and `role="tab"` semantics.

## Release Notes

When implemented, mention this as a user-facing customization:

- Users can turn off Todo and Agent sidebar tabs from settings to keep narrow sidebars compact.

Do not describe it as disabling Todo or agents.
