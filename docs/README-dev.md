# SideNote2 Development

Development notes for `SideNote2`. The main [README.md](../README.md) stays product-level; this file is for setup, internals, and testing.

## Docs Layout

Use `docs/` for material we expect to keep current as the repo evolves.

Examples:

- `README-dev.md`
- `architecture.md`
- `architecture.canvas`
- `feature-map.canvas`
- `comment-route-map.canvas`
- `comment-lifecycle.canvas`

Use `docs/thoughts/` for working notes, refactor logs, and naming or design thoughts that reflect the current thinking but are not treated as maintained reference docs.

## Architecture

See [architecture.md](./architecture.md) for the visual module map, comment route map, and lifecycle state machine.
See [feature-map.canvas](./feature-map.canvas) for the feature-first overview.


## Storage

Each note stores comments in a trailing hidden `<!-- SideNote2 comments -->` block:

``` 
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
cd "/path/to/SideNote2"
npm install
npm run dev
```

- Keep `npm run dev` running while testing.
- `npm run dev` now does two things in development:
  - watches and rebuilds `main.js`
  - reloads the `side-note2` plugin through the Obsidian CLI after each successful rebuild
- Open Obsidian on the target vault before starting `npm run dev`. Hot reload can only reload a plugin inside a running vault.
- This matters because Obsidian runs `main.js`, not `src/*.ts`. A source edit is not live until the bundle is rebuilt and the plugin instance is reloaded.
- If you want watch mode without automatic plugin reload, run:

```bash
SIDENOTE2_HOT_RELOAD=0 npm run dev
```

- `npm run build` creates a production bundle.
- `npm test` runs the Node test suite.
- `npm run skill:install` copies the packaged SideNote2 Codex skills into the default Codex skills directory. By default it installs every bundled skill under `skills/`; pass `-- --name <skill-name>` to install just one. This matches the end-user install flow.
- `npm run comment:append -- --file "/abs/path/note.md" --id "<comment-id>" --comment-file "/abs/path/reply.md"` appends one new entry to an existing SideNote2 thread using the same managed block format as the plugin.
- `npm run comment:migrate-legacy -- --file "/abs/path/note.md" --dry-run` is a temporary maintenance fallback for a note that somehow missed the automatic `2.0.1` startup migration.
- `npm run comment:migrate-legacy -- --root "/abs/path/to/vault" --dry-run` is the same fallback at vault scope for out-of-band repair work, not the normal upgrade path.
- `npm run comment:update -- --file "/abs/path/note.md" --id "<comment-id>" --comment-file "/abs/path/comment.md"` updates one stored comment body using the same managed block format as the plugin.
- The plugin auto-migrates legacy flat note comments once per vault on startup in `2.0.1`. Normal upgrades should not require any manual migration command.
- `comment:append`, `comment:migrate-legacy`, and `comment:update` now write atomically and refuse to overwrite a note if it changed after the script first read it. If Obsidian Sync or another editor is active, pass `-- --settle-ms 2000` to require a short quiet window before each write, then rerun any skipped notes after Sync settles. Treat skipped-note runs as partial success and retry them instead of hand-editing the managed JSON.
- `npm version patch|minor|major` updates `package.json`, `manifest.json`, `versions.json`, and the README beta badge together for a release bump.
- The test suite covers the note-backed comment lifecycle, comment retargeting and pruning, JSON storage updates, aggregate note generation, and the parsed-note cache plus aggregate index behavior.

## Linux Sandbox Troubleshooting

On Ubuntu 24.04 and similar Linux hosts, Codex may fail to start sandboxed commands with a message like:

```text
Reason: command failed; retry without sandbox?
```

For this repo, that failure was not caused by SideNote2 vault permissions. The actual problem was host AppArmor policy blocking the Codex Linux sandbox from creating unprivileged user namespaces.

Quick checks:

```bash
unshare -Ur true
unshare -Urn true
```

If either command fails with `Operation not permitted`, check these host prerequisites:

- `uidmap` is installed so `newuidmap` and `newgidmap` exist
- AppArmor is not blocking unprivileged user namespaces for the Codex sandbox binary

Install the namespace mapping helpers:

```bash
sudo apt update
sudo apt install -y uidmap
```

Temporary diagnostic workaround:

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

Preferred long-term fix: add a targeted AppArmor profile for the current Codex sandbox binary and then restore:

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1
```

Profile shape used by Ubuntu 24.04:

```text
abi <abi/4.0>,
include <tunables/global>

profile codex-linux-san /absolute/path/to/codex flags=(unconfined) {
  userns,
  include if exists <local/codex-linux-san>
}
```

On the DGX Spark setup used during development, the active Codex binary path was:

```text
/home/bun/.nvm/versions/node/v24.13.1/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-arm64/vendor/aarch64-unknown-linux-musl/codex/codex
```

After loading the profile, restart the Codex session and re-run the `unshare` checks above.

## Local Install

On a fresh machine, identify the actual vault you want to run against before linking the plugin.
The vault is often not the repo root.

```bash
obsidian vaults verbose
obsidian vault info=path
```

If the repo lives inside a larger Obsidian vault, use that outer vault path for `VAULT`.

Install the plugin into your vault with:

```bash
VAULT="/path/to/your/vault"
REPO="/path/to/SideNote2"
PLUGIN_ID="side-note2"
PLUGIN_DIR="$VAULT/.obsidian/plugins/$PLUGIN_ID"

mkdir -p "$VAULT/.obsidian/plugins"
if [ -L "$PLUGIN_DIR" ]; then rm "$PLUGIN_DIR"; fi
if [ -e "$PLUGIN_DIR" ] && [ ! -L "$PLUGIN_DIR" ]; then mv "$PLUGIN_DIR" "$PLUGIN_DIR.backup.$(date +%Y%m%d-%H%M%S)"; fi
ln -s "$REPO" "$PLUGIN_DIR"
```

Then open that vault in Obsidian and enable `SideNote2` under community plugins.
If you prefer the CLI:

```bash
obsidian plugin:enable id=side-note2 vault="<vault-name>"
```

The plugin installs as a symlink on purpose. `npm run dev` rebuilds `main.js` in the repo root, and Obsidian should load that same checkout rather than a copied plugin folder.

## Open The View

After enabling the plugin, click the SideNote2 ribbon icon labeled `Open SideNote2 index`.
That opens the index note and ensures the right-sidebar SideNote2 view exists.

If you want a console fallback in DevTools:

```js
await app.plugins.plugins["side-note2"].activateView(false);
```

## Reload

`npm run dev` should normally handle plugin reloads automatically after a successful rebuild.

If Obsidian still feels stale during development, reload the plugin manually.

- Preferred CLI path:

```bash
obsidian plugin:reload id=side-note2 vault="<vault-name>"
```

- DevTools fallback:

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
