---
name: aside
description: Use when working with Aside comments in real Obsidian notes: `obsidian://aside-comment?...` URIs, page notes, anchored notes, replies, stored comment updates, or `commentId` thread context.
---

# Aside

User-facing Aside skill. Recognizes normal user phrasing without requiring internal repo names.

## Trigger

Use for:

- `obsidian://aside-comment?...` or legacy `obsidian://side-note2-comment?...`
- `commentId` for an Aside thread
- create page note, anchored note, new side note thread
- reply, answer, continue, add another note under this
- update, edit, rewrite, replace a stored comment
- put each point into one comment

No resolve/archive flow: resolve functionality was removed.

## Source of truth

- Markdown note path plus comment id identify the user-facing target.
- Current persisted side note data lives in Aside plugin data and local sidecar JSON cache files.
- The trailing `<!-- Aside comments -->` block is legacy import/migration data, not current canonical storage. Built-in plugin startup/storage flows migrate it automatically; helper scripts should use the same write path and strip the managed block when they encounter one.
- Legacy `<!-- SideNote2 comments -->` blocks may exist for migration/read compatibility, but are not canonical.
- `Aside index.md` is derived; use only for discovery.
- `page note` / `anchored note` means an Aside thread in the current note unless user explicitly asks for a separate wiki page.

## Searching real Aside data

- `rg` skips hidden directories such as `.obsidian` by default. A failed vault-wide search without `--hidden` does not prove the Aside data is missing.
- When searching real comments, plugin data, caches, or installed builds, include `--hidden` and prefer narrow `.obsidian/plugins/aside` paths.
- Useful patterns:
  - `rg --hidden "<comment-id>" "/path/to/vault/.obsidian/plugins/aside"`
  - `rg --hidden "<comment-id>|<note path>" "/path/to/vault/.obsidian/plugins/aside" "/path/to/vault/<note>.md"`

## Default behavior

Aside is reply-based, not capability-limited. When invoked by `@codex` or `@claude`, treat the request like normal CLI agent work: answer questions, inspect files, edit files, create artifacts, run allowed commands/workflows, and use tools/skills as needed. Append a concise reply to the target thread with the answer, result, path, or status unless the user explicitly asks for a different stored-comment action.

| User asks | Do |
| --- | --- |
| question / explain / summarize / critique | reply with answer |
| improve / revise / draft source markdown | reply with proposed text |
| add / insert / apply / modify / replace / update / overwrite source note | edit source, then reply with concise summary |
| create markdown / `.canvas` / `.excalidraw` / other artifact | create artifact, then reply with path/result |
| inspect repo / run command / modify project files | do normal agent work, then reply with concise result |
| update existing Aside comment | update stored comment only if explicit |
| ambiguous source edit | reply with proposed edit; do not mutate source |

## Related skill routing

Load related skills only when the request requires them; do not inline their instructions here.

- `canvas-design`: Obsidian `.canvas` creation/revision, layout, grouping, spacing, hierarchy, edge crossings.
- `obsidian-excalidraw`: Obsidian Excalidraw, `.excalidraw`, ExcalidrawAutomate, generated drawings, embeds, templates, exports, visual PKM drawings.

Keep `aside` responsible for thread location and final reply. Use related skills for domain work or artifact creation.

## Write rules

- URI/comment id is exact thread target; prefer it over rediscovery.
- If no URI, locate real markdown note, then search current Aside plugin data with `rg --hidden` before falling back to legacy trailing blocks.
- Match by `commentId`; otherwise by `selectedText` plus nearby context.
- If multiple threads match, ask for context or use URI/comment id.
- Preserve existing entries unless user explicitly asks to replace one.
- Keep each Aside comment body <=250 words.
- If more detail is needed, keep reply concise and create/update a linked wiki page.
- One-point-per-note requests: create one parent thread and append each point as child entry; do not create many page-note threads.
- Use repo-local Node entrypoints or shared helpers. Do not hand-edit Aside JSON.
- Do not create, preserve, or normalize a second Aside/legacy managed block.
- If multiple managed blocks already exist, stop and repair/escalate before writing.
- If write entrypoint refuses because note changed after read, retry via entrypoint; do not manually patch JSON.

## Repo-local entrypoints

Create page note:

```bash
node scripts/create-note-comment-thread.mjs --file /abs/path/note.md --page --comment-file /abs/path/comment.md
```

Create parent with child comments:

```bash
node scripts/create-note-comment-thread-with-children.mjs --file /abs/path/note.md --page --root-comment-file /abs/path/root.md --children-dir /abs/path/children
```

Create anchored note:

```bash
node scripts/create-note-comment-thread.mjs --file /abs/path/note.md --selected-text "Priority conflicts" --start-line 335 --start-char 3 --end-line 335 --end-char 21 --comment-file /abs/path/comment.md
```

Append reply:

```bash
node scripts/append-note-comment-entry.mjs --uri "obsidian://aside-comment?..." --comment-file /abs/path/reply.md
node scripts/append-note-comment-entry.mjs --file /abs/path/note.md --id "<comment-id>" --comment-file /abs/path/reply.md
```

Update stored comment:

```bash
node scripts/update-note-comment.mjs --uri "obsidian://aside-comment?..." --comment-file /abs/path/comment.md
node scripts/update-note-comment.mjs --file /abs/path/note.md --id "<comment-id>" --comment-file /abs/path/comment.md
```
