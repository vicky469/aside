# SideNote2 Development

Development notes for `SideNote2`. The main [README.md](../README.md) stays product-level; this file is for setup, internals, and testing.

## Architecture

See [architecture.md](./architecture.md) for the visual module map, comment route map, and lifecycle state machine.


## Storage

Each note stores comments in a trailing hidden `<!-- SideNote2 comments -->` block:

````md
<!-- SideNote2 comments
[
  {
    "id": "comment-1",
    "startLine": 2,
    "startChar": 6,
    "endLine": 2,
    "endChar": 10,
    "selectedText": "beta",
    "selectedTextHash": "sha256...",
    "comment": "Keep this compact.",
    "timestamp": 1710000000000,
    "resolved": false
  }
]
-->
````

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
cd "/path/to/SideNote2"
npm install
npm run dev
```

- Keep `npm run dev` running while testing.
- `npm run build` creates a production bundle.
- `npm test` runs the Node test suite.
- `npm run skill:install` copies the packaged SideNote2 Codex skill into the default Codex skills directory. This matches the end-user install flow.
- `npm run comment:update -- --file "/abs/path/note.md" --id "<comment-id>" --comment-file "/abs/path/comment.md"` updates one stored comment body using the same managed block format as the plugin.
- `npm version patch|minor|major` updates `package.json`, `manifest.json`, `versions.json`, and the beta release docs together for a release bump.
- The test suite covers the note-backed comment lifecycle, comment retargeting and pruning, JSON storage updates, aggregate note generation, and the parsed-note cache plus aggregate index behavior.

The canonical repo skill lives in `skills/side-note2-note-comments/`.
When Codex is working in this repo, use that repo-local skill directly. There is no separate sync or link step for development.
Use `npm run skill:install` only when you want to test the user-style global Codex skill install flow on this machine.

For user or agent comment edits outside the UI, find the target `id` in the trailing `<!-- SideNote2 comments -->` block in source mode, then run the helper script instead of hand-editing escaped JSON.

## Local Install

Install the plugin into your vault with:

```bash
VAULT="/path/to/your/vault"
REPO="/path/to/SideNote2"
PLUGIN_ID="side-note2"
PLUGIN_DIR="$VAULT/.obsidian/plugins/$PLUGIN_ID"

mkdir -p "$VAULT/.obsidian/plugins"
if [ -L "$PLUGIN_DIR" ]; then rm "$PLUGIN_DIR"; fi
ln -s "$REPO" "$PLUGIN_DIR"
```

Then open that vault in Obsidian and enable `SideNote2` under community plugins.

## Reload

If Obsidian feels stale during development, reload the plugin from DevTools:

- For Mac, use `Command + option + i` to inspect, then switch to the `Console` tab and run:

```js
await app.plugins.disablePlugin("side-note2");
await app.plugins.enablePlugin("side-note2");
```

## Debugging

Debug logging is opt-in and lives in `src/debug.ts`.

Enable or disable it in `Settings > SideNote2 > Debug mode`.

Inspect:

```js
window.__SIDENOTE2_DEBUG__;
window.__SIDENOTE2_DEBUG_STORE__;
```
