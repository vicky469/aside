# Persistent Diagnostics Spec

## Status

Draft implementation spec based on:

- [persistent-diagnostics-plan.md](persistent-diagnostics-plan.md)

## Objective

Implement always-on local logging plus an in-product bug-report flow so that:

1. SideNote2 keeps a recent diagnostic trail on the user's machine.
2. The user does not need to enable a debug flag before reporting an issue.
3. The user can open a support form from the sidebar, review the attached log, and send the report from the same flow.
4. The user can attach screenshots to the same support report.
5. The logged data is useful for debugging without exposing raw note contents or absolute machine paths.

## Scope

In scope:

- always-on local log persistence
- 3-day automatic retention
- structured `.jsonl` records
- removal of the current debug setting and browser-localStorage debug flag
- support icon in the sidebar
- support form with:
  - email
  - title
  - content
  - attached current log file
  - optional screenshot attachments
- attachment preview before send
- log sanitization and path scrubbing
- tests for retention, sanitization, and support-form attachment behavior

Out of scope:

- full session replay
- automatic screenshot capture
- remote telemetry unrelated to user-initiated support reports
- raw note-body logging
- raw selected-text logging
- manual log-folder browsing as the primary user workflow

## Product Rules

### Rule 1: Logging Is Always On

SideNote2 writes local logs by default.
There is no user-facing debug toggle for enabling or disabling logging.

### Rule 2: Logs Stay Local Until The User Sends A Report

Logs live in the plugin folder inside the vault config directory.
They are not uploaded automatically.
They only leave the machine through an explicit user support submission flow.

### Rule 3: Retention Is Automatic

Logs older than 3 days are deleted automatically.
No manual `Clear logs` command is required.

### Rule 4: Logs Must Be Useful But Sanitized

Logs must capture high-signal checkpoints and errors, but must not store:

- full note bodies
- full comment bodies
- selected text content
- clipboard contents
- raw AGENTS.md contents
- absolute machine paths
- usernames embedded in local paths

### Rule 5: Support Flow Is In-Product

The normal user support path is the sidebar support icon plus the support form.
The user should not need to browse the plugin folder manually.

### Rule 6: Attachment Review Comes Before Send

The attached log must be visible in the support form and openable before send.
User-added screenshot attachments must also be visible before send.

## Storage Spec

### Log Location

Logs are stored under the plugin directory:

- `.obsidian/plugins/side-note2/logs/`

Recommended runtime path resolution:

1. use `manifest.dir` when available
2. otherwise fall back to `${app.vault.configDir}/plugins/${manifest.id}/logs`

### File Format

- newline-delimited JSON (`.jsonl`)

### File Naming

- one file per day
- example: `2026-04-13.jsonl`

### Retention

- keep only the latest 3 daily files
- prune on startup
- prune again before creating or appending to a daily log file

## Log Record Model

```ts
type LogLevel = "info" | "warn" | "error";

interface SideNote2LogEntry {
  at: string;
  level: LogLevel;
  area: string;
  event: string;
  pluginVersion: string;
  sessionId: string;
  payload?: Record<string, unknown>;
}
```

### Required Fields

- `at`
  ISO timestamp
- `level`
  `info | warn | error`
- `area`
  logical subsystem such as `startup`, `navigation`, `persistence`, `sidebar`, `index`, `support`, `agents`
- `event`
  stable event key
- `pluginVersion`
- `sessionId`

### Payload Rules

Payloads must be compact and scrubbed.

Allowed kinds of values:

- vault-relative file path
- comment id
- thread id
- booleans
- counts
- mode names
- word counts
- text lengths
- error name
- concise error message

Disallowed payload fields:

- `noteContent`
- `comment`
- `selectedText`
- `clipboardText`
- absolute file paths

### Path Hygiene

All logged file paths must be vault-relative when possible.

Examples:

