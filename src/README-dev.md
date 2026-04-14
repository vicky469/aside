# SideNote2 Development

Development notes for `SideNote2`. The main [README.md](../README.md) stays product-level; this file is for setup, internals, and testing.

## Docs Layout

Use `src/docs/` for material we expect to keep current as the repo evolves.

Examples:

- `src/README-dev.md`
- `src/docs/architecture.md`
- `src/docs/architecture.canvas`
- `src/docs/feature-map.canvas`
- `src/docs/comment-route-map.canvas`
- `src/docs/comment-lifecycle.canvas`

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
npm version patch
npm run release:check
git push origin main --follow-tags
```

- `npm version patch|minor|major` updates `package.json`, `manifest.json`, `versions.json`, and the README release badge.
- `npm run release:check` runs the tests and the production build.
- `origin` should point to the canonical public source repo: `SideNote2`.
- Before pushing a release tag, inspect the shipped files: `main.js`, `manifest.json`, and `styles.css`.
- Releases should not ship `main.js.map`, `sourceMappingURL`, or `sourcesContent`.
- GitHub releases upload only `main.js`, `manifest.json`, and `styles.css`.

## Local Install

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

## Debugging

Persistent local logs are always on.

- Logs are written under `.obsidian/plugins/side-note2/logs/`
- Files rotate daily and retain 3 days
- Use the sidebar support button to review the attached log and submit a report
