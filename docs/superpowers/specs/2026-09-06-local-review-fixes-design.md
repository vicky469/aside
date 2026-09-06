# Local Review Fixes Design

**Date:** 2026-09-06
**Status:** Approved for planning

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Review all 72 commits ahead of `origin/main` for correctness and regression risk.
- [x] Reproduce the three JavaScript dependency-scanner failures through the public extraction path.
- [x] Trace index tag-search results from Obsidian metadata events through the capability index and sidebar cache.
- [x] Confirm the pre-fix test suite passes, proving the four regressions are missing coverage rather than existing test failures.

### To Implement

- [ ] Restrict newline label handling in the JavaScript lexer to `break` and `continue` so division expressions after `return <identifier>` remain scannable.
- [ ] Decode valid surrogate code-unit escapes in JavaScript string literals so escaped non-BMP dependency paths are retained.
- [ ] Exclude property-access tokens named `new` from `new URL(..., import.meta.url)` dependency matching.
- [ ] Refresh only an open index Tags result after the capability index accepts a metadata change.
- [ ] Keep the production bundle free of Acorn and other general-purpose parser dependencies.

### Verification

- [ ] Fail-first tests reproduce each JavaScript scanner regression through the focused lexer and the public dependency-extraction facade.
- [ ] A fail-first lifecycle test proves a visible index Tags query refreshes after tag metadata changes without rebuilding unrelated sidebar modes.
- [ ] The focused regression tests pass after the minimal fixes.
- [ ] The change-surface audit confirms one lexer owner and one metadata-to-view refresh route.
- [ ] Full tests, lint, typecheck, Obsidian compliance, production bundle, bundle-size guard, and release-artifact inspection pass.

## Problem

The local commit review found four regressions in two independent subsystems.

The focused JavaScript dependency lexer can misclassify valid syntax. It treats a slash after `return <identifier>` and a newline as a regular-expression opener, rejects valid surrogate escapes inside strings, and treats a property named `new` as the `new` operator. These mistakes can omit real publish assets or create phantom dependencies that block a publish.

The vault capability index updates when Obsidian emits a metadata-cache change, but an already-rendered index Tags result owns a cached query model. The metadata callback does not notify that view, so the visible result can remain stale until another sidebar render happens.

## Goals

- Preserve every dependency form supported before the Acorn removal without restoring Acorn's bundle cost.
- Prevent both missed and phantom JavaScript dependencies for the reviewed cases.
- Make a visible index Tags query reflect metadata changes immediately from the in-memory index.
- Keep metadata refresh work scoped to the Tags body rather than rerendering all sidebar content.
- Add regression coverage at the shared owner and one representative adapter boundary.

## Non-Goals

- Do not turn the focused lexer into a complete JavaScript parser.
- Do not broaden the supported dependency forms.
- Do not restore Acorn or add another runtime parser dependency.
- Do not change tag ranking, filtering, pagination, navigation, or mutation permissions.
- Do not change settings art, agent behavior, scripts, publishing controls, or persistence.

## Considered Approaches

### Targeted semantic repairs — selected

Patch the three proven lexer decisions and add a focused Tags-view refresh route. This preserves the current bundle reduction, limits behavior changes to reviewed defects, and keeps the in-memory performance contract.

### Restore Acorn

Restoring the previous parser would recover broad grammar fidelity, but it would add roughly 121 KB to the production bundle and violate the enforced 750 KB budget.

### Adopt another lexer dependency

A third-party lexer could cover more syntax, but it introduces new runtime weight and maintenance risk without evidence that a broader replacement is required for these bounded regressions.

## Design

### JavaScript dependency lexer

`javascriptDependencyLexer.ts` remains the single scanner owner.

The newline rule will distinguish restricted productions that may carry labels from those that cannot. Only `break` and `continue` may treat a following same-line identifier plus newline as the end of the statement before a regex. `return <identifier>` must leave the following slash classified as division.

Fixed and braced Unicode escapes will accept surrogate values permitted in JavaScript strings. Appending successive code units naturally reconstructs escaped non-BMP filenames such as `\uD83D\uDE80` into the same string value produced by JavaScript.

Reference collection will apply the existing property-access guard before matching `new URL`. A token reached through `.new`, `?.new`, or `#new` cannot act as the `new` operator.

Tests will assert results through both `scanJavascriptDependencies` and `extractPublishDependencyReferences` so internal semantics and public wiring cannot drift.

### Live index Tags refresh

`VaultCapabilityIndex` remains the sole owner of tag membership. The metadata-cache callback will first apply the affected file's new tags, then ask the workspace view layer to refresh visible index Tags results.

The view-layer method will iterate Aside leaves and call a narrow public refresh hook only on applicable views. `AsideView` will ignore the hook unless it is attached to the generated index, currently in Tags mode, and has a connected Tags body. For an applicable view it will rebuild the current query model from the updated in-memory index and rerender only the Tags body.

This route performs no vault reads, does not reset the query, selected filter, or pagination window, and does not rebuild comment cards or the toolbar.

## Failure Handling

- Uncertain JavaScript candidates remain ignored; the repair only changes cases proven valid or proven to be property access.
- A metadata refresh with no open index Tags view is a no-op after the in-memory index update.
- If a selected tag disappears, the existing result normalization falls back to `All matches`.
- View refresh remains best-effort and must not prevent the metadata index from updating.

## Testing Strategy

Implementation uses red-green-refactor slices:

1. Add the division-after-return lexer and facade fixtures and observe the missing dependency failure.
2. Add the surrogate-escape lexer and facade fixtures and observe the missing dependency failure.
3. Add the property-named-`new` lexer and facade fixtures and observe the phantom dependency failure.
4. Add a workspace/view lifecycle test that observes no refresh after a metadata update.
5. Apply one minimal production fix per failing slice and rerun its focused tests.
6. Run the change-surface search and complete repository verification.

## Acceptance Criteria

- `return value\n/import("./asset.js")/g` retains `./asset.js` as a dependency.
- `import("./\uD83D\uDE80.js")` retains the cooked `./🚀.js` dependency.
- `obj.new\nURL("./asset.js", import.meta.url)` produces no dependency.
- A visible index Tags result updates after a metadata-cache tag change without user input.
- Tag refresh performs no Markdown or vault read and leaves unrelated sidebar modes untouched.
- The production bundle stays at or below 750,000 bytes and the exact release artifacts pass security inspection.