- allowed:
  - `Folder/Note.md`
  - `.obsidian/plugins/side-note2/logs/2026-04-13.jsonl`
- disallowed:
  - `/Users/name/Vault/Folder/Note.md`
  - `C:\Users\name\Vault\Folder\Note.md`

Error stacks should be omitted by default or scrubbed before persistence.

## Required Event Coverage

### Startup

- `startup.load.begin`
- `startup.settings.loaded`
- `startup.layout.ready`
- `startup.sidebar.ready`
- `startup.unload`

### Draft / mutation

- `draft.selection.created`
- `draft.page.created`
- `draft.append.created`
- `draft.save.begin`
- `draft.save.success`
- `draft.save.error`
- `draft.edit.begin`
- `draft.edit.success`
- `thread.resolve`
- `thread.reopen`
- `thread.delete`
- `thread.reanchor.begin`
- `thread.reanchor.success`
- `thread.reanchor.error`

### Persistence

- `storage.note.parse.begin`
- `storage.note.parse.unsupported`
- `storage.note.write.begin`
- `storage.note.write.success`
- `storage.note.write.conflict`
- `index.refresh.begin`
- `index.refresh.success`
- `index.refresh.error`

### Navigation / sidebar

- `navigation.reveal.requested`
- `navigation.reveal.resolved`
- `navigation.reveal.fallback`
- `sidebar.focus.requested`
- `sidebar.draft.scrollIntoView`
- `index.filter.changed`
- `index.mode.changed`

### Support

- `support.form.opened`
- `support.log.attached`
- `support.log.preview.opened`
- `support.submit.begin`
- `support.submit.success`
- `support.submit.error`

## UI Spec

### Support Icon Visibility

Show a small support icon at the bottom-right of the sidebar only when the current surface is relevant to SideNote2-managed comments.

Visible when:

- the sidebar is showing a markdown note that has SideNote2-managed comments
- the sidebar is showing `SideNote2 index.md`

Hidden when:

- no supported file is selected
- the sidebar is on an unsupported file type
- the sidebar is empty and unrelated to SideNote2 content

### Support Form

Clicking the support icon opens a support modal.

Required fields:

- `Email`
- `Title`
- `Content`

Optional attachments:

- one auto-attached log file
- one or more user-added screenshots

Recommended validation:

- `Title` required
- `Content` required
- `Email` required

### Attachment Row

The form must auto-attach the current retained log file.
The form must also allow the user to add screenshot attachments.

The attachment row must show:

- file name
- size
- timestamp or date
- action to open / preview

The user must be able to open the attachment before sending.

Recommended screenshot constraints:

- common image types only, for example `png`, `jpg`, `jpeg`, `webp`
- maximum 3 screenshots
- maximum 5 MB per screenshot file

### Attachment Preview

Opening a log attachment should show a read-only log preview inside SideNote2.

Recommended behavior:

- modal or pane with monospaced text
- no edit controls
- safe for large files:
  - either full content for small files
  - or truncated preview with clear indication if large

Opening a screenshot attachment should show an image preview inside SideNote2.

Do not require the user to leave Obsidian or browse the raw plugin folder.

### Submit Flow

The support form has a `Send` action.

On send:

1. validate form fields
2. resolve current log attachment
3. resolve any user-added screenshot attachments
4. build support payload
5. send through the support transport
6. show success or failure notice

The log attachment used for send must be the same one shown in the form.
The screenshot attachments used for send must be the same files shown in the form.

## Support Payload Model

```ts
interface SupportLogAttachment {
  fileName: string;
  relativePath: string;
  sizeBytes: number;
  content: string;
}

interface SupportScreenshotAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
}

interface SupportReportPayload {
  email: string;
  title: string;
  content: string;
  pluginVersion: string;
  sessionId: string;
  logAttachment: SupportLogAttachment;
  screenshotAttachments: SupportScreenshotAttachment[];
}
```

The log attachment for send is the current day's retained log file only.

