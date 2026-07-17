# Obsidian Scorecard Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Aside pass the current official Obsidian source, CI, capability-disclosure, and release-provenance checks while preserving Obsidian 1.12.7 compatibility.

**Architecture:** One local `npm run build` pipeline owns all static and artifact gates; CI and release workflows invoke it rather than duplicating policy. Source remediation is divided into narrow typed adapters for DOM construction, vault indexing, settings definitions, clipboard access, and release verification so each risky capability has one owner and direct tests.

**Tech Stack:** TypeScript 5.9, Obsidian API 1.13 typings, Node.js test runner, ESLint 9 with `eslint-plugin-obsidianmd` 0.4.1, esbuild, GitHub Actions, GitHub artifact attestations.

---

## File map

- Create `.github/workflows/ci.yml` for the Node.js 20/22/24 build matrix.
- Modify `.github/workflows/release.yml` to build on Node 24, reject existing releases, attest only executable outputs, and verify tag-bound attestations before upload.
- Modify `package.json`, `package-lock.json`, and `eslint.config.mjs` to define the shared compliance pipeline and current official lint baseline.
- Create `scripts/check-obsidian-compliance.mjs` and `tests/checkObsidianCompliance.test.mjs` for repository policy invariants.
- Modify `scripts/check-release-artifacts.mjs` and add `tests/checkReleaseArtifacts.test.mjs` so exact public artifacts and source-exposure checks remain one tested guard.
- Modify the assertion-warning source files and their existing focused tests without adding broad suppression.
- Create `src/ui/dom/createDetachedObsidianElement.ts` and `tests/createDetachedObsidianElement.test.ts`; migrate reported native DOM construction sites to parent/fragment helpers or this adapter.
- Create `src/core/vault/vaultCapabilityIndex.ts` and `tests/vaultCapabilityIndex.test.ts`; wire it through `src/main.ts` and the four suggestion/view consumers.
- Modify clipboard adapters/tests and `README.md` to enforce and disclose explicit-gesture access.
- Create `src/ui/settings/asideSettingCatalog.ts`, `asideSettingLegacyAdapter.ts`, and `asideSettingDefinitionsAdapter.ts`; reduce `AsideSetting.ts` to compatibility/lifecycle orchestration and add parity tests.
- Update the tracked spec only when each corresponding implementation and verification item has fresh evidence.

### Task 1: Establish the current toolchain and shared compliance gate

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `eslint.config.mjs`
- Create: `.github/workflows/ci.yml`
- Create: `scripts/check-obsidian-compliance.mjs`
- Create: `tests/checkObsidianCompliance.test.mjs`

- [ ] **Step 1: Add failing fixture tests for repository invariants**

Create temporary fixture repositories in `tests/checkObsidianCompliance.test.mjs` and assert exact failures for version disagreement, a missing disclosure heading, an undeclared literal network host, `navigator.clipboard.readText()`, a missing CI matrix value, and release `--clobber`. Use the public contract:

```js
const issues = checkObsidianCompliance(fixtureRoot);
assert.deepEqual(issues, [
  "manifest.json version 2.0.91 does not match package.json version 2.0.92",
]);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/checkObsidianCompliance.test.mjs`

Expected: FAIL because `scripts/check-obsidian-compliance.mjs` does not exist.

- [ ] **Step 3: Implement the repository checker**

Export `checkObsidianCompliance(rootDir)` and keep CLI exit behavior separate. Read files relative to `rootDir`; return exact issues for manifest/version/minAppVersion mismatches, missing required assets/files, missing capability disclosure markers, literal `https?://` hosts in executable plugin source absent from the disclosure inventory, ambient clipboard reads, CI matrix drift, and release clobber/upload drift.

```js
export function checkObsidianCompliance(rootDir = process.cwd()) {
  const issues = [];
  const packageJson = readJson(rootDir, "package.json");
  const manifest = readJson(rootDir, "manifest.json");
  if (packageJson.version !== manifest.version) {
    issues.push(`manifest.json version ${manifest.version} does not match package.json version ${packageJson.version}`);
  }
  return issues;
}
```

- [ ] **Step 4: Update scripts and dependencies intentionally**

Set `eslint-plugin-obsidianmd` to `^0.4.1`, keep `obsidian` on the current official package, update Node types to a Node-20-compatible current baseline, and add:

```json
{
  "lint": "eslint src --max-warnings 0",
  "typecheck": "tsc -noEmit -skipLibCheck",
  "bundle": "node esbuild.config.mjs production",
  "check:obsidian": "node scripts/check-obsidian-compliance.mjs",
  "build": "npm run test && npm run lint && npm run typecheck && npm run check:obsidian && npm run bundle && npm run release:artifacts:check"
}
```

