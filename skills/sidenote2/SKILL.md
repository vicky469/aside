---
name: sidenote2
description: Use when a user is working with SideNote2 comments in real Obsidian notes, especially if they want to create, reply to, update, resolve, or inspect a stored side note thread.
---

# SideNote2

Use this as the user-facing SideNote2 skill.

This skill exists so an agent can recognize normal user phrasing without requiring the user to know internal repo skill names.

## Trigger Phrases

Use this skill when the user:

- pastes an `obsidian://side-note2-comment?...` URI
- says `create a page note`
- says `create an anchored note`
- says `create a new side note thread`
- says `reply to this`
- says `answer this side note`
- says `add another note under this`
- says `update this side note`
- says `resolve this side note`
- says `edit this stored comment`
- gives a `commentId` and wants to act on a SideNote2 thread

## Source Of Truth

- The markdown note itself is canonical.
- SideNote2 stores comments in the trailing `<!-- SideNote2 comments -->` block in that note.
- `SideNote2 index.md` is derived output. Use it to discover a note path, not as canonical storage.
- In this skill, a `page note` or `anchored note` normally means a simple SideNote2 note/thread inside the current markdown note.
- Only create a separate wiki page when the user explicitly asks for one.

## Working Rules

1. If the user provided an `obsidian://side-note2-comment?...` URI:
   - treat it as the exact thread target
   - prefer the URI-based CLI path instead of re-discovering the note manually
2. If no URI is provided, locate the real markdown note and read the trailing SideNote2 managed block.
3. Distinguish:
   - `create`, `new thread`, `new page note`, `new anchored note`
     create a new thread instead of appending to an existing one
   - `reply`, `continue`, `answer this`, `add another note under this`
     append to the thread
   - `update`, `rewrite`, `replace`
     replace the targeted stored comment body
   - `resolve`, `mark resolved`, `archive this side note`
     mark the targeted thread resolved
4. Prefer the installed `sidenote2` CLI over hand-editing JSON.
5. Preserve all existing thread entries unless the user explicitly asked to replace one.
6. Keep each SideNote2 comment body at or under 120 words.
7. If the best response would exceed 120 words:
   - prefer shortening it to a concise side note
   - or split the continuation into child thread entries when the detail belongs inside the same discussion
8. Do not create a separate wiki page or markdown file unless the user explicitly asks for one.
9. Do not cram oversized detail into one side note just to avoid splitting it.

## Preferred CLI Shapes

Use the installed `sidenote2` command when available.

If `sidenote2` is not on `PATH` but the agent is working inside the SideNote2 repo, fall back to `node bin/sidenote2.mjs ...`.

Create a page note:

```bash
sidenote2 comment:create --file /abs/path/note.md --page --comment-file /abs/path/comment.md
```

Create an anchored note:

```bash
sidenote2 comment:create --file /abs/path/note.md --selected-text "Priority conflicts" --start-line 335 --start-char 3 --end-line 335 --end-char 21 --comment-file /abs/path/comment.md
```

Append:

```bash
sidenote2 comment:append --uri "obsidian://side-note2-comment?..." --comment-file /abs/path/reply.md
```

Or with an explicit file and comment id:

```bash
sidenote2 comment:append --file /abs/path/note.md --id "<comment-id>" --comment-file /abs/path/reply.md
```

Update:

```bash
sidenote2 comment:update --uri "obsidian://side-note2-comment?..." --comment-file /abs/path/comment.md
```

Or with an explicit file and comment id:

```bash
sidenote2 comment:update --file /abs/path/note.md --id "<comment-id>" --comment-file /abs/path/comment.md
```

Resolve:

```bash
sidenote2 comment:resolve --uri "obsidian://side-note2-comment?..."
```

Or with an explicit file and comment id:

```bash
sidenote2 comment:resolve --file /abs/path/note.md --id "<comment-id>"
```

## Matching Rules

- Match by `commentId` when available.
- Otherwise match by `selectedText` plus nearby note context.
- If multiple stored comments share the same `selectedText`, ask for more context or use the URI/comment id.

## Safety

- Do not append to an existing thread when the user clearly asked to create a new page note or anchored note.
- Do not overwrite a thread when the user asked to reply.
- Do not interpret `create a note` as `create a new markdown page` unless the user explicitly asks for a separate wiki page.
- Do not hand-migrate legacy flat `comment` payloads during normal agent work.
- If the CLI refuses a note because it changed after read, treat it as a retry case instead of editing the JSON manually.
