# Reference Map

Use this file first to decide which local references to load.

## Core Paths

- `developer-docs/Plugins/Getting started/`
  Build setup, plugin anatomy, development workflow, mobile notes, React and Svelte starter paths.
- `developer-docs/Plugins/User interface/`
  Commands, settings tabs, views, workspace behavior, modals, ribbon actions, icons, status bar, context menus.
- `developer-docs/Plugins/Editor/`
  CodeMirror and editor work: editor extensions, view plugins, decorations, state fields, markdown post processing.
- `developer-docs/Plugins/Releasing/`
  Submission requirements, plugin guidelines, beta testing, GitHub Actions release flow.
- `developer-docs/Reference/TypeScript API/`
  One markdown page per API symbol. Use with `api/obsidian-api/*.d.ts`.
- `developer-docs/Reference/CSS variables/`
  Styling tokens for plugin UI.
- `help/Extending Obsidian/`
  Community plugin lifecycle, plugin security, URI, CLI, headless integration.
- `help/Contributing to Obsidian/Developers.md`
  Contribution-facing notes around docs and development.
- `api/obsidian-api/`
  Canonical typings and upstream changelog.
- `sample-plugin/`
  Known-good repo structure, build config, manifest shape, settings pattern.

## Task Routing

- New plugin or repo setup:
  `sample-plugin/`, then `developer-docs/Plugins/Getting started/`
- Commands, settings, views, ribbon, menus:
  `developer-docs/Plugins/User interface/`, then `api/obsidian-api/obsidian.d.ts`
- Markdown renderer, post processors, CM6, editor extensions:
  `developer-docs/Plugins/Editor/`, then `api/obsidian-api/obsidian.d.ts`
- Vault, workspace, file operations, events:
  `developer-docs/Plugins/Vault.md`, `developer-docs/Plugins/Events.md`, then typings
- Release and submission:
  `developer-docs/Plugins/Releasing/`, then `help/Extending Obsidian/Community plugins.md`
- URI, CLI, automation, headless:
  `help/Extending Obsidian/Obsidian URI.md`, `Obsidian CLI.md`, `Obsidian Headless.md`

## Search Commands

```bash
rg -n "class Plugin|registerView|addCommand|addSettingTab|addRibbonIcon|registerEditorExtension" api/obsidian-api/obsidian.d.ts
rg -n "Plugin guidelines|Submission requirements|Submit your plugin|GitHub Actions" developer-docs/Plugins/Releasing
rg -n "Commands|Settings|Views|Workspace|Modals|Ribbon" developer-docs/Plugins/User\\ interface
rg -n "Markdown post processing|Editor extensions|View plugins|Decorations|State fields" developer-docs/Plugins/Editor
rg -n "Community plugins|Plugin security|Obsidian URI|Obsidian CLI|Obsidian Headless" help/Extending\\ Obsidian
```
