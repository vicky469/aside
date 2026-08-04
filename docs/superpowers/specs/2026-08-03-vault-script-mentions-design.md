# Vault Script Mentions Design

## Summary

Aside will discover user-facing JavaScript files stored directly under the active vault's `🛠️ scripts/` folder and offer them as `@script-name` suggestions in side-note drafts. Saving a side note with one registered script mention will execute that script directly with Node, passing the absolute path of the current markdown note. The request bypasses Codex and Claude completely.

This feature adds neither a sidebar tab nor a setting. Repository-local `scripts/` remains internal developer tooling and is never discovered, suggested, or executed by this feature.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside has a persisted side-note draft/save workflow and agent Regenerate interaction that can inform the script-run experience.
- [x] The example `clean-citation-links.mjs` accepts a markdown file path as a positional argument.

### To Implement

- [x] Centralize the vault script folder, supported extensions, exclusions, and mention naming in one shared policy.
- [x] Discover runnable scripts directly under the active vault's `🛠️ scripts/` folder at plugin startup.
- [x] Keep the registry synchronized with vault create, rename, and delete events.
- [x] Add filtered `@` suggestions for registered vault scripts alongside built-in directives.
- [x] Route one saved registered script mention to direct script execution before agent dispatch.
- [x] Pass the absolute current-note path as the script's only automatic argument and use the vault root as the working directory.
- [x] Persist script-run records so automatic execution is idempotent and explicit regeneration is traceable.
- [x] Render script results distinctly and connect them to the existing Regenerate interaction.
- [x] Add the vault script authoring location to the shared built-in agent prompt policy.
- [x] Do not add a Scripts tab or setting; expose vault scripts only through `@` suggestions.

### Verification

- [x] Unit tests cover discovery, extension/test exclusions, mention naming, and duplicate-name ambiguity.
- [x] Unit tests cover live create, rename, and delete registry changes.
- [x] Unit tests cover suggestion parsing, filtering, selection, and surrounding draft preservation.
- [x] Unit tests cover path containment and shell-free Node invocation arguments.
- [x] Controller tests cover agent bypass, mixed/multiple mention rejection, automatic idempotency, success, failure, and Regenerate.
- [x] Settings and sidebar-tab regression tests confirm no vault-script setting or Scripts tab is introduced.
- [x] Build and full automated test suite pass.
- [x] A built-plugin smoke test confirms a newly created vault script becomes available without restarting Obsidian.

## Goals

- Turn reusable vault scripts into first-class side-note directives without involving an AI agent.
- Make newly created scripts available in `@` suggestions immediately.
- Give scripts the current markdown note as a predictable execution target.
- Prevent storage refreshes or duplicated events from accidentally repeating destructive scripts.
- Allow an intentional rerun through the existing Regenerate control.
- Keep user-facing vault automation clearly separated from repository development tooling.

## Non-Goals

- Adding a Scripts sidebar tab.
- Adding a feature flag or settings toggle.
- Discovering repository-local `scripts/` or any folder outside the active vault.
- Recursively discovering scripts in subfolders.
- Supporting arbitrary executables, shell scripts, TypeScript, or test files.
- Passing free-form side-note text as command-line arguments.
- Delegating script execution to Codex, Claude, or another agent.
- Building a general-purpose task runner, scheduler, or permissions UI.

## Shared Vault Script Policy

One shared policy module will own all user-facing script rules so discovery, suggestions, execution, and agent prompt guidance cannot drift.

- Folder: `🛠️ scripts/`, relative to the active vault root.
- Depth: direct children only.
- Supported extensions: `.mjs`, `.js`, and `.cjs`.
- Exclusions: filenames beginning with `.` and filenames ending in `.test.mjs`, `.test.js`, `.test.cjs`, `.spec.mjs`, `.spec.js`, or `.spec.cjs`, matched case-insensitively.
- Mention name: the filename with one supported extension removed. For example, `clean-citation-links.mjs` becomes `@clean-citation-links`.
- Matching: case-insensitive for lookup and ambiguity detection while preserving the filename's display casing.
- Ambiguity: when two runnable files map to the same normalized mention name, neither is runnable through that mention until the collision is removed.

The shared built-in agent prompt will use this same policy value when instructing an agent where to place a user-requested reusable vault script. It must explicitly distinguish the active vault's `🛠️ scripts/` from the repository's internal `scripts/`.

## Live Registry

Aside will seed an in-memory registry by listing the user-facing vault script folder when the plugin loads. A missing folder is a valid empty state and will not be created merely by enabling the plugin.

The registry will subscribe to Obsidian vault create, rename, and delete events. Relevant events update the registry immediately, including moves into or out of `🛠️ scripts/`. Content modification does not change a script's registration, so the next run naturally uses the current file contents without requiring a registry update.

The registry exposes immutable suggestion records and exact mention resolution. It does not read script source code or scan repository files.