Run `npm install --package-lock-only` with the project package manager so the existing npm-11 whitespace-only rewrite is replaced by a dependency-bearing lockfile update.

- [ ] **Step 5: Add official-style CI**

Create a push/pull-request workflow with `actions/checkout@v6`, `actions/setup-node@v6`, `node-version: [20, 22, 24]`, `cache: npm`, `npm ci`, and `npm run build`.

- [ ] **Step 6: Verify GREEN and commit**

Run: `node --test tests/checkObsidianCompliance.test.mjs && npm run check:obsidian`

Expected: fixture tests pass; the repository check fails only on source/remediation findings explicitly scheduled below, not on malformed configuration.

Commit: `build: add Obsidian compliance gate`

### Task 2: Remove unnecessary assertion warnings through typed boundaries

**Files:**
- Modify: `src/agents/agentRuntimeAdapter.ts`
- Modify: `src/comments/commentMutationController.ts`
- Modify: `src/core/derived/derivedCommentMetadata.ts`
- Modify: `src/core/derived/derivedCommentMetadataPlanner.ts`
- Modify: `src/core/time/dateTime.ts`
- Modify: `src/logs/logSanitizer.ts`
- Modify: `src/ui/views/AsideView.ts`
- Modify: `src/ui/views/sidebarDraftEditor.ts`
- Modify: `src/ui/views/sidebarInteractionController.ts`
- Modify: `src/ui/views/sidebarSearchHighlight.ts`
- Modify focused tests under `tests/`

- [ ] **Step 1: Add behavior-first regression cases**

Extend existing tests for: validated `selectedTextHash` persistence, metadata-cache install/restore, fractional-second formatting, sanitizer `null`, stable render-item ordering, and absent CSS Highlight APIs. Assertions must exercise exported behavior rather than search source text.

- [ ] **Step 2: Run focused tests and verify RED where behavior is missing**

Run: `npm test -- --test-name-pattern='selectedTextHash|metadata cache|fractional|sanitizer|render item|CSS Highlight'`

Expected: new boundary cases fail for the intended missing/narrowing behavior.

- [ ] **Step 3: Replace each assertion with the narrow design from the spec**

Examples:

```ts
const env: ExecEnv = typeof process === "undefined" ? {} : process.env;
return env;
```

```ts
const options: Intl.DateTimeFormatOptions = { /* common fields */ };
if (includeMilliseconds) options.fractionalSecondDigits = 3;
```

Use a named `MutableMetadataCache` type guard/adapter once, typed locals for bound methods, generic `map<SidebarRenderableItem>()`, and explicit CSS registry/constructor predicates. Do not add `eslint-disable`, `as unknown as`, or blanket receiver casts.

- [ ] **Step 4: Verify focused tests and lint**

Run: `npm test && npm run lint -- --no-cache`

Expected: all behavior tests pass and no unnecessary assertion finding remains.

- [ ] **Step 5: Commit**

Commit: `refactor: remove scorecard type assertions`

### Task 3: Centralize cross-document detached DOM creation

**Files:**
- Create: `src/ui/dom/createDetachedObsidianElement.ts`
- Create: `tests/createDetachedObsidianElement.test.ts`
- Modify reported files in `src/comments/`, `src/ui/editor/`, `src/ui/modals/`, `src/ui/settings/`, and `src/ui/views/`

- [ ] **Step 1: Write a failing two-document adapter test**

The test supplies two fake owner documents whose fragments record `createEl` calls and verifies each returned node belongs to the supplied document:

```ts
const node = createDetachedObsidianElement(secondDocument, "span", {
  cls: "aside-test",
  text: "Test",
});
assert.equal(node.ownerDocument, secondDocument);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --test-name-pattern='detached Obsidian element'`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement the single adapter**

```ts
export function createDetachedObsidianElement<K extends keyof HTMLElementTagNameMap>(
  ownerDocument: Document,
  tag: K,
  options?: DomElementInfo,
): HTMLElementTagNameMap[K] {
  return ownerDocument.createDocumentFragment().createEl(tag, options);
}
```

- [ ] **Step 4: Migrate known-parent and detached call sites**

Use `contentEl.createEl`, `row.createEl`, `fragment.createEl`, or `ownerDocument.head.createEl` where a parent exists. Use only the shared adapter for CodeMirror decorations, staging nodes, search marks, loading placeholders, streamed replies, and clipboard fallback textarea. Preserve `ownerDocument` at all pop-out boundaries.

- [ ] **Step 5: Verify structure and lint**

Run: `npm test && npm run lint -- --no-cache`

Expected: DOM structure tests pass and `obsidianmd/prefer-create-el` has zero warnings.

