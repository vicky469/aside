---
name: sidenote2
description: Use when a user is working with SideNote2 comments in real Obsidian notes, especially if they paste an `obsidian://side-note2-comment?...` link or ask to reply to, update, or inspect a stored side note thread.
---

# SideNote2

Use this as the user-facing SideNote2 skill.

This skill exists so an agent can recognize normal user phrasing without requiring the user to know internal repo skill names.

## Trigger Phrases

Use this skill when the user:

- pastes an `obsidian://side-note2-comment?...` URI
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

## Working Rules

1. If the user provided an `obsidian://side-note2-comment?...` URI:
   - treat it as the exact thread target
   - prefer the URI-based CLI path instead of re-discovering the note manually
2. If no URI is provided, locate the real markdown note and read the trailing SideNote2 managed block.
3. Distinguish:
   - `reply`, `continue`, `answer this`, `add another note under this`
     append to the thread
   - `update`, `rewrite`, `replace`
     replace the targeted stored comment body
   - `resolve`, `mark resolved`, `archive this side note`
     mark the targeted thread resolved
4. Prefer helper scripts over hand-editing JSON.
5. Preserve all existing thread entries unless the user explicitly asked to replace one.
6. Keep each SideNote2 comment body at or under 120 words.
7. If the best response would exceed 120 words:
   - prefer creating a linked wiki page for the detailed writeup and keep the side note itself high-level, like a short Wikipedia-style summary
   - or split the continuation into child thread entries when the detail belongs inside the same discussion
8. Do not cram oversized detail into one side note just to avoid splitting it.

## Preferred CLI Shapes

Append:

```bash
node scripts/append-note-comment-entry.mjs --uri "obsidian://side-note2-comment?..." --comment-file /abs/path/reply.md
```

Or with an explicit file and comment id:

```bash
node scripts/append-note-comment-entry.mjs --file /abs/path/note.md --id "<comment-id>" --comment-file /abs/path/reply.md
```

Update:

```bash
node scripts/update-note-comment.mjs --uri "obsidian://side-note2-comment?..." --comment-file /abs/path/comment.md
```

Or with an explicit file and comment id:

```bash
node scripts/update-note-comment.mjs --file /abs/path/note.md --id "<comment-id>" --comment-file /abs/path/comment.md
```

Resolve:

```bash
node scripts/resolve-note-comment.mjs --uri "obsidian://side-note2-comment?..."
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

- Do not overwrite a thread when the user asked to reply.
- Do not hand-migrate legacy flat `comment` payloads during normal agent work.
- If the helper script refuses a note because it changed after read, treat it as a retry case instead of editing the JSON manually.
