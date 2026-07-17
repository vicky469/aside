# Obsidian Scorecard and Build Compliance Design

**Status:** Approved design

**Date:** 2026-07-17

**Objective:** Remove every actionable Obsidian scorecard error and source warning, minimize and disclose intentional capabilities, and make the same compliance checks run locally, on every push and pull request, and before every release.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Reproduced the published `2.0.91` asset digests from the GitHub release.
- [x] Verified `main.js`, `manifest.json`, and `styles.css` with `gh attestation verify --repo vicky469/aside`.
- [x] Confirmed the verified certificate identifies `vicky469/aside`, `.github/workflows/release.yml`, tag `refs/tags/2.0.91`, and commit `3310790b518c49e70bea73d7b421c8cf9c3faa00`.
- [x] Refreshed the local reference bundle from the official Obsidian developer docs, API, help, and sample-plugin repositories on 2026-07-17.
- [x] Mapped every reported type-assertion, DOM-construction, settings, clipboard, and vault-enumeration finding to its source location.

### To Implement

- [ ] Upgrade the Obsidian API and lint toolchain to the current official baseline and make scorecard warnings fail local and CI builds.
- [ ] Add an official-style push/pull-request CI matrix for Node.js 20, 22, and 24.
- [ ] Make release assets immutable and add tag-bound attestation verification before publishing a new release.
- [ ] Remove every reported unnecessary TypeScript assertion through inference, explicit return construction, or a narrow typed boundary.
- [ ] Replace reported `document.createElement` calls with Obsidian DOM helpers without breaking detached or cross-window rendering.
- [ ] Add declarative settings search support for Obsidian 1.13 while preserving Aside's Obsidian 1.12.7 compatibility from one shared settings model.
- [ ] Replace avoidable whole-vault enumeration with scoped indexes or folder traversal and document the remaining user-facing vault capabilities.
- [ ] Restrict clipboard access to explicit paste, copy, and drag gestures and document those capabilities.
- [ ] Add a maintained network/capability disclosure and automated checks for undeclared network hosts or background clipboard reads.

### Verification

- [ ] `npm ci` and the full compliance build pass on Node.js 20, 22, and 24.
- [ ] The current `eslint-plugin-obsidianmd` recommended configuration reports zero errors and zero warnings.
- [ ] TypeScript compilation and all repository tests pass.
- [ ] The release artifact guard passes for exactly `main.js`, `manifest.json`, and `styles.css`, with no source map, embedded source, secret, or local-path exposure.
- [ ] A release-candidate attestation verifies against the repository, tag ref, tag commit, and release workflow before the release is created.
- [ ] Obsidian 1.12.7 renders and persists the legacy settings UI.
- [ ] Obsidian 1.13 or later indexes every Aside setting in global settings search and renders equivalent controls.
- [ ] Manual scorecard review shows no release errors or source warnings; any remaining behavior recommendation is tied to an intentional, documented capability and cannot be removed without deleting that feature.

## Context

The Obsidian directory report contains two release errors, two behavior recommendations, and three families of source warnings:

1. `main.js` and `styles.css` are reported as having attestations that fail cryptographic verification.
2. Aside is reported as enumerating the vault.
3. Aside is reported as accessing the clipboard.
4. Several TypeScript assertions are unnecessary.
5. Native `document.createElement` is used instead of Obsidian's DOM helpers.
6. `AsideSetting` does not implement `getSettingDefinitions()` for Obsidian 1.13 settings search.

The report already passes its network-pattern and individual vault read/write checks. Those passing results are constraints: the remediation must not introduce suspicious networking or weaken the existing use of Obsidian's Vault API.

## Principles

### Optimize for user safety, not scanner evasion

An alternate API that still enumerates every note or accesses the clipboard does not remove the capability. The implementation may remove a scorecard recommendation only by genuinely narrowing or eliminating access. Intentional capabilities must be minimized, bound to a user-visible feature, and disclosed.

### Keep one compliance source of truth

`package.json` scripts own the local verification sequence. GitHub push/pull-request and release workflows call those scripts instead of reimplementing the checks in YAML. Repository-specific policy checks live in one script with direct tests.

### Treat published release assets as immutable

A version identifies one tag, one source commit, one build, and one set of release digests. A failed or superseded release is corrected with a new version. Existing release assets are never overwritten with `--clobber`.

### Preserve supported behavior

Aside continues supporting Obsidian 1.12.7. Clipboard-powered copy/paste remains user initiated. Note, tag, move-target, thought-trail, and publishing features retain the minimum vault access they genuinely need.

