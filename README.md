
<p align="center">
  <img src="./assets/logo-readme.svg" alt="Aside logo" width="72">
</p>
<p align="center">
Aside
</p>
<p align="center">
  <a href="https://github.com/vicky469/aside/releases/tag/2.0.70">
    <img src="https://img.shields.io/badge/release-2.0.70-22c55e?style=flat-square" alt="Latest release">
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
<table>
  <tr>
    <td align="center" valign="top" width="50%">
      <strong>Side note index</strong><br>
      <img src="./assets/demo.gif" alt="Aside demo preview in Obsidian dark theme" width="100%">
    </td>
    <td align="center" valign="top" width="50%">
      <strong>Agent reply</strong><br>
      <img src="./assets/demo2.gif" alt="Aside demo preview in Obsidian light theme" width="100%">
    </td>
  </tr>
</table>
Aside is a tool for thought. It helps you capture, connect, and go deeper into your knowledge. Optionally, AI agents can assist you along the journey.

## Features

- Uses a dedicated sidebar for drafting, editing, resolving, reopening, and deleting comments.
- Supports Obsidian-style `[[wikilinks]]` inside side comments to link existing notes or create new markdown notes.
- Type `#` in a side note to search existing tags or add a new one.
- Browse, filter, and batch-apply local side-note tags from the active note sidebar.
- Keeps resolved comments archived instead of removing them.
- Generates `Aside index.md` as a vault-wide comment index.
- Lets the index sidebar switch between the comment list and a thought-trail graph built from side-note wiki links. The graph follows those links across connected markdown files, so it can show multi-step trails instead of only direct one-hop links.
- Built-in `@codex` side notes on desktop Obsidian. Type `@codex` in a thread, watch the reply stream in the sidebar, and keep the final answer in the same thread.

## How to Get Started

1. Install Aside
   settings -> install community plugins -> type aside
2. Install and sign in to Codex on the same machine.
   Quick check: open Terminal in your vault or project folder and run `codex`.
3. Install the Aside Codex skill.
   ```
   $skill-installer install https://github.com/vicky469/aside/tree/main/skills/aside
   ```
   Restart Codex after installing the skill. Aside auto refreshes the installed skill on desktop startup when it is already present, but it does not install or remove the skill for you.

## Workflow

1. Open a markdown file.
2. Add a side note.
   You can select text and right-click `Add comment to selection`, or use the sidebar for a page note.
3. Write your comment in the sidebar.
   Type `@codex` if you want Codex to take the task.
4. Save the note.
5. Aside runs Codex locally and appends the reply back into the same thread.

## Glossary

- **`thread`**  
  One Aside discussion attached to one target. A thread can have one first entry and later replies.

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

- **`Aside index.md`**
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

- `Aside: Add comment to selection`


## Reporting Bugs

Open a GitHub issue using the bug report template:

https://github.com/vicky469/aside/issues/new?template=bug_report.yml

For suspected vulnerabilities or other sensitive security issues, do not file a public issue. Email dev@databun.xyz instead.

## License

MIT

<p align="center">
  <a href="https://buymeacoffee.com/vickyli">
    <img src="./assets/logo-readme.svg" alt="Aside logo" width="84">
  </a>
</p>
<p align="center">
  <strong>Keep Aside brewing.</strong>
</p>
<p align="center">
  <a href="https://buymeacoffee.com/vickyli">
    <img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-support-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=000000" alt="Buy Me a Coffee">
  </a>
</p>
