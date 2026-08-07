# Public Publish Metadata Registry Design

## Summary

Aside will persist one plugin-owned metadata record for every published Markdown, HTML, and PDF artifact. The generated `public/index.md` will derive its status, last-published date, and URL from that registry instead of treating the generated table as durable state.

This fixes the current empty `last_published_at` values: startup can discover that an artifact is enabled from Markdown `asidePublish` flags or the legacy standalone artifact path list, but neither source records when the artifact was last published. The previous implementation stored that timestamp only in `public/index.md`, so rebuilding the index could not restore it.

The index will also move `published_url` to the final column and render long URLs with the same clickable shortened Markdown-link presentation used by comment cards.

## Implementation Tracking

Use this section as the working checklist. Mark an item complete only after it is implemented on the working branch and the listed verification passes.

### Already Done

- [x] Aside publishes Markdown-rendered HTML, standalone HTML, and PDF artifacts through the local Wrangler Pages deployment path.
- [x] Markdown `asidePublish.markdownEnabled` and `asidePublish.htmlEnabled` fields describe which source-owned artifacts belong in a deployment snapshot.
- [x] The legacy `publishedPublicArtifactPaths` setting identifies standalone HTML/PDF artifacts.
- [x] `public/index.md` is a fully Aside-owned generated inventory and can read previous table formats.
- [x] Comment rendering has a tested short Markdown-link presentation for long HTTP(S) URLs.

### To Implement

- [ ] Add a normalized `publicPublishMetadataRecords` plugin-data registry containing one metadata record per public artifact.
- [ ] Store the vault-relative artifact path, `published` or `unpublished` status, date-only last-published value, and full current public URL.
- [ ] Persist metadata only after a successful publish, update, or unpublish deployment.
- [ ] Preserve the last-published date when an artifact becomes unpublished while clearing its current public URL.
- [ ] Update registry paths on file rename and remove records on file deletion or containing-folder deletion.
- [ ] Migrate current published state and legacy index rows without inventing historical dates.
- [ ] Keep deployment configuration in existing Markdown flags while making the registry the source of truth for status/history metadata.
- [ ] Render the generated index columns as `path`, `status`, `last_published_at`, and final-column `published_url`.
- [ ] Reuse the comment-card URL-shortening owner instead of duplicating URL-label logic.
- [ ] Parse shortened Markdown links in the URL column back to their full link targets during legacy/current index reads.
- [ ] Rebuild the real `lean-startup/public/index.md` from the migrated registry.

### Verification

- [ ] Registry tests cover normalization, malformed data, deduplication, immutability, and legacy migration.
- [ ] Publish-controller tests cover publish, republish, unpublish, failed deployment, failed metadata persistence, startup migration, and overlapping refreshes.
- [ ] Lifecycle tests cover artifact rename, file deletion, and folder deletion.
- [ ] Index tests cover URL-last rendering, shortened clickable URLs, full-target parsing, prior column orders, unknown historical dates, sorting, and table-cell escaping.
- [ ] The complete repository build and release-artifact guard pass.
- [ ] The verified `main.js`, `manifest.json`, and `styles.css` are installed byte-identically in `lean-startup`.
- [ ] The real vault registry and generated index are inspected after migration.

## Goals

- Preserve trustworthy last-published dates across index rebuilds.
- Give Markdown, HTML, and PDF artifacts one uniform metadata schema.
- Keep generated inventory state recoverable from plugin data.
- Make long published URLs compact and readable without losing click targets.
- Keep `published_url` as the final inventory column.

## Non-Goals

- Adding a source-file creation date.
- Writing publish history into Markdown frontmatter.
- Replacing existing `asidePublish.markdownEnabled`, `htmlEnabled`, or `html` deployment configuration.
- Inventing publish dates for artifacts published before the registry exists.
- Keeping a multi-event publish history; the registry stores only current status and the most recent successful publish date.
- Changing the public deployment provider or cache-purge behavior.

## Metadata Model

Plugin data gains a `publicPublishMetadataRecords` registry of normalized records equivalent to:

```ts
type PublicPublishMetadataStatus = "published" | "unpublished";

interface PublicPublishMetadataRecord {
  path: string;
  status: PublicPublishMetadataStatus;
  published: string | null;
  publishedUrl: string | null;
}
```

`path` is the canonical vault-relative artifact path, including the configured publish root. `published` is a real calendar date in date-only `YYYY-MM-DD` form for the most recent successful deployment that included the artifact. It remains unchanged when the artifact is unpublished. `publishedUrl` is the full current URL while status is published and `null` while unpublished.

