# TODO: Obsidian Plugin Submission Checklist

Checked against the official Obsidian docs and local repo guidance on 2026-04-14:

- `Obsidian October plugin self-critique checklist`
- `Submit your plugin`
- `Submission requirements for plugins`
- `Plugin guidelines`
- `Plugin security`
- `obsidian-plugin-dev` skill guidance
- local `AGENTS.md` release artifact security rules

## Repository And Metadata

- [x] Root repo has `README.md`, `LICENSE`, and `manifest.json`.
- [x] The plugin source is public on GitHub at `vicky469/SideNote2`.
- [x] `manifest.json` uses a valid semver version.
- [x] `versions.json` includes the current `manifest.json` version.
- [x] `package-lock.json` is committed.
- [x] `fundingUrl` only points to financial support.
- [x] Plugin id is `side-note2`, which does not contain `obsidian`.
- [x] `side-note2` is not already present in Obsidian's current `community-plugins.json` as of 2026-04-14.

## Compatibility And Runtime

- [x] Removed the desktop-only block. `manifest.json` now keeps `isDesktopOnly` `false`, and the remaining desktop-specific diagnostics path (`electron` log-location reveal) is runtime-gated so it does not block mobile loading.
- [x] Updated `minAppVersion` to `1.12.7` to match the latest public Obsidian desktop release as of 2026-03-23.
- [x] Command text does not include the plugin name or plugin id.
- [x] No default hotkeys are registered in code.
- [ ] Run a real Android or iOS smoke test before claiming mobile support in the submission PR.

## Documentation And User Disclosures

- [x] `README.md` explains what the plugin does and how to use it.
- [x] `README.md` includes bug reporting instructions.
- [x] `README.md` includes a contact path for sensitive security issues.

## Security And Code Review

- [x] No telemetry or analytics SDKs were found in `src/` or `package.json`.
- [x] Support-report sending code uses Obsidian `requestUrl` instead of `fetch`.
- [x] The current build has no active support-report endpoint because `src/support/supportConfig.ts` sets `SUPPORT_REPORT_ENDPOINT_URL` to `null`.
- [x] Reviewed and trimmed non-essential console output so routine startup and warning-level plugin events stay in SideNote2 logs instead of the default console.
- [x] Reviewed the remaining HTML injection sinks. `SupportLogInspectorModal.ts` escapes row content before table HTML assembly, `sidebarDraftComment.ts` escapes draft text before preview rendering, `sidebarPersistedComment.ts` no longer uses `innerHTML` for the external-link SVG icon, and the Mermaid view in `SideNote2View.ts` only injects Mermaid-generated SVG from sanitized labels and encoded Obsidian URLs.

## Release Artifact Security

- [x] The latest GitHub release ships `main.js`, `manifest.json`, and `styles.css`.
- [x] The production build already blocks `main.js.map`, `sourceMappingURL`, and `sourcesContent`.
- [x] Release policy already requires inspecting the shipped artifacts `main.js`, `manifest.json`, and `styles.css`.
- [x] Before each public release, `npm run release:artifacts:check` now inspects the exact shipped artifacts and fails on missing assets, `main.js.map`, source-map markers, embedded sources, obvious secrets, or local absolute paths.

## Submission Workflow

- [ ] Submit the plugin entry to `obsidianmd/obsidian-releases/community-plugins.json`.
- [ ] Open the submission PR with title `Add plugin: SideNote2`.
- [ ] Fill in the PR template and wait for the validation bot to mark it `Ready for review`.

## After Submission

- [ ] Address review comments in the same PR.
- [ ] If Obsidian asks for changes, cut a new GitHub release and update the same submission PR instead of opening a new one.

## Meta

- [x] Added this marketplace-submission checklist workflow to the shared `obsidian-plugin-dev` skill so it is part of future release/submission prep by default.
