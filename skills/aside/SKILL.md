---
name: aside
description: Use when a user is working with Aside comments in real Obsidian notes, especially if they want to create, reply to, update, resolve, or inspect a stored side note thread.
---

# Aside

Use this as the user-facing Aside skill.

This skill exists so an agent can recognize normal user phrasing without requiring the user to know internal repo skill names.

## Trigger Phrases

Use this skill when the user:

- pastes an `obsidian://aside-comment?...` URI
- pastes a legacy `obsidian://side-note2-comment?...` URI
- says `create a page note`
- says `put each point into one comment`
- says `create an anchored note`
- says `create a new side note thread`
- says `reply to this`
- says `answer this side note`
- says `add another note under this`
- says `update this side note`
- says `resolve this side note`
- says `edit this stored comment`
- gives a `commentId` and wants to act on a Aside thread

## Source Of Truth

- The markdown note itself is canonical.
- Aside stores comments in exactly one trailing `<!-- Aside comments -->` block in that note.
- Aside can still read and migrate legacy trailing `<!-- SideNote2 comments -->` blocks.
- `Aside index.md` is derived output. Use it to discover a note path, not as canonical storage.
- In this skill, a `page note` or `anchored note` normally means a simple Aside note/thread inside the current markdown note.
- Only create a separate wiki page when the user explicitly asks for one, or when the best useful reply would exceed the 250-word side-note limit.

## Mode Selection

First decide whether the current turn is:

- chat-only
- a Aside write back into the note/thread

Use these defaults:

- If the request came from an in-note Aside `@codex` reply path, default to write mode.
- If the request came from terminal usage or normal chat, default to chat-only mode.

Important:

- A pasted `obsidian://aside-comment?...` URI, note path, selected text, or `commentId` is thread context, not automatic permission to write.
- In terminal usage or normal chat, only write when the user explicitly asks to create, reply, append, update, resolve, or otherwise modify stored Aside comments.
- If the user explicitly says this is chat, asks for explanation only, or asks what a passage/comment means, answer in chat and do not mutate the note.
- If the user explicitly asks to modify or append somewhere directly, treat that as a normal chat instruction to perform the write.
- When unsure, default to chat-only and avoid mutating the note.

## Working Rules

1. If the user provided an `obsidian://aside-comment?...` URI or legacy `obsidian://side-note2-comment?...` URI:
   - treat it as the exact thread target
   - do not treat the URI alone as permission to write
   - prefer the URI-based write target instead of re-discovering the note manually when you are actually writing
2. If no URI is provided, locate the real markdown note and read the trailing Aside managed block.
3. Distinguish:
   - `create`, `new thread`, `new page note`, `new anchored note`
     create a new thread instead of appending to an existing one
   - `reply`, `continue`, `answer this`, `add another note under this`
     append to the thread
   - `update`, `rewrite`, `replace`
     replace the targeted stored comment body
   - `resolve`, `mark resolved`, `archive this side note`
     mark the targeted thread resolved
4. Prefer the repo-local Aside write entrypoints or shared helpers over hand-editing JSON.
   Built-in Aside behavior must not require any separate Aside command install.
5. Preserve all existing thread entries unless the user explicitly asked to replace one.
6. Keep each Aside comment body at or under 250 words.
7. Keep the formatting compact:
   - plain paragraphs or one simple list
   - no headings
   - no long multi-section layout
   - no excess blank lines
8. If the best response would exceed 250 words:
   - keep the side note concise
   - create or update a linked wiki page with the fuller detail when needed
9. Do not cram oversized detail into one side note just to avoid splitting it.
10. For "one point a note/comment" requests, create one parent thread and append each point as a child entry in that thread. Do not create many separate page-note threads for points from the same source.

## Preferred Write Entry Points

When working inside the Aside repo, use the repo-local Node entrypoints.
Treat them as internal implementation detail, not as a user setup requirement.

Create a page note:

```bash
node scripts/create-note-comment-thread.mjs --file /abs/path/note.md --page --comment-file /abs/path/comment.md
```

Create one page-note thread with child comments:

```bash
node scripts/create-note-comment-thread-with-children.mjs --file /abs/path/note.md --page --root-comment-file /abs/path/root.md --children-dir /abs/path/children
```

Use this for requests like "add this in sidebar page note, one point a note" or "put each point into one comment." Put the framing/summary in `root.md`; put child comments in sorted files like `01-self.md`, `02-motivation.md`. Add `--replace-existing` only when repairing a wrong prior split.

Create an anchored note:

```bash
node scripts/create-note-comment-thread.mjs --file /abs/path/note.md --selected-text "Priority conflicts" --start-line 335 --start-char 3 --end-line 335 --end-char 21 --comment-file /abs/path/comment.md
```

Append:

```bash
node scripts/append-note-comment-entry.mjs --uri "obsidian://aside-comment?..." --comment-file /abs/path/reply.md
```

Or with an explicit file and comment id:

```bash
node scripts/append-note-comment-entry.mjs --file /abs/path/note.md --id "<comment-id>" --comment-file /abs/path/reply.md
```

Update:

```bash
node scripts/update-note-comment.mjs --uri "obsidian://aside-comment?..." --comment-file /abs/path/comment.md
```

Or with an explicit file and comment id:

```bash
node scripts/update-note-comment.mjs --file /abs/path/note.md --id "<comment-id>" --comment-file /abs/path/comment.md
```

Resolve:

```bash
node scripts/resolve-note-comment.mjs --uri "obsidian://aside-comment?..."
```

Or with an explicit file and comment id:

```bash
node scripts/resolve-note-comment.mjs --file /abs/path/note.md --id "<comment-id>"
```

## Matching Rules

- Match by `commentId` when available.
- Otherwise match by `selectedText` plus nearby note context.
- If multiple stored comments share the same `selectedText`, ask for more context or use the URI/comment id.

## Safety

- Do not treat a pasted URI or `commentId` as an automatic instruction to append a reply.
- Do not append/update/resolve/create anything when the interaction came from terminal usage or normal chat unless the user explicitly asked for that write.
- Do not append to an existing thread when the user clearly asked to create a new page note or anchored note.
- Do not overwrite a thread when the user asked to reply.
- Do not interpret `create a note` as `create a new markdown page` unless the user explicitly asks for a separate wiki page.
- Do not create, preserve, or normalize a second `<!-- Aside comments -->` or legacy `<!-- SideNote2 comments -->` block in the same markdown file.
- If a note already has more than one Aside or legacy SideNote2 managed block, stop and repair or escalate instead of writing.
- Do not hand-migrate legacy flat `comment` payloads during normal agent work.
- If the repo-local write entrypoint refuses a note because it changed after read, treat it as a retry case instead of editing the JSON manually.
