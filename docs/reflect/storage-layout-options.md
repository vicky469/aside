# SideNote Storage Options

This note is about one concrete scaling problem:

- the sample book note at  
  `/Users/wenqingli/Obsidian/public/public/books/The Goal_ A Process of Ongoing Improvement - Revised 3rd -- Eliyahu M_ Goldratt, Jeff Cox, Ensemble cast, Dwight Jon -- Revised 3rd Edition, 2006 -- isbn13 9781598870640 -- 95f4f3be72ed3c91ea065d8eb808b566 -- Anna’s Archive.md`
- is already about `856,892` bytes and `10,012` lines
- current Aside storage rewrites the note itself because threads live in a trailing hidden JSON block

That works well for normal notes, but it is the wrong scaling shape for book-sized markdown files.

## Current Constraints

Any new storage model still has to support the current product shape:

- anchored threads on exact text ranges
- page threads
- multi-entry threads and replies
- `resolved`, `deleted`, `pinned`, and `orphaned` state
- derived index and thought-trail views
- good Obsidian sync behavior
- stable import/export and repair paths without depending on direct human editing

## Design Principles To Borrow

### From Linux filesystems

- Do not rewrite huge parent files when a small child record changes.
- Separate identity from path where possible.
- Shard directories so one folder does not grow without bound.
- Prefer atomic write patterns: write temp file, then rename.
- Keep lookup metadata small and cheap to load.

### From Org mode / Emacs

- Use stable IDs for links instead of depending only on headings or file position.
- Separate addressing metadata from display text.
- Allow a fast index/cache layer without making it the only source of truth.

### From Maildir / Git / other file-native systems

- One logical object per file can reduce conflict blast radius.
- Append-only or object-style storage is robust and sync-friendly.
- A small index plus stable object files is often better than one giant mutable blob.

## Important Observation

Putting the canonical side-note pointer into the source note frontmatter does not really solve the large-note problem.

Why:

- it still requires rewriting the huge source note at least once
- it keeps Aside coupled to the note body for metadata churn
- it makes imported or generated notes less clean

So if we use frontmatter at all, it should live in side-note-owned storage, not in the huge source note.

## Option 1: Per-Note Sidecar Manifest

Store one compact sidecar file per note in plugin data and move the canonical thread data out of the note body.

Example layout:

```text
.obsidian/
  plugins/
    aside/
      sidenotes/
        by-note/
          95/
            f4/
              95f4f3be72ed3c91ea065d8eb808b566.json
```

Suggested payload:

```json
{
  "notePath": "books/The Goal ... Anna’s Archive.md",
  "threads": [
    {
      "id": "thread-uuid",
      "anchorKind": "selection",
      "startLine": 120,
      "startChar": 4,
      "endLine": 120,
      "endChar": 19,
      "selectedText": "constraint",
      "selectedTextHash": "...",
      "resolved": false,
      "isPinned": false,
      "entries": [
        { "id": "entry-1", "body": "First note", "timestamp": 1 }
      ]
    }
  ]
}
```

### Why it is good

- Fast for note open: compute note-path hash, read one small file.
- Very reliable write path: temp file plus rename.
- Minimal migration from current code because it still stores one structured thread array.
- Easy to cache in memory.
- Keeps the source note clean.
- Fits the repo's existing pattern of storing larger durable plugin-owned state under `.obsidian/plugins/aside/...`.

### Why it is not perfect

- Global search over note bodies and side-note bodies needs an extra index pass.
- Rename/move needs Aside to update `notePath` inside the sidecar or maintain an external path index.

## Option 2: Per-Thread Markdown Files Plus Per-Note Manifest

Store each thread as its own markdown file, and keep a small manifest per note for lookup and ordering.

Example layout:

```text
sidenotes/
  by-note/
    95/
      f4/
        95f4f3be72ed3c91ea065d8eb808b566/
          note.json
          8cc93bfb-ac20-4069-b430-57896f23393e.md
          2ffd6f57-f0f1-4458-b09b-ed9c871d77b0.md
```

Example thread file:

```md
---
id: 8cc93bfb-ac20-4069-b430-57896f23393e
notePath: books/The Goal ... Anna’s Archive.md
anchorKind: selection
startLine: 28
startChar: 6
endLine: 28
endChar: 20
selectedText: Cross-Section
selectedTextHash: 964144...
resolved: true
isPinned: false
createdAt: 1774912991539
updatedAt: 1775538575210
---

## 2026-04-22T15:49:51Z

Cross-section means...

## 2026-04-22T17:12:47Z

update
```

### Why it is good

