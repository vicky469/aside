# Debug Log Inspector Spec

## Summary

Add a simple debug mode for Aside:

- A single settings toggle controls whether debug UI is visible.
- When debug mode is on, the sidebar shows the bottom-right log button.
- Clicking the button opens the log inspector with the current log already loaded.
- The inspector shows the log location.
- Agent/tool error payloads are written to logs, not shown in comment cards.

The feature should be small, but the implementation should keep boundaries clean. Reuse existing code where it fits. Refactor only where reuse creates awkward coupling.

## Goals

- Make debugging available inside Obsidian without copy-pasting JSONL.
- Keep normal comment UI clean for non-debug users.
- Preserve enough error detail in persistent logs to diagnose failed agent/tool runs.
- Use one source of truth for debug visibility: `settings.enableDebugMode`.
- Keep the log inspector useful as the codebase grows.

## Non-goals

- No remote upload.
- No new support-report workflow.
- No separate feature flag for the floating button.
- No agent error payloads in comment card UI.
- No speculative framework or large debug subsystem.

## Core UX

### Setting

Add a persisted setting:

```ts
enableDebugMode: boolean
```

Default: `false`.

Settings UI:

- Name: `Debug mode`
- Description: `Show the floating log inspector button and developer diagnostics.`

Changing this setting should refresh the sidebar so the button appears or disappears immediately.

### Sidebar button

When `settings.enableDebugMode === true`:

- Show the existing bottom-right circular log button.
- Label: `Open log inspector`.
- Click opens the log inspector.

When `settings.enableDebugMode === false`:

- Do not show the button.
- Do not reserve space for the button.
- Do not treat it as a draft scroll obstruction.

Debug mode is the only visibility switch. Do not add another button-specific flag.

### Log inspector

Opening the log inspector from the sidebar should automatically load the current Aside log.

The modal should show:

- Current log file name.
- Log location.
- Parsed log rows from the current log.
- Existing summary badges and filters.
- Existing paste/drop input as an optional override.

The default state should not be an empty paste box when a current log exists.

If no current log file exists:

- Show a clear empty state: `No current log file yet.`
- Still show the expected log location if available.

If reading the log fails:

- Show a short failure message in the modal.
- Log `support.log.read.error`.
- Do not crash or close the sidebar.

### Log location

The inspector should show the log path directly.

Minimum:

```text
Location: .obsidian/plugins/aside/logs/YYYY-MM-DD.jsonl
```

On desktop, if a full filesystem path can be resolved, also show:

```text
Full path: /Users/.../Vault/.obsidian/plugins/aside/logs/YYYY-MM-DD.jsonl
```

Keep the existing `Locate log` button when Electron shell support exists.

## Agent error policy

### Comment UI

Do not show agent/tool error payloads in comment cards.

Remove or avoid:

- Red error payload blocks under agent replies.
- Error payloads in visible metadata.
- Error details in hover titles.

Keep:

- Compact run status marker.
- Terse metadata after completed replies:
  - `Skills: ...`
  - `Tools: WebSearch (unavailable)`
  - `URLs:`

### Logs

Persistent logs are where detailed failures belong.

When an agent run fails, log:

- Event: `agents.run.failed`
- Level: `warn` or `error`
- Payload:
  - `runId`
  - `threadId`
  - `requestedAgent`
  - `runtime`
  - `outputEntryId`
  - sanitized error message
  - partial reply text if present

When a tool returns an error payload, log:

- Event: `agents.tool.error`
- Level: `warn`
- Payload:
  - `runId`
  - `threadId`
  - `requestedAgent`
  - `toolName`
  - sanitized payload

The log sanitizer remains mandatory.

## Clean boundary design

Use these boundaries:

