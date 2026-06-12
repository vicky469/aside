# Remove Legacy SideNote2 And Inline Storage Design

## Context

Aside currently has several historical compatibility paths in the codebase:

- Old source-note storage: hidden trailing markdown blocks at the bottom of markdown files.
- Old plugin identity and URL/path names from the pre-Aside plugin.
- Transitional local caches: sidecar JSON files under `.obsidian/plugins/aside/sidenotes/...`, plus fallback reads from the old plugin's data directory.
- Current storage: Aside plugin data, source identities, sync events/snapshots, and Aside sidecars under `.obsidian/plugins/aside/sidenotes/...`.

The old source-note storage put side-note JSON at the bottom of user markdown files. It was hidden in reading mode because it lived inside an HTML comment, but it still made source notes a storage surface. That path is no longer desirable: it creates ambiguity, makes source files harder to reason about, and keeps migration logic active long after the migration window.

The recent incident where a vault shows very few comments and a nearly empty `Aside index.md` should be diagnosed separately before implementation. This spec removes unsafe legacy compatibility surfaces, but it does not assume that the current missing-comment symptom was caused by inline-block compatibility.

This is a deliberate breaking cleanup: current runtime should no longer know the old plugin name or old storage format. Users who still need migration must use the immediately previous release, let it migrate their vault, then upgrade.

## Goals

- Make source markdown files non-canonical for side-comment data.
- Stop writing hidden comment-data blocks to source notes.
- Stop reading hidden comment-data blocks from source notes.
- Remove all runtime knowledge of the old plugin name, including old plugin ids, URI protocols, generated-index protocols, CSS classes, data attributes, storage paths, and constant names.
- Stop reading, writing, reconciling, or deleting old plugin cache files from current runtime paths.
- Stop parsing old storage formats in current runtime and helper scripts.
- Keep modern Aside storage intact: source identities, plugin-data sync events/snapshots, and `.obsidian/plugins/aside/sidenotes/...`.
- Keep `Aside index.md` as derived output only.
- Make helper scripts follow the same storage boundary as the plugin runtime.
- Add tests and static checks that prove current runtime only uses current Aside names and current storage.

## Non-Goals

- Do not delete user vault files or legacy data automatically.
- Do not attempt a one-shot data recovery from old plugin data during this change.
- Do not change the current Aside sidecar format.
- Do not change source identity, sync event, snapshot, rename recovery, or aggregate index data models except where they depend on legacy inline inputs.
- Do not redesign `Aside index.md`.
- Do not solve the current missing-comment incident without a separate data audit and repro.
- Do not keep old-name compatibility in current runtime for convenience.
- Do not keep old-format parsing in current runtime as a fallback.

## Source Of Truth

After this change, comment data is loaded only from current Aside-owned storage:

```text
.obsidian/plugins/aside/data.json
.obsidian/plugins/aside/sidenotes/by-note/<hash-prefix>/<hash>.json
.obsidian/plugins/aside/sidenotes/by-source/<hash-prefix>/<hash>.json
```

Source markdown files are normal note content. They are not a comment database.

`Aside index.md` remains generated output. It can help users discover comments, but it is not canonical storage.

Old plugin directories and old inline blocks are historical data. Current runtime should not read, write, reconcile, strip, parse, detect, or delete them.

Current runtime should use the Aside vocabulary exclusively. The old plugin name may appear in historical release notes or in this spec while describing what to remove, but it should not appear in production runtime code, helper scripts, tests that exercise current behavior, generated output, CSS selectors, URL protocols, data attributes, or user-facing copy.

## Target Behavior

### Source Notes

When a source markdown note contains an old hidden comments block, Aside must not import, parse, migrate, strip, or specially hide it. It is just markdown file content as far as the current plugin is concerned.

This is intentionally stricter than "ignore but still recognize." Current runtime should not keep block markers, regexes, serializers, parsers, or visibility helpers for the old storage format.

Saving comments for a note must never append or update a hidden source-note block. The write path updates current Aside storage only.

### Modern Sidecars

Aside keeps reading and writing:

```text
.obsidian/plugins/aside/sidenotes/by-note
.obsidian/plugins/aside/sidenotes/by-source
```

Path sidecars remain the local hot cache. Source sidecars remain the rename-stable cache keyed by source identity.

### Old Plugin Sidecars

Aside stops reading from old plugin sidecar paths. It also stops removing stale old sidecars during current writes. Deleting historical files is a separate user-approved cleanup operation, not part of normal comment persistence.

