# Conditional Update-Script Renames Design

**Date:** 2026-08-28
**Status:** Implemented; verified

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] `/update-script /script-name <request>` resolves one live vault script and sends the exact target path plus opaque request text through the shared agent pipeline.
- [x] Vault-script slash names are derived from direct-child filenames under `🛠️ scripts/`; source exports do not define command names.
- [x] Obsidian file rename events reseed the live vault-script registry, causing the old slash name to disappear and the new filename-derived name to become available.
- [x] One shared update-script prompt policy serves every supported local CLI runtime.
- [x] The real failure was diagnosed: the existing prompt forbade every rename, so the agent added an unused `scriptName` export and incorrectly reported a new slash invocation.

### To Implement

- [x] Replace the unconditional no-rename prompt with a conditional contract: ordinary update requests stay in place, while requests that explicitly ask to rename the script or slash command may perform a true rename.
- [x] Require explicit renames to move the existing direct-child script rather than copy it, preserve its supported extension and runtime contracts, reject collisions or invalid names, and leave no old-name alias.
- [x] Require a paired test file, when present, to move with the script and update its import/path references without modifying unrelated vault files.
- [x] Require the agent to verify the renamed file exists, the old file is absent, the paired tests pass, and the reported slash name matches the new filename before returning a success reply.
- [x] Preserve the existing target-disappeared and cannot-edit failure behavior, including a plain failure reply instead of a substitute file.

### Verification

- [x] A red-green prompt-policy regression proves ordinary update requests retain the default in-place/no-rename rule.
- [x] A red-green prompt-policy regression proves explicit rename requests are allowed to rename the target and paired test under the guarded rename contract.
- [x] Adapter regression coverage proves every provider continues to consume the one shared update-script policy rather than provider-specific copies.
- [x] The full automated test suite, lint, typecheck, Obsidian compliance check, production bundle, and release-artifact guard pass.
- [x] A manual installed-plugin smoke test renames a disposable vault script, confirms only the new slash command appears, and runs it successfully.

## Context

The existing `/update-script` design intentionally scoped every request to an in-place edit. Its shared prompt says to modify the resolved target in place and explicitly says not to rename it. That is correct for ordinary behavior changes, but it also overrides a user's explicit request to change a script's filename and slash command.

The observed failure used:

```text
/update-script /compact-google-ai-images rename the script name to clean-google-ai-summary
```

The agent followed the no-rename guard, left `🛠️ scripts/compact-google-ai-images.mjs` in place, and added `export const scriptName = "clean-google-ai-summary";`. Aside never reads that export: the registered command remained `/compact-google-ai-images`, `/clean-google-ai-summary` did not appear in suggestions, and the agent's success reply was false.

This design supersedes only the earlier update-script non-goal that prohibited all renames. The strict command grammar, live target resolution, agent selection, execution pipeline, and registry filename policy remain unchanged.

## Goals

- Keep ordinary update requests strictly in-place by default.
- Let an explicit request rename the actual vault script and its slash command.
- Make a rename a move, not a copy, so the old command disappears without an alias.
- Keep paired tests and their references aligned with the renamed script.
- Prevent collision, invalid-name, partial-rename, and false-success outcomes.
- Apply the same contract to Codex, Claude Code, Gemini, and DeepSeek through the existing shared prompt policy.

## Non-Goals

- Adding a second `/rename-script` command or changing `/update-script` syntax.
- Parsing natural-language rename intent in plugin code or limiting rename phrasing to one English regex.
- Keeping the old slash command as an alias or compatibility wrapper.
- Recursively moving scripts, introducing nested script folders, or changing supported extensions.
- Creating a general vault-file transaction engine.
- Modifying registry naming to read a `scriptName` export or other source metadata.

## Conditional Update Contract

The shared prompt remains the source of truth for update behavior. The natural-language request remains opaque to plugin routing and is interpreted by the selected agent.

For every `/update-script` request, the prompt establishes this default:

- inspect the exact resolved target before editing;
- modify that file in place;
- do not rename it or create a replacement unless the user's request explicitly asks to change the script filename or slash invocation;
- preserve the current-note positional argument and vault-root working-directory contract;
- avoid unrelated vault files.

An explicit rename means the user directly asks to rename the script file, script name, or slash command. Mentioning another name incidentally, changing an internal function name, changing output text, or refactoring identifiers does not authorize a file rename.

Keeping interpretation in the shared agent contract avoids a brittle English-only parser and gives every provider identical instructions. Provider adapters remain transport-only and must not copy or specialize the policy.

## Explicit Rename Flow

When the request explicitly authorizes a rename, the agent must:

1. Derive the requested command from a valid direct-child filename under `🛠️ scripts/` and preserve the target's `.mjs`, `.js`, or `.cjs` extension unless the user explicitly requests another supported extension.
2. Reject reserved names, invalid mention characters, nested paths, hidden names, test/spec suffixes, and case-insensitive collisions with another runnable script.
3. Move the existing script to the new path. It must not leave the old script, create an alias, or represent the rename with an internal `scriptName` export.
4. If a corresponding `🛠️ scripts/tests/<old-script-stem>.test.<extension>` file exists, move it to the matching new stem and update its imports and exact path/name expectations. Unrelated tests and vault files remain untouched.
5. Preserve the script's behavior and execution contracts except for changes explicitly requested by the user.
6. Run the paired tests when present.
7. Before reporting success, verify that the new script exists, the old script does not exist, the new filename maps to the reported slash invocation, and no case-insensitive registration collision exists.

Obsidian's existing rename event handling reseeds `VaultScriptRegistry` from live vault filenames. No alias or registry migration is needed: after the file move, the old mention stops resolving and the new mention becomes available through the existing suggestion and execution paths.

## Failure Behavior

- If the request does not explicitly authorize a rename, the agent must leave the target path unchanged even if another filename might be cleaner.
- If the requested new name is invalid, reserved, ambiguous, or already occupied, the agent must not rename or create a substitute.
- If the target disappears or cannot be edited, existing update-script failure guidance applies.
- If moving the paired test, updating references, or running tests fails, the agent must state that verification failed rather than claim the new invocation is ready.
- A partial move must not be described as success. The agent should restore a consistent old or new script/test pairing when safe; otherwise it must report the exact incomplete state compactly.
- A successful reply reports the actual new vault-relative path and filename-derived slash invocation only after the filesystem and test checks pass.

## Testing Strategy

### Shared prompt policy

- Build an ordinary request such as `make the default size reasonable` and assert the prompt says the exact target stays in place unless the request explicitly asks for a filename or slash-command rename.
- Build an explicit request such as `rename the script name to clean-google-ai-summary` and assert the prompt permits a true rename, forbids aliases and `scriptName` metadata substitutes, covers paired tests and reference updates, and requires old/new path plus invocation verification.
- Keep the test-folder, current-note argument, vault-root working-directory, unrelated-file, and missing-target protections in the same contract.

### Runtime adapters

- Keep representative adapter coverage proving `requestKind: "update-script"`, `targetScriptPath`, and request text reach the shared prompt builder.
- Assert no provider adapter contains a second rename policy.

### Regression and acceptance

- Run the focused prompt and agent-runtime suites after each red-green cycle.
- Run the full build pipeline before completion.
- In a disposable installed-vault script, first perform an ordinary update and confirm its path is unchanged. Then explicitly rename it, confirm the paired test moved and passed, confirm `/old-name` disappeared from suggestions, confirm `/new-name` appeared without restarting Obsidian, and execute `/new-name` successfully.
