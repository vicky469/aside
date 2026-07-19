# Release Scan Remediation Design

**Date:** 2026-07-19
**Status:** Implemented locally; next release scan pending

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Verified the latest GitHub release is `2.0.94`, published on 2026-07-19, with assets `main.js`, `manifest.json`, and `styles.css`.
- [x] Verified the downloaded `2.0.94` `main.js` SHA-256 is `4fab68c9e5359cedf41bfa0b744fa10a1330fb13bbe11931686078f6aacc1f0e`, matching the GitHub release metadata and the local release artifact.
- [x] Verified the shipped `2.0.94` `main.js` contains no `eslint-disable`, no `eslint-enable`, no `fetch` token, and no source map marker.
- [x] Verified the shipped `2.0.94` `main.js` contains one `requestUrl` call, one `getMarkdownFiles` startup seed, and clipboard write/paste adapters.
- [x] Verified `node scripts/check-obsidian-compliance.mjs` passes locally.
- [x] Verified `node scripts/check-release-artifacts.mjs` passes locally for `main.js`, `manifest.json`, and `styles.css`.
- [x] Mapped the reported eslint-disable risk family to committed source-archive content, especially `workers/cache-purge-broker/src/worker-configuration.d.ts`.
- [x] Mapped the reported `fetch` warning to non-plugin source candidates: dev hot-reload code in `esbuild.config.mjs` and Cloudflare Worker code under `workers/cache-purge-broker`.
- [x] Confirmed the vault enumeration and clipboard findings correspond to intentional user-facing capabilities already disclosed in `README.md`.
- [x] Created and initialized `vicky469/aside-private` as a private repository.
- [x] Moved the reference Cloudflare cache-purge Worker source to `aside-private`.
- [x] Removed the reference Cloudflare cache-purge Worker source from the public Aside repository.
- [x] Reconciled `scripts/hooks/pre-push` with the single-`origin` public repository rule.
- [x] Replaced dev-only `fetch` in `esbuild.config.mjs` with a Node `http` helper.
- [x] Extended `scripts/check-obsidian-compliance.mjs` with public source-archive hygiene checks for eslint directive comments and dev-only `fetch`.
- [x] Extended `scripts/check-release-artifacts.mjs` to reject a global `fetch` token in shipped `main.js`.

### Remaining Follow-up

- [ ] Produce a versioned release-scan evidence note for the next release, recording artifact digests, source-scan results, and the accepted vault/clipboard capability rationale.
- [ ] Run the next automated marketplace/source scan and confirm the eslint-disable risks and `fetch` warning are gone.

### Verification

- [x] `rg -n '/\\*\\s*eslint-disable|//\\s*eslint-disable|eslint-enable|eslint-disable-line|eslint-disable-next-line'` over public runtime/source files reports no directive comments outside intentional test/spec fixtures.
- [x] `rg -n '\\bfetch\\s*\\('` over plugin runtime source and release artifacts reports no Obsidian-plugin HTTP path using `fetch`.
- [x] `npm run lint` passes with no inline configuration and zero warnings.
- [x] `npm run check:obsidian` passes and includes source-archive hygiene checks.
- [x] `npm run release:artifacts:check` passes and includes the `main.js` `fetch` assertion.
- [x] `npm run build` passes after non-plugin source movement.
- [x] `gh repo view vicky469/aside-private --json name,visibility` confirms the private repo exists and is private.
- [x] `git config --get core.hooksPath` returns `scripts/hooks`, and `scripts/hooks/pre-push` agrees with the single-`origin` repository rule.
- [ ] `gh release view <next-version> --json assets` shows only `main.js`, `manifest.json`, and `styles.css` as public release assets.
- [ ] The next automated scan no longer reports eslint-disable risks or the `fetch` warning.
- [x] Remaining vault enumeration and clipboard findings are explicitly accepted as intentional, README-disclosed capabilities tied to product features that would need removal to eliminate the capability.

## Problem

The automated scan of the latest release reports seven findings:

1. Four eslint-disable risks:
   - unlimited `eslint-disable`;
   - undescribed directive comment;
   - missing `eslint-enable`;
   - disabling protected Obsidian/security rules is not allowed.
2. One `fetch` warning: use Obsidian `requestUrl` instead of `fetch` for network requests.
3. Two capability findings:
   - vault enumeration;
   - clipboard access.

The findings mix two different scan surfaces:

- the exact shipped Obsidian plugin assets: `main.js`, `manifest.json`, and `styles.css`;
- the broader GitHub source archive or repository source visible to automated scanners.

