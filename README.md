# SideNote2
<p align="center">
  <img src="./logo-readme.svg" alt="SideNote2 logo" width="72">
</p>
<p align="center">
  <a href="https://github.com/vicky469/SideNote2/releases/tag/2.0.0">
    <img src="https://img.shields.io/badge/beta-2.0.0-f97316?style=flat-square" alt="Current beta">
  </a>
  <a href="./docs/README-dev.md">
    <img src="https://img.shields.io/badge/docs-dev%20notes-0f766e?style=flat-square" alt="Dev docs">
  </a>
  <a href="./docs/README-dev.md">
    <img src="https://img.shields.io/badge/built-mostly%20in--repo-2563eb?style=flat-square" alt="Built mostly in repo">
  </a>
  <a href="./docs/README-dev.md#dependencies">
    <img src="https://img.shields.io/badge/runtime-no%20bundled%20deps-16a34a?style=flat-square" alt="No bundled runtime dependencies">
  </a>
</p>
<p align="center">
  <a href="https://obsidian.md">
    <img src="https://img.shields.io/badge/Obsidian-API-7c3aed?style=flat-square&logo=obsidian&logoColor=white" alt="Obsidian API">
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-language-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  </a>
  <a href="https://codemirror.net/">
    <img src="https://img.shields.io/badge/CodeMirror-editor-0ea5e9?style=flat-square" alt="CodeMirror">
  </a>
  <a href="https://lezer.codemirror.net/">
    <img src="https://img.shields.io/badge/Lezer-parser-f59e0b?style=flat-square" alt="Lezer">
  </a>
</p>
<p align="center">
  <img src="./assets/demo-preview.gif" alt="SideNote2 demo preview" width="900">
</p>

For the fuller dependency and architecture notes, see [README-dev.md](./docs/README-dev.md).

SideNote2 is an [Obsidian](https://obsidian.md) plugin for side comments that stay attached to the note.

It is built for a minimal workflow: humans work in the sidebar, while agents can read the same comments directly from the markdown file. Inspired by [mofukuru/SideNote](https://github.com/mofukuru/SideNote).

## Features

- Uses a dedicated sidebar for drafting, editing, resolving, reopening, and deleting comments.
- Supports Obsidian-style `[[wikilinks]]` inside side comments to link existing notes or create new markdown notes.
- Type `#` in a side note to search existing tags or add a new one.
- Keeps resolved comments archived instead of removing them.
- Generates `SideNote2 index.md` as a vault-wide comment index.
- Lets the index sidebar switch between the comment list and a thought-trail graph built from side-note wiki links. The graph follows those links across connected markdown files, so it can show multi-step trails instead of only direct one-hop links.
- Supports agent workflows so Codex, Claude Code, and other assistants can read and update side comments from the note-backed storage format.

## How to Get Started

1. Install BRAT
   settings -> install community plugins -> BRAT
2. Install the SideNote2 beta
   Open BRAT, enable Auto update if you want, then add the plugin as shown below.
   <p align="center">
     <img src="./image.png" alt="Install SideNote2 with BRAT" width="420">
   </p>
3. Optional: use the bundled SideNote2 agent instructions.

Example install for Codex CLI:
```bash
python ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --repo \
  vicky469/SideNote2 --path skills/side-note2-note-comments skills/canvas-design
```

`side-note2-note-comments` helps agents read and update SideNote2-backed notes. `canvas-design` is a bundled Obsidian canvas-layout skill for cleaner spacing, grouping, and board readability. If you use Claude Code or another assistant, adapt the same instructions there.

## Workflow

1. Select text in a note.
2. Right-click `Add comment to selection`.
   You can use the ribbon button to open the sidebar, or assign your own hotkey in Obsidian.
3. Write the comment in the sidebar.
   See `Writing in Side Notes` below for editor shortcuts and formatting behavior.
4. Review it later from the sidebar, from `SideNote2 index.md`, or from the sidebar thought trail.

## Writing in Side Notes

| Action | How it works |
| --- | --- |
| Save draft | Click `Save`. |
| Insert a newline | Press `Enter`. |
| Link a note | Type `[[` to open note suggestions and insert an Obsidian wikilink. |
| Add a tag | Type `#` to open tag suggestions and insert a tag. |
| Reopen link or tag suggestions | Press `Tab` while the cursor is inside an unfinished `[[...` or `#...` token. |
| Bold or highlight text | Use the sidebar `B` and `H` buttons to wrap the current selection with `**bold**` or `==highlight==`. |
| Cancel a draft or edit | Press `Esc`. |

For power users:

Agents can read the side notes from markdown.

In Codex CLI, Claude Code, or another assistant, you can ask:

```text
Show me the side comment for "selected text" in "/Users/path/to/note.md".
```

Or update it:

```text
Update the side comment for "selected text" in "/Users/path/to/note.md" to:
Your new side comment text here.
```

If multiple side comments in the same note use the same selected text, include a little more nearby context or the comment id.

## Settings

- `Index header image URL`
- `Index header image caption`
- `Debug mode`
  This is not implemented yet.

## Command

- `SideNote2: Add comment to selection`

## Storage

For MD files:
Each note stores its comments in a trailing hidden `<!-- SideNote2 comments -->` JSON block inside the same markdown file.

For PDF files:
The JSON block is stored in plugin data.

`SideNote2 index.md` is just a generated index, not separate storage.

## Development

Setup, local vault install, debugging, and architecture notes live in [README-dev.md](./docs/README-dev.md).

## Changelog

### 2.0.0 - 2026-04-06

- Breaking: SideNote2 now reads threaded note-backed comments with `entries[]`. Legacy flat `comment` payloads are not loaded by the current parser, so older notes must be migrated before those comments will appear in the sidebar, index, or agent workflows.
- Migration path: run `npm run comment:migrate-legacy -- --root "/abs/path/to/vault" --dry-run`, then rerun without `--dry-run` once the results look correct. If Obsidian Sync is active, add `-- --settle-ms 2000`.
- Added append-to-thread comment helpers for agents and repo automation via `npm run comment:append` and `scripts/append-note-comment-entry.mjs`.
- Improved note comment rendering and index workflows, including safer CLI writes, better index sidebar behavior, and page-note previews in the generated index note.
- Added `npm run review:bundle` for read-only isolated review snapshots.

## License

MIT