- [ ] **Step 6: Commit**

Commit: `refactor: use Obsidian DOM helpers`

### Task 4: Introduce the vault capability index and scoped publishing traversal

**Files:**
- Create: `src/core/vault/vaultCapabilityIndex.ts`
- Create: `tests/vaultCapabilityIndex.test.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/editor/commentLinkSuggestions.ts`
- Modify: `src/ui/modals/SideNoteTagSuggestModal.ts`
- Modify: `src/ui/views/AsideView.ts`
- Modify: lifecycle/event registration modules as required

- [ ] **Step 1: Write failing index tests**

Cover one initial Markdown-note seed, immutable path queries, tag count replacement on metadata changes, create/delete/rename events, graph candidates, and traversal that starts at the configured `TFolder` and never calls `getMarkdownFiles()`.

```ts
assert.deepEqual(index.listMarkdownPathsInFolder("public"), ["public/a.md"]);
assert.equal(vault.getMarkdownFilesCalls, 1); // global seed only
assert.equal(folderTraversalWholeVaultCalls, 0);
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --test-name-pattern='vault capability index'`

Expected: FAIL because the owner does not exist.

- [ ] **Step 3: Implement narrow immutable queries**

Create `VaultCapabilityIndex` with `seedGlobalNoteCapabilities()`, `handleCreate`, `handleDelete`, `handleRename`, `handleMetadataChanged`, `rankedLinkCandidates`, `tagUsageCounts`, `moveDestinations`, `thoughtTrailCandidates`, `listMarkdownPathsInFolder`, and published source/HTML mapping. Return copied/read-only arrays and maps; never expose mutable storage.

- [ ] **Step 4: Wire lifecycle events and consumers**

Instantiate once in plugin lifecycle, register Vault/MetadataCache events with plugin cleanup, replace consumer scans with focused queries, and replace both publishing scans in `src/main.ts` with folder traversal/publish-path lookup.

- [ ] **Step 5: Verify scope and no per-render scans**

Run: `npm test && rg -n 'getMarkdownFiles\(' src`

Expected: only the intentional initial seed remains; tests prove sidebar rerender and publishing do not rescan the vault.

- [ ] **Step 6: Commit**

Commit: `refactor: centralize vault capability indexing`

### Task 5: Enforce explicit clipboard gestures and disclose capabilities

**Files:**
- Modify: `src/ui/copyTextToClipboard.ts`
- Modify: `src/ui/editor/commentEditorPaste.ts`
- Modify: `src/ui/views/sidebarInteractionController.ts`
- Modify: `tests/sidebarClipboardOwnership.test.ts`
- Modify: `tests/sidebarInteractionController.test.ts`
- Modify: `README.md`
- Modify: `scripts/check-obsidian-compliance.mjs`

- [ ] **Step 1: Add failing gesture-boundary and disclosure tests**

Prove paste reads only the supplied `ClipboardEvent`, copy receives an explicit command/gesture adapter, fallback uses the active document, payloads are not logged, and the compliance checker rejects `navigator.clipboard.readText()`.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --test-name-pattern='clipboard|paste|copy' && node --test tests/checkObsidianCompliance.test.mjs`

Expected: new ownership/disclosure case fails.

- [ ] **Step 3: Narrow adapters and add maintained disclosure**

Keep writes behind explicit copy actions, rich reads behind paste events, drag payloads behind drag events, and remove any ambient navigator fallback not tied to a command. Add README sections with stable compliance markers for network origins, local note/tag indexing, clipboard behavior, and Cloudflare publishing services.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test && npm run check:obsidian`

Expected: clipboard tests and capability inventory pass.

Commit: `docs: disclose minimized plugin capabilities`

### Task 6: Build one settings catalog with legacy and declarative adapters

**Files:**
- Create: `src/ui/settings/asideSettingCatalog.ts`
- Create: `src/ui/settings/asideSettingLegacyAdapter.ts`
- Create: `src/ui/settings/asideSettingDefinitionsAdapter.ts`
- Modify: `src/ui/settings/AsideSetting.ts`
- Create: `tests/asideSettingCatalog.test.ts`
- Modify: `tsconfig.test.json`

- [ ] **Step 1: Inventory stable setting keys and write failing parity tests**

Extract a stable key for every currently rendered row. Tests compare visible keys from both adapters and assert definition names, descriptions, aliases, keywords, visibility, and save callbacks without calling I/O from `getSettingDefinitions()`.

```ts
assert.deepEqual(
  legacyAdapter.keysFor(state),
  definitionAdapter.keysFor(state),
);
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --test-name-pattern='setting catalog|declarative settings'`

Expected: FAIL because the catalog/adapters are absent.

- [ ] **Step 3: Implement catalog types and shared behavior**

