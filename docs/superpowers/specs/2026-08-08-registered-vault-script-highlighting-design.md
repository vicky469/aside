# Registered Vault Script Highlighting Design

## Summary

Aside will style slash-prefixed text as a vault-script mention only when it is a standalone token that currently resolves to one runnable, unambiguous script in the live vault-script registry. Absolute paths such as `/Users/wenqingli/...`, URLs such as `https://example.com/...`, unregistered `/name` tokens, removed scripts, and ambiguous script names remain ordinary text.

This design narrows only the visual highlighting policy from the existing vault-script mention feature. Suggestion filtering, insertion, saved-entry routing, execution, and Regenerate behavior remain unchanged.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside maintains a live vault-script registry synchronized with vault create, rename, and delete events.
- [x] The registry withholds ambiguous mention names and resolves runnable mentions case-insensitively.
- [x] Script suggestions and execution already consume current runnable registry state.
- [x] Draft previews and persisted comments share the mention-decoration owner in `commentEditorStyling.ts`.

### To Implement

- [x] Expose a read-only registry-backed predicate for whether a slash mention currently resolves to a runnable script.
- [x] Require slash candidates to be standalone mention tokens rather than segments of paths or URLs.
- [x] Make the shared comment highlighter preserve existing `@` styling while applying slash styling only when the registry predicate accepts the token.
- [x] Pass the same live predicate through draft-preview and persisted-comment rendering hosts.
- [x] Leave mention suggestions, script execution, stored comment bodies, and CSS presentation unchanged.

### Verification

- [x] Fail-first tests prove registered standalone slash mentions remain highlighted.
- [x] Tests prove unregistered, removed, and ambiguous slash mentions remain plain text.
- [x] Tests prove macOS absolute paths, slash-separated paths, and HTTP(S) URLs do not receive partial slash highlighting.
- [x] Representative caller tests prove both draft previews and persisted comments use the registry-aware shared policy.
- [x] The complete repository build and release-artifact guard pass.
- [x] A built-plugin smoke check in `lean-startup` confirms `/Users` remains plain while a registered script mention remains highlighted.

## Goals

- Make slash highlighting accurately signal a script that Aside can currently run.
- Eliminate misleading partial highlighting inside absolute paths and URLs.
- Keep draft and persisted-comment presentation consistent as the registry changes.

## Non-Goals

- Changing `/` suggestion-menu behavior or ranking.
- Changing script discovery, filename rules, ambiguity handling, execution, or Regenerate.
- Persisting whether a token was a script when the comment was saved.
- Rewriting existing comment bodies or absolute paths.
- Changing `@todo`, agent, or ordinary `@name` styling.

## Highlighting Policy

The shared tokenizer continues to recognize `@` mentions using the current behavior. A slash candidate must satisfy both of these rules:

1. It has standalone `/name` syntax and is not immediately embedded in a slash-separated path or URL.
2. The complete token resolves case-insensitively to exactly one current runnable script in the live registry.

For example, `/clean-youtube-transcript` is highlighted only while `🛠️ scripts/clean-youtube-transcript.mjs`, `.js`, or `.cjs` resolves uniquely. `/Users/wenqingli/...`, `https://example.com/path`, `/missing-script`, and a colliding `/clean` mention remain plain.

Persisted comments are intentionally live rather than historical: deleting or ambiguating a script removes the highlight on the next render, while creating or restoring a unique registration enables it. The stored Markdown text never changes.

## Architecture and Data Flow

`VaultScriptRegistry` remains the source of truth. The plugin exposes a read-only resolution predicate to `AsideView`; it does not expose mutable registry state.

`AsideView` supplies that predicate through the existing draft and persisted-comment host adapters. `commentEditorStyling.ts` remains the single matching and decoration owner for both surfaces. It parses mention-shaped tokens, always admits existing `@` candidates, and consults the predicate before admitting a slash candidate.

The default behavior when no registry predicate is available is conservative: slash tokens remain plain. This prevents helpers, tests, or future renderers from implying that an unverified command is runnable.

## Error and Lifecycle Handling

Highlighting has no persistence, network, or execution side effects. A missing registry adapter, unresolved token, ambiguous name, or removed script produces ordinary text without an error notice. Existing vault lifecycle events keep registry state current; any subsequent comment render reflects that state without adding another listener.

Markdown links, code, preformatted blocks, and already-decorated mention elements retain their existing exclusion behavior. Absolute paths and URLs remain copyable and visually unchanged.

## Testing Strategy

Pure highlighter tests inject a registry predicate and cover accepted registered tokens, rejected unregistered tokens, case-insensitive resolution, absolute paths, relative slash paths, and URLs. Registry tests remain the owner for create, rename, delete, and collision semantics; focused tests connect those outcomes to the predicate used by styling.

Representative renderer tests verify that draft preview creation and persisted Markdown decoration both receive the same host predicate. Existing `@` mention and HTML-escaping regressions remain green. Final verification runs the full repository build and release-artifact inspection, installs the verified public assets into `lean-startup`, and checks the reported `/Users` case against a registered script mention in the real sidebar.
