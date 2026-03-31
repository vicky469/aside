# SideNote2
<p align="center">
  <img src="./logo-readme.svg" alt="SideNote2 logo" width="72">
</p>
<p align="center">
  <a href="https://github.com/vicky469/SideNote2/releases/tag/1.0.20">
    <img src="https://img.shields.io/badge/beta-1.0.20-f97316?style=flat-square" alt="Current beta">
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

For the fuller dependency and architecture notes, see [README-dev.md](./docs/README-dev.md).

SideNote2 is an [Obsidian](https://obsidian.md) plugin for side comments that stay attached to the note.

It is built for a minimal workflow: humans work in the sidebar, while agents can read the same comments directly from the markdown file. Inspired by [mofukuru/SideNote](https://github.com/mofukuru/SideNote).

## Features

- Uses a dedicated sidebar for drafting, editing, resolving, reopening, and deleting comments.
- Supports Obsidian-style `[[wikilinks]]` inside side comments to link existing notes or create new markdown notes.
- Type `#` in a side note to search existing tags or add a new one.
- Keeps resolved comments archived instead of removing them.
- Generates `SideNote2 index.md` as a vault-wide comment index.
- Supports Codex CLI workflows so agents can read and update side comments from the note-backed storage format.

## How to Get Started

1. Install BRAT, then install the SideNote2 beta in Obsidian.

   <p align="center">
     <img src="./image.png" alt="Install SideNote2 with BRAT" width="420">
   </p>

2. Install the SideNote2 skill in Codex CLI.

```bash
python ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --url \
  https://github.com/vicky469/SideNote2/tree/main/skills/side-note2-note-comments
```

## Workflow

1. Select text in a note.
2. Right-click `Add comment to selection`.
   You can use the ribbon button to open the sidebar, or assign your own hotkey in Obsidian.
3. Write the comment in the sidebar.
   See `Writing in Side Notes` below for editor shortcuts and formatting behavior.
4. Review it later from the sidebar or from `SideNote2 index.md`.

## Writing in Side Notes

| Action | How it works |
| --- | --- |
| Save draft | Press `Enter`. |
| Insert a newline | Press `Shift+Enter`. |
| Link a note | Type `[[` to open note suggestions and insert an Obsidian wikilink. |
| Add a tag | Type `#` to open tag suggestions and insert a tag. |
| Reopen link or tag suggestions | Press `Tab` while the cursor is inside an unfinished `[[...` or `#...` token. |
| Toggle highlight | Uses your vault's Obsidian `Toggle highlight` hotkey (`editor:toggle-highlight`). If that command is unbound, it falls back to `Option+H` (`Alt+H`) and toggles `==highlight==` around the current selection. |
| Cancel a draft or edit | Press `Esc`. |

For power users:

Agents can read the side notes from markdown.

In Codex CLI, you can ask:

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

- `Debug mode`
  This is not implemented yet.
- Others should be straightforward.

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

## License

MIT