The shipped `2.0.94` `main.js` does not contain eslint directives or `fetch`. Therefore the eslint and `fetch` findings are not caused by executable Obsidian release asset code. They are source-archive hygiene findings. The vault and clipboard findings do exist in the shipped plugin asset, but they represent documented product capabilities rather than accidental background access.

## Diagnosis

### Release asset evidence

The GitHub release metadata for `2.0.94` reports these public assets:

| Asset | Size | SHA-256 |
| --- | ---: | --- |
| `main.js` | 565,379 bytes | `4fab68c9e5359cedf41bfa0b744fa10a1330fb13bbe11931686078f6aacc1f0e` |
| `manifest.json` | 239 bytes | `1d98407859ab89ba060b8636a08e12fb60e71f964dde123813cc5229ea7cdcdd` |
| `styles.css` | 71,989 bytes | `8a9ec6517fdc5233763593936be66aebb601f76af405d44bc1bc587a93d17d21` |

The downloaded release `main.js` matches the local artifact and contains:

| Signal | Count | Interpretation |
| --- | ---: | --- |
| `eslint-disable` | 0 | The eslint-disable risks are not in shipped `main.js`. |
| `eslint-enable` | 0 | Same. |
| `fetch` token | 0 | The `fetch` warning is not in shipped `main.js`. |
| `requestUrl` | 1 | Plugin-side HTTP uses Obsidian's API in the release asset. |
| `navigator.clipboard` | 2 | Clipboard write helper exists for explicit copy actions. |
| `clipboardData` | 3 | Paste/copy event adapters exist for user gestures. |
| `getMarkdownFiles` | 1 | Startup vault note index seed exists. |

`node scripts/check-release-artifacts.mjs` passes and confirms the exact release assets contain no source map marker, embedded sources, secret-like tokens, certificates, private keys, or local absolute paths.

### Eslint-disable risk family

The strongest source match is the generated Cloudflare Worker type file:

```text
workers/cache-purge-broker/src/worker-configuration.d.ts
```

It contains generated directive comments:

- `/* eslint-disable */` at the file start;
- another `/* eslint-disable */` before generated runtime types;
- `// eslint-disable-line` comments inside generated Cloudflare runtime declarations.

Local ESLint intentionally ignores this generated file, and repository governance already sets `noInlineConfig: true` for maintained surfaces. The external scanner is stricter: it treats committed source-archive content as reviewable even when local ESLint ignores it. That is reasonable for a marketplace source review. The fix should remove the generated directive comments from committed public source rather than adding local suppressions.

### Fetch warning

The shipped plugin asset has no `fetch` token and uses `requestUrl` for the cache-purge broker request.

Source-archive candidates are:

- `esbuild.config.mjs`: dev-only CDP hot reload calls localhost with global `fetch`;
- `workers/cache-purge-broker/src/index.ts`: Cloudflare Worker runtime handlers and outbound Cloudflare API calls use Worker `fetch`, as required by the Worker runtime;
- worker tests and generated types that mention `fetch`.

These are not Obsidian plugin runtime network paths. However, they are committed under the same public repository and can be seen by a broad source scanner. The fix should narrow the public plugin repository's scan surface and avoid `fetch` in dev tooling where a standard-library replacement is straightforward.

### Vault enumeration finding

The release asset contains one startup call:

```text
this.app.vault.getMarkdownFiles()
```

Source location:

```text
src/main.ts
```

This seeds `VaultCapabilityIndex` once on plugin load. The index powers note link suggestions, tag usage, move destinations, Thought Trail candidates, and the generated Aside index. It is then maintained from Obsidian vault and metadata events. Existing implementation has already removed repeated per-render scans and folder publishing now traverses the configured folder subtree.

This is an intentional local vault capability, not an accidental leak. It should remain unless the product decision is to remove global note/tag suggestions, move destinations, and graph/index features or put them behind a materially different opt-in mode.

### Clipboard access finding

The release asset contains clipboard access through user-gesture adapters:

- `src/ui/editor/commentEditorPaste.ts` reads `ClipboardEvent.clipboardData` during a paste event;
- `src/ui/views/sidebarInteractionController.ts` writes selected sidebar text during a copy event;
- `src/ui/copyTextToClipboard.ts` uses `navigator.clipboard.writeText` after an explicit copy action and falls back to a temporary detached textarea plus `execCommand("copy")`.

The compliance script already rejects `navigator.clipboard.readText()`. There is no background clipboard read, polling, persistence, or logging path. This is an intentional copy/paste capability and is disclosed in `README.md`.

## Design Principles

### Fix source-archive hygiene, not by hiding real behavior

If a capability is real, do not evade the scanner by swapping to a different API with the same access. Vault indexing and clipboard writes are real product capabilities. They should be minimized, tested, disclosed, and accepted unless the feature is removed.

