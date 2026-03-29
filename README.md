# SideNote2
<p align="center">
  <img src="./logo-readme.svg" alt="SideNote2 logo" width="72">
</p>
<p align="center">
  Current beta: <a href="https://github.com/vicky469/SideNote2/releases/tag/1.0.15">1.0.15</a>
</p>
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

1. Install BRAT and SideNote2 plugin in Obsidian.
   ![alt text](image.png)

2. Install SideNote2 skill in Codex CLI:
   `python ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --url
https://github.com/vicky469/SideNote2/tree/main/skills/side-note2-note-comments`

## Workflow

1. Select text in a note.
2. Right-click `Add comment to selection`.
   You can use the ribbon button to open the sidebar, or assign your own hotkey in Obsidian.
3. Write the comment in the sidebar.
   Type `[[` to link a note, or type `#` to search existing tags or create a new one.
4. Review it later from the sidebar or from `SideNote2 index.md`.

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

## Command

- `SideNote2: Add comment to selection`

## Storage

For MD files:
Each note stores its comments in a trailing hidden `<!-- SideNote2 comments -->` JSON block inside the same markdown file.

For PDF files:
The JSON block is stored in plugin data.

`SideNote2 index.md` is just a generated index, not separate storage.

## Development

Setup, local vault install, debugging, and architecture notes live in [README-dev.md](./README-dev.md).

## License

MIT
