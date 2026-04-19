# SideNote2
<p align="center">
  <img src="./assets/logo-readme.svg" alt="SideNote2 logo" width="72">
</p>
<p align="center">
  <a href="https://github.com/vicky469/SideNote2/releases/tag/2.0.27">
    <img src="https://img.shields.io/badge/beta-2.0.27-f97316?style=flat-square" alt="Current beta">
  </a>
  <a href="https://buymeacoffee.com/vickyli">
    <img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-support-FFDD00?style=flat-square&logo=buymeacoffee&logoColor=000000" alt="Buy Me a Coffee">
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
  Same workflow in both Obsidian themes.
</p>
<table>
  <tr>
    <td align="center" valign="top" width="50%">
      <strong>Light theme</strong><br>
      <img src="./assets/demo.gif" alt="SideNote2 demo preview in Obsidian dark theme" width="100%">
    </td>
    <td align="center" valign="top" width="50%">
      <strong>Dark theme</strong><br>
      <img src="./assets/demo2.gif" alt="SideNote2 demo preview in Obsidian light theme" width="100%">
    </td>
  </tr>
</table>
SideNote2 is an [Obsidian](https://obsidian.md) plugin for side comments that stay attached to the note. Inspired by [mofukuru/SideNote](https://github.com/mofukuru/SideNote).

It is built for a minimal workflow: both humans and agents can work in the sidebar or the main markdown file. 

For development, setup, testing, and release workflow, see [README-dev.md](./README-dev.md).

## Features

- Uses a dedicated sidebar for drafting, editing, resolving, reopening, and deleting comments.
- Supports Obsidian-style `[[wikilinks]]` inside side comments to link existing notes or create new markdown notes.
- Type `#` in a side note to search existing tags or add a new one.
- Keeps resolved comments archived instead of removing them.
- Generates `SideNote2 index.md` as a vault-wide comment index.
- Lets the index sidebar switch between the comment list and a thought-trail graph built from side-note wiki links. The graph follows those links across connected markdown files, so it can show multi-step trails instead of only direct one-hop links.
- Built-in `@codex` side notes on desktop Obsidian. Type `@codex` in a thread, watch the reply stream in the sidebar, and keep the final answer in the same thread.

## How to Get Started

1. Install BRAT
   settings -> install community plugins -> BRAT
2. Install the SideNote2 beta
   Open BRAT, enable Auto update if you want, then add the plugin as shown below.
   <p align="center">
     <img src="./assets/image.png" alt="Install SideNote2 with BRAT" width="420">
   </p>
3. Use desktop Obsidian with a filesystem-backed vault.
4. Install and sign in to Codex on the same machine.
   Quick check: open Terminal in your vault or project folder and run `codex`.

## Workflow

1. Open a note.
2. Add a side note.
   You can select text and right-click `Add comment to selection`, or use the sidebar for a page note.
3. Write your comment in the sidebar.
   Type `@codex` if you want Codex to take the task.
4. Save the note.
5. SideNote2 runs Codex locally and appends the reply back into the same thread.
6. Review it later from the sidebar, from `SideNote2 index.md`, from the `Agent` tab, or from the thought trail.

## Glossary

- **`thread`**  
  One SideNote2 discussion attached to one target. A thread can have one first entry and later replies.

- **`entry`**  
  One message inside a thread. The first saved entry creates the thread. Later child entries are replies in the same thread.

- **`page note`**  
  A thread attached to the whole file, not to a text selection.

- **`anchored note`**  
  A thread attached to a specific text selection in a markdown note.

- **`orphaned note`**  
  An anchored thread whose original text can no longer be matched in the file. The thread still exists; its anchor is just currently missing.

- **`resolved note`**  
  A thread that has been archived instead of deleted.

- **`SideNote2 index.md`**  
  The generated vault-wide index note. It is derived output, not the source of truth.

- **`thought trail`**  
  The graph view built from `[[wikilinks]]` inside side-note threads.

## Writing in Side Notes

| Action | How it works |
| --- | --- |
| Save draft | Click `Save`. |
| Insert a newline | Press `Enter`. |
| Ask Codex from a side note | Type `@codex` in the note, then save it. |
| Link a note | Type `[[` to open note suggestions and insert an Obsidian wikilink. |
| Add a tag | Type `#` to open tag suggestions and insert a tag. |
| Reopen link or tag suggestions | Press `Tab` while the cursor is inside an unfinished `[[...` or `#...` token. |
| Bold or highlight text | Use the sidebar `B` and `H` buttons to wrap the current selection with `**bold**` or `==highlight==`. |
| Cancel a draft or edit | Press `Esc`. |

## Settings

- `Index header image URL`
- `Index header image caption`

## Command

- `SideNote2: Add comment to selection`

## Storage

For MD files:
Each note stores its comments in a trailing hidden `<!-- SideNote2 comments -->` JSON block inside the same markdown file.

For PDF files:
The JSON block is stored in plugin data.

`SideNote2 index.md` is just a generated index, not separate storage.

## Index Surfaces

- `SideNote2 index.md` stays a derived vault-wide aggregate note.
- The index sidebar `Files` filter only scopes the sidebar view. Selecting one file there does not rewrite `SideNote2 index.md` down to that single file section.
- In the index sidebar list view, the nested-comments toggle is hidden when the filter scope resolves to exactly one file.
- The generated index note only shows a visibility banner in resolved-only mode.

## Reporting Bugs

Open a GitHub issue using the bug report template:

https://github.com/vicky469/SideNote2/issues/new?template=bug_report.yml

For suspected vulnerabilities or other sensitive security issues, do not file a public issue. Email dev@databun.xyz instead.

## License

MIT

<p align="center">
  <a href="https://buymeacoffee.com/vickyli">
    <img src="./assets/logo-readme.svg" alt="SideNote2 logo" width="84">
  </a>
</p>
<p align="center">
  <strong>Keep SideNote2 brewing.</strong>
</p>
<p align="center">
  <a href="https://buymeacoffee.com/vickyli">
    <img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-support-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=000000" alt="Buy Me a Coffee">
  </a>
</p>