The eslint directive and broad `fetch` findings are different. They are avoidable source-archive noise caused by non-plugin code living in the public plugin repository. Those should be eliminated.

### Keep one compliance owner

Do not patch each finding with ad hoc suppressions. Add one repository compliance owner that knows the difference between:

- release assets;
- plugin runtime source;
- dev tooling;
- worker/support services;
- generated files;
- test fixtures.

The owner should fail when source that will be public to Obsidian reviewers contains unsafe directive comments or plugin-side network APIs.

### Keep the public plugin repository scanner-clean

The public `aside` repository is the Obsidian marketplace repo. It should be boring to scan. Non-plugin support services, generated cloud runtime types, and private modular packages should live outside this repository unless there is a deliberate reason to expose them.

## Dependency Map

The release-scan remediation is not standalone. Its implementation depends on these earlier or adjacent decisions:

| Dependency | Current status | Blocks | Required action |
| --- | --- | --- | --- |
| Private package repository spec: `docs/superpowers/specs/2026-07-19-private-package-repo-design.md` | Implemented. `gh repo view vicky469/aside-private --json name,visibility` returns `PRIVATE`. | Moving Worker/support packages into `aside-private`. | Keep using the separate private repository; do not add it as a remote to the public checkout. |
| Single-remote routing rule from `AGENTS.md` and the private repo spec | Implemented. This checkout has only `origin`. | Any private-repo workflow that assumes a `private` remote in the public checkout. | Keep the public checkout on `origin` only; clone or check out `aside-private` separately when needed. |
| `scripts/hooks/pre-push` | Reconciled with the single-`origin` rule and covered by `check:obsidian`. | Clean private-repo setup and normal branch pushes from the public repo. | Keep the hook limited to blocking non-`origin` remotes. |
| Remote cache purge broker spec: `docs/superpowers/specs/2026-07-15-remote-cache-purge-broker-design.md` | Split. Plugin-side optional broker client/settings/docs remain public; reference Worker source moved to `aside-private`. | Avoiding non-plugin Worker scanner findings in the public Obsidian plugin source archive. | Continue developing Worker source in `aside-private` unless a later spec chooses a dedicated Worker repo. |
| ESLint governance spec: `docs/superpowers/specs/2026-07-18-ban-eslint-disable-design.md` | Extended with public source-archive hygiene checks in `check:obsidian`. Branch-protection verification remains external. | Preventing future inline directive regressions after generated Worker files move. | Keep generated directive files out of the public source archive. |
| Obsidian scorecard compliance spec: `docs/superpowers/specs/2026-07-17-obsidian-scorecard-compliance-design.md` | Previously centralized vault indexing and clipboard disclosures. | Avoiding duplicate fixes that re-open already-settled capability decisions. | Treat vault enumeration and clipboard access as intentional disclosed capabilities unless a new feature-removal spec says otherwise. |

Implemented ordering:

1. Create `aside-private` or choose a dedicated Worker repo.
2. Fix the stale public-repo pre-push hook so it no longer conflicts with the single-`origin` rule.
3. Move or split the Worker source.
4. Remove generated directive files and dev-only `fetch` source false positives.
5. Strengthen compliance/artifact checks.
6. Cut the next release only after release notes and scan evidence are prepared.

## Proposed Solution

### Track 1: Remove generated directive comments from public source

Stop committing `workers/cache-purge-broker/src/worker-configuration.d.ts` as-is.

Preferred approach:

1. Generate Worker runtime types during `npm run typecheck:worker` into an ignored path.
2. Keep a small maintained `env.d.ts` or checked-in type shim only for the bindings the Worker source actually uses.
3. Ensure the maintained shim has no eslint directive comments.
4. Add a compliance test that fails if any committed non-test comment starts with an eslint directive.

Fallback approach:

1. Keep a sanitized generated type file with all eslint directive comments stripped.
2. Add a generation script that strips directives deterministically.
3. Add a test that fails if the checked-in sanitized file drifts from generated output after stripping.

The preferred approach is cleaner because it avoids committing a large generated runtime file to the public plugin repository.

### Track 2: Move non-plugin Worker source out of the public plugin repo

The Cloudflare cache-purge broker is not part of the Obsidian plugin bundle. It should move to `aside-private` or a dedicated Worker repository. That move depends on implementing the private repository spec first if `aside-private` remains the target.

Public Aside should keep only:

- the plugin-side broker client;
- settings for a user-configured broker URL and secret;
- documentation that says the broker is optional and externally hosted.

If the Worker remains useful for testers, publish or share it from the private repository separately. Do not ship or expose it as part of the public Obsidian plugin source archive unless the project intentionally accepts Worker-specific scanner findings.

