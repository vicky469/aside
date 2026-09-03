---
name: aside
description: "Use when working with Aside comments in real Obsidian notes: `obsidian://aside-comment?...` URIs, page or anchored notes, replies, stored comment updates, `commentId` thread context, or requests to add annotations to a note."
---

# Aside

Use this workflow for real Aside comments in Obsidian.

Aside is reply-based, not capability-limited. Do the requested work, then append its result or concise status to the target thread.

## Locate

- An `obsidian://aside-comment?...` URI or note path plus comment id is the exact target; prefer it over rediscovery. Legacy `obsidian://side-note2-comment?...` URIs are also valid.
- Current persisted side note data is in `.obsidian/plugins/aside` plugin data and sidecar JSON. Trailing `<!-- Aside comments -->` or legacy `<!-- SideNote2 comments -->` blocks are migration input, not canonical storage.
- `🐰 Aside Index.md` and legacy `Aside index.md` are derived discovery aids.
- Search hidden plugin data explicitly: `rg --hidden "<comment-id>" "/vault/.obsidian/plugins/aside"`.

## Act

- Questions, explanations, summaries, critiques: append a concise answer.
- Proposed source revisions: reply with proposed text. Edit source only when explicitly asked to add, apply, modify, replace, or overwrite it.
- Create requested artifacts or perform requested repository work, then append the result or path.
- Update an existing stored comment only when explicitly asked to update or replace it; a request to reply must append.
- If source-edit intent is ambiguous, propose the edit without mutating source.

## Write safely

- Match by URI/comment id; otherwise use exact selected text plus nearby context. Ask when multiple threads match.
- Preserve existing entries unless replacement is explicit. Do not hand-edit Aside JSON; use repo-local Node entrypoints or shared helpers.
- Do not claim a change succeeded unless it was made. If the runtime cannot perform it, say so plainly.
- Treat tracked content and commit history as public. In code, documentation, plans, tests, examples, logs, and release notes, replace personal paths and identifiers with placeholders such as `/path/to/vault`, `user@example.com`, and `<account-id>`.
- Never print or persist secrets, tokens, credentials, private keys, vault contents, or private URLs. Before committing or sharing, scan the diff and staged content; sanitize private data.
- Do not create a second managed block. If multiple blocks exist, stop and repair before writing. Retry helper conflicts through the helper, never by patching JSON.
- For annotations, create selection-anchored threads. Inside the plugin runtime, return a fenced `aside-annotations` JSON array of `{ "selectedText": "exact source text", "comment": "text" }`; outside it, use the create-thread helper. Never substitute a plain critique when anchoring fails.
- For non-annotation “one point per note” requests, create one parent and append child entries unless separate threads are explicit.
- Keep replies `<=250 words`. Put longer detail in a linked wiki note.
- Use `canvas-design` or `obsidian-excalidraw` only when the requested artifact requires it; Aside still owns thread targeting and the final reply.

## Helpers

Run the relevant script with `--help`; prefer a supplied `--uri`:

- Create: `node scripts/create-note-comment-thread.mjs`
- Create parent plus children: `node scripts/create-note-comment-thread-with-children.mjs`
- Reply: `node scripts/append-note-comment-entry.mjs`
- Replace: `node scripts/update-note-comment.mjs`
