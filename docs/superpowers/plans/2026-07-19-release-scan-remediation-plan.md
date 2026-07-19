# Release Scan Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove avoidable release/source-scan findings by creating the private repo foundation, removing stale private-remote assumptions from the public repo, moving non-plugin Worker source out of the public scanner surface, and enforcing source/archive hygiene in local release checks.

**Architecture:** Keep public Aside as a single-remote Obsidian marketplace plugin repo. Keep plugin runtime code and the optional broker client public, but move the reference Cloudflare Worker source to the separate private repo. Add compliance checks for public source hygiene so ignored/generated files cannot reintroduce scanner findings.

**Tech Stack:** GitHub CLI, Git, npm workspaces, Node.js test runner, TypeScript, ESLint 9, esbuild, Obsidian `requestUrl`.

---

## File Map

- Create private repo: `vicky469/aside-private`
- Create private repo files: `README.md`, `package.json`, `packages/README.md`, `docs/modularization.md`, `workers/cache-purge-broker/**`
- Modify public repo: `scripts/hooks/pre-push`
- Modify public repo: `package.json`
- Modify public repo: `README.md`
- Modify public repo: `esbuild.config.mjs`
- Modify public repo: `scripts/check-obsidian-compliance.mjs`
- Modify public repo: `scripts/check-release-artifacts.mjs`
- Modify public repo: `tests/checkObsidianCompliance.test.mjs`
- Modify public repo: `tests/checkReleaseArtifacts.test.mjs`
- Modify public repo: `tests/eslintGovernance.test.mjs`
- Delete public repo: `workers/cache-purge-broker/**`
- Update specs after evidence: `docs/superpowers/specs/2026-07-19-private-package-repo-design.md`, `docs/superpowers/specs/2026-07-19-release-scan-remediation-design.md`

## Task 1: Create the private repository skeleton

**Files:**
- Create private repo: `vicky469/aside-private`
- Create private repo: `README.md`
- Create private repo: `package.json`
- Create private repo: `packages/README.md`
- Create private repo: `docs/modularization.md`

- [ ] **Step 1: Create the GitHub repository**

Run:

```bash
gh repo create vicky469/aside-private --private --description "Private Aside packages and support services." --clone=false
```

Expected: command exits `0`, or exits with "already exists". If it already exists, run `gh repo view vicky469/aside-private --json name,visibility` and continue only if `visibility` is `PRIVATE`.

- [ ] **Step 2: Initialize a temporary local checkout**

Run:

```bash
mkdir -p /private/tmp/aside-private
git -C /private/tmp/aside-private init
git -C /private/tmp/aside-private branch -M main
git -C /private/tmp/aside-private remote add origin https://github.com/vicky469/aside-private.git
```

Expected: local repo exists under `/private/tmp/aside-private`; public Aside remotes remain unchanged.

- [ ] **Step 3: Add skeleton files**

Create:

```json
{
  "name": "aside-private",
  "version": "0.0.0",
  "private": true,
  "description": "Private Aside packages and support services.",
  "workspaces": [
    "packages/*",
    "workers/*"
  ],
  "scripts": {
    "test": "echo \"No private package tests configured yet.\""
  }
}
```

Add `README.md` explaining that the repo owns private packages and support services, not public plugin releases. Add `packages/README.md` for future package modules. Add `docs/modularization.md` with the rule that public Aside must remain buildable without private dependencies.

- [ ] **Step 4: Commit and push**

Run:

```bash
git -C /private/tmp/aside-private add README.md package.json packages/README.md docs/modularization.md
git -C /private/tmp/aside-private commit -m "chore: initialize private workspace"
git -C /private/tmp/aside-private push -u origin main
gh repo view vicky469/aside-private --json name,visibility
```

Expected: repo exists and `visibility` is `PRIVATE`.

## Task 2: Reconcile public pre-push routing

**Files:**
- Modify: `scripts/hooks/pre-push`
- Test: `tests/checkObsidianCompliance.test.mjs`
- Modify: `scripts/check-obsidian-compliance.mjs`

- [ ] **Step 1: Add failing compliance fixture for stale private remote hook text**

In `tests/checkObsidianCompliance.test.mjs`, add a fixture file `scripts/hooks/pre-push` containing `git push private $branch` and assert:

```js
assert.deepEqual(checkObsidianCompliance(rootDir), [
  "scripts/hooks/pre-push must not advertise or require private or icloud remotes",
]);
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/checkObsidianCompliance.test.mjs
```

Expected: FAIL because the compliance checker does not inspect the pre-push hook.

- [ ] **Step 3: Replace hook logic**

Make `scripts/hooks/pre-push` enforce only the current rule:

- `origin` is the normal remote;
- branch pushes and tags are allowed to `origin`;
- any remote other than `origin` fails with a message saying this public repo uses one remote.

- [ ] **Step 4: Add checker logic**

In `scripts/check-obsidian-compliance.mjs`, read `scripts/hooks/pre-push` when present and reject `git push private`, `private →`, `icloud`, or `two-remote`.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
node --test tests/checkObsidianCompliance.test.mjs
npm run check:obsidian
```

Expected: both commands exit `0`.

## Task 3: Add source/archive hygiene checks

**Files:**
- Modify: `scripts/check-obsidian-compliance.mjs`
- Modify: `tests/checkObsidianCompliance.test.mjs`

- [ ] **Step 1: Add failing fixture tests**

Add tests asserting:

- `src/generated.d.ts` with `/* eslint-disable */` fails with `src/generated.d.ts contains forbidden ESLint directive comment`;
- `esbuild.config.mjs` with `fetch("http://127.0.0.1:9222/json/list")` fails with `esbuild.config.mjs uses fetch in public source; use Node http/https or keep dev-only transport out of the public source archive`;
- `src/main.ts` with `fetch("https://api.example.com")` still fails as an undeclared plugin host.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/checkObsidianCompliance.test.mjs
```

