# SideNote2 Development

Development notes for `SideNote2`. The main [README.md](./README.md) stays product-level; this file is for setup, internals, and testing.

## Docs Layout

Use `docs/` for material we expect to keep current as the repo evolves.

Examples:

- `README-dev.md`
- `docs/architecture.md`
- `docs/architecture.canvas`
- `docs/feature-map.canvas`
- `docs/comment-route-map.canvas`
- `docs/comment-lifecycle.canvas`

## Architecture

See [architecture.md](./docs/architecture.md) for the visual module map, comment route map, and lifecycle state machine.
See [feature-map.canvas](./docs/feature-map.canvas) for the feature-first overview.


## Storage

Each note stores comments in a trailing hidden `<!-- SideNote2 comments -->` block:

```
<!-- SideNote2 comments
[
  {
    "id": "thread-1",
    "startLine": 12,
    "startChar": 4,
    "endLine": 12,
    "endChar": 19,
    "selectedText": "selected words",
    "selectedTextHash": "hash-selected-words",
    "entries": [
      {
        "id": "entry-1",
      {
        "id": "entry-2",
        "body": "Follow-up reply.",
        "timestamp": 1710000005000
    "updatedAt": 1710000005000
  }
]
-->
```

The stored payload includes coordinates and a text hash so anchors can be re-matched after edits. The block is hidden in Reading view, but still present in raw markdown for source-mode workflows and LLM ingestion.

## Dependencies

- Most of the plugin logic is implemented in this repo.
- The production bundle includes no third-party runtime packages.
- Obsidian, Electron, CodeMirror, Lezer, and Node built-ins stay external at bundle time.
  
```text
+--------------------- Dependency Model ---------------------+
| In-repo code (most plugin behavior)                        |
|   src/main.ts                                              |
|   src/commentManager.ts                                    |
|   src/core/*  src/ui/*  src/index/*  src/cache/*           |
|                                                            |
| Build-time packages                                        |
|   typescript  esbuild  builtin-modules  tslib              |
|   @types/node  @typescript-eslint/*  obsidian              |
|                                                            |
| Host/runtime APIs kept external                            |
|   obsidian  electron  @codemirror/*  @lezer/*              |
|   node built-ins                                           |
|                                                            |
| Result                                                     |
|   main.js is mostly our code, with host APIs left out      |
+------------------------------------------------------------+
```

## Run

```bash
npm install
npm run dev
```

- Keep `npm run dev` running while testing in Obsidian.
- Dev mode rebuilds `main.js` and reloads the `side-note2` plugin after a successful build.
- Open the target vault in Obsidian before starting dev mode.
- If you want watch mode without automatic plugin reload, use:

```bash
SIDENOTE2_HOT_RELOAD=0 npm run dev
```

- `npm test` runs the Node test suite.
- `npm run build` creates the production bundle and fails if release artifacts leak source-map markers.

## Release

```bash
VERSION=<next-version>
cp docs/releases/_template.md "docs/releases/${VERSION}.md"
npm version patch
npm run release:check
git push origin main --follow-tags
```

- Required: create `docs/releases/<version>.md` before tagging. `npm run release:check` and the GitHub release workflow both fail if the exact versioned notes file is missing or still contains template placeholders.
- `npm version patch|minor|major` updates `package.json`, `manifest.json`, `versions.json`, and the README release badge.
- `npm run release:check` runs the tests, the production build, the shipped-artifact inspection, and the required release-notes check.
- `origin` should point to the canonical public source repo: `SideNote2`.
- The shipped-artifact inspection checks exactly `main.js`, `manifest.json`, and `styles.css`.
- Releases should not ship `main.js.map`, `sourceMappingURL`, `sourcesContent`, private keys, certificates, tokens, or obvious local absolute paths.
- GitHub releases upload only `main.js`, `manifest.json`, and `styles.css`.

## Local Install

For desktop-only development against a local vault, use a symlink:

```bash
VAULT="/path/to/vault"
mkdir -p "$VAULT/.obsidian/plugins"
ln -sfn "$(pwd)" "$VAULT/.obsidian/plugins/side-note2"
```

- Then enable `SideNote2` in Obsidian.
- Open the ribbon action `Open SideNote2 index` to show the index note and sidebar view.
- If auto reload misses a change, reload the plugin manually:

```bash
obsidian plugin:reload id=side-note2 vault="<vault-name>"
```

For mobile testing through Obsidian Sync, do not use a symlink. Copy the built plugin artifacts into the synced vault instead:

```bash
npm run build
npm run dev:install-built -- --vault "/path/to/synced-vault"
```

- This copies exactly `main.js`, `manifest.json`, and `styles.css` into `"/path/to/synced-vault/.obsidian/plugins/side-note2/"`.
- After Sync finishes, reload Obsidian on mobile or disable and re-enable the plugin there.
- This is the right path when you want to test an unreleased build on mobile without pushing a new release.
- The remote bridge token is stored only on the current device, so if you test remote `@codex` on mobile you still need to enter the token on the phone.

## DGX Bridge

The repo now includes a standalone DGX/mobile bridge runner for the existing remote runtime contract:

```bash
cp .env.example .env
npm run dgx:bridge
```

- The runner listens for:
  - `POST /v1/sidenote2/runs`
  - `GET /v1/sidenote2/runs/{runId}?after=<cursor>`
  - `POST /v1/sidenote2/runs/{runId}/cancel`
- By default it reads `.env` from the repo root.
- For local development, the example config uses:
  - `SIDENOTE2_DGX_PUBLIC_BASE_URL=http://127.0.0.1:4215`
  - `SIDENOTE2_DGX_WORKSPACE_ROOT=.dgx-workspace`
- The bridge runs `codex app-server` inside `SIDENOTE2_DGX_WORKSPACE_ROOT`, so remote runs can inspect or edit that server-side workspace while still returning only the final thread reply to Obsidian.
- On a real DGX deployment, change at minimum:
  - `SIDENOTE2_DGX_BIND_HOST`
  - `SIDENOTE2_DGX_PUBLIC_BASE_URL`
  - `SIDENOTE2_DGX_WORKSPACE_ROOT`
  - `SIDENOTE2_DGX_BRIDGE_BEARER_TOKEN`
- The mobile plugin should then point its remote bridge base URL and token at that service.

## Debugging

Persistent local logs are always on.

- Logs are written under `.obsidian/plugins/side-note2/logs/`
- Files rotate daily and retain 3 days
- Use the sidebar support button to review the attached log and submit a report