## Official Obsidian Baseline

The implementation is based on the upstream sources refreshed on 2026-07-17:

- [Obsidian sample plugin CI](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/.github/workflows/lint.yml) runs on pushes and pull requests, installs with `npm ci`, builds, and lints on Node.js 20, 22, and 24.
- [Obsidian sample plugin release workflow](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/.github/workflows/release.yml) checks out a tag, builds on Node.js 24, attests `main.js` and optional `styles.css`, and uploads the required assets.
- [Submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins) define manifest, mobile, description, funding, and platform constraints.
- [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) cover Obsidian DOM helpers, resource cleanup, Vault API use, targeted path lookups, UI text, and mobile-safe behavior.
- [Developer policies](https://docs.obsidian.md/Developer+policies) prohibit hidden telemetry and self-update mechanisms and require disclosure of network use and access outside the vault.
- [Declarative settings migration](https://docs.obsidian.md/Plugins/Guides/Migrate+to+declarative+settings) defines the dual-support path for plugins whose `minAppVersion` remains below 1.13.0.

The community directory's safety-scorecard implementation is not published in an official repository. Exact private-scanner parity is therefore not a valid promise. The public approximation consists of the current official ESLint configuration, the official API types and policies, release-provenance verification, and Aside-specific regression guards.

## Build and CI Architecture

### Package scripts

Refactor the build into named, composable gates:

| Script | Responsibility |
| --- | --- |
| `test` | Compile and run the TypeScript and `.mjs` test suites. |
| `lint` | Run the current `eslint-plugin-obsidianmd` recommended rules with zero warnings allowed. |
| `typecheck` | Run the production TypeScript check without emitting files. |
| `bundle` | Produce the production `main.js` only after static checks pass. |
| `check:obsidian` | Validate manifest, version mapping, policy disclosure, workflow invariants, and capability inventory. |
| `release:artifacts:check` | Inspect the exact three shipped assets for source exposure, secrets, source maps, and local paths. |
| `build` | Run `test`, `lint`, `typecheck`, `check:obsidian`, `bundle`, and artifact inspection in that order. |
| `release:check` | Run `build`, release-note validation, and tag/version validation when a tag is supplied. |

`npm run dev` remains a fast watch build. It must perform a one-time type/configuration preflight before starting, but it must not rerun the entire test suite after every keystroke. Every production build and every CI run uses the full gate.

### Toolchain baseline

Update `eslint-plugin-obsidianmd` from `0.1.9` to the current public release (`0.4.1` when this design was approved). Update the `obsidian` development dependency and lockfile so TypeScript includes the 1.13 declarative settings types. Keep `manifest.json.minAppVersion` at `1.12.7`; compiling against newer typings does not invoke newer APIs on older Obsidian versions.

Use the official recommended lint configuration as the base. Aside-specific sentence-case brands and the existing `require-await` policy remain additive overrides. CI invokes ESLint with `--max-warnings 0` so a future recommended rule cannot silently appear only in the directory scorecard.

### Push and pull-request CI

Create `.github/workflows/ci.yml` with the official Node.js matrix: 20, 22, and 24. Each job performs:

1. `actions/checkout@v6`.
2. `actions/setup-node@v6` with npm caching.
3. `npm ci`.
4. `npm run build`.

The matrix is the compatibility signal; it must not contain separate hand-written lint or type-check logic already owned by `npm run build`.

### Repository compliance check

Create `scripts/check-obsidian-compliance.mjs`, with tests in `tests/checkObsidianCompliance.test.mjs`. It validates stable facts that ESLint does not own:

- `manifest.json` includes the required fields and a strict `x.y.z` version.
- `package.json`, `manifest.json`, and the current `versions.json` entry agree.
- `minAppVersion` is represented accurately in `versions.json`.
- `isDesktopOnly` remains consistent with the shipped plugin bundle's platform dependencies.
- Required repository files and release assets exist in the expected locations.
- README capability disclosures contain the maintained network, vault-indexing, clipboard, and external-service entries.
- The release workflow contains no asset clobber path and invokes the shared release checks.
- A maintained host/capability inventory matches the plugin-side networking entry points. Generated Worker bindings and test fixtures are excluded from plugin-bundle host checks.
- Background calls to `navigator.clipboard.readText()` are forbidden. Clipboard access must remain in approved user-gesture adapters.

The check must report the exact violated invariant and file rather than a generic compliance failure.

## Release Attestation Error

### Evidence

The published `2.0.91` assets have these GitHub release digests:

| Asset | SHA-256 |
| --- | --- |
| `main.js` | `9543379f3020be97567531a6cc197701b172bb32ed201a9b9034f836e90e6e5e` |
| `manifest.json` | `84ee00266bbb6842c375e26c4adfd2d0014fb482073b270947405d0479e256dd` |
| `styles.css` | `8a9ec6517fdc5233763593936be66aebb601f76af405d44bc1bc587a93d17d21` |

All three exact downloaded assets pass `gh attestation verify --repo vicky469/aside`. The certificate and SLSA statement bind the build to:

- repository `vicky469/aside`;
- workflow `.github/workflows/release.yml`;
- source ref `refs/tags/2.0.91`;
- source and workflow commit `3310790b518c49e70bea73d7b421c8cf9c3faa00`;
- GitHub-hosted run `29553105692`.

Therefore the report does not establish that these files came from another repository or commit. The remaining hypotheses are directory-side attestation discovery/verification compatibility, stale scorecard state, or ambiguity created by historical attestations for unchanged asset digests. The implementation must not claim a more specific root cause without a failing verifier or directory response that demonstrates it.

### Remediation

Align the release workflow with the official sample while preserving Aside's manual release notes and security guard:

1. Use Node.js 24 for the tag build.
2. Verify the tag equals `manifest.json.version` before building.
3. Run `npm ci` and `npm run release:check` from the tag checkout.
4. Inspect the exact generated `main.js`, `manifest.json`, and `styles.css` before attestation or upload.
5. Attest `main.js` and `styles.css`, which are the executable and styling build outputs expected by the official sample and directory report.
6. Verify each local asset with `gh attestation verify`, requiring:
   - repository `vicky469/aside`;
   - source ref `refs/tags/<version>`;
   - source digest equal to `GITHUB_SHA`;
   - signer workflow `vicky469/aside/.github/workflows/release.yml`.
7. Refuse to proceed if a GitHub release already exists for the tag. Remove the `gh release upload --clobber` branch.
8. Create the release once, with the three required assets and the checked manual release notes.

If the directory still rejects a newly published version after these checks pass, preserve the verification JSON and asset digests as evidence for Obsidian support. Do not repeatedly rebuild or replace the same release.

### Acceptance criteria

- A release cannot be created from a branch SHA or mismatched tag.
- A release cannot overwrite an existing version's assets.
- The locally verified subject digest equals the uploaded release digest for each attested asset.
- `main.js` contains no `sourceMappingURL`, `sourcesContent`, secret material, or local absolute path; `main.js.map` is absent.
- The matching `docs/releases/<version>.md` exists and contains no template placeholders.

## Network Finding

The current report passes network-pattern review. Preserve that result while documenting the publishing and cache-purge feature's user-configured network behavior.

The plugin-side inventory must distinguish:

- user-configured Pages/publishing origins;
- the optional cache-purge broker origin configured by the user;
- static documentation links that never execute requests;
- Cloudflare Worker-only requests, which are not bundled into the Obsidian plugin;
- test-only and generated Worker type references.

Any newly introduced plugin-side host or request mechanism must update the disclosure and its allowlist test in the same change. The build fails when executable plugin code introduces an undeclared literal host. This is not a substitute for code review of dynamically configured URLs.

## Vault Enumeration Recommendation

### Capability analysis

The six current whole-vault call sites serve different features:

| Location | Purpose | Decision |
| --- | --- | --- |
| `src/ui/editor/commentLinkSuggestions.ts:154` | Suggest existing Markdown notes while typing a wikilink. | Intentional vault index. Centralize and cache rather than rescan on each query. |
| `src/ui/modals/SideNoteTagSuggestModal.ts:42` | Rank tags already used in the vault. | Intentional metadata index. Consume a shared tag index maintained from metadata events. |
| `src/main.ts:479` | List Markdown files under the configured publishing root. | Avoidable whole-vault access. Resolve the root folder and traverse only that subtree. |
| `src/main.ts:941` | Reverse-map a published HTML path to its Markdown source. | Replace repeated scan with a publish-path index scoped to the configured publishing root. |
| `src/ui/views/AsideView.ts:2284` | Supply Markdown candidates to Thought Trail. | Derive candidates from MetadataCache links and indexed comment sources; do not rescan the vault per render. |
| `src/ui/views/AsideView.ts:3969` | Offer destination notes when moving a comment thread. | Intentional vault index because the feature presents all valid destinations. Reuse the shared note index. |

### Shared owner

Introduce one vault note/capability index owned by the plugin lifecycle rather than six independent scans. It exposes focused queries such as:

- ranked link candidates;
- tag usage counts;
- Markdown paths within a configured folder;
- move destinations;
- cached link-graph candidates;
- published source/HTML pairs.

The owner performs the minimum initial seed needed for pre-existing notes and then stays current through registered Vault and MetadataCache events. Consumers receive immutable query results and cannot access the raw mutable index. Folder-scoped publishing queries must never seed from the entire vault.

One initial all-note seed remains an intentional capability for global note suggestions, tag suggestions, and move destinations. Replacing `getMarkdownFiles()` with another whole-vault API solely to evade detection is prohibited. The README must state that Aside indexes note paths and cached tags locally to provide these features and does not transmit the index.

### Acceptance criteria

- Publishing a folder touches only the configured publishing subtree and explicitly referenced assets.
- Opening or rerendering the sidebar does not trigger a fresh whole-vault scan.
- Link, tag, and move suggestions update after note create, delete, rename, and metadata-change events.
- No vault path, tag, or note content is transmitted by the indexing layer.
- Remaining enumeration is centralized, locally justified, and covered by tests for scope and event updates.

## Clipboard Recommendation

### Capability analysis

Aside uses clipboard-related APIs only for user gestures:

- `src/ui/editor/commentEditorPaste.ts` reads `ClipboardEvent.clipboardData` during a paste event to preserve rich Markdown and compact Excalidraw payloads.
- `src/ui/copyTextToClipboard.ts` writes text after an explicit copy action, with a legacy `execCommand("copy")` fallback.
- `src/ui/views/sidebarInteractionController.ts` writes selected text into a copy event's `clipboardData`.
- `src/ui/views/AsideView.ts` uses drag-and-drop `dataTransfer`, which is not ambient clipboard access but belongs in the same interaction audit.

There is no background `navigator.clipboard.readText()` path. Removing all clipboard findings would require deleting rich paste and copy features and is outside the approved design.

### Remediation

- Keep clipboard adapters dependency-injected and directly unit tested.
- Require an event or explicit user command at every production call site.
- Do not add ambient clipboard reads, polling, startup reads, or clipboard logging.
- Ensure logs never contain clipboard payloads; retain `clipboardText` sanitization.
- Replace native textarea construction in the fallback with the approved Obsidian DOM adapter while preserving the active document.
- Add a concise README capability note: Aside reads pasted content only when the user pastes and writes only when the user invokes copy.

### Acceptance criteria

- Automated source checks reject `navigator.clipboard.readText()` and unapproved direct clipboard access.
- Paste and copy tests prove access occurs only through their explicit event/command adapters.
- Clipboard content is never persisted or logged merely because it was copied or pasted.
- Copy/paste behavior continues working when async clipboard access is unavailable.

## Unnecessary Type Assertions

Each warning must be fixed according to its actual narrowing problem; a blanket lint suppression is not acceptable.

| Location | Analysis and required fix |
| --- | --- |
| `src/agents/agentRuntimeAdapter.ts:275` | The conditional result is already assignable to `ExecEnv`; remove the nested assertion and return the inferred value through a typed local if needed. |
| `src/comments/commentMutationController.ts:1067` | Property narrowing on a mutable object does not create the desired intersection reliably. Capture the validated hash and return a new object with `selectedTextHash` explicitly populated. |
| `src/core/derived/derivedCommentMetadata.ts:34-35` | Bound methods already match the declared mutable-cache function types. Remove redundant assertions and use typed locals. |
| `src/core/derived/derivedCommentMetadata.ts:39,46,57,62` | Assignments already target the declared function properties. Remove receiver-compatible assertions and preserve the original methods with exact property types. |
| `src/core/derived/derivedCommentMetadata.ts:146` | This is a private mutable API boundary. Move conversion into one named adapter/type guard; callers must not repeat `as unknown as` chains. |
| `src/core/derived/derivedCommentMetadataPlanner.ts:14` | Replace the assertion with a marker-aware type guard or an intersection accepted by the helper signature. |
| `src/core/time/dateTime.ts:64` | Construct an `Intl.DateTimeFormatOptions`-compatible object directly; add fractional seconds conditionally rather than asserting the full object. |
| `src/logs/logSanitizer.ts:125` | Control-flow narrowing already proves the primitive union. Return the value directly. |
| `src/ui/views/AsideView.ts:1758` | Supply the generic result type to `map` or use `satisfies SidebarRenderableItem`; remove the per-item assertion. |
| `src/ui/views/sidebarDraftEditor.ts:59` | Type the concatenated collection before sorting so the final array assertion is unnecessary. |
| `src/ui/views/sidebarInteractionController.ts:42` | Use the declared `Window.CSS`/highlight extension type through a guard rather than asserting the receiver. |
| `src/ui/views/sidebarSearchHighlight.ts:101,113` | Narrow CSS Highlight registry and constructor values with reusable predicates; do not cast a value after checking it. |

Tests must cover the real boundary behavior for comment hash persistence, derived metadata monkey-patching/restoration, date formatting with milliseconds, sanitizer null handling, render-item ordering, and CSS Highlight absence. Merely compiling after deleting assertions is insufficient.

## Obsidian DOM Helper Migration

### Migration rules

Use the closest existing parent as the construction owner:

- `parent.createDiv`, `parent.createSpan`, or `parent.createEl` when the destination parent is known;
- `fragment.createEl` for table or batch construction inside a `DocumentFragment`;
- `ownerDocument.head.createEl("style")` for document-specific styles;
- one small detached-element helper backed by `ownerDocument.createDocumentFragment().createEl(...)` when a caller genuinely needs an unattached element from a specific document;
- no global `document` helper when the view may live in an Obsidian pop-out window.

The shared detached helper is the only abstraction. Do not create file-specific wrappers that duplicate tag, class, and attribute handling.

### Change groups

| Group | Reported locations | Fix strategy |
| --- | --- | --- |
| Editor decorations | `commentHighlightController.ts:1129`; `commentEditorStyling.ts:23,36,58,134,148` | Create detached spans/elements from the editor's owner document through the shared helper. |
| Modal content | `SupportLogInspectorModal.ts:157,230,247,268,398,401,405,406,417,420,425`; `SupportReportModal.ts:154,201,231` | Build directly from `contentEl`, row, cell, or fragment using Obsidian helpers. |
| Settings | `AsideSetting.ts:89,92` | Build description fragments with `createFragment` and fragment-owned helpers. |
| Sidebar/view content | `AsideView.ts:2478,2517`; `sidebarIndexLoadingState.ts:10,15,37`; `sidebarPersistedComment.ts:233,277`; `sidebarSearchHighlight.ts:123,221,228`; `streamedAgentReplyController.ts:12` | Use the known container where possible; use the detached helper for staging, highlights, and stream cards that must later move between parents. |

Run the official autofix only after the semantic migration is designed. Review every autofix involving `ownerDocument`, a pop-out window, a detached node, CodeMirror decoration DOM, or a fragment. A syntactically clean fix that creates nodes in the wrong document is a regression.

### Acceptance criteria

- `obsidianmd/prefer-create-el` reports no warnings.
- Pop-out windows receive nodes and styles owned by their own document.
- Support log tables, editor decorations, sidebar search marks, loading placeholders, and streamed replies retain their current structure and classes.
- Tests exercise the shared detached helper with two distinct documents.

## Declarative Settings Search

### Compatibility decision

Aside's manifest currently supports Obsidian 1.12.7. The approved approach is the official dual-support path:

- Obsidian 1.13 and later call `getSettingDefinitions()` and skip `display()`.
- Obsidian 1.12.7 continues using `display()`.
- `minAppVersion` remains `1.12.7`.

### Shared settings model

Do not maintain two hand-copied settings screens. Extract a shared setting catalog from `src/ui/settings/AsideSetting.ts`. Each catalog entry owns:

- stable key and page/section placement;
- user-facing name, description, aliases, and keywords;
- visibility/enabled predicate;
- either a declarative control descriptor or a shared custom render callback;
- save/validation behavior;
- legacy rendering metadata when the old runtime needs it.

`getSettingDefinitions()` adapts this catalog to Obsidian's 1.13 definition types. `display()` adapts the same catalog to imperative `Setting` rows. Complex entries—SecretComponent, runtime diagnostics, publishing actions, dynamic visibility, and other side effects—use shared render functions rather than duplicated DOM blocks.

Move the catalog and render helpers into focused modules; `AsideSetting.ts` remains the tab lifecycle and compatibility adapter. This is necessary because the current settings file already owns many unrelated sections and would otherwise duplicate a second full implementation.

### Acceptance criteria

- Every visible legacy setting has one catalog entry and a stable search name.
- Obsidian 1.13 global settings search finds every setting and relevant aliases.
- Legacy and declarative renderers use the same visibility, validation, save, and side-effect functions.
- A parity test compares the stable keys produced by both adapters.
- Manual testing covers SecretComponent, publishing settings, agent runtime status, conditional sections, persistence, and reload on both supported runtime generations.

## Source Layout

The detailed implementation plan may refine names, but responsibility boundaries must remain:

| Path | Responsibility |
| --- | --- |
| `.github/workflows/ci.yml` | Official-style Node matrix calling the shared local build. |
| `.github/workflows/release.yml` | Immutable, tag-bound build, attestation, verification, and release creation. |
| `scripts/check-obsidian-compliance.mjs` | Manifest, disclosure, capability, and workflow invariants not owned by ESLint. |
| `tests/checkObsidianCompliance.test.mjs` | Fixture-driven failures for each repository invariant. |
| `src/core/vault/vaultCapabilityIndex.ts` | Central local index and scoped queries for note, tag, publish, and graph consumers. |
| `src/ui/dom/createDetachedObsidianElement.ts` | The one cross-document detached DOM adapter. |
| `src/ui/settings/asideSettingCatalog.ts` | Shared searchable setting metadata and control/render definitions. |
| `src/ui/settings/asideSettingLegacyAdapter.ts` | Obsidian 1.12.7 imperative adapter. |
| `src/ui/settings/asideSettingDefinitionsAdapter.ts` | Obsidian 1.13 declarative adapter. |
| `README.md` | User-facing network, local vault-indexing, and clipboard disclosures. |

Avoid unrelated architecture changes. Existing feature modules consume these owners through narrow interfaces.

## Testing Strategy

### Static and unit tests

- Fixture tests for every compliance-script invariant and error message.
- Red/green tests for each type-narrowing behavior affected by assertion removal.
- DOM tests for correct owner document, parent placement, classes, attributes, and fragments.
- Vault index tests for initial seed, create, delete, rename, metadata update, folder scope, and no transmission.
- Clipboard tests for explicit gesture adapters, fallback copy, payload sanitization, and failure without a document.
- Settings catalog parity tests and definition search metadata tests.
- Release workflow inspection tests for tag matching, no clobber path, exact asset list, artifact guard, and attestation verification flags.

### CI tests

Node.js 20, 22, and 24 each run a clean `npm ci` followed by `npm run build`. This catches lockfile portability, runtime API assumptions, type errors, current Obsidian lint findings, tests, bundling, and artifact leakage.

### Manual tests

- Obsidian 1.12.7 settings rendering and persistence.
- Obsidian 1.13 settings rendering, global search, conditional controls, and persistence.
- Main-window and pop-out-window DOM behavior.
- Copy, paste, Excalidraw payload, and clipboard fallback behavior.
- Large-vault link/tag/move suggestions and Thought Trail refresh after file events.
- Folder-scoped public publishing with unrelated vault folders present.
- A release candidate built from a throwaway tag or dry-run repository, including attestation identity verification.

## Rollout Sequence

Implement as independently reviewable tracks, in this order:

1. Toolchain upgrade and CI/compliance gate, initially exposing all current findings.
2. Type-assertion cleanup.
3. DOM helper migration.
4. Vault capability index and clipboard disclosure/guards.
5. Declarative settings shared model and dual adapters.
6. Immutable tag-bound release workflow and attestation verification.
7. Full matrix, manual compatibility, artifact-security, and scorecard verification.

The gate lands first so every later track proves it removes findings rather than hiding them. The release workflow lands after source remediation so the next version is built once from a reviewed, scanner-clean commit.

## Definition of Done

This project is complete when:

1. The current official Obsidian lint configuration reports zero errors and warnings.
2. Every reported source location is removed from the scorecard or replaced by a justified, tested implementation.
3. All avoidable whole-vault scans are gone; remaining indexing is centralized, local, and disclosed.
4. Clipboard access is user initiated, minimized, tested, and disclosed.
5. Settings work and remain in parity on Obsidian 1.12.7 and 1.13 or later, with global search on the latter.
6. Push and pull-request CI passes on Node.js 20, 22, and 24.
7. The exact release artifacts pass the security guard and tag-bound cryptographic verification before upload.
8. Published assets cannot be overwritten for an existing version.
9. A newly published version has no release errors or source warnings in the Obsidian directory scorecard.
10. Any remaining behavior recommendation is explicitly accepted because removing it would remove an approved feature; it is not suppressed or disguised.
