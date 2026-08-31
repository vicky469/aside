# Thought Trail Attachments Design

**Date:** 2026-08-31
**Status:** Approved

## Goal

Add `Attachments` as the third `Related Files By` source in Thought Trail. It shows the resolved non-Markdown files embedded directly in the selected file as a compact clickable list. Unlike the existing `Wikilinks` and `Tags` sources, Attachments is explicitly file-scoped.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Thought Trail has one transient source selection with `Wikilinks` as its default and `Tags` as its second source.
- [x] Obsidian metadata-cache adapters already read source-note embeds without reading note contents or scanning attachment folders.
- [x] Wikilinks deliberately accepts only resolved Markdown targets, so non-Markdown embeds do not currently enter the note-link graph.
- [x] Thought Trail has a shared preferred-leaf file-opening path and native full-path tooltips.

### To Implement

- [ ] Extend the shared Thought Trail source policy with `Attachments`, its label, file scope, ordering, normalization, availability, and fallback behavior.
- [ ] Add one attachment model that resolves direct cached embeds from the selected file, excludes Markdown and unresolved targets, deduplicates normalized paths, and sorts the result deterministically.
- [ ] Make direct attachments participate in Thought Trail availability without changing Wikilinks or Tags scope.
- [ ] Render Attachments as a compact semantic list with clickable filenames, type labels, and full-path tooltips.
- [ ] Show `Scope: File` for Attachments while retaining `Scope: Vault` for Wikilinks and Tags.
- [ ] Keep Attachments visible but disabled when the selected file has no eligible attachments, and fall back to Wikilinks if an active attachment source becomes unavailable.
- [ ] Add only the minimal theme-native styles required by the attachment list.

### Verification

- [ ] Tests prove attachment discovery is direct-file-only, excludes Markdown and unresolved embeds, deduplicates repeated embeds, and sorts deterministically.
- [ ] Tests prove the source order is Wikilinks, Tags, Attachments; source normalization accepts Attachments; scope copy and independent disabled states derive from the shared policy; and unavailable Attachments falls back to Wikilinks.
- [ ] Tests prove a file with attachments but no Wikilink or tag relationships can still enter Thought Trail.
- [ ] Tests prove the compact list is semantic, exposes filenames and types, uses full-path tooltips, and opens the exact attachment through the existing preferred-leaf behavior.
- [ ] Tests prove existing Wikilinks and Tags behavior remains unchanged on note and index surfaces.
- [ ] A repeated change-surface audit leaves one shared source-policy owner plus thin metadata, availability, and rendering adapters.
- [ ] The full tests, lint, typecheck, Obsidian compliance check, production bundle, and release-artifact guard pass.
- [ ] An installed-vault smoke test covers image and PDF embeds, a repeated embed, a Markdown embed, an unresolved embed, source switching, disabled state, file scope, and exact file opening.

## Product Behavior

The source control becomes:

```text
Related Files By  ( ) Wikilinks  ( ) Tags  ( ) Attachments    Scope: File
```

`Attachments` appears after `Tags`. The scope note reflects the selected source: it reads `Scope: File` for Attachments and remains `Scope: Vault` for Wikilinks and Tags. Scope is passive explanatory text, not a control.

This design supersedes the earlier “always `Scope: Vault`” rule only for the new Attachments source. The established vault scope for Wikilinks and Tags remains unchanged.

An attachment is a resolved non-Markdown `TFile` referenced by an embed in the selected root file's metadata cache, corresponding to Markdown such as `![[image.png]]` or `![[document.pdf]]`. Regular non-embed links do not count. Markdown embeds remain part of Wikilinks and do not also appear under Attachments. Attachment discovery does not traverse the Wikilink component, search candidate notes, infer an attachment folder, or scan the vault.

Each resolved attachment appears once even when embedded repeatedly. Rows are sorted case-insensitively by display filename, then by vault-relative path for deterministic ties. Each row shows the filename and a compact uppercase extension label such as `PNG` or `PDF`; an extensionless file uses `FILE`. Hover or keyboard focus exposes the complete vault-relative path through Obsidian's native tooltip.

Selecting a row opens the exact attachment in the existing preferred leaf and focuses that leaf. If the file disappears after rendering, the existing opener safely does nothing.

Attachments stays visible in the radio group when unavailable but is disabled in the same style as Tags. If Attachments is active and the selected file loses its last eligible attachment, the source falls back to Wikilinks. Source selection remains transient and continues to reset to Wikilinks when the existing view lifecycle resets it.

## Shared Ownership and Components

### Thought Trail source policy