There is no `created` field. Aside does not create the source artifact, so it has no authoritative creation event to record.

The registry owns status/history metadata. Existing Markdown frontmatter still owns source-to-artifact deployment configuration. `publishedPublicArtifactPaths` continues to own standalone HTML/PDF deployment configuration and also serves as a startup migration input; this design does not replace it.

## Publish Lifecycle

### Publish and update

The controller calculates the date once from its injected clock before building the in-memory post-success metadata change. It deploys the complete enabled snapshot first. Only after deployment succeeds does it persist a record with:

- `status: published`
- `published: YYYY-MM-DD` for that successful deployment
- the canonical full public URL

Republishing replaces `published` with the new successful deployment date.

### Unpublish

The controller deploys the remaining enabled snapshot first. After success it persists:

- `status: unpublished`
- the previous non-null `published` date
- `publishedUrl: null`

A failed unpublish leaves both deployment configuration and registry metadata unchanged under the existing rollback behavior.

### Persistence failure

If deployment succeeds but registry persistence fails, the controller must return an explicit incomplete-state error rather than claiming that publish bookkeeping and the generated index are current. The registry and index write path remains serialized so overlapping actions cannot overwrite newer metadata.

## Startup Migration and Reconciliation

Startup reads normalized registry records first. It then reconciles legacy sources:

1. Previous/current generated index rows provide full URLs, statuses, and any trustworthy dates already present.
2. Enabled Markdown and paired-HTML frontmatter identifies currently published source-owned artifacts.
3. `publishedPublicArtifactPaths` identifies currently published standalone artifacts.

Existing registry values win. Legacy index dates are retained when valid. Newly discovered published artifacts receive their derived full URL and `published: null`; Aside does not use migration time or file modification time as a fake publish date. A successful later publish supplies the first trustworthy date.

Unpublished legacy index rows may be retained as historical registry records. The owner-only `index.md` path is always excluded.

## Rename and Delete Lifecycle

File rename moves the exact matching artifact record to the normalized new path when both paths remain within the allowed publish root. Folder rename applies the same transformation to every descendant record. File or folder deletion removes matching registry records so deleted artifacts do not remain in regenerated inventory.

Source Markdown renames continue to use the existing frontmatter and paired-path resolution rules. The registry adapter updates only the artifact paths that actually change.

## Generated Index

New output uses:

```md
| path | status | last_published_at | published_url |
| --- | --- | --- | --- |
| startup/business plan.md | published | 2026-08-07 | [publish.fdechina.com/public/startup/business plan](https://publish.fdechina.com/public/startup/business%20plan) |
```

`published_url` is always the final column. The in-memory record retains the full URL. Rendering delegates to the existing comment URL-shortening policy, so long or encoded URLs get a compact Markdown label while preserving the full target. Short URLs retain that shared policy's existing presentation.

Index parsing accepts the new order and all currently supported older orders. When the URL cell contains a Markdown link, parsing extracts and unescapes the full HTTP(S) target rather than storing the visible label.

Unpublished rows retain `last_published_at`, when known, and render an empty URL cell.

## Shared Ownership

Publish metadata normalization and immutable update helpers belong in one core publish module. The settings planner, main plugin adapter, controller, lifecycle hooks, and generated index consume that shared owner rather than reimplementing record rules.

URL-label construction stays owned by the existing comment URL module. The publish index calls an exported formatting function from that owner and adds only table-cell escaping/parsing specific to the inventory format.

## Error Handling

- Malformed persisted records are dropped during normalization.
- Duplicate paths resolve deterministically after path normalization: the later valid persisted record wins.
- Invalid dates, including impossible calendar dates, become `null`; no current date is substituted.
- Invalid or non-HTTP(S) published URLs become `null`.
- Failed deployments change no registry or index state.
- Failed metadata persistence produces a clear incomplete-state result.
- Failed index regeneration preserves the successfully stored registry so a later refresh can recover.
- Legacy malformed table rows remain ignorable without losing later valid rows.

## Testing Strategy

Pure registry tests establish the schema and immutable path/status transitions. Settings-planner tests prove malformed plugin data cannot enter runtime state. Controller tests verify deployment-before-persistence ordering and exact publish/unpublish semantics. Lifecycle tests prove renames and deletes keep the registry aligned with vault state.

Index tests verify the new column order and shared URL presentation while preserving backward reads for previous table formats. One representative caller test proves the index actually consumes the shared URL formatter, and direct URL-module tests remain the single owner for label/truncation behavior.

Final verification runs the full repository build, release artifact security inspection, installation into `lean-startup`, byte comparisons for the three shipped assets, and a real-vault migration/index inspection.