This also aligns with the separate private package repository direction: future modular or support packages can live outside the public marketplace repo while the public plugin remains buildable without private dependencies.

### Track 3: Remove dev-only `fetch` from public source

`esbuild.config.mjs` uses global `fetch` only for localhost CDP hot reload. Replace it with a small Node `http` request helper.

This is not required for runtime safety because it never ships in `main.js`, but it is cheap and removes a broad-source false positive.

Keep using Obsidian `requestUrl` in plugin runtime code. Add an artifact assertion that the production `main.js` does not contain a `fetch` token.

### Track 4: Strengthen release/source scanners

Extend `scripts/check-obsidian-compliance.mjs` or split a focused `scripts/check-release-source-scan.mjs` if that keeps ownership clearer.

The scanner should verify:

- no committed non-test source comment uses `eslint-disable`, `eslint-enable`, `eslint-disable-line`, or `eslint-disable-next-line`;
- no generated public source file contains inline eslint directive comments;
- plugin runtime source under `src/` does not call global `fetch` for HTTP;
- production `main.js` has no `fetch` token;
- production `main.js` uses `requestUrl` for the known plugin-side cache-purge request;
- README still contains network, local vault indexing, clipboard, and external service disclosures.

Tests should use fixtures for each failure so future changes fail before release.

### Track 5: Keep and document intentional capabilities

Vault enumeration and clipboard access are not accidental findings.

Keep the current capability posture:

- one startup seed of Markdown files into `VaultCapabilityIndex`;
- event-driven updates after startup;
- no vault path/tag transmission;
- clipboard reads only from paste events;
- clipboard writes only from copy actions/events;
- no background clipboard reads.

For the next release, add a versioned scan-evidence note under `docs/releases/scan-evidence/` or another agreed location. It should contain:

- release asset digests;
- source hygiene checks run;
- explanation of the remaining vault and clipboard findings;
- link to the README disclosures.

If the goal later becomes zero capability findings, that is a product change. It would require deleting or gating features, not a scanner-only remediation.

## Alternatives Considered

### A. Add local ESLint ignores or comments

Rejected. Local ignores already exist and did not prevent the external scan. Adding descriptions or narrower eslint disables would still leave directive comments in public source and fight the scanner instead of improving reviewability.

### B. Keep Worker code in the public plugin repository

Possible, but it keeps a permanent mismatch between Obsidian plugin scanning and Cloudflare Worker source. This repository is the public marketplace repo; keeping unrelated runtime code here increases false positives and review burden.

### C. Remove vault indexing and clipboard access

Possible only as a feature-removal decision. It would break or degrade link suggestions, tag suggestions, move targets, Thought Trail, the generated index, rich paste, and copy actions. This design does not recommend it.

### D. Rename or wrap APIs to avoid string-based scanner matches

Rejected. If behavior remains the same, this is scanner evasion. The only acceptable API replacement in this design is replacing dev-only `fetch` with Node `http`, because the behavior is not part of the plugin runtime and there is no user-facing Obsidian network capability there.

## Acceptance Criteria

The remediation is complete when:

1. The public source archive has no generated eslint directive comments.
2. The public source archive has no dev-tool `fetch` false positive.
3. Non-plugin Worker code no longer appears in the public Obsidian plugin scan surface.
4. The production `main.js` still contains no `fetch` token and uses `requestUrl` for plugin HTTP.
5. The exact release assets still pass the release artifact guard.
6. The public Aside repo still builds without private dependencies.
7. The next automated scan reports no eslint-disable risks and no `fetch` warning.
8. Any remaining vault enumeration and clipboard findings are accepted as intentional, minimized, documented capabilities.

## Rollout

1. Create and initialize `vicky469/aside-private`, or choose a dedicated Worker repository instead.
2. Reconcile the active pre-push hook with the current single-`origin` rule.
3. Add source-scan fixture tests for eslint directive comments and plugin-side `fetch`.
4. Move `workers/cache-purge-broker` out of the public plugin repo, keeping the plugin-side broker client public.
5. Remove or sanitize generated Worker declaration files that remain temporarily during the split.
6. Replace dev hot-reload `fetch` with Node `http`.
7. Extend artifact and compliance checks.
8. Run `npm run build`.
9. Prepare the next release notes and scan-evidence note.
10. Cut the next release only after the exact artifacts and public source scan pass.

## Open Decisions

- Whether to keep public docs for the optional broker after moving its source out of the public plugin repository.
- Whether the project wants to accept vault/clipboard scorecard findings permanently as disclosed capabilities, or later design a reduced-capability mode that removes those features.
