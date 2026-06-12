# Aside Development

Development notes for `Aside`. The main [README.md](./README.md) stays product-level; this file is for setup, internals, and testing.

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

[[storage]]

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
|   typescript  esbuild  tslib                               |
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
- Dev mode rebuilds `main.js` and reloads the `aside` plugin in the `dev` vault after a successful build.
- Open the target vault in Obsidian before starting dev mode.
- To target another vault for hot reload, set `ASIDE_HOT_RELOAD_VAULT=<vault-name>`.
- If you want watch mode without automatic plugin reload, use:

```bash
ASIDE_HOT_RELOAD=0 npm run dev
```

- `npm test` runs the Node test suite. The DGX bridge socket integration tests auto-skip outside DGX Spark devices; set `ASIDE_RUN_DGX_BRIDGE_SOCKET_TESTS=1` to force them.
- `npm run build` runs the full test suite first, then lint, then creates the production bundle. It now fails on test failures instead of bypassing them.

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
- `npm run release:check` runs the test-enforced production build, the shipped-artifact inspection, and the required release-notes check.
- `origin` should point to the canonical public source repo: `Aside`.
- The shipped-artifact inspection checks exactly `main.js`, `manifest.json`, and `styles.css`.
- Releases should not ship `main.js.map`, `sourceMappingURL`, `sourcesContent`, private keys, certificates, tokens, or obvious local absolute paths.
- GitHub releases upload only `main.js`, `manifest.json`, and `styles.css`.

## Local Install

For desktop-only development against a local vault, use a symlink:

```bash
VAULT="/path/to/vault"
mkdir -p "$VAULT/.obsidian/plugins"
ln -sfn "$(pwd)" "$VAULT/.obsidian/plugins/aside"
```

- Then enable `Aside` in Obsidian.
- Open the ribbon action `Open Aside index` to show the index note and sidebar view.
- If auto reload misses a change, reload the plugin manually:

```bash
obsidian plugin:reload id=aside vault="<vault-name>"
```

For mobile testing through Obsidian Sync, do not use a symlink. Copy the built plugin artifacts into the synced vault instead:

```bash
npm run build
npm run dev:install-built -- --vault "/path/to/synced-vault"
```

- This copies exactly `main.js`, `manifest.json`, and `styles.css` into `"/path/to/synced-vault/.obsidian/plugins/aside/"`.
- After Sync finishes, reload Obsidian on mobile or disable and re-enable the plugin there.
- This is the right path when you want to test an unreleased build on mobile without pushing a new release.

## Debugging

Persistent local logs are always on.

- Logs are written under `.obsidian/plugins/aside/logs/`
- Files rotate daily and retain 3 days
- Use the sidebar support button to review the attached log and submit a report

### Electron DevTools

Use this when you want to search TypeScript files and bind breakpoints while testing Aside in Obsidian.

1. Keep the dev watcher running:

```bash
npm run dev
```

2. Open Obsidian's Electron DevTools with `Command+I`.

3. In DevTools, use file search to open `src/main.ts` or another `src/*.ts` file and set breakpoints there.

Dev mode writes the sourcemapped bundle to `.aside-dev/main.js` and keeps root `main.js` as a local bootstrap so Electron DevTools sees a real `file://` script with TypeScript sources.

The production `npm run build` path still emits no source maps and fails if release artifacts contain `sourceMappingURL`, `sourcesContent`, or `main.js.map`.
