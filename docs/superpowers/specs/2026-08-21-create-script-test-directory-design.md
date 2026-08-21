# Create-Script Test Directory Design

**Date:** 2026-08-21
**Status:** Approved, pending implementation

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] `/create-script` uses `shared/sideNotePromptPolicy.js` as the single prompt owner for Codex, Claude Code, and Gemini.
- [x] Runnable vault scripts are restricted to direct JavaScript children of `🛠️ scripts/`; nested files are not registered as slash commands.
- [x] The `lean-startup` vault has five `node:test` files paired with its five runnable scripts.

### To Implement

- [ ] Add one canonical shared constant for the vault script test folder: `🛠️ scripts/tests`.
- [ ] Require every `/create-script` run to create or update a matching automated test under that folder and run the test before reporting success.
- [ ] Keep generated runnable scripts as direct children of `🛠️ scripts/` and keep nested test files non-runnable.
- [ ] Move the five existing `lean-startup` test files into `🛠️ scripts/tests/` and update their imports and path calculations.

### Verification

- [ ] Shared prompt-policy tests fail before the contract change and pass after it for both create-script and ordinary agent requests.
- [ ] All five migrated vault script test files pass from their new directory.
- [ ] Vault-script registry tests confirm nested test files remain non-runnable.
- [ ] The complete Aside test suite, lint, typecheck, Obsidian compliance check, production bundle, and release-artifact inspection pass.

## Context

Aside already requires a `/create-script` agent to create a runnable JavaScript file directly under the active vault's `🛠️ scripts/` folder. The `lean-startup` vault already has one `.test.mjs` file for every runnable script, but each test currently sits beside its script.

Future generated scripts should always include an automated test, and all vault script tests should live under `🛠️ scripts/tests/`. This keeps the runnable folder easy to scan while preserving the direct-child registration rule.

## Goals

- Make an automated test mandatory for every `/create-script` result.
- Give all providers one exact vault-relative test location.
- Require the agent to run the generated test before claiming that script creation succeeded.
- Move the existing `lean-startup` tests to the same structure.
- Preserve current slash-command discovery and execution behavior.

## Non-Goals

- Requiring manually authored vault scripts to have a paired test before registration.
- Adding plugin-side parsing of agent replies or filesystem enforcement after an agent run.
- Changing the supported runnable script extensions or direct-child rule.
- Registering files under `🛠️ scripts/tests/` as slash commands.
- Migrating script tests in vaults other than `lean-startup`.

## Shared Path Ownership

`shared/vaultScriptPolicy.js` remains the canonical owner of vault script paths. It gains:

```js
const VAULT_SCRIPT_TEST_FOLDER_PATH = `${VAULT_SCRIPT_FOLDER_PATH}/tests`;
```

The matching declaration is exported from `shared/vaultScriptPolicy.d.ts`. Prompt code, tests, and future consumers derive the test folder from this shared constant instead of repeating the Unicode path.

The runnable registry remains unchanged. Its direct-child parser already rejects nested paths, so a file such as `🛠️ scripts/tests/clean-links.test.mjs` cannot become `/clean-links.test`.

## Create-Script Contract

The create-script branch in `shared/sideNotePromptPolicy.js` adds these requirements for all providers:

1. Create or update the runnable script as a collision-free direct child of `🛠️ scripts/`.
2. Create or update a matching test under `🛠️ scripts/tests/` for every generated script.
3. Prefer the existing naming convention `<script-name>.test.mjs` and Node's built-in `node:test` runner.
4. Exercise the script's meaningful behavior, not merely file existence or a mocked invocation.
5. Run the matching test before returning the Aside reply.
6. Report a concise failure if the test cannot be created or does not pass; do not claim successful creation.
7. On Regenerate, inspect and update the existing script and test instead of creating duplicates.

This is a prompt contract rather than plugin-side enforcement. The agent already owns file creation and test execution, while Aside owns dispatch, streaming, and the final reply. Adding a second filesystem protocol would require structured output and would duplicate responsibility without improving the normal workflow enough to justify the complexity.

## Existing Vault Migration

Create `/Users/example/Obsidian/lean-startup/🛠️ scripts/tests/` and move these files into it:

- `append-audio-transcript.test.mjs`
- `clean-citation-links.test.mjs`
- `clean-youtube-transcript.test.mjs`
- `ensure-writing-template.test.mjs`
- `mobi-to-markdown.test.mjs`

Update imports from `./<script>.mjs` to `../<script>.mjs`.

Two tests require additional path corrections:

- `clean-youtube-transcript.test.mjs` must resolve the runnable script from the parent script directory rather than the new tests directory.
- `mobi-to-markdown.test.mjs` must continue resolving the vault root rather than treating `🛠️ scripts/` as the root after the extra directory level is introduced.

The five runnable script files remain in place and are not rewritten by the migration.

## Error Handling

- If the test directory does not exist, the create-script agent creates it.
- If a matching script or test already exists, the agent inspects and updates it rather than choosing a duplicate name.
- If test execution fails, the agent returns a compact failure with the relevant script and test paths and does not use success wording.
- A test failure does not cause Aside to launch another provider automatically because the first provider may already have changed vault files.

## Testing Strategy

1. Extend the shared prompt-policy test first and confirm it fails because the mandatory test location and execution rule are absent.
2. Add the shared path constant and prompt lines, then prove create-script prompts contain the rule while ordinary agent prompts do not.
3. Retain registry coverage proving nested files are ignored.
4. Move the five vault tests, update relative paths, and run them together with Node's test runner.
5. Run the complete repository build so the exact public artifacts `main.js`, `manifest.json`, and `styles.css` receive the standard source-exposure and secret checks.

## Rejected Alternatives

### Plugin-side completion enforcement

Aside could parse a structured agent response, inspect the filesystem, and independently run the generated test. This would provide stronger enforcement but introduces a new response protocol, duplicates agent execution, and complicates partial-failure handling.

### Registry-level paired-test enforcement

Aside could refuse to register any script without a matching test. This would break existing manual workflows and change the registry from a file-eligibility authority into a development-policy gate. The requested rule applies to `/create-script`, not to all user-authored files.