- Small conflict surface: one thread change touches one file.
- Easy external tooling and export.
- Stable per-thread IDs map well to thread semantics.

### Why it is not perfect

- Parsing markdown thread files is slower and more fragile than structured JSON.
- Per-note load may require opening many files unless we also keep a manifest.
- More filesystem objects means more directory and sync overhead.
- Editing reply structure inside markdown needs stricter parsing rules.
- If human readability is not a primary goal, this option pays complexity for a benefit we do not need.

## Option 3: Hybrid Journal + Materialized Cache

Use an append-only log for writes, then materialize per-note caches for reads.

Example layout:

```text
sidenotes/
  log/
    2026-04.jsonl
  by-note/
    95/
      f4/
        95f4f3be72ed3c91ea065d8eb808b566.json
```

Write path:

1. append event to journal
2. update per-note materialized cache
3. atomically rename cache file into place

### Why it is good

- Best write reliability story.
- Great for support/debugging and sync recovery.
- Fast per-note reads if the materialized cache is authoritative for reads.

### Why it is not perfect

- More complex than Aside probably needs right now.
- Harder for humans to understand as the canonical storage shape.
- Worse plain-file interoperability than the thread-markdown option.

## Recommendation

The best fit for Aside looks like this:

1. Canonical storage: per-note sidecar manifest in plugin data.
2. Layout: `.obsidian/plugins/aside/sidenotes/by-note/<hash-prefix>/<full-hash>.json`.
3. Do not use source-note frontmatter as canonical storage.
4. Do not use `data.json` for this payload.
5. Optional future export mode: per-thread markdown files only as an export/import surface, not as the primary format.

Why this is the best first move:

- It solves the big-note rewrite problem immediately.
- It keeps retrieval fast and simple.
- It preserves the current in-memory thread model with the least migration pain.
- It is much more reliable than reparsing giant notes after every save.
- It does not force us to invent a markdown thread parser as part of the first migration.
- It matches how this plugin already treats larger plugin-owned data such as logs: as files under the plugin directory, not blobs inside `data.json`.

## Why Plugin Data Instead Of `data.json`

Use plugin data files under `.obsidian/plugins/aside/sidenotes/...`, not `saveData()` / `data.json`.

Why:

- side notes can become large and hot-write state
- per-note files avoid rewriting one giant plugin blob
- file sharding is easier than managing one monolithic JSON document
- recovery and repair are simpler when one note maps to one storage file
- it matches the existing repo direction for larger persistent plugin-owned state

## Recommended Retrieval Model

For note-local reads:

1. normalize note path
2. hash normalized note path
3. read `.obsidian/plugins/aside/sidenotes/by-note/<shard>/<hash>.json`
4. fall back to legacy inline block only if no sidecar exists

For global index rebuild:

- scan `.obsidian/plugins/aside/sidenotes/by-note/**.json`
- or keep a small `sidenotes/index.json` that maps note path to sidecar path

## Reliability Rules

If we move to sidecars, we should adopt these rules from day one:

- never partially rewrite the sidecar in place
- write temp file, `fsync` if needed, then rename
- shard directories by hash prefix
- keep note path inside the sidecar for verification and repair
- dual-read old inline storage during migration
- write only the new sidecar format after migration for large notes

## Migration Shape

1. Keep current parser for legacy inline blocks.
2. Add a storage adapter interface so current controllers stop caring where threads live.
3. On the first plugin release that ships sidecar storage, automatically run note migration on upgrade.
4. During that upgrade path, read legacy inline threads and write them into the sidecar without requiring a manual user command.
5. If migration for one note fails, leave the legacy inline block untouched for that note and retry later instead of partially switching formats.
6. After startup migration is in place, on first write for any still-legacy large note, migrate inline threads into the sidecar before normal persistence continues.
7. Remove or stop updating the hidden block once migration is confirmed.
8. Keep `Aside index.md` as derived output, not primary storage.

## Migration Rollout Rule

The migration should not be a separate maintenance task.

- On the next release that introduces sidecar storage, Aside should auto-run the note migration during plugin startup or version-upgrade handling.
- Users should get the new storage format just by updating the plugin.
- Manual migration commands can still exist for repair or re-run cases, but they should not be required for the main rollout.

## Open Question

Do we want the source note to contain any breadcrumb at all?

Possible answers:

- `none`
  Best for clean imported notes and zero rewrite pressure.
- small hidden marker comment
  Easier manual discovery, but still touches the source note.
- frontmatter pointer
  Most explicit, but worst fit for the “huge note” problem.

Decision: **none**.