Expected: FAIL because these new checks do not exist.

- [ ] **Step 3: Implement checker**

Add source-hygiene scanning for public code/config paths. Exclude `docs/`, `node_modules/`, `.git/`, `main.js`, `.test-dist/`, and test fixtures. Reject eslint directive comments and dev-tool `fetch` in public config files. Keep existing `src/` network-host detection.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test tests/checkObsidianCompliance.test.mjs
npm run check:obsidian
```

Expected: both commands exit `0` after Worker source is moved and dev `fetch` is removed.

## Task 4: Remove dev-only `fetch` from esbuild config

**Files:**
- Modify: `esbuild.config.mjs`
- Test: `tests/checkObsidianCompliance.test.mjs`

- [ ] **Step 1: Verify current source finding**

Run:

```bash
rg -n '\bfetch\s*\(' esbuild.config.mjs
```

Expected: reports the CDP target list request.

- [ ] **Step 2: Implement Node HTTP helper**

Replace the CDP target-list `fetch` call with `node:http` request code that returns parsed JSON and checks status codes.

- [ ] **Step 3: Verify source finding is gone**

Run:

```bash
rg -n '\bfetch\s*\(' esbuild.config.mjs
node --test tests/checkObsidianCompliance.test.mjs
```

Expected: `rg` reports no matches in `esbuild.config.mjs`; tests exit `0`.

## Task 5: Move cache-purge Worker source to private repo

**Files:**
- Copy to private repo: `workers/cache-purge-broker/**`
- Delete public repo: `workers/cache-purge-broker/**`
- Modify public repo: `package.json`
- Modify public repo: `README.md`
- Modify public repo: `tests/eslintGovernance.test.mjs`

- [ ] **Step 1: Copy Worker source into private repo**

Copy `workers/cache-purge-broker` from public Aside into `/private/tmp/aside-private/workers/cache-purge-broker`.

- [ ] **Step 2: Commit and push private Worker source**

Run:

```bash
git -C /private/tmp/aside-private add workers/cache-purge-broker
git -C /private/tmp/aside-private commit -m "chore: move cache purge broker source"
git -C /private/tmp/aside-private push origin main
```

Expected: private repo now owns the Worker source.

- [ ] **Step 3: Delete Worker source from public repo**

Delete the public `workers/cache-purge-broker` files. Remove root package scripts `test:worker`, `typecheck:worker`, and `verify:worker`. Remove `npm run verify:worker` from `build`.

- [ ] **Step 4: Update public docs and tests**

Update `README.md` to say the optional broker is externally hosted and its reference implementation is maintained outside the public plugin source archive. Update `tests/eslintGovernance.test.mjs` so maintained runtime assertions no longer require worker paths.

- [ ] **Step 5: Verify public repo no longer exposes Worker scan surface**

Run:

```bash
test ! -d workers/cache-purge-broker
rg -n 'workers/cache-purge-broker|worker-configuration\.d\.ts|eslint-disable' workers src scripts esbuild.config.mjs tests package.json README.md
npm run check:obsidian
```

Expected: Worker directory is absent; only intentional docs/test references remain; compliance exits `0`.

## Task 6: Strengthen release artifact guard

**Files:**
- Modify: `scripts/check-release-artifacts.mjs`
- Modify: `tests/checkReleaseArtifacts.test.mjs`

- [ ] **Step 1: Add failing artifact tests**

In `tests/checkReleaseArtifacts.test.mjs`, add fixture assertions that:

- `main.js` containing `fetch(` fails with `main.js contains global fetch token`;
- `main.js` missing `requestUrl` fails when plugin-side cache purge code is present.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/checkReleaseArtifacts.test.mjs
```

Expected: FAIL because artifact guard does not check `fetch`.

- [ ] **Step 3: Implement artifact checks**

Add `fetch` token detection to `scripts/check-release-artifacts.mjs`. Keep source-map, secret, certificate, and local-path checks unchanged.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test tests/checkReleaseArtifacts.test.mjs
npm run release:artifacts:check
```

Expected: both commands exit `0`.

## Task 7: Update specs and run full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-19-private-package-repo-design.md`
- Modify: `docs/superpowers/specs/2026-07-19-release-scan-remediation-design.md`

- [ ] **Step 1: Update checklists with evidence**

Mark only implemented and verified items complete. Leave next-release automated scan and release-asset verification pending until a release exists.

- [ ] **Step 2: Run focused verification**

Run:

```bash
node --test tests/checkObsidianCompliance.test.mjs tests/checkReleaseArtifacts.test.mjs tests/eslintGovernance.test.mjs
npm run check:obsidian
npm run release:artifacts:check
git remote -v
git config --get core.hooksPath
gh repo view vicky469/aside-private --json name,visibility
```

Expected: tests/checks exit `0`; public repo still has only `origin`; private repo is `PRIVATE`.

- [ ] **Step 3: Run full build**

Run:

```bash
npm run build
```

Expected: tests, lint, typecheck, compliance, bundle, and release artifact guard exit `0`.

- [ ] **Step 4: Commit public repo implementation**

Run:

```bash
git add .
git commit -m "build: clean release scan surface"
```

Expected: public repo commit contains hook cleanup, source scan checks, dev `fetch` removal, Worker source removal, package script updates, README update, tests, and spec checklist updates.