`sidebarThoughtTrailSource.ts` becomes the single owner of source identity and presentation policy. It owns the closed source IDs, ordered definitions, labels, scopes, normalization, default selection, and availability fallback. The renderer iterates those definitions instead of maintaining its own source array and label conditional. `AsideView` supplies availability facts rather than adding source-specific fallback branches.

The policy accepts independent availability for Tags and Attachments. Wikilinks remains the always-selectable default once Thought Trail itself has a root file. This keeps source ordering, disabled state, scope text, and fallback behavior synchronized across note and index rendering.

### Attachment model and Obsidian adapter

A focused pure attachment planner owns classification, normalization, deduplication, display fields, and ordering. Its input is the selected source path, cached embed link paths, and a resolver result; its output is immutable list items containing the exact vault-relative path, display filename, and type label.

A thin Obsidian adapter reads only `metadataCache.getFileCache(selectedFile)?.embeds`, resolves each embed with `metadataCache.getFirstLinkpathDest(embed, selectedFilePath)`, and admits only `TFile` results whose extension is not `md` case-insensitively. Missing source files, absent caches, unresolved links, folders, and malformed entries produce no attachment item rather than an exception.

Both availability and rendering consume this shared attachment model. No second renderer-only interpretation of attachments is introduced.

### Availability and rendering

Thought Trail availability expands from “Wikilink graph or Tags result” to “Wikilink graph, Tags result, or direct Attachment result.” This lets a Markdown file whose only relationship is an embedded image or PDF open Thought Trail and select Attachments.

The renderer receives or builds the shared attachment model for the selected `rootFilePath`. It passes source availability into the shared source policy, renders the dynamic scope note, and branches to a compact Attachments list only when that source is active. Wikilinks keeps its Mermaid graph, while Tags keeps its existing unique related-file list and filters.

The attachment list uses one semantic `ul`, one `li` per unique attachment, a native non-submit button for the filename, and a noninteractive type label. It reuses the existing Thought Trail file opener and tooltip API rather than introducing attachment-specific navigation.

## Data Flow

```text
selected Thought Trail root file
    -> CachedMetadata.embeds for that file only
    -> Obsidian link resolver
    -> resolved non-Markdown TFiles
    -> pure normalize / dedupe / sort planner
    -> attachment availability + source policy
    -> compact attachment list
    -> existing preferred-leaf opener
```

No file contents are read and no vault-wide attachment scan is added. Metadata changes already cause the surrounding Aside view to rerender through the existing refresh flow; rerendering recomputes the model from current cache state.

## Failure Handling

- Missing root file or metadata cache: Attachments is disabled.
- Unresolved, malformed, or folder embed target: ignore that entry.
- Markdown target: leave it to Wikilinks and omit it from Attachments.
- Duplicate path or path spelling variant resolving to the same `TFile`: render one row using the resolved path.
- Last attachment removed while Attachments is active: resolve the source back to Wikilinks before rendering.
- Attachment deleted between render and click: the shared opener validates the target and performs no navigation.
- One unsupported attachment type: still render it as a normal file row; no preview decoder is required.

## Testing Strategy

Implementation follows red-green-refactor. Pure planner tests are written first and must fail because attachment modeling does not exist. They cover direct embed input, Markdown exclusion, unresolved targets, duplicate resolved paths, path normalization, case-insensitive extension handling, deterministic sort order, filenames, and type labels.

Source-policy tests then establish the third normalized source, ordered definitions, dynamic scope, independent Tags and Attachments availability, and fallback. Availability tests prove attachments alone make Thought Trail usable on both the normal note path and the selected-file index path without changing existing graph or tag cases.

Representative renderer tests cover the semantic list, native buttons, type labels, full-path tooltip wiring, disabled radio state, and shared open behavior. Stylesheet tests require only Obsidian theme variables and compact responsive geometry. Existing Thought Trail graph, Tags, sidebar source, toolbar, and source-contract tests remain green.

Final automated verification runs the complete repository build. The installed-vault smoke uses one Markdown note containing an image embed, PDF embed, duplicate image embed, Markdown embed, and missing embed. It verifies one row per non-Markdown file, no Markdown or missing row, `Scope: File`, exact opening, and fallback after the last eligible embed is removed.

## Non-Goals

- Thumbnail, image, PDF, audio, or video previews.
- Attachments from the entire Wikilink-connected component.
- Finding other notes that share an attachment.
- Treating regular `[[file.pdf]]` links as attachments.
- Scanning or inferring Obsidian's configured attachment folder.
- Adding attachments to the Mermaid Wikilinks graph.
- Restoring historical attachment-comment storage or changing PDF page-note storage.
- Persisting the selected Thought Trail source.
- Changing release metadata, version numbers, or public artifacts as part of this feature.
