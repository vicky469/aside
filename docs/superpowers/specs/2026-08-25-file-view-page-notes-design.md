# File-View Page Notes Design

**Date:** 2026-08-25
**Status:** Implemented

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside models file-level comments as `anchorKind: "page"` threads that do not require source-text coordinates.
- [x] Markdown, PDF, and HTML files already use the current sidecar/sync page-note storage path.
- [x] Workspace targeting already resolves a `TFile` exposed by a native or plugin-provided file-backed view without requiring a Markdown editor.
- [x] Page-note mutation, persistence, indexing, rename, and deletion flows are separated from Markdown-only text-anchor operations.

### To Implement

- [x] Replace the Markdown/PDF/HTML page-note extension whitelist with one extension-independent rule for every real vault `TFile` except the generated Aside index.
- [x] Let the note sidebar target any `TFile` exposed by the active Obsidian file-backed view while preserving the existing no-stale-file behavior for non-file tabs.
- [x] Expose the normal Add page note, reply, edit, delete, pin, reorder, navigation, and index behavior for representative native and plugin-provided non-Markdown file views.
- [x] Keep source-content reads, editor selection, anchor validation, highlights, and Markdown preview refresh limited to the existing text-anchor-capable formats.
- [x] Keep Aside out of file preview ownership: add no custom file view, extension registration, parser, converter, viewer setting, or file-menu fallback.
- [x] Preserve existing page-note data when a source file still exists but its viewer is temporarily unavailable.
- [x] Remove PDF-only page-note policy helpers that have no remaining production consumer, while retaining truly format-specific HTML and publishing behavior.

### Verification

- [x] Capability tests cover Markdown, PDF, HTML, images, audio, video, canvas, a plugin-viewed DOCX, the generated Aside index, and null inputs.
- [x] Workspace tests prove native and plugin-provided file views become the sidebar target and non-file tabs do not reuse a stale Markdown target.
- [x] Controller tests cover page-note creation and representative mutations on non-Markdown files without reading source bytes or refreshing Markdown decorations.
- [x] Persistence and lifecycle tests cover sidecar load/save, index inclusion, rename, deletion, and viewer unavailability for representative non-Markdown sources.
- [x] Existing Markdown anchors, rendered HTML behavior, PDF page notes, and `/pdf-to-markdown` tests remain green.
- [x] The full build, Obsidian compliance check, production bundle, and release-artifact guard pass.
- [x] Installed `main.js`, `manifest.json`, and `styles.css` match the inspected build byte-for-byte.
- [x] A live smoke test creates and mutates a page note from a native non-Markdown file view without changing the source file; automated reader tripwires verify that page-note operations do not read source bytes.

## Problem

Aside currently restricts page-note capability and note-sidebar targeting to Markdown, PDF, and HTML paths. Obsidian can display other vault files in file-backed tabs, including images, audio, video, canvas files, and formats supported by installed viewer plugins. Those files already have the two properties Aside needs: a stable `TFile` path and an active file-backed view. The extension whitelist unnecessarily blocks their page notes.

Aside should follow Obsidian's preview boundary instead of owning a second list of previewable formats. If Obsidian or another plugin exposes a file in a file-backed tab, Aside should allow file-level page notes. If no viewer exists, Aside should not add one or expose a separate targeting workflow.

## Goals

- Enable page notes for every real vault file that the user can view in an Obsidian file-backed tab.
- Make native and plugin-provided viewers feel identical from the Aside sidebar.
- Keep page-note storage independent of source bytes and file format.
- Preserve current mutation, index, sync, rename, and deletion behavior across file types.
- Keep text-selection anchors and editor integrations within their existing capability boundary.
- Eliminate the page-note extension whitelist as a source of future drift.

## Non-Goals

- Previewing a format that Obsidian and installed plugins cannot display.
- Registering a wildcard, generic, or format-specific file view.
- Parsing, converting, extracting, OCRing, or rendering source-file contents.
- Adding DOCX, PPTX, spreadsheet, EPUB, media, or archive dependencies.
- Adding file-explorer context actions, a file picker, or a viewer setting.
- Enabling selection-anchored comments on binary or non-editor views.
- Changing `/pdf-to-markdown` or the separate document-conversion design.

## User Experience

When the active Obsidian tab is backed by a real vault file, Aside follows that file and shows the normal note sidebar. The Add page note action creates a file-level thread using the same editor, cards, replies, deletion, pinning, and ordering controls already used by PDF page notes.

The source viewer remains untouched. Markdown keeps its editor and preview, PDF keeps the core PDF viewer, media keeps its native viewer, canvas keeps its canvas view, and a DOCX viewer supplied by another plugin keeps that plugin's UI. Aside owns only the adjacent page-note experience.

If the active tab is not file-backed, the note sidebar has no source target and must not fall back to the previously active Markdown file. If a viewer plugin is later disabled, existing page-note data remains stored and indexed but no source-tab page-note UI is invented until a file-backed viewer is available again.

## Capability Model

`src/core/rules/commentableFiles.ts` remains the shared owner of source capabilities.

