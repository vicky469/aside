# Vault Script Single-Argument Design

## Summary

Aside will treat a saved comment as a vault-script command only when its trimmed body starts with `/script-name`. The source Markdown note remains implicit from the comment card. Any remaining text becomes one optional script argument, allowing paths with spaces to work with or without surrounding quotes.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside discovers uniquely named direct JavaScript children of `🛠️ scripts/` and executes them with Node without a shell.
- [x] The source Markdown note is resolved from the saved comment and passed as the first user-facing positional argument.
- [x] Script runs and retries are recorded persistently and write their result back into the triggering thread.

### To Implement

- [ ] Restrict vault-script execution to comments whose trimmed body begins with a registered `/script-name` command.
- [ ] Capture the entire trimmed command remainder as one optional argument and remove one matching pair of surrounding single or double quotes.
- [ ] Pass the source note first and the optional command argument second through the controller and runtime without shell evaluation.
- [ ] Preserve the argument in persisted script-run records and re-resolve the current command when regenerating a run.
- [ ] Update the reusable-script authoring prompt to document the source-note-plus-optional-argument contract.

### Verification

- [ ] Directive tests cover leading commands, non-leading slash mentions, empty remainders, quoted paths, and unquoted paths containing spaces.
- [ ] Controller tests prove initial runs and regenerated runs carry the expected single argument.
- [ ] Runtime tests prove Node receives `<script> <source-note> [argument]` and preserves the no-argument behavior.
- [ ] The complete test, lint, typecheck, Obsidian compliance, bundle, and release-artifact checks pass.
- [ ] The built plugin is installed into the `lean-startup` vault and the Carl Bass transcription command advances beyond the usage guard.

## Command Contract

The supported comment form is:

```text
/script-name [argument]
```

Leading whitespace is ignored. A slash mention elsewhere in prose does not launch a script. This makes execution explicit and prevents ordinary discussion of a script from running it.

Aside supplies the source note from the comment card. The script sees:

```text
process.argv.slice(2)[0] = absolute source Markdown path
process.argv.slice(2)[1] = optional command argument
```

For example, both comments below pass the same second argument:

```text
/append-audio-transcript "Attachments/Carl Bass - Manufacturing Spaces.mp3"
/append-audio-transcript Attachments/Carl Bass - Manufacturing Spaces.mp3
```

The resulting script inputs are:

```text
<absolute source Markdown path>
Attachments/Carl Bass - Manufacturing Spaces.mp3
```

## Argument Normalization

Aside trims whitespace around the remainder after `/script-name`. If the complete remainder starts and ends with the same single quote or the same double quote, Aside removes that one outer pair. It performs no further parsing.

An empty remainder adds no second argument, preserving existing scripts that consume only the source note. Unmatched or internal quotes remain literal text. Aside does not expand environment variables, globs, backticks, substitutions, or escape sequences.

## Data Flow

1. The saved-entry router inspects the trimmed comment body.
2. The vault-script directive resolver accepts only a registered script name at the start of the body and normalizes the optional remainder.
3. The controller stores the normalized optional argument with the script run.
4. The runtime resolves and validates the vault, script, and source-note paths as it does today.
5. The runtime calls Node through `execFile` with the real script path, real source-note path, and optional literal argument.
6. Standard output, errors, persistence, and thread replies retain their current behavior.

Retries re-read and resolve the current saved command so an edited audio path is used. The newly normalized argument is persisted on the retry record before execution.

## Security And Compatibility

Aside continues to use `execFile` without a shell. The optional argument is an opaque value interpreted only by the selected vault script. Existing no-argument scripts keep their current `process.argv.slice(2) === [sourceNote]` contract.

Restricting execution to a leading slash command intentionally changes the previous permissive behavior that recognized registered script mentions inside prose. Suggestions and visual highlighting remain unchanged; only execution routing becomes command-shaped.

## Testing

The implementation will follow red-green-refactor:

- directive unit tests first define leading-command recognition and single-argument normalization;
- controller tests then define persistence and retry behavior;
- runtime tests define the exact `execFile` argument order;
- repository-wide verification checks integration, packaging, and Obsidian compliance;
- a built-plugin smoke test uses the existing Carl Bass comment and MP3 in `lean-startup`.
