---
name: side-note2-note-comments
description: Use when reading or editing SideNote2-backed Obsidian notes. Covers finding the relevant markdown note in the vault, reading the note body plus trailing `<!-- SideNote2 comments -->` JSON block, identifying stored comments by `id` or `selectedText`, and using the repo helper script or direct note edits when the user asks the agent to write changes.
---

# SideNote2 Obsidian Notes

Use this skill when the user wants work done against real Obsidian notes that use SideNote2 note-backed comments.

## Scope

- Read note content directly from markdown files in the vault.
- Read SideNote2 comment data from the trailing `<!-- SideNote2 comments -->` block in the same note.
- Write note content directly when the user asks to edit the note body.
- Write SideNote2 comment bodies through the helper script when possible.

## Replacement Lookup Paths

Use one of these two paths to locate the side comment that should be replaced:

1. `SideNote2 index.md`
   - Use this to discover the note path and comment target when the user refers to a side comment indirectly.
   - Treat it as a jump index only, not canonical storage.
2. The user’s active note in source mode
   - Use the trailing `<!-- SideNote2 comments -->` block at the bottom of the active markdown note.
   - Treat this as the authoritative source when reading or writing a stored comment.

## Finding Notes

1. Prefer an explicit absolute path from the user.
2. Resolve the actual Obsidian vault root before searching broadly.
   - Do not assume the plugin repo root is the vault root.
   - If Obsidian CLI is available, check `obsidian vaults verbose` to map vault names to paths.
   - Check `~/.config/obsidian/obsidian.json` for vault entries marked `"open": true` when you need the vault(s) currently open in Obsidian.
   - Check `<vault>/.obsidian/workspace.json` for the current workspace state, active leaves, and recent files when you need the note the user is actively working in.
   - If the repo is nested inside a larger vault, search the outer vault root for notes and keep the repo root only for helper scripts.
3. If the user gives only a note title or fragment, search the resolved vault root for matching `.md` files.
4. Treat the markdown note itself as the source of truth.
5. Do not rely on the Obsidian UI state alone when the note file can be read directly.

## Reading Workflow

1. Confirm the target note path.
2. If needed, use `SideNote2 index.md` to find the relevant note path first.
3. Open the note itself, not just plugin code or generated index files.
4. Read both:
   - the main markdown content
   - the trailing `<!-- SideNote2 comments -->` block, if present
5. When the user asks about a specific side note:
   - match by `id` if available
   - otherwise match by `selectedText` and surrounding context
   - do not rely on `timestamp` if a stronger identifier exists

## Writing Workflow

If the user asks to edit the note body:

1. Edit the markdown note directly.
2. Preserve the trailing SideNote2 managed block unless the task explicitly changes comments.

If the user asks to add a page-level tag in a SideNote2 note:

1. Inspect the note's leading YAML frontmatter only if it starts at the top of the file.
2. If that frontmatter already contains a `tags` field, add the tag there and avoid duplicates.
3. Preserve the note's existing `tags` style when practical, such as a YAML list versus inline form.
4. If the note does not have a leading frontmatter `tags` field, do not create one just for this request.
5. In that fallback case, add the tag as a SideNote2 page note instead.

If the user asks to edit a stored SideNote2 comment:

1. Confirm the target note path.
2. If needed, use `SideNote2 index.md` to locate the target note and comment first.
3. Inspect the trailing `<!-- SideNote2 comments -->` block in the active markdown note.
4. Identify the target comment by `id` when it is available.
   - Natural-language requests such as `Update the side comment for "selected text" in "/path/to/note.md" to: ...` should be interpreted as a `selectedText`-based replacement request.
   - If `id` is not provided, match by `selectedText` and surrounding note context.
   - If multiple stored comments in the same note share the same `selectedText`, ask for more context or use the `id`.
5. If the stored payload uses legacy flat comments with top-level `comment` fields instead of `entries`, migrate the note before any edit.
   - For one note:

```bash
cd "/abs/path/to/SideNote2"
node scripts/migrate-legacy-note-comments.mjs --file "/abs/path/to/note.md" --dry-run
node scripts/migrate-legacy-note-comments.mjs --file "/abs/path/to/note.md"
```

   - For a whole vault after resolving the true vault root:

```bash
cd "/abs/path/to/SideNote2"
node scripts/migrate-legacy-note-comments.mjs --root "/abs/path/to/vault" --dry-run
node scripts/migrate-legacy-note-comments.mjs --root "/abs/path/to/vault"
```

   - If Obsidian Sync or another editor may still be touching the vault, add `--settle-ms 2000`.
   - If the script reports skipped notes because they changed during the run, do not hand-merge the managed block. Wait for Sync to settle and rerun the same command. Treat that run as partial success, not completion.

6. Prefer the helper script from the repo root:

```bash
cd "/abs/path/to/SideNote2"
node scripts/update-note-comment.mjs --file "/abs/path/to/note.md" --id "<comment-id>" --comment-file "/abs/path/to/comment.md"
```

Short replacements can use `--comment "New body"` instead of `--comment-file`.
If Sync is active, add `--settle-ms 2000` here too so the script skips notes that changed after it read them instead of overwriting them.

7. If the note is outside the writable workspace, request escalation before running the script.
8. Verify the note still contains exactly one managed block and that only the target comment thread or entry body changed.

## Important Details

- SideNote2 stores comments as strict JSON in the trailing hidden block.
- Legacy notes may still use one flat object per comment with a top-level `comment` field. Migrate those notes with the helper script before editing them.
- The helper scripts write atomically and skip notes that changed after the initial read. Treat a skipped note as a retry case, not as a signal to hand-edit the managed JSON.
- Multiline comment bodies must stay JSON-escaped in source; do not paste raw block text into the JSON string by hand unless necessary.
- The note itself is the source of truth. Sidebar state and aggregate views are derived from the note.
- `SideNote2 index.md` is generated output, not canonical storage.

## Fallback

If the helper script cannot be used:

1. Edit the source-mode block directly.
2. Preserve `id`, anchor coordinates, `selectedText`, `selectedTextHash`, timestamps, and `resolved`.
3. Change only the target body field:
   - legacy flat payloads: `comment`
   - threaded payloads: the target `entries[*].body`
