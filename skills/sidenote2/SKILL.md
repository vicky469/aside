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
- SideNote2 stores comments in exactly one trailing `<!-- SideNote2 comments -->` block in that note.
- `SideNote2 index.md` is derived output. Use it to discover a note path, not as canonical storage.
- In this skill, a `page note` or `anchored note` normally means a simple SideNote2 note/thread inside the current markdown note.
- Only create a separate wiki page when the user explicitly asks for one, or when the best useful reply would exceed the 250-word side-note limit.

## Mode Selection

First decide whether the current turn is:

- chat-only
- a SideNote2 write back into the note/thread

Use these defaults:

- If the request came from an in-note SideNote2 `@codex` reply path, default to write mode.
- If the request came from CLI or normal chat, default to chat-only mode.

Important:

- A pasted `obsidian://side-note2-comment?...` URI, note path, selected text, or `commentId` is thread context, not automatic permission to write.
- In CLI or normal chat, only write when the user explicitly asks to create, reply, append, update, resolve, or otherwise modify stored SideNote2 comments.
- If the user explicitly says this is chat, asks for explanation only, or asks what a passage/comment means, answer in chat and do not mutate the note.
- If the user explicitly asks to modify or append somewhere directly, treat that as a normal chat instruction to perform the write.
- When unsure, default to chat-only and avoid mutating the note.

## Working Rules

1. If the user provided an `obsidian://side-note2-comment?...` URI:
   - treat it as the exact thread target
   - do not treat the URI alone as permission to write
   - prefer the URI-based CLI path instead of re-discovering the note manually when you are actually writing
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
6. Keep each SideNote2 comment body at or under 250 words.
7. Keep the formatting compact:
   - plain paragraphs or one simple list
   - no headings
   - no long multi-section layout
   - no excess blank lines
8. If the best response would exceed 250 words:
   - keep the side note concise
   - create or update a linked wiki page with the fuller detail when needed
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

- Do not treat a pasted URI or `commentId` as an automatic instruction to append a reply.
- Do not append/update/resolve/create anything when the interaction came from CLI or normal chat unless the user explicitly asked for that write.
- Do not append to an existing thread when the user clearly asked to create a new page note or anchored note.
- Do not overwrite a thread when the user asked to reply.
- Do not interpret `create a note` as `create a new markdown page` unless the user explicitly asks for a separate wiki page.
- Do not create, preserve, or normalize a second `<!-- SideNote2 comments -->` block in the same markdown file.
- If a note already has more than one `<!-- SideNote2 comments -->` block, stop and repair or escalate instead of writing.
- Do not hand-migrate legacy flat `comment` payloads during normal agent work.
- If the CLI refuses a note because it changed after read, treat it as a retry case instead of editing the JSON manually.