The current codebase should not hardcode those old paths at all.

### Sync Events And Snapshots

Plugin-data sync remains current storage. This change should not remove:

- `sideNoteSyncEventState`
- `sourceIdentityState`
- snapshot compaction
- event replay into current Aside sidecars
- rename recovery from current Aside source identities and snapshots

If a synced event or snapshot points to a current Aside source note, it remains valid. If the only copy of a comment is in old inline storage or old plugin storage, current runtime should not import it. The migration path is the immediately previous release.

## Migration Path

Current release `N` does not migrate old names or old storage formats.

Users who still need migration must:

1. Install release `N-1`, the immediately previous release.
2. Open the vault with that release and let its existing migration/import code materialize comments into current Aside storage.
3. Confirm current Aside sidecars and plugin-data sync state exist.
4. Upgrade to release `N`.

Release notes for `N` must say this clearly. The current codebase should not include a hidden fallback migrator for users who skipped `N-1`.

The `N-1` release is the compatibility bridge. Release `N` is current-storage-only.

## Code Surface

### Inline Source-Note Storage

Current modules to remove or shrink:

- `src/core/storage/noteCommentStorage.ts`
- `src/core/storage/canonicalCommentStorage.ts`
- `src/core/storage/legacyInlineCommentMigration.ts`
- `src/comments/commentPersistenceController.ts`
- `scripts/lib/asideRepoScripts.mjs`

Target shape:

- Remove hidden-block markers, regexes, analyzers, serializers, and parsers used only for comment storage.
- Remove JSON parsing of hidden markdown blocks into `CommentThread[]`.
- Remove `serializeNoteCommentThreads(...)` as a persistence writer.
- Replace canonical planning actions that mention `legacy-inline` or `migrate-inline` with a sidecar/sync-only plan.
- Remove merge/reconcile code that imports inline threads into sidecars.
- Remove migration logs such as `storage.note.migrate.success` for inline source-note import.

No replacement helper should retain knowledge of old storage markers. If prompt-building or UI code needs visible markdown content, it should use generic markdown/content rules, not old comment-storage parsing.

### Sidecar Storage

Current module:

- `src/core/storage/sidecarCommentStorage.ts`

Target changes:

- Remove `legacyPluginDirPaths` from `SidecarCommentStorageOptions`.
- Remove `legacyBaseDirPaths` and `legacySourceBaseDirPaths`.
- `exists`, `read`, `readForSource`, `listStoredComments`, and cleanup methods only operate under `.obsidian/plugins/aside/sidenotes/...`.
- Do not delete old plugin data files as stale current-state cleanup.
- Remove old plugin path literals from this module.

### Plugin Host Wiring

Current host surface:

- `CommentPersistenceHost.getLegacyPluginDataDirPaths?()`
- plugin composition that returns legacy plugin data paths

Target changes:

- Remove `getLegacyPluginDataDirPaths?()` from the persistence host.
- Remove runtime wiring for old plugin data directories.
- Keep `getPluginDataDirPath()` for current `.obsidian/plugins/aside`.

### Helper Scripts

Current scripts still include old inline-block and old-plugin sidecar compatibility:

- `scripts/lib/asideRepoScripts.mjs`
- `scripts/create-note-comment-thread.mjs`
- `scripts/create-note-comment-thread-with-children.mjs`
- `scripts/append-note-comment-entry.mjs`
- `scripts/update-note-comment.mjs`
- `scripts/resolve-note-comment.mjs`
- `scripts/generate-large-graph-fixture.mjs`

Target behavior:

- Script reads and writes use current Aside sidecars and current `data.json` only.
- Script writes never serialize hidden blocks into source notes.
- Script reads never import hidden source-note blocks.
- Script cleanup does not remove old plugin cache files.
- URI-based script targets should prefer `obsidian://aside-comment?...`.
- Remove old URI parsing from scripts. Users with old URIs should migrate through release `N-1` before using current scripts.

### Index And Navigation Legacy Names

Current derived-index compatibility still contains old names in generated paths, URL protocols, CSS classes, and data attributes. Remove those too.

Target behavior:

- Generate only `Aside index.md`.
- Use only `aside-comment` and `aside-index-file` protocols.
- Use only `aside-*` CSS classes and data attributes.
- Do not recognize old generated-index paths as special current index notes.
- Do not parse old generated-index protocols.
- Do not parse old comment-link protocols.

Users with old generated index notes should regenerate the current index after migration through release `N-1`.