## Mention Suggestions

Typing `@` in a new, append, or edit side-note draft opens a filtered suggestion modal. The menu contains supported built-in directives and the current runnable vault-script registry. Continued typing narrows results case-insensitively.

Choosing a script replaces only the active `@query` range and preserves all surrounding draft text. The inserted value is `@script-name`. Keyboard selection, closing, and focus restoration follow the existing link and tag suggestion behavior.

Ambiguous script names are omitted from suggestions. If a user types the ambiguous mention manually and saves it, Aside appends a concise collision failure rather than choosing a file silently.

## Saved-Entry Routing

After a user entry is saved, routing checks registered vault-script mentions before agent directives.

- Exactly one script mention and no agent mention: queue the script run.
- More than one distinct script mention: do not run; persist one rejected script-run record and append a concise ambiguity failure.
- A script mention mixed with `@codex` or `@claude`: do not run either path; persist one rejected script-run record and append a concise instruction to use one directive.
- An unregistered `@name`: leave it as ordinary side-note text.
- `@todo` continues to use existing behavior and is not a script or agent directive.

The agent controller must never receive an entry routed to a script or rejected as a mixed script/agent request.

## Secure Direct Execution

The runner resolves all paths from trusted Obsidian vault metadata rather than from the raw mention text. Immediately before launch it revalidates that:

- the queued mention still resolves uniquely to the same registered script path;
- the script still exists as a registered file;
- its normalized path is a direct child of the active vault's `🛠️ scripts/` folder;
- its extension remains supported;
- the current target is a markdown file inside the active vault.

The runner resolves the user's external `node` executable from the login-shell `PATH`, matching Aside's existing desktop agent-runtime environment resolution, and launches the script without a shell. This avoids treating Electron's packaged renderer helper as a Node CLI. Conceptually, the process is:

```text
executable: node
arguments:  [absoluteScriptPath, absoluteCurrentNotePath]
cwd:        absoluteVaultRoot
```

The login shell is consulted only to discover `PATH`; script execution itself uses `execFile`. This preserves paths containing spaces and emoji without interpolation and prevents shell metacharacters from becoming commands. The current note path is the script's only automatic positional argument.

Runs time out after 60 seconds. Captured standard output and standard error are limited to 64 KiB each; exceeding either limit fails the run. Result entries retain at most 250 words and end with an explicit truncation marker when formatting omits captured text. Standard output is preferred for successful result text; standard error and exit details are used for failures. Empty successful output becomes a compact completion message.

Aside tracks active script child processes. Plugin unload marks the controller disposed before terminating those children, preventing queued work from launching and preventing terminated runs from persisting late output. Any queued or running receipt left by unload is terminalized by startup reconciliation and remains explicitly regeneratable.

## Run Records and Regenerate

Aside will persist script-run records separately from agent-run records. A record includes the run id, thread id, trigger entry id, script identity, file path, status, timestamps, output entry id, and optional retry lineage or error information.

For automatic dispatch, the trigger entry id is an idempotency key: repeated storage events must find the existing run rather than launch another process.

The resulting thread entry begins with `Script @script-name:` and is associated with its script-run record. It is not attributed to an agent and must not appear as an Agent-tab result.

The existing Regenerate button will be available for a script result. An explicit click creates a new run record linked to the prior run, resolves the latest registered script file, and executes it against the current note. Like agent regeneration, the script rerun clears and replaces the existing result entry instead of appending duplicate result entries. A busy script run disables Regenerate until it reaches a terminal state.

## Failure Behavior

Failures never fall back to an agent. Aside will provide concise, actionable output for:

- a script removed or renamed after suggestion selection;
- an ambiguous or unsupported script;
- a missing or invalid current note;
- Node launch failure;
- non-zero exit status;
- timeout;
- output truncation;
- failure to persist or replace the result entry.

The failure remains regeneratable when the original mention can still resolve to a registered script. If the script no longer resolves, Regenerate reports that fact without launching anything.

## Testing Strategy

Pure policy, discovery, parsing, and execution-planning functions will be tested without Obsidian or child processes. Registry tests will drive synthetic vault events. Runner tests will inject a process adapter and assert the exact executable, arguments, working directory, timeout, and output handling.

Controller tests will prove run-once automatic routing, queued-run registry revalidation, unload behavior, explicit reruns, output replacement, agent bypass, and rejection of mixed or multiple directives. Runtime tests will cover active-child termination. Draft-editor tests will cover `@` query detection and replacement. Existing setting-catalog and sidebar-tab tests will be strengthened to make the no-setting/no-tab scope explicit.

The final manual smoke test will install the built plugin into a test vault, create a new supported script directly under the vault's `🛠️ scripts/`, confirm that its mention appears without restarting Obsidian, run it against a note, change the note or script, and confirm Regenerate uses the latest data.
