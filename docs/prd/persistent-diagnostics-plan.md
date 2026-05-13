# Persistent Diagnostics Plan

## Goal

Add real observability to Aside so that when a user reports a bug, we can inspect a local diagnostic trail with enough checkpoints to explain:

- what the user did
- what Aside believed the current state was
- what persistence or navigation step failed
- what fallback path or error message fired

The logs must live on the user's machine, be enabled by default, and clean themselves up automatically.

## Recommendation

Use persistent structured logs as the primary diagnostic channel.

Do not rely on browser console as the main debugging surface.

Reason:

- console output is easy to lose
- most users will not keep DevTools open
- console logs are poor for after-the-fact issue reports
- a persistent local log gives us a stable trail across reloads and restarts

Console logging can still exist as a secondary development aid for warnings and high-severity failures, but the source of truth should be the persistent local diagnostic log.

## Storage Model

Store logs in the plugin folder under the vault config directory, not in `data.json`.

Recommended location:

- `.obsidian/plugins/aside/logs/`

Recommended file format:

- newline-delimited JSON (`.jsonl`)

Recommended file strategy:

- one file per day, for example `2026-04-13.jsonl`

Recommended retention:

- keep 3 days
- delete older files automatically on startup
- also run cleanup before each new daily file write

Reason for not using `saveData()` / `data.json`:

- `data.json` is better for settings and small persistent state
- logs are high-churn and can grow quickly
- mixing logs into settings makes syncing and manual inspection worse

This is an engineering inference from the Obsidian plugin storage model and current repo shape, not a quoted platform rule.

## Logging Policy

### Default

- logging is always on
- remove the user-facing debug toggle from settings
- keep logging lightweight and bounded

### What to log

Log checkpoints, not raw application state dumps.

Each record should include:

- timestamp
- level: `info | warn | error`
- area: for example `startup`, `sidebar`, `navigation`, `persistence`, `index`, `agents`
- event name
- plugin version
- session id
- compact payload

### What not to log by default

Do not log:

- full note bodies
- full comment bodies
- selected text contents
- clipboard contents
- raw AGENTS.md contents
- secrets, tokens, or environment-specific credentials

Prefer:

- file path
- comment or thread id
- counts
- booleans
- lengths
- mode names
- error names and concise messages

If a payload is large, truncate it before writing.

## Checkpoints To Cover

### Startup and lifecycle

- plugin load start
- settings loaded
- sidebar view registered
- layout ready
- plugin unload

### Draft and mutation flow

- selection comment draft created
- page note draft created
- append draft created
- draft save started
- draft save succeeded
- draft save failed
- edit started
- edit saved
- resolve / reopen / delete
- re-anchor started / succeeded / failed

### Persistence

- note comment block parsed
- unsupported legacy block detected
- note write started
- note write succeeded
- note write skipped due to concurrent change
- aggregate index refresh started / succeeded / failed

### Navigation and sidebar

- comment reveal requested
- reveal target resolved
- reveal fallback used
- sidebar focus requested
- draft card scrolled into view
- index file filter changed
- index mode changed

### Errors and warnings

- any user-facing notice that reflects a real failure path
- unexpected exceptions in async controllers
- fallback branches that may explain a confusing UI outcome

## UX Surface

Add an in-product support entrypoint instead of a log-folder command.

Recommended behavior:

- show a small support icon at the bottom-right of the sidebar
- only show it when the current sidebar surface is relevant to Aside:
  - a note with Aside-managed comments
  - or the `Aside index.md` view
- clicking the icon opens a simple support form

Recommended form fields:

- email
- title
- content
- optional screenshot attachments

Recommended attachment behavior:

- automatically retrieve the relevant local log file
- attach it to the support form by default
- show the attached log in the form before submit
- let the user open the attached log from the form and inspect it before sending
- let the user add one or more screenshots as extra attachments
- let the user click `Send` from the same form

This means we do not need a separate `Aside: Open logs folder` command as the main support workflow.

## Proposed Architecture

### Logger service

Replace the current lightweight `debug.ts` helper with a real log service that:

- buffers records in memory
- writes batched `.jsonl` records to the logs folder
- rotates by day
- enforces 3-day retention
- optionally mirrors `warn` and `error` to console

### Support report composer

Add a lightweight support-report UI that:

- opens from the sidebar support icon
- reads the current retained log file from `.obsidian/plugins/aside/logs/`
- shows that file as an attachment row inside the form
- allows opening the attachment before submit
- allows the user to add screenshot attachments
- submits the user-entered metadata plus the attached log and any user-added screenshots

The actual delivery transport is a separate implementation choice, but the UX contract should be:

- user fills out email, title, and content
- user can inspect the attached log
- user can attach screenshots
- user clicks `Send` in the same flow

### API shape

Recommended call shape:

```ts
logs.log("info", "navigation", "reveal.requested", {
  filePath,
  commentId,
  source: "index-sidebar",
});
```

Helper methods are fine if they stay thin:

- `logInfo(area, event, payload?)`
- `logWarn(area, event, payload?)`
- `logError(area, event, payload?)`

### Failure behavior

Logging must never break the user flow.

If log writing fails:

- keep the app working
- drop back to in-memory buffering
- emit one console warning
- avoid recursive logging loops

## Migration

### Remove

- settings toggle for debug mode
- browser-localStorage debug flag
- global window debug store as the primary mechanism

### Keep only if useful during development

- minimal console mirror for `warn` and `error`

## Acceptance Criteria

1. A fresh install writes local logs without the user enabling anything.
2. Logs survive plugin reload and app restart.
3. Logs are automatically pruned to 3 days.
4. A typical issue flow can be reconstructed from logs without reading note bodies.
5. High-signal checkpoints exist across startup, mutation, persistence, navigation, and index flows.
6. Logging failures never block note editing or side note persistence.
7. The user-facing debug setting is removed.
8. A support icon appears in the sidebar when the current surface is relevant to Aside-managed comments.
9. The support form auto-attaches the local log and lets the user open it before sending.
10. The support form allows user-added screenshot attachments.
11. No standalone `Open logs folder` support command is required for the normal user path.

## Implementation Order

1. Add the log service and file retention logic.
2. Replace the current debug toggle path with always-on log initialization.
3. Instrument the highest-signal controllers first:
   - startup / lifecycle
   - comment mutation
   - navigation
   - persistence
   - index sidebar state changes
4. Add the sidebar support entrypoint and support form with auto-attached log file.
5. Add tests for retention, truncation, sanitation, attachment resolution, and write-failure fallback.
6. Update README and dev docs to describe logs as persistent local files and the support flow as in-product.

## Non-Goals

Not part of this first observability pass:

- full session replay
- automatic screenshot capture
- remote telemetry
- automatic issue submission
- raw note-content logging
- manual log-folder browsing as the primary support workflow