- Source-note frontmatter is not used as canonical storage.
- After migration, Aside writes zero metadata back into the source note.
- The managed inline block is stripped from the note during migration and is never re-inserted.
- Note identity lives in the sidecar (`notePath` field) and in the in-memory aggregate index.

This means the source note is treated as read-only for side-note purposes after migration, except for normal user editing.

---

## Implementation Log

### First cut (current)

Canonical storage is now per-note sidecar JSON under `.obsidian/plugins/aside/sidenotes/by-note/<hash-prefix>/<full-hash>.json`.

Key files:

- `src/core/storage/sidecarCommentStorage.ts`
  - `SidecarCommentStorage` class: read, write, rename, remove.
  - Write path: serialize payload, write temp file, rename into place.
  - Empty thread list deletes the sidecar file.
  - Uses 2-character hash prefix for sharding.

- `src/comments/commentPersistenceController.ts`
  - `sidecarStorage` is the primary storage adapter.
  - `migrateLegacyInlineCommentsOnStartup()` scans all markdown files, reads legacy inline blocks, writes sidecars, and strips the managed block from the source note.
  - `handleMarkdownFileModified()` now reads sidecar-first; if no sidecar exists and the file was modified externally with a legacy block, it migrates on demand.
  - Anchor-coordinate updates and normal persistence write back to the sidecar, not the note body.

- `src/app/pluginLifecycleController.ts`
  - `handleFileRename()` moves the sidecar via `renameStoredComments()`.
  - `handleFileDelete()` removes the sidecar via `deleteStoredComments()`.

- `src/settings/indexNoteSettingsPlanner.ts` / `src/main.ts`
  - `sidecarStorageMigrationVersion` is persisted in plugin data.
  - `ensureSidecarStorageMigrated()` runs once on startup after settings load.

- `README.md`
  - Updated with the new storage layout description.

Migration behavior observed:

- Startup migration iterates all markdown files in sorted order.
- For each file with a legacy inline block, it parses threads, writes the sidecar, rewrites the note without the managed block, and increments a counter.
- If a note already has a sidecar, it is left untouched.
- Per-note failures do not abort the global migration; the legacy block stays in that note and can be retried later.

### Verified

- `tsc -p tsconfig.test.json` passes.
- New unit tests for `sidecarCommentStorage.ts` pass under `node --test`.
- `npm run build` completes the full test/lint/typecheck/build pipeline.

### Not yet done

Internal helper scripts that directly edit legacy note blocks have not been migrated. The plugin runtime is sidecar-based, but repo-side write scripts still assume inline canonical storage. Those scripts need to be pointed at the sidecar files or removed if they are no longer needed.

---

## FAQ: Why the directory layout looks this way

### Why `sidenotes/by-note/` instead of just `sidenotes/`?

`sidenotes/` is the root for all side-note storage. `by-note/` makes the addressing scheme explicit and leaves room for future storage surfaces under the same root without collision:
- `sidenotes/index.json` — a future global lookup index
- `sidenotes/export/` — per-thread markdown exports
- `sidenotes/by-note/` — the canonical per-note sidecars (today)

It is future-proofing, not a necessity for the current shape.

### Why the hash-prefix folders (`95/f4/...`)?

This is directory sharding. Without it, every sidecar would live in one flat directory. If a vault has 10,000 notes, that is 10,000 files in a single folder. Some filesystems and sync tools (Obsidian Sync, Dropbox, iCloud) degrade when directories grow past a few thousand entries.

A 2-character hex prefix creates `16^2 = 256` subdirectories. At 10,000 notes, each shard holds roughly 40 files — well within the comfortable range for any sync client.

Trade-off: slightly deeper paths in exchange for predictable performance at scale.

### Does each JSON file hold the entire sidebar for one markdown note?

Yes. One `.json` file = one source note = the complete thread array for that note.

The file contains every anchored thread, page thread, reply, resolved state, pin state, and deletion timestamp for that single file. The plugin reads this file when the note opens, and rewrites it (atomically, via temp-file-then-rename) whenever any comment on that note changes.

There is no per-thread file splitting; the note is the unit of storage.

## Follow-up Work

1. Migrate repo-side helper scripts that still touch legacy inline blocks.
2. Consider whether the 2-character shard prefix is enough for very large vaults; 4-character may be safer if the directory count grows.
3. Evaluate whether `notePath` inside the sidecar should be updated on every rename, or whether a stable external path index is preferable. 
4. Decide on a repair/rebuild command that can re-index sidecars back into the aggregate view if the in-memory index drifts.
5. Long-term: consider an export mode that emits per-thread markdown files for portability, but keep JSON sidecars as the canonical runtime format.