### Transport Boundary

The delivery transport is an integration boundary.
This spec requires a send-capable interface, but not a specific backend vendor.

Recommended transport architecture:

1. the plugin sends the support report to a backend intake endpoint
2. the backend validates the payload and handles rate limiting
3. the backend delivers the report to the support destination through Resend
4. the backend may create a GitHub issue for triage

GitHub issues should be treated as a triage surface, not the primary raw attachment sink.
Log files and screenshots should stay private by default and should not be posted directly to a public GitHub issue unless that is an explicit later decision.

Recommended interface:

```ts
interface SupportReportSender {
  sendSupportReport(payload: SupportReportPayload): Promise<void>;
}
```

If sending is unavailable, the UI must fail gracefully and keep the form contents intact.

## Module Ownership

### `src/logs/*`

Owns:

- path resolution for the logs directory
- daily file naming
- retention pruning
- append batching
- payload sanitization
- session id generation

Recommended module split:

- `logService.ts`
- `logSanitizer.ts`
- `logRetention.ts`

### `src/main.ts`

Owns:

- logger initialization on plugin load
- removing old debug-toggle initialization path
- wiring the logger into controllers and support UI

### `src/app/*`, `src/comments/*`, `src/agents/*`, `src/settings/*`, `src/sync/*`

Owns:

- emitting high-signal events from mutation, navigation, persistence, lifecycle, and sidebar state changes

Controllers should log checkpoints, not raw state dumps.

### `src/ui/*`

Owns:

- support icon rendering
- support form modal
- attachment preview UI
- screenshot attachment picking and preview
- send action

## Compatibility / Migration

### Remove

- current `Debug mode` setting
- browser-localStorage debug flag
- global window debug store as the primary mechanism

### Transitional Behavior

During migration, console logging may remain for:

- `warn`
- `error`

But persistent local logs become the canonical debugging surface.

## Failure Behavior

Logging must never break user actions.

If local log writing fails:

1. do not block the user flow
2. emit one console warning
3. keep a minimal in-memory recent buffer if possible
4. avoid recursive logging about log-write failures

If support attachment resolution fails:

1. keep the form open
2. show a clear error notice
3. do not discard the user's entered title/content/email

## Test Requirements

### Log service

- writes to the daily `.jsonl` file
- prunes files older than 3 days
- appends multiple records deterministically
- scrubs absolute paths
- omits disallowed raw-text fields
- survives write failures without throwing into user flows

### UI / support flow

- support icon visibility matches relevant SideNote2 surfaces only
- support form auto-attaches the current log file
- support form allows user-added screenshot attachments
- preview opens the same attached log file
- screenshot preview opens the same selected screenshot file
- send uses the attached log content shown in the form
- failed send keeps form state intact
- form validation requires email, title, and content
- screenshot limits enforce at most 3 files and 5 MB per file

### Migration

- debug setting is no longer rendered in settings
- existing startup path initializes persistent logging without user action

## Acceptance Criteria

1. SideNote2 writes local logs by default on every startup.
2. Logs live under `.obsidian/plugins/side-note2/logs/`.
3. Only the latest 3 days of logs are retained automatically.
4. Logged file paths are vault-relative or plugin-relative, never absolute machine paths.
5. A reported issue can be reconstructed from logs without reading note bodies or selected text.
6. The sidebar shows a support icon only when the current surface is relevant to SideNote2-managed comments.
7. The support form auto-attaches the current log file.
8. The user can add screenshots as extra attachments.
9. The user can preview the attachments before send.
10. The send flow requires email, title, and content.
11. Screenshot attachments are limited to 3 files at 5 MB each.
12. The attached log for send is the current day's retained log file.
13. The current `Debug mode` setting is removed.

## Transport Decision

- Use Resend as the backend delivery provider.
- Do not call Resend directly from the plugin.
- Keep the Resend API key server-side only.