## Data Audit Before Implementation

Before removing compatibility code, run a read-only audit against the affected vaults. This audit is an ad hoc pre-implementation check, not shipped runtime behavior and not a retained helper script in `src/`, `scripts/`, or `tests/`.

1. Count current Aside sidecars by note and by source.
2. Count old plugin sidecars by note and by source.
3. Count source notes containing old hidden comment-storage blocks.
4. Count sync snapshots and source identities in current `.obsidian/plugins/aside/data.json`.
5. For the reported example note, record whether comments exist in current sidecars, source sidecars, sync snapshots, old sidecars, or hidden blocks.

The audit must not mutate files. If it finds comments that exist only in old storage, stop and report that release `N` will not import those comments. The supported migration instruction is to install and run release `N-1`, then upgrade.

## Migration Policy

This change is a compatibility removal, not an automatic data migration.

Allowed:

- Current runtime has no knowledge of old source-note comment blocks.
- Current runtime has no knowledge of old plugin sidecars.
- Documentation tells users to use release `N-1` for migration.

Not allowed:

- Silently importing old hidden blocks on normal note open.
- Silently deleting old hidden blocks from user markdown.
- Silently deleting old plugin directories.
- Reconstructing current storage from derived `Aside index.md`.
- Keeping a current-runtime fallback parser for old URI protocols, generated-index protocols, old CSS/data attributes, old hidden blocks, or old sidecar paths.
- Adding a new one-time migration script to release `N`; that belongs in `N-1` or in a separate user-run historical maintenance branch.

## Testing

Add or update focused tests.

### Storage Planning

- Sidecar exists: load sidecar threads from current Aside storage.
- No sidecar exists: return no threads; do not inspect source markdown for stored comment JSON.
- No sidecar exists: run current rename recovery from source identities/snapshots.
- Planning types do not expose `legacy-inline` or old-storage actions.

### Note Content Helpers

- Runtime contains no helper that recognizes old hidden comment-storage markers.
- Hidden comment-storage blocks are not parsed, stripped, imported, migrated, or treated as an error by current comment writes.
- Saving current Aside sidecars does not depend on source-note hidden-block analysis.

### Sidecar Storage

- Reading a current Aside path sidecar still works.
- Reading a current Aside source sidecar still works.
- Old plugin sidecar paths are not constructed or scanned.
- Empty current thread writes remove only current Aside sidecars.

### Persistence Controller

- `loadCommentsForFile(...)` does not inspect source-note content for stored comment JSON when no current storage exists.
- `persistCommentsForFile(...)` writes current sidecars and sync events without mutating source-note content to add hidden blocks.
- Existing sync event replay still materializes current Aside sidecars.
- Current rename recovery still works from source identity snapshots.

### Scripts

- Create, append, update, and resolve scripts read current Aside storage and write current Aside sidecars.
- Scripts do not create hidden source-note blocks.
- Scripts do not construct old plugin paths.
- Scripts reject old URI protocols instead of parsing them.

### Static Removal Checks

- `rg -n "SideNote2|side-note2|sidenote2" src scripts tests styles.css manifest.json package.json` returns no hits except where a test fixture is explicitly scoped to release notes or migration documentation.
- `rg -n "legacy-inline|migrate-inline|legacyPluginDirPaths|getLegacyPluginDataDirPaths" src scripts tests` returns no hits.
- `rg -n "<!-- Aside comments|<!-- SideNote2 comments" src scripts tests` returns no hits.

## Acceptance Criteria

- No runtime code contains the old plugin name, old plugin id, old protocols, old CSS/data attributes, or old storage paths.
- No runtime code parses hidden source-note blocks into stored threads.
- No runtime code serializes comment threads into hidden source-note blocks.
- No runtime code reads old plugin sidecars.
- No runtime code deletes old plugin sidecars as part of normal writes.
- Current Aside sidecar reads/writes still work.
- Current sync event replay and snapshot compaction still work.
- Current source identity rename recovery still works.
- `Aside index.md` generation still derives from current aggregate comment state.
- Helper scripts use the same current-storage-only model as the runtime.
- Tests cover current sidecars, absence of inline storage parsing, absence of old plugin path construction, and script write paths.
- The implementation includes a read-only audit result before removing compatibility in a real vault.
- Release notes explain that users who need migration must first run release `N-1`, then upgrade.

## Open Decisions

1. Which exact release number is `N-1` for the final migration bridge? does not matter for now.