Define entries with `key`, `section`, `name`, `desc`, `aliases`, `keywords`, `visible`, `disabled`, `read`, `save`, and either a declarative control or shared custom renderer. Keep runtime diagnostics, SecretComponent, publishing actions, and other side-effectful rows in render callbacks.

- [ ] **Step 4: Implement both adapters**

`asideSettingLegacyAdapter.ts` creates imperative `Setting` rows. `asideSettingDefinitionsAdapter.ts` returns `SettingDefinitionItem[]`. `AsideSetting.getSettingDefinitions()` performs no file/network work; `display()` remains for Obsidian 1.12.7. Both consume the same catalog predicates and save functions.

- [ ] **Step 5: Verify parity and type compatibility**

Run: `npm test && npm run typecheck && npm run lint -- --no-cache`

Expected: every stable key is present in both adapters, typings compile against 1.13, and `manifest.json.minAppVersion` remains `1.12.7`.

- [ ] **Step 6: Commit**

Commit: `feat(settings): add searchable declarative catalog`

### Task 7: Make release creation immutable and attestations tag-bound

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/check-release-artifacts.mjs`
- Create: `tests/checkReleaseArtifacts.test.mjs`
- Modify: `tests/checkObsidianCompliance.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add failing workflow/artifact tests**

Assert Node 24, tag/version check before build, `npm ci`, shared `npm run release:check`, exact asset list, no `--clobber` or `gh release edit`, rejection when a release exists, attestation for `main.js` and `styles.css`, and verification flags for repo, source ref/SHA, and signer workflow. Add artifact fixtures for source maps, `sourcesContent`, secrets, raw TS/JSX-family files, and local paths.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/checkReleaseArtifacts.test.mjs tests/checkObsidianCompliance.test.mjs`

Expected: current workflow fails immutable-release and tag-bound-verification assertions.

- [ ] **Step 3: Strengthen the artifact guard**

Keep `RELEASE_ARTIFACTS = ["main.js", "manifest.json", "styles.css"]`; reject `main.js.map`, embedded sources, obvious secret files/material, local paths, and raw `.ts`, `.tsx`, `.jsx`, `.mts`, or `.cts` files in any staged release directory while permitting `.d.ts` only when explicitly requested (the default exact asset set contains none).

- [ ] **Step 4: Rewrite the release workflow**

Use Node 24, fail if `gh release view "$GITHUB_REF_NAME"` succeeds, run release checks from the tag checkout, attest `main.js` and `styles.css`, run `gh attestation verify` for each attested local subject with repository/ref/SHA/signer constraints, then create exactly one release containing `main.js`, `manifest.json`, and `styles.css`. Never edit or upload over an existing release.

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test tests/checkReleaseArtifacts.test.mjs tests/checkObsidianCompliance.test.mjs && npm run release:artifacts:check`

Expected: workflow and exact artifact checks pass.

Commit: `ci: bind releases to immutable attestations`

### Task 8: Full compliance verification and tracked-spec update

**Files:**
- Modify: `docs/superpowers/specs/2026-07-17-obsidian-scorecard-compliance-design.md`
- Modify only if evidence requires it: implementation files from Tasks 1-7

- [ ] **Step 1: Verify clean installs across Node versions**

Run in clean environments for Node 20, 22, and 24: `npm ci && npm run build`.

Expected: exit 0 for each matrix member with zero lint warnings.

- [ ] **Step 2: Inspect the exact release artifact set**

Run: `npm run release:artifacts:check && find . -maxdepth 1 -type f \( -name 'main.js*' -o -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' -o -name '.env*' -o -name '.npmrc' \) -print`

Expected: the guard passes for `main.js`, `manifest.json`, and `styles.css`; no map, embedded source, secret file, or local path is present in the shipped set.

- [ ] **Step 3: Re-run source audits**

Run: `npm run lint -- --no-cache && npm run check:obsidian && rg -n 'getMarkdownFiles\(|navigator\.clipboard\.readText\(|document\.createElement\(|ownerDocument\.createElement\(' src`

Expected: zero lint warnings; only the documented initial vault seed and approved non-HTML namespace creation remain.

- [ ] **Step 4: Record manual verification separately**

Document pending manual checks for Obsidian 1.12.7, 1.13+, pop-out windows, clipboard gestures, large-vault indexing, and a throwaway tag attestation. Do not mark these complete without fresh observed evidence.

- [ ] **Step 5: Update implementation tracking from evidence**

Mark only proven implementation/verification items `[x]`; leave manual directory scorecard and runtime compatibility checks unchecked if they were not actually run.

- [ ] **Step 6: Final commit**

Commit: `docs: record Obsidian compliance verification`