```text
AsideSettings
  owns enableDebugMode

AsideView
  decides whether to render the debug button

sidebarSupportButton
  renders the existing button when asked

AsideLogService
  owns current log path, current log content, and log writes

SupportLogInspectorModal
  displays a provided log source and optional location
  keeps paste/drop as an override source

CommentAgentController
  logs agent/tool failures
  stores run metadata
  does not render UI

sidebarPersistedComment
  renders terse metadata only
```

## Reuse and refactor policy

Prefer reuse for:

- Existing floating button styling.
- Existing `SupportLogInspectorModal`.
- Existing log parser/filter table.
- Existing `AsideLogService`.
- Existing log location actions.

Do not force reuse if it makes code worse.

If the current modal is too paste-input-centered, refactor it into a cleaner source model:

```ts
type LogInspectorSource = {
  fileName: string;
  content: string;
  relativePath?: string;
  fullPath?: string;
  emptyMessage?: string;
};
```

The modal should accept an initial source, render it immediately, and still allow pasted/dropped content to override it.

This is an acceptable refactor because it creates a stable boundary:

- The modal displays log sources.
- The plugin/log service provides log sources.
- The modal does not know how to find current logs.

Do not create a larger abstraction unless the implementation proves it is needed.

## Data model

Keep existing run metadata:

```ts
usedTools?: string[];
usedToolErrors?: Array<{
  name: string;
  payload: string;
}>;
```

`usedToolErrors` may remain persisted for diagnostic continuity.

`mergeAgentRunMetadata` may continue deriving unavailable tool labels:

```text
WebSearch -> WebSearch (unavailable)
```

Persisted error payloads should not imply visible UI payloads.

## Implementation steps

1. Settings
   - Add `enableDebugMode` to `AsideSettings`.
   - Default to `false`.
   - Preserve it in persisted data.
   - Add a settings toggle.
   - Refresh sidebar after changes.

2. Sidebar button
   - At the existing render call site, check `settings.enableDebugMode`.
   - Render existing button only when true.
   - Avoid creating or leaving an empty obstruction slot when false.

3. Log source loading
   - Add the smallest `AsideLogService` helper needed to expose current log path.
   - Use existing current-log attachment/content loading.
   - Resolve full path only where desktop filesystem support exists.

4. Log inspector
   - Change modal entry path so current log source is passed in.
   - Render current source by default.
   - Show location metadata.
   - Keep paste/drop as override.

5. Agent/tool logging
   - Log tool error payloads when metadata includes `usedToolErrors`.
   - Log failed run details in `agents.run.failed`.
   - Avoid duplicate tool-error logs for the same run/tool/payload.

6. Comment UI cleanup
   - Remove visible failure payload rendering.
   - Remove error text/title exposure.
   - Keep terse metadata and compact status marker.

## Acceptance criteria

- Debug mode defaults off.
- With debug mode off, the sidebar does not show the bottom-right log button.
- With debug mode on, the sidebar shows the bottom-right log button.
- Toggling debug mode updates the sidebar without restarting Obsidian.
- Clicking the button opens the log inspector.
- The inspector automatically displays current log rows when a log exists.
- The inspector shows log location.
- The inspector still supports pasted/dropped log content.
- Agent/tool error payloads are absent from comment cards.
- Tool failure metadata can still show `Tools: WebSearch (unavailable)`.
- Agent run failures are present in persistent logs.
- Tool error payloads are present in persistent logs.
- Existing log sanitization is applied.

## Test plan

- Settings normalization preserves `enableDebugMode`.
- Settings toggle persists `enableDebugMode`.
- Sidebar button is absent when debug mode is false.
- Sidebar button is present when debug mode is true.
- Sidebar rerenders after toggling debug mode.
- Log inspector receives current log content by default.
- Log inspector shows relative log path.
- Log inspector shows full path when available.
- Missing current log shows empty state and expected location.
- Failed log read logs `support.log.read.error`.
- Agent run failure logs include failure details.
- Tool error logs include tool name and payload.
- Comment card visible metadata excludes error payload blocks.
- Build, tests, lint, and typecheck pass.
