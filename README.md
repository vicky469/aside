# SideNote2

SideNote2 is an [Obsidian](https://obsidian.md) plugin for side comments that stay attached to the note.

It is built for a minimal workflow: humans work in the sidebar, while agents can read the same comments directly from the markdown file. Inspired by [mofukuru/SideNote](https://github.com/mofukuru/SideNote).

## What It Does

- Uses a dedicated sidebar for drafting, editing, resolving, reopening, and deleting comments.
- Highlights commented text directly in the note.
- Keeps resolved comments archived instead of removing them.
- Generates `SideNote2 index.md` as a vault-wide comment index.

## Workflow

1. Select text in a note.
2. Right-click `Add comment to selection`.
   You can use the ribbon button to open the sidebar, or assign your own hotkey in Obsidian.
3. Write the comment in the sidebar.
4. Review it later from the sidebar.

## Settings

- `Debug mode`
	This is not implemented yet. In the future, if you see bugs, toggle this to on, then contact me and send me the console logs. 

## Command

- `SideNote2: Add comment to selection`

## Storage

Each note stores its comments in a trailing hidden `<!-- SideNote2 comments -->` JSON block inside the same markdown file.

`SideNote2 index.md` is just a generated index, not separate storage.

## Development

Setup, local vault install, debugging, and architecture notes live in [README-dev.md](./README-dev.md).

## License

MIT