- `isMarkdownCommentablePath` and `isMarkdownCommentableFile` retain the existing text-anchor boundary and generated-index exclusion.
- `isPageNoteCapablePath` becomes extension-independent: every normalized real file path except the configured generated Aside index is eligible for file-level storage and lifecycle handling.
- `isPageNoteCapableFile` requires a non-null `TFile` and delegates to the path rule.
- `isSidebarSupportedPath` continues to include the generated Aside index and otherwise delegates to page-note capability.
- `isSidebarSupportedFile` requires a non-null `TFile` and delegates to the sidebar path rule.

The path rule intentionally does not claim that Aside can preview the file. Preview availability is established by workspace context: page-note creation is reachable only when Obsidian supplies an active file-backed target. The broader file rule lets persistence and lifecycle code keep valid page-note data even when no viewer is currently open.

Format helpers remain only when another behavior genuinely depends on format. The HTML helper still owns rendered-HTML-specific mutation behavior. A PDF-only page-note helper with no production consumer should be removed rather than retained as a misleading second policy.

## Workspace and Sidebar Data Flow

1. Obsidian activates a leaf.
2. `WorkspaceContextController` resolves the leaf's current view state or `view.file` to a real `TFile`.
3. The shared sidebar capability accepts the file unless it is the generated Aside index, which retains its existing index-specific sidebar mode.
4. `resolveWorkspaceFileTargets` updates `activeSidebarFile` and the rendered sidebar target. It updates `activeMarkdownFile` only for the existing Markdown capability.
5. The sidebar loads page-note threads through current sidecar/sync persistence without reading source contents.
6. Add page note creates an `anchorKind: "page"` draft; save and subsequent mutations reuse the existing page-note controller path.

A leaf that exposes neither a file object nor a resolvable file path yields no file target. This preserves the existing protection against displaying comments for a stale Markdown note while a non-file tab is active.

## Storage, Mutation, and Lifecycle

Page-note operations remain format-agnostic:

- create a page-note thread;
- append and edit entries;
- delete, restore, and permanently clear;
- pin and unpin;
- reorder page-note threads;
- navigate from Aside index entries when Obsidian can open the source;
- update source paths after rename;
- clear stored/indexed data after source deletion.

The current move-thread picker remains Markdown-only and is not expanded by this feature. This avoids introducing a separate file-selection surface that could target files with no available viewer.

Persistence must never call `vault.read`, `vault.readBinary`, Markdown parsing, source fingerprinting from contents, or editor APIs merely because a page note exists. Source identity for these page-note-only files remains path-based or content-null, as it already is for PDF page notes.

Markdown selection anchors retain their current validation and rendering. Page-note mutations on any source suppress editor-decoration and Markdown-preview refresh work in the same way PDF page-note mutations do.

## Error Handling

- Active non-file tab: clear the source target; do not reuse the last Markdown file.
- Viewer unavailable: expose no new preview or source-tab action; preserve existing sidecar and index data.
- Source renamed: migrate the stored source path through the existing lifecycle flow.
- Source deleted: remove or retain data according to the existing Aside deletion policy and refresh the aggregate index.
- Source view closes during a draft or mutation: use existing target revalidation and report the current compact missing-source notice rather than saving against a stale file.
- Source content unreadable or binary: irrelevant to page notes because the feature never reads it.

## Testing Strategy

### Shared capability policy

Use table-driven tests for Markdown, PDF, HTML, PNG/JPEG, audio, video, canvas, DOCX, mixed-case extensions, extensionless files, the default/custom Aside index, and null file inputs. Prove the result is based on real-file identity and index exclusion rather than an extension allowlist.

### Workspace and UI

Cover a native non-Markdown `FileView`, a plugin-like DOCX file view, view state whose file path resolves before `view.file` updates, and a non-file view with no file state. Verify Add page note is present for valid targets and the unsupported/stale-file empty state is not shown for a valid `TFile`.

### Controllers and persistence

Exercise create, reply, edit, delete, pin, and reorder with representative image, canvas, and plugin-viewed document sources. Assert source-content readers and Markdown decoration refreshes are not called. Verify sidecar/sync reload and aggregate-index inclusion without a currently open viewer.

### Lifecycle and regression

Cover rename and deletion for representative non-Markdown sources. Keep existing Markdown anchor, PDF page-note, HTML, publishing, and PDF-to-Markdown suites green. Re-run the change-surface search so extension-specific page-note claims remain only in historical documentation or truly format-specific policy.

### Installed acceptance

Build and inspect the exact public assets, install them into the development vault, and confirm byte identity. Open a native non-Markdown file in Obsidian, create a page note, append and edit a reply, reload Aside, and confirm persistence without source-file modification. If a third-party file viewer is already installed, repeat targeting with one of its file-backed views; this is supplemental rather than required for release acceptance.

## Change-Surface Ownership

- File capability and generated-index exclusion: `src/core/rules/commentableFiles.ts`.
- Active file-backed target resolution: existing workspace context planner/controller.
- Page-note creation and mutations: existing comment entry/mutation controllers.
- Sidecar, sync, and aggregate index: existing persistence controller.
- Rename and deletion: existing plugin lifecycle controller.
- Viewer UI and source rendering: Obsidian core or another installed plugin, never Aside.

Generated `main.js` and installed plugin files remain build artifacts, not policy owners. Tests may name representative extensions, but production page-note eligibility must not rebuild an extension whitelist in another layer.
